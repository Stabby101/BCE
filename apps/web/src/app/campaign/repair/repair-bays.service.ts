/*
 * BCE — REPAIR & SALVAGE BAYS service (DIRECTIVE-033). The Angular seam around the pure bay math:
 * builds THE QUEUE from the live roster (walk-fed 'In repair' + cold-storage prizes + skirmish damage),
 * assigns/unassigns one occupant per bay snapshotting the CITED estimate, burns tech-hours per elapsed
 * campaign DAY through the D-022 clock (priority-weighted), and on completion CLEARS the damage envelope
 * (the D-030 round-trip in reverse), returns the unit to service (Active, or Reserve if its lance is
 * gone — captures have no lance so prizes land RESERVE with provenance intact), debits the treasury, and
 * logs + records bay history. B-tagged wrecks WRITE OFF (the D-029 delete path). All via persistCurrent;
 * the burn is the only mutation that does NOT persist (the clock's single advance-transaction owns that).
 */
import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { NewCampaignState, type CampaignStartDate } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { readDamage } from '../walk/field-walk-core';
import type { ProtoInstance } from '../force/force-generator';
import { estimateRepairJob, type RepairBill } from './repair-times';
import {
    BAY_TUNABLES, makeDefaultBays, freeBay, remainingHours, dailyAllocation, burnPool, generateTechPool, hasMechDamage,
    type Bay, type BayHistoryEntry, type TechPool,
} from './repair-bays';

const ACTIVE = 'Active';
const RESERVE = 'Reserve';
const REPAIR = 'In repair';
const COLD = 'Cold storage';
const SEV: Record<string, number> = { G: 0, Y: 1, R: 2, B: 3 };

/** A bay joined with its occupant's display fields (for the bay card). */
export interface BayView extends Bay { label?: string; occTons?: number; occTriage?: string; }

export type QueueKind = 'repair' | 'prize' | 'skirmish';
export interface QueueItem {
    instanceId: string;
    inst: ProtoInstance;
    label: string;
    tons: number;
    kind: QueueKind;          // walk-recovered | cold-storage prize | damaged-outside-missions
    triage: 'G' | 'Y' | 'R' | 'B';
    bill: RepairBill;         // the cited estimate (preview + the snapshot taken at assignment)
    writeOff: boolean;        // B-tag / destroyed → offer WRITE OFF instead of repair
}

