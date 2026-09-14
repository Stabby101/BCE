/*
 * FORKED FROM campaign/repair/repair-bays.service.ts @ dd1a717 — DIRECTIVE-ODM-13 Phase 2 (a DRIFT SURFACE).
 * The SURVIVAL bays: repair costs TIME and PARTS — the two things a resistance actually spends.
 *   R3 (HARD): a replace-action requires the named component in inventory (exact line, else a compatible
 *   donor-stripped line). Present → the job runs and DEBITS ON COMPLETION, never on start (an interrupted
 *   job half-consumes nothing). Absent → the WHOLE JOB HOLDS naming the component (Bay.heldFor) — the
 *   recourse is the game: salvage one, strip a donor. Armor/structure work stays time-gated as today.
 *   REARM-FROM-BINS (dry-not-held): completion computes the ammo RESTORED from the damage state
 *   (consumed/totalAmmo per slot — game truth) and DEBITS the matching odmStocks bin; an insufficient bin
 *   completes the repair DRY on that weapon with the shortfall stated. A rearm-driven floor crossing
 *   renders BREACH per ODM-11 — the system working, not a bug.
 *   DONOR-STRIP (Ruling 4): a COLD hulk → inventory lines + bin tonnage via THE SAME odm-materiel math as
 *   the walk (one tunable block), destroying the instance — one direction, no round-trip.
 * THE C-BILL CALL SITES DO NOT EXIST IN THIS FILE — no cost(), no cbillsPerTechHour, no setTreasury
 * (the Phase-1 by-construction standard). The burn is driven by a fork-owned currentDate effect (the
 * shared clock's burnDays call is pack-gated — the 5th sanctioned gate; classic→odm imports are fenced).
 */
import { Injectable, computed, effect, inject, isDevMode, untracked } from '@angular/core';
import { NewCampaignState, type CampaignStartDate } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { readDamage } from '../walk/field-walk-core';
import type { ProtoInstance } from '../force/force-generator';
import { estimateRepairJob, type RepairBill } from '../repair/repair-times';
import {
    BAY_TUNABLES, makeDefaultBays, freeBay, remainingHours, dailyAllocation, hasMechDamage, // ODM-17 P1: the rolled mint is GONE · P4: burnPool too — the LADDER allocates, bay weights are dead
    type Bay, type BayHistoryEntry,
} from '../repair/repair-bays';
import { daysBetween } from '../clock/campaign-clock';
import { odmStartingStocks, round1 } from './odm-stocks';
import { odmStripYield, addAmmoToBins, addPartLine, rearmNeeds, ODM_BENCH, effGrades, installableCount, consumeInstallable, heldRecourse } from './odm-materiel'; // ODM-17 P3 — grades and the lifecycle
import type { OdmBenchJob, CampaignLogEntry } from '../new-campaign-state';
import { OdmShopService } from './odm-shop.service'; // ODM-17 P1 — the authored facility (MAC-7, D39 pools)

/* ── DIRECTIVE-ODM-17 P4-a — THE 30-DAY MAINTENANCE CYCLE (the doctrine's own figures, not tunables):
 * "Every BattleMech requires a full maintenance cycle at MAC-7 once every 30 days regardless of combat
 * damage … It comes before salvage repairs in the tech-hour budget." Hours = the doctrine's repair-table
 * row: "Full 30-day maintenance cycle — MAC-7 only — 18-24 hrs — Light: 18hrs. Heavy usage previous
 * cycle: up to 24hrs." HEAVY = the machine took the field during the cycle window (the honest BCE key:
 * fieldWalk blufor rows + engaged bluforIds, dated — the recon'd derivation; nothing else records
 * deployment per-instance). The breakdown check is canon §4 (repair_time_canonical): 2D6 + (overdue
 * months − 1), 10+ = failure, 1D6−3 crits (min 0) against the REAR ARC, rolled MONTHLY per overdue
 * machine. Canon's twice-monthly clause requires short parts AND short techs — the tech half cannot
 * honestly occur in BCE (the no-hiring economy fixes headcount), so that branch is coded and
 * structurally unreachable, stated here rather than faked. */
export const ODM_MAINTENANCE = {
    cycleDays: 30,
    lightHours: 18,
    heavyHours: 24,
    breakdownThreshold: 10, // 2D6 result at/above = failure (canon §4)
} as const;

const ACTIVE = 'Active';
const RESERVE = 'Reserve';
const REPAIR = 'In repair';
const COLD = 'Cold storage';
const SEV: Record<string, number> = { G: 0, Y: 1, R: 2, B: 3 };

export interface BayView extends Bay { label?: string; occTons?: number; occTriage?: string; }
export type QueueKind = 'repair' | 'prize' | 'skirmish';
export interface QueueItem {
    instanceId: string;
    inst: ProtoInstance;
    label: string;
    tons: number;
    kind: QueueKind;
    triage: 'G' | 'Y' | 'R' | 'B';
    bill: RepairBill;
    writeOff: boolean;
    missingParts: string[]; // ODM-13 P2 — replace-components NOT currently in stores (advisory at queue time)
}

