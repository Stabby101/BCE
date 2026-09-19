import { Injectable, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignSaveStore } from '../campaign-save-store';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';
import { deployedSet } from '../force/deployed';
import {
    WALK_TUNABLES, readDamage, q1ShipIt, q3WorthWhole, unitValue, pilotOutcome, stripCredit, salvageCredit,
    type DamageReadout, type Disposition, type Side, type PilotOutcome, type WalkRowResult, type FieldWalkResult,
} from './field-walk-core';

const COLD = 'Cold storage';
const REPAIR = 'In repair';

export interface WalkRow {
    side: Side;
    instanceId: string;
    inst: ProtoInstance;
    unit?: Unit;
    label: string;
    tons: number;
    readout: DamageReadout;
    q1: boolean;            // ship-it (auto)
    q3: boolean;            // worth whole (auto)
    value: number;
    pilot?: PilotOutcome;   // BLUFOR only (OpFor pilots are not entities this slice)
    pilotId?: string;
    def: Disposition;       // the auto-suggested disposition
}

@Injectable({ providedIn: 'root' })
export class FieldWalkService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly store = inject(CampaignSaveStore);

    /** The RESOLVED branch that has an engaged snapshot but no completed walk = the pending walk. */
    readonly pendingBranch = computed(() => (this.state.missionTree() ?? []).find((b) => b.state === 'RESOLVED' && b.resolution?.engaged && !b.resolution?.fieldWalk));

    /** All branches awaiting a walk (for the pending badge / count). */
    readonly pendingCount = computed(() => (this.state.missionTree() ?? []).filter((b) => b.state === 'RESOLVED' && b.resolution?.engaged && !b.resolution?.fieldWalk).length);

    /** Prize storage slots remaining (cap − units already in cold storage). */
    readonly prizeSlots = computed(() => {
        const inCold = (this.state.startingForce() ?? []).filter((i) => i.condition === COLD).length;
        return Math.max(0, WALK_TUNABLES.coldStorageCaps.mech - inCold);
    });
    /** Recovery (haul-back) capacity for this walk = transport lift by resource tier. */
    readonly recoverCap = computed(() => WALK_TUNABLES.transportLift[(this.state.resources() || 'standard')] ?? 8);

    readonly rows = computed<WalkRow[]>(() => {
        const br = this.pendingBranch();
        if (!br?.resolution?.engaged) return [];
        const eng = br.resolution.engaged;
        const force = this.state.startingForce() ?? [];
        const pilots = this.state.pilots() ?? [];
        const blu: WalkRow[] = eng.bluforIds
            .map((id) => force.find((i) => i.instanceId === id))
            .filter((i): i is ProtoInstance => !!i)
            .map((inst) => this.row('blufor', inst, pilots.find((p) => p.assignedInstanceId === inst.instanceId)?.pilotId));
        const opf: WalkRow[] = eng.opfor.map((inst) => this.row('opfor', inst, undefined));
        return [...blu, ...opf];
    });

    private row(side: Side, inst: ProtoInstance, pilotId: string | undefined): WalkRow {
        const unit = this.data.getUnitByName(inst.unitRef);
        const readout = readDamage(inst.damage, unit?.armor ?? 0);
        const q1 = q1ShipIt(readout);
        const q3 = q3WorthWhole(readout);
        const value = unitValue(unit?.cost ?? 0, readout.severity);
        const pilot = side === 'blufor' && pilotId ? pilotOutcome(inst.damage) : undefined;
        return {
            side, instanceId: inst.instanceId, inst, unit, label: `${inst.chassis} ${inst.model}`.trim(),
            tons: inst.tons, readout, q1, q3, value, pilot, pilotId, def: this.suggest(side, readout, q1, q3),
        };
    }

    private suggest(side: Side, r: DamageReadout, q1: boolean, q3: boolean): Disposition {
        if (side === 'blufor') {
            if (r.unitDestroyed) return 'ABANDON';        // write-off
            return q1 && q3 ? 'RECOVER' : 'FIELD_STRIP';
        }
        if (r.unitDestroyed) return 'SALVAGE';            // OpFor wreck → salvage the hulk
        return q1 ? 'CLAIM_PRIZE' : 'SALVAGE';
    }

    /** Atomic CONFIRM: apply every row's disposition, credit per the clause, log, store the fieldWalk. */
    apply(dispositions: Record<string, Disposition>, overrides: Record<string, string[]> = {}): void {
        const br = this.pendingBranch();
        if (!br?.resolution?.engaged) return;
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
        const ac = this.state.acceptedContract();
        const salvagePct = ac?.salvage?.pct ?? 0;
        const exchange = !!ac?.salvage?.exchange;
        const rows = this.rows();

        let force = [...(this.state.startingForce() ?? [])];
        let pilots = [...(this.state.pilots() ?? [])];
        const log: { date: typeof today; text: string }[] = [];
        const results: WalkRowResult[] = [];
        let credit = 0;
        let prizeSlots = this.prizeSlots();

        for (const row of rows) {
            const disp = dispositions[row.instanceId] ?? row.def;
            const res: WalkRowResult = { side: row.side, instanceId: row.instanceId, label: row.label, severity: row.readout.severity, disposition: disp, credit: 0, overrides: overrides[row.instanceId] };

            if (row.side === 'blufor') {
                const pout = this.applyPilot(pilots, row, today); // injury/KIA (KIA guard) + outcome record
                pilots = pout.pilots; if (pout.outcome) res.pilot = { ...pout.outcome, pilotId: row.pilotId };
                if (disp === 'RECOVER') {
                    force = force.map((i) => i.instanceId === row.instanceId ? { ...i, condition: REPAIR, triage: row.readout.severity } : i);
                    res.triage = row.readout.severity;
                    log.push({ date: today, text: `Recovered ${row.label} → repair bay (triage ${row.readout.severity})` });
                } else if (disp === 'FIELD_STRIP') {
                    const c = stripCredit(row.unit?.cost ?? 0, row.readout.severity);
                    credit += c; res.credit = c;
                    force = force.filter((i) => i.instanceId !== row.instanceId);
                    pilots = this.unassign(pilots, row.instanceId);
                    log.push({ date: today, text: `Field-stripped ${row.label} — +${c.toLocaleString('en-US')} C-bills (interim strip value)` });
                } else { // ABANDON / write-off
                    force = force.filter((i) => i.instanceId !== row.instanceId);
                    pilots = this.unassign(pilots, row.instanceId);
                    log.push({ date: today, text: `${row.readout.unitDestroyed ? 'Wrote off' : 'Abandoned'} ${row.label} on the field` });
                }
            } else { // OPFOR
                if (disp === 'CLAIM_PRIZE' && prizeSlots > 0) { // Q1 gate enforced UI-side (with the GM override); slots authoritative here
                    prizeSlots--; res.captured = true;
                    force = [...force, { ...row.inst, lanceId: undefined, isCommander: false, condition: COLD, triage: row.readout.severity, provenance: { origin: 'captured', acquiredDate: today } }];
                    log.push({ date: today, text: `Claimed ${row.label} as a prize → COLD STORAGE (captured)` });
                } else if (disp === 'SALVAGE' || disp === 'CLAIM_PRIZE') { // CLAIM with no slot → salvage the wreck
                    res.disposition = 'SALVAGE';
                    const c = salvageCredit(row.value, salvagePct, exchange);
                    credit += c; res.credit = c;
                    log.push({ date: today, text: `Salvaged ${row.label} — +${c.toLocaleString('en-US')} C-bills (${exchange ? 'exchange' : salvagePct + '% clause'} of ${row.value.toLocaleString('en-US')})` });
                } else { // LEAVE
                    log.push({ date: today, text: `Left ${row.label} on the field` });
                }
            }
            results.push(res);
        }

        // walk is Traditional-only (the UI is suppressed under hotspots); this is the airtight economy-layer guard.
        if (credit && this.state.campaignSystem() !== 'hotspots') this.state.setTreasury((this.state.treasury() ?? 0) + credit);
        this.state.setStartingForce(force);
        this.state.setPilots(pilots);
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), ...log.map((e) => ({ ...e, kind: 'walk' as const }))]);

        const fieldWalk: FieldWalkResult = { walkedDate: today, rows: results, totalCredit: credit, prizesClaimed: results.filter((r) => r.captured).length };
        this.state.setMissionTree((this.state.missionTree() ?? []).map((b) =>
            b.branchId === br.branchId ? { ...b, resolution: { ...b.resolution!, fieldWalk, engaged: undefined } } : b));
        void this.store.persistCurrent();
    }

    /** Skip — leave the walk pending (the badge stays); no mutations. */
    skip(): void { /* no-op: pending state is the absence of fieldWalk; nothing to persist */ }

    private applyPilot(pilots: Pilot[], row: WalkRow, today: { y: number; m: number; d: number }): { pilots: Pilot[]; outcome?: PilotOutcome } {
        if (!row.pilotId || !row.pilot) return { pilots };
        const outcome = row.pilot;
        const next = pilots.map((p): Pilot => {
            if (p.pilotId !== row.pilotId) return p;
            if (p.status === 'KIA') return p; // the reversibility guard — dead stays dead
            if (outcome.status === 'KIA') return { ...p, status: 'KIA', recoveryDays: undefined, hits: 6, kiaDate: today, assignedInstanceId: undefined };
            if (outcome.status === 'Injured') return { ...p, status: 'Injured', recoveryDays: outcome.recoveryDays, hits: outcome.hits, assignedInstanceId: undefined };
            return p;
        });
        return { pilots: next, outcome: outcome.status === 'OK' ? undefined : outcome };
    }

    private unassign(pilots: Pilot[], instanceId: string): Pilot[] {
        return pilots.map((p) => p.assignedInstanceId === instanceId ? { ...p, assignedInstanceId: undefined } : p);
    }
}