@Injectable({ providedIn: 'root' })
export class RepairBaysService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly store = inject(CampaignSaveStore);

    constructor() {
        // HOTFIX-024 — self-heal the D-029 "no silent vanish". A unit can only be repaired if it HAS mech damage
        // (the queue at line ~queue() and the new roster 'In repair' gate both filter on hasMechDamage). A unit
        // stranded 'In repair' with NO damage (a legacy save from before the gate, or any future non-gated path) is
        // neither deployable (mission BV excludes 'In repair') nor repairable (the queue skips it) — it vanishes from
        // the bays. Auto-return it to service (Active, or Reserve if its lance is gone) and LOG it (not silent).
        // Idempotent: no stranded unit → no write, so a clean campaign never triggers this (and it terminates after
        // one revert — the reverted force has no stranded unit left).
        effect(() => {
            const force = this.state.startingForce() ?? [];
            if (!force.length) return;
            const occ = this.occupantIds();
            const stranded = force.filter((i) => i.condition === REPAIR && !occ.has(i.instanceId) && !hasMechDamage(i.damage));
            if (!stranded.length) return;
            untracked(() => {
                const today = this.today();
                const ids = new Set(stranded.map((i) => i.instanceId));
                this.state.setStartingForce(force.map((i) => ids.has(i.instanceId) ? { ...i, condition: i.lanceId ? ACTIVE : RESERVE } : i));
                this.state.setCampaignLog([...(this.state.campaignLog() ?? []), ...stranded.map((i) => (
                    { date: today, text: `${`${i.chassis} ${i.model}`.trim()} released from repair — no damage on record (returned to service)`, kind: 'repair' as const }))]);
                void this.store.persistCurrent();
            });
        });
    }

    /** The 4 bays (defaults until first mutation; pre-D-033 saves render the defaults). */
    readonly bays = computed<Bay[]>(() => this.state.bays() ?? makeDefaultBays());
    readonly history = computed<BayHistoryEntry[]>(() => this.state.bayHistory() ?? []);
    /** D-037: the stored tech-pool identity (null until ensureTechPool runs on first tab visit). */
    readonly techPool = computed<TechPool | null>(() => this.state.techPool());

    /** Generate the campaign's tech-pool identity ONCE (tier-keyed character; stored-not-rerolled).
     *  Returns true when it generated (the caller persists). */
    ensureTechPool(): boolean {
        if (this.state.techPool()) return false;
        this.state.setTechPool(generateTechPool(this.state.resources() || 'normal'));
        return true;
    }

    /** Bays joined with their occupant's display fields (label/tons/triage) for the cards. */
    readonly bayViews = computed<BayView[]>(() => {
        const force = this.state.startingForce() ?? [];
        return this.bays().map((b) => {
            const inst = b.occupantId ? force.find((i) => i.instanceId === b.occupantId) : undefined;
            return inst ? { ...b, label: `${inst.chassis} ${inst.model}`.trim(), occTons: inst.tons, occTriage: inst.triage } : { ...b };
        });
    });

    /** Tech labor capacity per elapsed day for this campaign's resource tier. */
    readonly perDayHours = computed<number>(() => {
        const tier = this.state.resources() || 'standard';
        return BAY_TUNABLES.techHoursPerDay[tier] ?? BAY_TUNABLES.techHoursPerDay['standard'];
    });
    /** Steady-state daily allocation per occupied bay (for the ETA estimate). */
    readonly allocation = computed<Record<string, number>>(() => dailyAllocation(this.bays(), this.perDayHours()));

    private occupantIds = computed<Set<string>>(() => new Set(this.bays().map((b) => b.occupantId).filter((x): x is string => !!x)));

    /** THE QUEUE — every damaged unit awaiting/eligible for a bay, tagged by kind, cited estimate attached. */
    readonly queue = computed<QueueItem[]>(() => {
        const occ = this.occupantIds();
        const force = this.state.startingForce() ?? [];
        const items: QueueItem[] = [];
        for (const inst of force) {
            if (occ.has(inst.instanceId)) continue;       // already in a bay
            if (!hasMechDamage(inst.damage)) continue;     // pristine / pilot-only injury
            const cond = inst.condition;
            const kind: QueueKind = cond === REPAIR ? 'repair' : cond === COLD ? 'prize' : 'skirmish';
            const unit = this.data.getUnitByName(inst.unitRef);
            const readout = readDamage(inst.damage, unit?.armor ?? 0);
            const triage = inst.triage ?? readout.severity;
            items.push({
                instanceId: inst.instanceId, inst, label: `${inst.chassis} ${inst.model}`.trim(), tons: inst.tons,
                kind, triage, bill: estimateRepairJob(inst.damage), writeOff: triage === 'B' || readout.unitDestroyed,
            });
        }
        const ord: Record<QueueKind, number> = { repair: 0, prize: 1, skirmish: 2 };
        return items.sort((a, b) => ord[a.kind] - ord[b.kind] || (SEV[b.triage] ?? 0) - (SEV[a.triage] ?? 0) || b.tons - a.tons);
    });

    /** Free bays available to receive an assignment. */
    readonly freeBays = computed<Bay[]>(() => this.bays().filter((b) => !b.occupantId));

    private today(): CampaignStartDate {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
    }

    /** Estimated C-bill cost for a job of `hours`. */
    cost(hours: number): number {
        return Math.round(hours * BAY_TUNABLES.cbillsPerTechHour);
    }
    /** Over-treasury check (the WARN at assignment; assignment still proceeds knowingly). */
    wouldExceedTreasury(amount: number): boolean {
        return amount > (this.state.treasury() ?? 0);
    }
    /** ETA in campaign days for a bay's remaining job at the steady-state allocation (null = no capacity). */
    etaDays(bay: Bay): number | null {
        const rem = remainingHours(bay);
        if (rem <= 0) return 0;
        const rate = this.allocation()[bay.id] ?? 0;
        return rate > 0 ? Math.ceil(rem / rate) : null;
    }

    /** Assign a queued unit to a free bay, snapshotting the cited estimate. Persists. */
    assign(instanceId: string, bayId: string): void {
        if (this.occupantIds().has(instanceId)) return;
        const target = this.bays().find((b) => b.id === bayId);
        if (!target || target.occupantId) return;
        const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
        if (!inst) return;
        const bill = estimateRepairJob(inst.damage);
        const today = this.today();
        const bays = this.bays().map((b) => b.id === bayId ? {
            ...b, occupantId: instanceId, laborHours: bill.totalHours, hoursSpent: 0,
            estimateCost: this.cost(bill.totalHours), bill: bill.lines, notes: bill.notes,
            assignedDate: today, isPrize: inst.condition === COLD,
        } : b);
        // a unit in a bay is 'In repair' (skirmish + prize transition in; the walk-fed already are)
        if (inst.condition !== REPAIR) {
            this.state.setStartingForce((this.state.startingForce() ?? []).map((i) =>
                i.instanceId === instanceId ? { ...i, condition: REPAIR } : i));
        }
        this.state.setBays(bays);
        void this.store.persistCurrent();
    }

    /** Pull a unit out of its bay (job reset; the unit returns to the queue 'In repair'). Persists. */
    unassign(bayId: string): void {
        const bays = this.bays();
        if (!bays.find((b) => b.id === bayId)?.occupantId) return;
        this.state.setBays(bays.map((b) => b.id === bayId ? freeBay(b) : b));
        void this.store.persistCurrent();
    }

    /**
     * Burn tech-hours for `days` elapsed campaign days (called inside the clock's advance transaction —
     * does NOT persist; the clock persists once after). Priority-weighted with spillover; completed jobs
     * settle immediately.
     */
    burnDays(days: number): void {
        if (days <= 0) return;
        const bays = this.bays();
        if (!bays.some((b) => b.occupantId && remainingHours(b) > 0)) return;
        const { bays: burned, completedIds } = burnPool(bays, this.perDayHours() * days);
        if (!completedIds.length) { this.state.setBays(burned); return; }
        this.settle(burned, completedIds);
    }

    /** Completion: clear the envelope, return to service, debit, log + history, free the bays. No persist. */
    private settle(burned: Bay[], completedIds: string[]): void {
        const today = this.today();
        let force = [...(this.state.startingForce() ?? [])];
        const log = [...(this.state.campaignLog() ?? [])];
        const history = [...this.history()];
        let treasury = this.state.treasury() ?? 0;

        for (const id of completedIds) {
            const bay = burned.find((b) => b.id === id);
            if (!bay?.occupantId) continue;
            const inst = force.find((i) => i.instanceId === bay.occupantId);
            const label = inst ? `${inst.chassis} ${inst.model}`.trim() : bay.occupantId;
            const cost = bay.estimateCost;
            if (inst) {
                // envelope CLEARS (fully repaired); back to service — Active, or Reserve if the lance is gone
                // (captures carry no lanceId, so prizes land RESERVE) — provenance is preserved by the spread.
                const condition = inst.lanceId ? ACTIVE : RESERVE;
                force = force.map((i) => i.instanceId === inst.instanceId
                    ? { ...i, damage: undefined, triage: undefined, condition } : i);
            }
            treasury -= cost;
            log.push({ date: today, text: `Repairs complete — ${label} restored to service (${bay.laborHours} h · −${cost.toLocaleString('en-US')} C-bills · Bay ${bay.name})`, kind: 'repair' });
            // D-037: the itemized bill + gap-notes SURVIVE onto the record (the AAR joins them;
            // history reads like a shop record). Forward-only — older entries render honest absence.
            history.unshift({ date: today, bayId: bay.id, bayName: bay.name, instanceId: bay.occupantId, label, laborHours: bay.laborHours, cost, outcome: 'completed', bill: bay.bill, notes: bay.notes });
        }

        const nextBays = burned.map((b) => completedIds.includes(b.id) ? freeBay(b) : b);
        this.state.setStartingForce(force);
        this.state.setTreasury(treasury);
        this.state.setCampaignLog(log);
        this.state.setBays(nextBays);
        this.state.setBayHistory(history);
    }

    /** WRITE OFF a B-tagged wreck — the D-029 delete path + a dated log + history. Persists. */
    writeOff(instanceId: string): void {
        const force = this.state.startingForce() ?? [];
        const inst = force.find((i) => i.instanceId === instanceId);
        if (!inst) return;
        const label = `${inst.chassis} ${inst.model}`.trim();
        const today = this.today();
        const heldBay = this.bays().find((b) => b.occupantId === instanceId);
        if (heldBay) this.state.setBays(this.bays().map((b) => b.id === heldBay.id ? freeBay(b) : b));
        this.state.setStartingForce(force.filter((i) => i.instanceId !== instanceId));
        this.state.setPilots((this.state.pilots() ?? []).map((p) => p.assignedInstanceId === instanceId ? { ...p, assignedInstanceId: undefined } : p));
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text: `Wrote off ${label} — beyond economical repair (write-off)`, kind: 'repair' }]);
        this.state.setBayHistory([{ date: today, bayId: heldBay?.id ?? '—', bayName: heldBay?.name ?? '—', instanceId, label, laborHours: 0, cost: 0, outcome: 'written-off' }, ...this.history()]);
        void this.store.persistCurrent();
    }
}