@Injectable({ providedIn: 'root' })
export class OdmRepairBaysService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly store = inject(CampaignSaveStore);
    private readonly shop = inject(OdmShopService); // ODM-17 P1

    /** The fork burn driver: a currentDate effect (the shared clock cannot import the fork — the fence).
     *  Tracks the last-seen date; a forward move burns the delta days. First sight (hydrate/mount) only
     *  arms the tracker — no burn on load, mirroring the clock-transaction semantics. */
    private lastSeen: CampaignStartDate | null = null;

    constructor() {
        // HOTFIX-024 self-heal (copied): a unit stranded 'In repair' with NO damage returns to service, logged.
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
        // ODM-17 P4-c — the D36 bay-type migration, forward-only: ENGINE (and the dormant FIELD) retire to
        // GENERAL; a null-bays campaign materializes the migrated seed so fresh ODM campaigns are born D36.
        effect(() => {
            if (this.state.packId() !== 'odm') return;
            const bays = this.state.bays();
            const needsSeed = bays === null;
            const needsMigrate = (bays ?? []).some((b) => (b.type as string) === 'ENGINE' || (b.type as string) === 'FIELD');
            if (!needsSeed && !needsMigrate) return;
            untracked(() => {
                const next = (bays ?? makeDefaultBays()).map((b) => ((b.type as string) === 'ENGINE' || (b.type as string) === 'FIELD') ? { ...b, type: 'GENERAL' as const } : b);
                this.state.setBays(next);
                if (!needsSeed && needsMigrate) { // an EXISTING campaign's bays migrated (a fresh seed lands silently, born D36)
                    this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: this.today(), text: 'Bay register — ENGINE retired (D36): dead label normalized to GENERAL; bays are GENERAL or SALVAGE', kind: 'repair' as const }]);
                }
                void this.store.persistCurrent();
            });
        });
        // ODM-13 P2 — the fork burn driver (see above). Fires after any clock advance lands the new date.
        // ODM-17 P1 — the driver WAITS for the shop: hours derive from the authored pools, so burning at
        // an unloaded shop's 0 h/day would eat days for nothing. lastSeen arms only once pools are known;
        // the accumulated delta burns on the first tick after the shop lands (the effect reads shop.shop()
        // so the load itself re-fires it). Shop never loads (unentitled/offline) → no burn, honestly.
        effect(() => {
            const cur = this.state.currentDate();
            const shopLoaded = !!this.shop.shop();
            if (!cur) return;
            untracked(() => {
                if (this.state.packId() !== 'odm') { this.lastSeen = cur; return; }
                if (!shopLoaded) return; // not armed — the delta waits for the authored pools
                const prev = this.lastSeen;
                this.lastSeen = cur;
                if (!prev) return; // arm only — no burn on hydrate/mount
                const days = daysBetween(prev, cur);
                if (days > 0) this.burnDays(days);
            });
        });
    }

    readonly bays = computed<Bay[]>(() => this.state.bays() ?? makeDefaultBays());
    readonly history = computed<BayHistoryEntry[]>(() => this.state.bayHistory() ?? []);

    /* ODM-17 P1-a — THE FORGE BLEED KILLED. The fork's pool identity is AUTHORED (packs/odm/shop.json:
     * MAC-7 Station, MacCready's) — generateTechPool (the rolled "Halvorsen 7"-class syllable mint)
     * NEVER runs under the pack, and this fork no longer reads OR writes the persisted techPool state:
     * a pre-P1 campaign's rolled pool becomes inert residue (the 12b staffVoices precedent — nothing
     * cleared, nothing migrated, D-0b untouched). Classic's own service keeps its mint byte-identical. */
    readonly shopFile = this.shop.shop;
    ensureTechPool(): boolean {
        void this.shop.ensureLoaded(); // authored identity — fetched, never minted
        // ODM-17 P1-b (the dev fail-loud, fork-side): the shared tier table silently falls back on an
        // unrecognized key — exactly how ODM ran at 80 h/day for a year. The fork no longer keys hours
        // off the tier at all; this guard makes any future tier-keyed read impossible to miss in dev.
        const tier = this.state.resources() || '(unset)';
        if (isDevMode() && !(tier in BAY_TUNABLES.techHoursPerDay)) {
            console.error(`[odm-repair-bays] resource tier '${tier}' has NO techHoursPerDay key — the shared table would silently fall back to 'standard'. The fork derives hours from shop.json (headcount × hoursPerTechDay); never key hours off the tier.`);
        }
        return false; // nothing persisted — the shop is pack data
    }

    readonly bayViews = computed<BayView[]>(() => {
        const force = this.state.startingForce() ?? [];
        return this.bays().map((b) => {
            const inst = b.occupantId ? force.find((i) => i.instanceId === b.occupantId) : undefined;
            return inst ? { ...b, label: `${inst.chassis} ${inst.model}`.trim(), occTons: inst.tons, occTriage: inst.triage } : { ...b };
        });
    });

    /* ODM-17 P1-c — hours are DERIVED from the authored pools (headcount × hoursPerTechDay), never the
     * tier table (the 'normal'-key fallback bug dies structurally: there is no tier read to fall back).
     * Null while the shop loads → 0 h/day and the burn driver WAITS (no days are lost — the delta burns
     * on the first tick after the shop lands, because lastSeen only arms once the shop is loaded). */
    readonly perDayHours = computed<number>(() => this.shop.poolHours('mac7') ?? 0);
    readonly fieldPoolHours = computed<number>(() => this.shop.poolHours('field') ?? 0); // rendered P1; consumed P2
    /** TESTER-ODM-1 #6 — per-pool DERIVED hours for the bays header (the coupling choke point, not the raw
     *  headcount × rate the header used to recompute). */
    poolHoursOf(id: string): number { return this.shop.poolHours(id) ?? 0; }
    /* ODM-17 P1-d — THE COMMIT/RELEASE LEDGER, derived not persisted (a second book cannot drift):
     * committed = Σ remaining estimated hours across occupied bays (assignment commits the estimate by
     * construction; completion/unassign/write-off release it the same way). Over-commitment is VISIBLE
     * (amber past one day's capacity — the doctrine's own rule: too much scheduled work means the
     * lowest-priority items do not get done; Phase 4 enforces the ladder, P1 shows the truth). */
    readonly committedHours = computed<number>(() =>
        Math.round(this.bays().reduce((s, b) => s + (b.occupantId ? Math.max(0, remainingHours(b)) : 0), 0) * 100) / 100);
    readonly allocation = computed<Record<string, number>>(() => dailyAllocation(this.bays(), this.perDayHours()));
    private occupantIds = computed<Set<string>>(() => new Set(this.bays().map((b) => b.occupantId).filter((x): x is string => !!x)));

    /** THE QUEUE — with the R3 advisory: which replace-components are missing from stores right now. */
    readonly queue = computed<QueueItem[]>(() => {
        const occ = this.occupantIds();
        const force = this.state.startingForce() ?? [];
        const lines = this.state.inventory()?.lines ?? [];
        const items: QueueItem[] = [];
        for (const inst of force) {
            if (occ.has(inst.instanceId)) continue;
            if (!hasMechDamage(inst.damage)) continue;
            const cond = inst.condition;
            const kind: QueueKind = cond === REPAIR ? 'repair' : cond === COLD ? 'prize' : 'skirmish';
            const unit = this.data.getUnitByName(inst.unitRef);
            const readout = readDamage(inst.damage, unit?.armor ?? 0);
            const triage = inst.triage ?? readout.severity;
            const bill = estimateRepairJob(inst.damage);
            items.push({
                instanceId: inst.instanceId, inst, label: `${inst.chassis} ${inst.model}`.trim(), tons: inst.tons,
                kind, triage, bill, writeOff: triage === 'B' || readout.unitDestroyed,
                missingParts: this.missingFor(this.neededParts(inst, unit), lines),
            });
        }
        const ord: Record<QueueKind, number> = { repair: 0, prize: 1, skirmish: 2 };
        return items.sort((a, b) => ord[a.kind] - ord[b.kind] || (SEV[b.triage] ?? 0) - (SEV[a.triage] ?? 0) || b.tons - a.tons);
    });

    /** COLD hulks eligible for donor-strip (Ruling 4 — captured or mothballed machines become parts). */
    readonly donors = computed(() => (this.state.startingForce() ?? []).filter((i) => i.condition === COLD)
        .map((i) => { const unit = this.data.getUnitByName(i.unitRef); const sev = i.triage ?? readDamage(i.damage, unit?.armor ?? 0).severity; return { inst: i, label: `${i.chassis} ${i.model}`.trim(), sev, yield: odmStripYield(i, unit, sev) }; }));

    readonly freeBays = computed<Bay[]>(() => this.bays().filter((b) => !b.occupantId));

    private today(): CampaignStartDate {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
    }

    /** R3 — WHAT COUNTS AS A PART: the destroyed crits whose PROPER NAMES appear in the unit's own
     *  equipment list (comp, E/M/B/A/C). The shared bill's replace lines carry FAMILY labels ("Weapon (1)")
     *  — display prose, not a supply key — so the gate reads the DAMAGE ENVELOPE ∩ the catalog equipment
     *  instead: exactly the vocabulary the walk/donor strips stock (the loop closes lexically by
     *  construction). Engine/gyro/cockpit/actuators never appear in comp → they stay TIME-GATED like
     *  armor/structure — deliberate: no strip can supply an engine, and R3's hold is only honest where the
     *  in-loop recourse exists (holding an engine kill forever would be the lockout the ruling forbids). */
    private neededParts(inst: ProtoInstance, unit: { comp?: { n: string; t: string }[] } | undefined): string[] {
        const equip = new Map<string, string>(); // lower-name → display name
        for (const c of unit?.comp ?? []) if (['E', 'M', 'B', 'A', 'C'].includes(c.t)) equip.set(c.n.toLowerCase().trim(), c.n);
        const needed: string[] = [];
        for (const c of (inst.damage?.crits ?? [])) {
            if (!c.destroyed) continue;
            const key = (c.name || c.originalName || '').toLowerCase().trim();
            const disp = equip.get(key);
            if (disp) needed.push(disp);
        }
        return needed;
    }

    /** The R3 gate math — ODM-17 P3: only INSTALLABLE grades satisfy a replace-component: A (ready) or C
     *  (installs with its parts-repair hours ledgered). B needs its bench inspection first; RAW cannot be
     *  installed until reclassified (doctrine Part VI) — a pre-P3 line reads all-A via effGrades. */
    private missingFor(components: string[], lines: import('../inventory/starting-inventory').InventoryLine[]): string[] {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const budget = new Map<string, number>();
        const missing: string[] = [];
        for (const c of components) {
            const key = norm(c);
            if (!budget.has(key)) budget.set(key, installableCount(lines, c));
            const have = budget.get(key)!;
            if (have > 0) budget.set(key, have - 1);
            else missing.push(c);
        }
        return missing;
    }

    etaDays(bay: Bay): number | null {
        const rem = remainingHours(bay);
        if (rem <= 0) return 0;
        const rate = this.allocation()[bay.id] ?? 0;
        return rate > 0 ? Math.ceil(rem / rate) : null;
    }

    /** ODM-17 P4-b — the doctrine's default job priority from triage: B→P1, R→P2, Y→P3, G→P4. */
    private priorityFromTriage(inst: ProtoInstance): 1 | 2 | 3 | 4 {
        const t = inst.triage ?? readDamage(inst.damage, 0).severity;
        return ({ B: 1, R: 2, Y: 3, G: 4 } as const)[t] ?? 3;
    }

    /** Assign — snapshot the bill; estimateCost is 0 BY CONSTRUCTION (no bench rate exists here).
     *  ODM-17 P4: the job's LADDER priority stamps from triage (GM-adjustable after); a PRIZE REFIT
     *  (cold-storage hulk) routes through a SALVAGE bay ONLY — the D36 rule made real. */
    assign(instanceId: string, bayId: string): boolean { // ODM-18 P1 — belts report refusal (audit lines gate on it); GM UI ignores the return, behavior unchanged
        if (this.occupantIds().has(instanceId)) return false;
        const target = this.bays().find((b) => b.id === bayId);
        if (!target || target.occupantId) return false;
        const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
        if (!inst) return false;
        if (inst.condition === COLD && target.type !== 'SALVAGE') return false; // prize-refit is SALVAGE-bay work (the UI filters; this is the belt)
        const bill = estimateRepairJob(inst.damage);
        const today = this.today();
        const bays = this.bays().map((b) => b.id === bayId ? {
            ...b, occupantId: instanceId, laborHours: bill.totalHours, hoursSpent: 0,
            estimateCost: 0, bill: bill.lines, notes: bill.notes,
            assignedDate: today, isPrize: inst.condition === COLD, heldFor: undefined, lastNote: undefined,
            jobPriority: this.priorityFromTriage(inst),
        } : b);
        if (inst.condition !== REPAIR) {
            this.state.setStartingForce((this.state.startingForce() ?? []).map((i) =>
                i.instanceId === instanceId ? { ...i, condition: REPAIR } : i));
        }
        this.state.setBays(bays);
        void this.store.persistCurrent();
        return true;
    }

    unassign(bayId: string): boolean {
        const bays = this.bays();
        if (!bays.find((b) => b.id === bayId)?.occupantId) return false;
        this.state.setBays(bays.map((b) => b.id === bayId ? freeBay(b) : b));
        void this.store.persistCurrent();
        return true;
    }

    /** Burn tech-hours over elapsed days. Unlike Classic: held (already-full) bays re-enter the settle
     *  attempt every burn, so a job held for parts RELEASES when supply arrives. Persists on change. */
    burnDays(days: number): void {
        if (days <= 0) { this.settleAttempt(this.bays()); return; }
        // ── ODM-17 P4-b — THE STRICT LADDER (bay weights are DEAD; burnPool's priority-weighted spill is
        //    not called here anymore): MAINTENANCE (the doctrine's budget precedence) → P1 → P2 → the
        //    BENCH (the PM's placement — the doctrine is silent on bench rank) → P3 → P4. Sequential
        //    allocation IS the strictness: a lower tier sees only what the higher tiers left; a job held
        //    for parts has no remaining hours, so it is STARVED, never BLOCKING (the card says so). ──
        let remaining = this.perDayHours() * days;
        remaining = this.runMaintenance(remaining);
        const bays = this.bays().map((b) => ({ ...b }));
        const r2 = (n: number): number => Math.round(n * 100) / 100; // bills are 2-dp — the shared burn's own precision (round1 here ate a 1.84 h job's tail and stranded it)
        const burnTier = (p: number): void => {
            for (const b of bays.filter((x) => x.occupantId && remainingHours(x) > 0.01 && this.jobPriorityOf(x) === p)) {
                if (remaining <= 0.01) break;
                const take = Math.min(remaining, remainingHours(b));
                b.hoursSpent = r2(b.hoursSpent + take);
                remaining = r2(remaining - take);
            }
        };
        burnTier(1); burnTier(2);
        remaining = this.burnBench(remaining); // P3-b's bench — lands BEFORE settle so a fresh part frees a held bay this boundary
        burnTier(3); burnTier(4);
        const ids = bays.filter((b) => b.occupantId && remainingHours(b) <= 0.01).map((b) => b.id);
        if (!ids.length) { this.state.setBays(bays); void this.store.persistCurrent(); return; }
        this.settle(bays, ids);
    }

    // ── ODM-17 P4-a — THE MAINTENANCE MACHINERY (see ODM_MAINTENANCE for the source figures). ──

    /** The per-machine cycle view (renders + the burn read the same derivation — never stored totals).
     *  Cold-storage hulks are mothballed and do not cycle (DECISION, flagged: the doctrine says "every
     *  BattleMech"; a mothballed hulk drawing 18 h/30 d would starve the shop for machines that never
     *  move — the active muster cycles). */
    readonly maintenanceView = computed(() => {
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
        const recs = this.state.odmMaintenance();
        return (this.state.startingForce() ?? []).filter((i) => i.condition !== COLD).map((i) => {
            const rec = recs[i.instanceId] ?? {};
            const anchor = rec.lastDone ?? this.state.startDate() ?? today;
            const daysSince = daysBetween(anchor, today);
            const due = daysSince >= ODM_MAINTENANCE.cycleDays;
            // OVERDUE renders past day 30; the canon BREAKDOWN cadence is per full MONTH missed (the first
            // roll lands a month after the cycle came due — canon: "after the FIRST month", escalating).
            const overdueMonths = Math.max(0, Math.floor((daysSince - ODM_MAINTENANCE.cycleDays) / ODM_MAINTENANCE.cycleDays));
            const heavy = due && (rec.needHours != null ? rec.needHours === ODM_MAINTENANCE.heavyHours : this.deployedSince(i.instanceId, anchor));
            const need = rec.needHours ?? (heavy ? ODM_MAINTENANCE.heavyHours : ODM_MAINTENANCE.lightHours);
            return { inst: i, label: `${i.chassis} ${i.model}`.trim(), daysSince, due, overdue: daysSince > ODM_MAINTENANCE.cycleDays, overdueMonths, heavy, need, progress: rec.progressHours ?? 0 };
        });
    });
    readonly maintenanceDue = computed(() => this.maintenanceView().filter((m) => m.due).sort((a, b) => b.daysSince - a.daysSince));

    /** The recon'd HONEST deployment key: fieldWalk blufor rows (dated) + a pending walk's engaged ids. */
    private deployedSince(instanceId: string, since: CampaignStartDate): boolean {
        for (const br of this.state.missionTree() ?? []) {
            const r = br.resolution;
            if (!r) continue;
            const when = r.fieldWalk?.walkedDate ?? r.resolvedDate;
            if (!when || daysBetween(since, when) < 0) continue;
            if (r.fieldWalk?.rows?.some((w) => w.side === 'blufor' && w.instanceId === instanceId)) return true;
            if (r.engaged?.bluforIds?.includes(instanceId)) return true;
        }
        return false;
    }

    /** Maintenance burns FIRST (the doctrine: "It comes before salvage repairs in the tech-hour budget").
     *  Most-overdue machines first; overdue months roll the canon §4 breakdown check BEFORE hours land
     *  (the check fires on the calendar, not on shop capacity). Returns the unspent hours. */
    private runMaintenance(hours: number): number {
        if (this.state.packId() !== 'odm') return hours;
        const today = this.today();
        const recs = { ...this.state.odmMaintenance() };
        let force = [...(this.state.startingForce() ?? [])];
        const log: CampaignLogEntry[] = [];
        let rem = hours;
        let touched = false;
        for (const m of this.maintenanceDue()) {
            const rec = recs[m.inst.instanceId] ?? {};
            // the canon breakdown check — once per NEW overdue month (2D6 + months−1, 10+ fails, 1D6−3 rear-arc crits)
            const rolled = rec.lastRollMonths ?? 0;
            for (let month = rolled + 1; month <= m.overdueMonths; month++) {
                const roll = 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + (month - 1);
                if (roll >= ODM_MAINTENANCE.breakdownThreshold) {
                    const nCrits = Math.max(0, 1 + Math.floor(Math.random() * 6) - 3);
                    const applied = nCrits > 0 ? this.applyBreakdownCrits(force, m.inst.instanceId, nCrits) : [];
                    force = [...(this.state.startingForce() ?? [])]; // the crit writer persisted a fresh force — re-read for the next machine
                    log.push({ date: today, text: `BREAKDOWN — ${m.label} missed its maintenance cycle (month ${month} overdue): check ${roll} vs ${ODM_MAINTENANCE.breakdownThreshold}+ FAILED${applied.length ? ` — ${applied.join(', ')}` : nCrits === 0 ? ' — no critical damage this time' : ''}`, kind: 'repair' });
                } else {
                    log.push({ date: today, text: `Maintenance overdue — ${m.label} (month ${month}): breakdown check ${roll} vs ${ODM_MAINTENANCE.breakdownThreshold}+ held`, kind: 'repair' });
                }
                touched = true;
            }
            if (m.overdueMonths > rolled) recs[m.inst.instanceId] = { ...rec, lastRollMonths: m.overdueMonths, needHours: m.need, progressHours: m.progress };
            // the cycle's hours (the budget precedence — maintenance eats the pool before any bay job)
            if (rem <= 0.01) continue;
            const prog = recs[m.inst.instanceId]?.progressHours ?? m.progress;
            const take = Math.min(rem, Math.max(0, m.need - prog));
            if (take <= 0) continue;
            rem = round1(rem - take);
            const newProg = round1(prog + take);
            touched = true;
            if (newProg >= m.need - 0.01) {
                recs[m.inst.instanceId] = { lastDone: today };
                log.push({ date: today, text: `Maintenance cycle complete — ${m.label} (${m.need} h${m.heavy ? ' — heavy usage previous cycle' : ''})`, kind: 'repair' });
            } else {
                recs[m.inst.instanceId] = { ...(recs[m.inst.instanceId] ?? {}), needHours: m.need, progressHours: newProg };
            }
        }
        if (touched) {
            this.state.odmMaintenance.set(recs);
            if (log.length) this.state.setCampaignLog([...(this.state.campaignLog() ?? []), ...log]);
        }
        return rem;
    }

    /** ODM-17 P4-a — the breakdown CRIT WRITER: BCE campaign code's first crit minter, on the sheet-write
     *  pattern (the walk's damage READER is the precedent; CriticalSlot has no rear encoding — the rear
     *  arc is the canon HIT TABLE, so the crit lands in a rear-arc-rolled torso location). Destroys a
     *  random live equipment comp in the rolled location; a location with no equipment takes internal
     *  structure instead. Returns human-readable descriptions; writes force state. */
    private applyBreakdownCrits(force: ProtoInstance[], instanceId: string, n: number): string[] {
        const idx = force.findIndex((i) => i.instanceId === instanceId);
        if (idx < 0) return [];
        const inst = force[idx];
        const unit = this.data.getUnitByName(inst.unitRef);
        // an undamaged machine gains a minimal damage envelope (crew/heat neutral — the same fields the
        // battle writer serializes; readers null-tolerate all of them)
        const damage = (inst.damage
            ? { ...inst.damage, crits: [...(inst.damage.crits ?? [])], locations: { ...(inst.damage.locations ?? {}) } }
            : { crew: [], crits: [], locations: {}, heat: undefined }) as NonNullable<ProtoInstance['damage']>;
        const applied: string[] = [];
        const destroyedNames = new Set(damage.crits.filter((c) => !!c.destroyed).map((c) => (c.name || '').toLowerCase()));
        for (let i = 0; i < n; i++) {
            const loc = ['LT', 'CT', 'RT'][Math.floor(Math.random() * 3)];
            const candidates = (unit?.comp ?? []).filter((c) => ['E', 'M', 'B', 'A', 'C'].includes(c.t) && (c.l ?? '').split('/').includes(loc) && !destroyedNames.has(c.n.toLowerCase()));
            if (candidates.length) {
                const hit = candidates[Math.floor(Math.random() * candidates.length)];
                damage.crits.push({ id: `${hit.n}@${loc}#breakdown`, loc, name: hit.n, destroyed: Date.now() });
                destroyedNames.add(hit.n.toLowerCase());
                applied.push(`${hit.n} (${loc}) destroyed`);
            } else {
                const cur = (damage.locations[loc] ?? {}) as { internal?: number };
                damage.locations[loc] = { ...cur, internal: (cur.internal ?? 0) + 1 };
                applied.push(`internal structure damage (${loc})`);
            }
        }
        const next = [...force];
        next[idx] = { ...inst, damage };
        this.state.setStartingForce(next);
        return applied;
    }

    // ── ODM-17 P3-b — THE BENCH (doctrine: "Component bench test and assessment — MAC-7 only — 1-4 hrs
    //    per item"). Items live IN-SHOP (out of the stores) while the hours burn; landings are CACHED
    //    grades / cleared tonnage, each a ledger row. FIFO within the leftover; P4 brings the ladder. ──
    private burnBench(leftover: number): number {
        if (leftover <= 0.01) return leftover;
        const jobs = this.state.odmBench();
        if (!jobs.length) return leftover;
        const today = this.today();
        let rem = leftover;
        const next: OdmBenchJob[] = [];
        const landed: OdmBenchJob[] = [];
        for (const j of jobs) {
            if (rem <= 0.01) { next.push(j); continue; }
            const take = Math.min(rem, j.hoursRemaining);
            rem = round1(rem - take);
            const left = round1(j.hoursRemaining - take);
            if (left <= 0.01) landed.push(j); else next.push({ ...j, hoursRemaining: left });
        }
        if (!landed.length && next.every((j, i) => j === jobs[i])) return rem;
        const inv = this.state.inventory();
        const invLines = inv ? [...inv.lines] : [];
        const stocks = this.state.odmStocks() ?? odmStartingStocks();
        const bins = { ...stocks.bins };
        const log = [...(this.state.campaignLog() ?? [])];
        let invTouched = false, binsTouched = false;
        for (const j of landed) {
            if (j.kind === 'ammo') {
                const b = bins[j.label] ?? { tons: 0, floorTons: null };
                bins[j.label] = { ...b, tons: round1(b.tons + j.count) };
                binsTouched = true;
                log.push({ date: today, text: `Parts ledger — quarantine CLEARED: ${j.count} t ${j.label} to the magazine (bench assessment complete)`, kind: 'parts' });
            } else {
                const add = j.kind === 'assess' ? (j.outcome ?? { a: j.count, b: 0, c: 0 }) : { a: j.count, b: 0, c: 0 };
                this.landGrades(invLines, j.label, add);
                invTouched = true;
                const what = j.kind === 'assess' ? `assessed — A ${add.a} · B ${add.b} · C ${add.c}` : j.kind === 'inspect' ? `inspected to grade A ×${j.count}` : `parts-repaired to grade A ×${j.count}`;
                log.push({ date: today, text: `Parts ledger — ${j.label} ${what} (CACHED)`, kind: 'parts' });
            }
        }
        this.state.odmBench.set(next);
        if (binsTouched) this.state.odmStocks.set({ ...stocks, bins });
        if (invTouched && inv) this.state.setInventory({ ...inv, lines: invLines });
        this.state.setCampaignLog(log);
        return rem; // the ladder hands the leftover down to P3/P4
    }

    /** Land bench output back into the stores (recreating a line that emptied while its items were IN-SHOP). */
    private landGrades(lines: import('../inventory/starting-inventory').InventoryLine[], label: string, add: { a: number; b: number; c: number }): void {
        const n = add.a + add.b + add.c;
        const idx = lines.findIndex((l) => l.category === 'component' && l.label === label);
        if (idx >= 0) {
            const g = effGrades(lines[idx]);
            lines[idx] = { ...lines[idx], onHand: lines[idx].onHand + n, grades: { a: g.a + add.a, b: g.b + add.b, c: g.c + add.c, raw: g.raw } };
        } else {
            lines.push({ catalogId: null, category: 'component', label, onHand: n, unit: 'count', floor: 0, notes: 'Bench-assessed', grades: { a: add.a, b: add.b, c: add.c, raw: 0 } });
        }
    }

    /** ODM-17 P3-b — the held card's line: every missing part with its doctrine recourse. */
    heldLineFor(bay: Bay): string {
        const lines = this.state.inventory()?.lines ?? [];
        const bench = this.state.odmBench();
        return (bay.heldFor ?? []).map((c) => heldRecourse(c, lines, bench)).join(' · ');
    }

    /** Queue a RAW assessment: the GM's grading (MacCready's reclassification — hers alone in doctrine;
     *  the single-GM app renders the authority as the choice itself), applied when the hours land. */
    benchAssess(label: string, outcome: { a: number; b: number; c: number }): boolean {
        const n = outcome.a + outcome.b + outcome.c;
        return n > 0 && this.benchQueue('assess', label, n, round1(ODM_BENCH.assessPerItem * n), outcome, (g) => g.raw >= n ? { ...g, raw: g.raw - n } : null);
    }
    /** Queue a grade-B inspection (B → A). */
    benchInspect(label: string, n: number): boolean {
        return n > 0 && this.benchQueue('inspect', label, n, round1(ODM_BENCH.inspectPerItem * n), undefined, (g) => g.b >= n ? { ...g, b: g.b - n } : null);
    }
    /** Queue a grade-C parts-repair (C → A). */
    benchRepair(label: string, n: number): boolean {
        return n > 0 && this.benchQueue('repair', label, n, round1(ODM_BENCH.repairPerItem * n), undefined, (g) => g.c >= n ? { ...g, c: g.c - n } : null);
    }
    private benchQueue(kind: 'assess' | 'inspect' | 'repair', label: string, n: number, hours: number, outcome: { a: number; b: number; c: number } | undefined, take: (g: ReturnType<typeof effGrades>) => ReturnType<typeof effGrades> | null): boolean {
        const inv = this.state.inventory();
        if (!inv) return false;
        const lines = [...inv.lines];
        const idx = lines.findIndex((l) => l.category === 'component' && l.label === label);
        if (idx < 0) return false;
        const ng = take(effGrades(lines[idx]));
        if (!ng) return false; // not enough of the source grade (the UI clamps; this is the belt)
        lines[idx] = { ...lines[idx], onHand: Math.max(0, lines[idx].onHand - n), grades: ng };
        const today = this.today();
        this.state.odmBench.set([...this.state.odmBench(), { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, label, count: n, outcome, hoursRemaining: hours, startedDate: today }]);
        this.state.setInventory({ ...inv, lines });
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text: `Parts ledger — ${label} ×${n} IN-SHOP (${kind}, ${hours} h on the MAC-7 bench)`, kind: 'parts' }]);
        void this.store.persistCurrent();
        return true;
    }
    /** Queue the quarantine clearance for a bin's ASSESS-FIRST tonnage (doctrine Part V). */
    benchAmmoClear(bin: string): boolean {
        const stocks = this.state.odmStocks() ?? odmStartingStocks();
        const b = stocks.bins[bin];
        const tons = round1(b?.quarantinedTons ?? 0);
        if (tons <= 0) return false;
        const bins = { ...stocks.bins, [bin]: { ...b, quarantinedTons: 0 } };
        const today = this.today();
        const hours = round1(ODM_BENCH.ammoPerTon * tons);
        this.state.odmStocks.set({ ...stocks, bins });
        this.state.odmBench.set([...this.state.odmBench(), { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'ammo', label: bin, count: tons, hoursRemaining: hours, startedDate: today }]);
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text: `Parts ledger — ${tons} t ${bin} IN-SHOP (quarantine assessment, ${hours} h)`, kind: 'parts' }]);
        void this.store.persistCurrent();
        return true;
    }

    /** Re-attempt settle on held/full bays WITHOUT burning (donor-strip and tab-visit call this). */
    settleAttempt(bays: Bay[]): void {
        const ids = bays.filter((b) => b.occupantId && remainingHours(b) <= 0.01).map((b) => b.id); // the ladder's completion tolerance — a job settled at 0.01 must re-attempt too
        if (ids.length) this.settle(bays.map((b) => ({ ...b })), ids);
    }

    /** Completion — R3 + rearm-from-bins. Debits land HERE (completion), never at assignment/start. */
    private settle(burned: Bay[], readyIds: string[]): void {
        const today = this.today();
        let force = [...(this.state.startingForce() ?? [])];
        const log = [...(this.state.campaignLog() ?? [])];
        const history = [...this.history()];
        const inv = this.state.inventory();
        const invLines = inv ? [...inv.lines] : [];
        const stocks = this.state.odmStocks() ?? odmStartingStocks();
        const bins = { ...stocks.bins };
        let binsTouched = false, invTouched = false;

        for (const id of readyIds) {
            const bay = burned.find((b) => b.id === id);
            if (!bay?.occupantId) continue;
            const inst = force.find((i) => i.instanceId === bay.occupantId);
            const label = inst ? `${inst.chassis} ${inst.model}`.trim() : bay.occupantId;

            // ── R3: the parts gate — every destroyed EQUIPMENT crit needs its named component in stores,
            //    else the WHOLE JOB HOLDS (see neededParts for what counts as a part and why) ──
            const needed = inst ? this.neededParts(inst, this.data.getUnitByName(inst.unitRef)) : [];
            const missing = this.missingFor(needed, invLines);
            if (missing.length) {
                const heldChanged = JSON.stringify(bay.heldFor ?? []) !== JSON.stringify(missing);
                bay.heldFor = missing;
                // ODM-17 P3-b — the held card names the doctrine RECOURSE per part ("on the bench, 3 h" /
                // "in RAW stock — bench-assess it" / "grade B — inspection needed" / genuinely absent).
                if (heldChanged) {
                    const bench = this.state.odmBench();
                    log.push({ date: today, text: `Repair HELD — ${label}: ${missing.map((c) => heldRecourse(c, invLines, bench)).join(' · ')}`, kind: 'repair' });
                }
                continue; // the bay stays occupied; every future burn/supply/bench-landing re-attempts
            }

            // parts present → DEBIT the lines (completion-time, per the ruling). ODM-17 P3: A first; a
            // C-grade install LEDGERS its parts-repair hours onto the job (the doctrine's "parts-repair,
            // ledgered when consumed by a hold-release").
            const used: string[] = [];
            let cRepairHours = 0;
            for (const c of needed) {
                const grade = consumeInstallable(invLines, c);
                if (grade) {
                    used.push(grade === 'c' ? `${c} (grade C — +${ODM_BENCH.repairPerItem} h parts-repair)` : c);
                    if (grade === 'c') cRepairHours += ODM_BENCH.repairPerItem;
                    log.push({ date: today, text: `Parts ledger — ${c} INSTALLED on ${label} (grade ${grade.toUpperCase()})`, kind: 'parts' }); // P3-c lifecycle row (append-only = immutable)
                    invTouched = true;
                }
            }
            if (cRepairHours > 0) bay.laborHours = round1(bay.laborHours + cRepairHours); // the ledgered true cost, recorded on the job

            // ── REARM-FROM-BINS (dry-not-held): restore ammo from the bins; shortfalls state themselves ──
            const short: string[] = [];
            if (inst) {
                for (const need of rearmNeeds(inst)) {
                    const have = bins[need.bin]?.tons ?? 0;
                    const take = round1(Math.min(need.tons, have));
                    if (take > 0) { bins[need.bin] = { ...bins[need.bin], tons: round1(have - take) }; binsTouched = true; }
                    const gap = round1(need.tons - take);
                    if (gap > 0) short.push(`${need.bin} ${gap} t short, rack dry`);
                }
                const condition = inst.lanceId ? ACTIVE : RESERVE;
                force = force.map((i) => i.instanceId === inst.instanceId ? { ...i, damage: undefined, triage: undefined, condition } : i);
            }

            const partsTxt = used.length ? ` · parts consumed: ${used.join(', ')}` : '';
            const shortTxt = short.length ? ` · REARMED SHORT — ${short.join('; ')}` : '';
            log.push({ date: today, text: `Repairs complete — ${label} restored to service (${bay.laborHours} h${partsTxt}${shortTxt} · Bay ${bay.name})`, kind: 'repair' });
            history.unshift({ date: today, bayId: bay.id, bayName: bay.name, instanceId: bay.occupantId, label, laborHours: bay.laborHours, cost: 0, outcome: 'completed', bill: bay.bill, notes: bay.notes, partsUsed: used.length ? used : undefined, rearmShort: short.length ? short : undefined });
            const note = short.length ? `Last job: ${label} — REARMED SHORT (${short.join('; ')})` : undefined;
            const freed = freeBay(bay);
            bay.occupantId = undefined; bay.laborHours = freed.laborHours; bay.hoursSpent = freed.hoursSpent; bay.estimateCost = 0; bay.bill = undefined; bay.notes = undefined; bay.assignedDate = undefined; bay.isPrize = undefined; bay.heldFor = undefined; bay.lastNote = note;
        }

        if (binsTouched) this.state.odmStocks.set({ ...stocks, bins });
        if (invTouched && inv) this.state.setInventory({ ...inv, lines: invLines });
        this.state.setStartingForce(force);
        this.state.setBays(burned);
        this.state.setCampaignLog(log);
        this.state.setBayHistory(history);
        void this.store.persistCurrent();
    }

    /** DONOR-STRIP (Ruling 4) — a COLD hulk becomes inventory lines + bin tonnage via THE SAME materiel
     *  math as the walk; the instance is DESTROYED (one direction, no round-trip). Releases held jobs. */
    /** ODM-17 P4-c — salvage work is SALVAGE-bay work (D36): no operational SALVAGE bay → no donor strip. */
    readonly salvageBayOperational = computed(() => this.bays().some((b) => b.type === 'SALVAGE'));

    /** ODM-17 P4-b — the job's LADDER priority (stored, else derived live from the occupant's triage —
     *  the same derivation the burn uses; a pre-P4 job reads honestly, forward-only). */
    jobPriorityOf(b: Bay): number {
        if (b.jobPriority) return b.jobPriority;
        const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === b.occupantId);
        return inst ? this.priorityFromTriage(inst) : 3;
    }

    /** ODM-17 P4-b — GM-set job priority on an occupied bay (the ladder reads it next burn). */
    setJobPriority(bayId: string, p: 1 | 2 | 3 | 4): boolean {
        const bays = this.bays();
        if (!bays.find((b) => b.id === bayId)?.occupantId) return false;
        this.state.setBays(bays.map((b) => b.id === bayId ? { ...b, jobPriority: p } : b));
        void this.store.persistCurrent();
        return true;
    }

    /** ODM-17 P4-c — bay conversion (D36): EMPTY bays only; GENERAL or SALVAGE, nothing else writes. */
    setBayType(bayId: string, type: 'GENERAL' | 'SALVAGE'): boolean {
        const bays = this.bays();
        const bay = bays.find((b) => b.id === bayId);
        if (!bay || bay.occupantId || bay.type === type) return false;
        this.state.setBays(bays.map((b) => b.id === bayId ? { ...b, type } : b));
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: this.today(), text: `Bay ${bay.name} converted ${bay.type} → ${type} (empty-bay conversion; the crew rigs it)`, kind: 'repair' as const }]);
        void this.store.persistCurrent();
        return true;
    }

    donorStrip(instanceId: string): boolean {
        if (!this.salvageBayOperational()) return false; // D36 — the UI disables with the reason; this is the belt
        const force = this.state.startingForce() ?? [];
        const inst = force.find((i) => i.instanceId === instanceId && i.condition === COLD);
        if (!inst) return false;
        const unit = this.data.getUnitByName(inst.unitRef);
        const sev = inst.triage ?? readDamage(inst.damage, unit?.armor ?? 0).severity;
        const y = odmStripYield(inst, unit, sev);
        const label = `${inst.chassis} ${inst.model}`.trim();
        const today = this.today();
        const inv = this.state.inventory();
        const invLines = inv ? [...inv.lines] : [];
        const stocks = this.state.odmStocks() ?? odmStartingStocks();
        const bins = { ...stocks.bins };
        let ammoTons = 0, parts = 0, binsTouched = false;
        for (const a of y.ammo) { if (addAmmoToBins(bins, a.bin, a.tons, a.src)) { binsTouched = true; ammoTons = round1(ammoTons + a.tons); } }
        for (const p of y.parts) { addPartLine(invLines, p.label, p.count, `donor — ${label}`); parts += p.count; }
        if (binsTouched) this.state.odmStocks.set({ ...stocks, bins });
        if (inv) this.state.setInventory({ ...inv, lines: invLines });
        else if (parts > 0) this.state.setInventory({ lines: invLines, generatedAt: 'donor strip', tier: this.state.resources() ?? 'normal' });
        this.state.setStartingForce(force.filter((i) => i.instanceId !== instanceId));
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text: `Stripped ${label} as donor — ${ammoTons ? `+${ammoTons} t ammunition to the magazine · ` : ''}${parts} component${parts === 1 ? '' : 's'} to stores (hulk expended)`, kind: 'repair' as const }]);
        void this.store.persistCurrent();
        this.settleAttempt(this.bays()); // supply arrived → held jobs release WITHOUT re-queueing
        return true;
    }

    /** WRITE OFF (copied; no money fields touched). */
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
