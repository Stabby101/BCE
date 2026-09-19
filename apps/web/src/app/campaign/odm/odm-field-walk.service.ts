import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignSaveStore } from '../campaign-save-store';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';
import type { InventoryLine } from '../inventory/starting-inventory';
import {
    WALK_TUNABLES, readDamage, q1ShipIt, q3WorthWhole, pilotOutcome,
    type DamageReadout, type Side, type PilotOutcome, type WalkRowResult, type FieldWalkResult, type Disposition, type WalkLoadManifest,
    manifestLoadState, WALK_MANIFEST_TIMEOUT_MS, type ManifestParts, type ManifestPartState, // P8 — the manifest load state, said
} from '../walk/field-walk-core';
import type { MissionBranch } from '../mission/mission-tree'; // TABLE-2 T2-1 — selection-aware pendingBranch
import { odmStartingStocks, round1 } from './odm-stocks';
import { odmStripYield, addAmmoToBins, addPartLine, fieldableYield, yieldTons, yieldFieldHours, type OdmStripYield } from './odm-materiel';
import { OdmFleetService } from './odm-fleet.service';
import { OdmShopService } from './odm-shop.service';
import { OdmSupportService } from './odm-support.service';
import { makeDefaultBays } from '../repair/repair-bays';

const COLD = 'Cold storage';
const REPAIR = 'In repair';

/** TABLE-2 T2-1 — pure walk-pending selection (exported for a fast unit spec, no TestBed/DI). A branch is
 *  walk-pending when it is RESOLVED with an engaged snapshot and no completed walk. */
export const isPendingWalk = (b: MissionBranch): boolean => b.state === 'RESOLVED' && !!b.resolution?.engaged && !b.resolution?.fieldWalk;
/** The pending walk the modal addresses: the SELECTED pending branch when one is chosen (per-mission routing —
 *  so a later mission is not shadowed by an earlier one), else the first-pending in tree order. */
export function pickPendingBranch(tree: readonly MissionBranch[], selectedId: string | null | undefined): MissionBranch | undefined {
    if (selectedId) { const s = tree.find((b) => b.branchId === selectedId && isPendingWalk(b)); if (s) return s; }
    return tree.find(isPendingWalk);
}

/** The ODM per-wreck trio (R2). RECOVER = take it aboard (own → bays; enemy → capture/COLD, bay space is
 *  the cost) · STRIP = the battlefield becomes materiel · LEAVE = deny nothing, gain nothing (recorded —
 *  every wreck the enemy recovers is evidence, Exposure's business in a later directive). NO SELL, EVER. */
export type OdmDisposition = 'RECOVER' | 'STRIP' | 'LEAVE';

// donor-strip reuses THE SAME block — one tunable set, never forked constants (the Phase-2 ruling).

export interface OdmWalkRow {
    side: Side;
    instanceId: string;
    inst: ProtoInstance;
    unit?: Unit;
    label: string;
    tons: number;
    readout: DamageReadout;
    q1: boolean;
    q3: boolean;
    q3Reason: string;
    pilot?: PilotOutcome;
    pilotId?: string;
    def: OdmDisposition;
    yield: OdmStripYield;      // the FIELDABLE strip preview (MAC-7-only components already removed)
    mac7Denied: string[];
    stripTons: number;         // cargo cost of a STRIP (ammo + fieldable components, catalog-priced)
    fieldHours: number;        // FIELD-pool price of a STRIP (the doctrine table)
    unpriced: string[];        // labels the catalog could not price (reported, never guessed — should be empty)
}

@Injectable({ providedIn: 'root' })
export class OdmFieldWalkService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly store = inject(CampaignSaveStore);
    private readonly fleetSvc = inject(OdmFleetService);
    private readonly shop = inject(OdmShopService);
    private readonly support = inject(OdmSupportService);

    readonly salvageBayOperational = computed(() => (this.state.bays() ?? makeDefaultBays()).some((b) => b.type === 'SALVAGE'));

    constructor() {
        // (honest nulls until then). The full catalog matters: a resident era SLICE carries weapons-only comp
        // and no equipment tonnage — a slice-priced walk would understate every yield (caught by the P2
        // harness: 4-part Phoenix Hawk, everything "unpriced"). The walk waits instead of guessing.
        // P8 — kicked ONCE per pending branch (the effect re-runs on any dependency; the loads are idempotent but the
        // timeout clock must not restart on every tick), with the 10 s clock that turns a silent wait into a said one.
        effect(() => {
            const b = this.state.packId() === 'odm' ? this.pendingBranch() : null;
            if (b && b.branchId !== this.kickedFor) { this.kickedFor = b.branchId; this.kickLoads(); }
            if (!b) this.kickedFor = null;
        });
        effect(() => { if (this.fleetReady()) this.clearClock(); }); // ready ends the clock (a late catalog is not a failure)
    }

    private kickedFor: string | null = null;
    private clock: ReturnType<typeof setTimeout> | null = null;
    /** true once the clock ran out with the manifest still not ready (cleared by readiness or a Retry). */
    readonly manifestTimedOut = signal(false);
    private clearClock(): void { if (this.clock) { clearTimeout(this.clock); this.clock = null; } }
    private kickLoads(): void {
        this.manifestTimedOut.set(false);
        void this.fleetSvc.ensureLoaded(); void this.shop.ensureLoaded();
        this.data.ensureFullCatalog().catch(() => { /* reported through isFullLoaded() + the registry size below */ });
        this.clearClock();
        this.clock = setTimeout(() => { this.clock = null; if (!this.fleetReady()) this.manifestTimedOut.set(true); }, WALK_MANIFEST_TIMEOUT_MS);
    }
    /** The walk's Retry: every prerequisite asked again (the catalog's initialize() runs again — it no longer latches on a
     *  slice), the clock restarted. */
    retryManifest(): void { void this.fleetSvc.retry(); void this.shop.retry(); this.kickLoads(); }
    /** Each prerequisite's state — 'ready' · 'loading' · 'failed: <why>' (the fetch status, or the catalog's own failure). */
    readonly manifestParts = computed<ManifestParts>(() => {
        this.data.catalogVersion();
        const fleet: ManifestPartState = this.liftBays() != null && this.cargoCap() != null ? 'ready' : this.fleetSvc.loadError() ? `failed: ${this.fleetSvc.loadError()}` : 'loading';
        const shop: ManifestPartState = this.fieldHoursWindow() != null ? 'ready' : this.shop.loadError() ? `failed: ${this.shop.loadError()}` : 'loading';
        const catalog: ManifestPartState = this.data.isFullLoaded() ? 'ready' : 'loading';
        const equipment: ManifestPartState = this.data.getEquipmentRegistry().size > 0 ? 'ready' : 'loading';
        return { fleet, shop, catalog, equipment };
    });
    /** The one line the footer reads: { ready, failure, parts } — failure = the loud "fleet manifest failed: …" text. */
    readonly manifestLoad = computed(() => manifestLoadState(this.manifestParts(), this.manifestTimedOut()));

    /** TABLE-2 T2-1 — which pending mission the walk addresses. When set (from an AAR row or the just-resolved
     *  branch) the walk targets THAT branch; when null it falls back to the first-pending .find() (the banner
     *  affordance). Cleared by apply()/skip() so the next open starts fresh. */
    readonly selectedWalkBranchId = signal<string | null>(null);

    /** The pending walk = a RESOLVED branch with an engaged snapshot but no completed walk. TABLE-2 T2-1: the
     *  SELECTED pending branch when one is chosen (per-mission routing), else the first-pending in tree order —
     *  so a second pending mission (SHORT COUNT) is no longer permanently shadowed by an earlier one (PALE CANDLE).
     *  The selection logic is the pure pickPendingBranch (unit-tested in odm-field-walk.service.spec.ts). */
    readonly pendingBranch = computed(() => pickPendingBranch(this.state.missionTree() ?? [], this.selectedWalkBranchId()));
    readonly pendingCount = computed(() => (this.state.missionTree() ?? []).filter(isPendingWalk).length);

    /** Capture slots (Ruling 4: a hulk is a COLD instance; bay space is R2's cost — the caps carry it). */
    readonly prizeSlots = computed(() => {
        // the tunable is "prize storage caps" and this signal is prizeSlots. The old count took EVERY
        // cold-storage unit, an assumption that only held because the authored mothballs were mislabeled
        // 'In repair' at mint; fixing that label would otherwise have silently cut capture capacity from 4
        // to 1 on game day — a gameplay change nobody ordered, riding in on a display fix. Captures are
        // stamped provenance.origin 'captured' by this same service, so the distinction is already in the
        // data. NOT a new design decision: this PRESERVES the ratified behavior every shipped pin encodes.
        // Whether the company's own mothballs should also eat prize berths is a real question — LEDGERED
        const prizes = (this.state.startingForce() ?? []).filter((i) => i.condition === COLD && i.provenance?.origin === 'captured').length;
        return Math.max(0, WALK_TUNABLES.coldStorageCaps.mech - prizes);
    });

    //    The company lives at MAC-7 Station; the DropShips are the MISSION lift — so the bays carry the
    //    machines returning from THIS engagement (+ captured hulks), the holds carry THIS walk's strip haul,
    //    and the FIELD pool's day is the extraction window. All null until fleet/shop load (the walk waits).
    readonly liftBays = computed(() => this.fleetSvc.liftBays());
    readonly cargoCap = computed(() => this.fleetSvc.cargoTons());
    readonly fieldHoursWindow = computed(() => this.shop.poolHours('field'));
    readonly fleetReady = computed(() => {
        this.data.catalogVersion(); // reactive driver — comp + equipment land with catalog swaps
        return this.liftBays() != null && this.cargoCap() != null && this.fieldHoursWindow() != null
            && this.data.isFullLoaded() && this.data.getEquipmentRegistry().size > 0; // REBASE-1 P1 c: registry (ruling #2 re-home)
    });

    //    name index is the fallback for older stored yields that predate the id field). Null = unpriceable,
    //    REPORTED by the row (never guessed). The index is keyed to catalogVersion — never cached empty.
    private nameTons: Map<string, number> | null = null;
    private nameTonsVer = -1;
    private readonly tonsOf = (p: { label: string; id?: string }): number | null => {
        // REBASE-1 P1 c: the pin's Equipment.tonnage is `number | 'variable'` (was `number`); a 'variable'
        // tonnage is not numerically priceable, so it maps to null — exactly this resolver's "null = unpriceable,
        // reported not guessed" contract. numTonnage() coerces it.
        if (p.id) { const eq = this.data.findEquipment(p.id); if (eq) return this.numTonnage(eq.tonnage); } // registry (ruling #2 re-home)
        const ver = this.data.catalogVersion();
        if (!this.nameTons || this.nameTonsVer !== ver) {
            this.nameTons = new Map();
            this.nameTonsVer = ver;
            const all = this.data.getEquipmentRegistry().equipment; // REBASE-1 P1 c: the frozen EquipmentMap (ruling #2 re-home)
            for (const key of Object.keys(all)) {
                const eq = all[key];
                const t = this.numTonnage(eq.tonnage);
                if (t == null) continue; // 'variable' / non-finite tonnage is unpriceable — never indexed
                for (const n of [eq.name, eq.shortName, eq.id, ...(eq.aliases ?? [])]) {
                    const k = (n || '').toLowerCase().trim();
                    if (k && !this.nameTons.has(k)) this.nameTons.set(k, t);
                }
            }
        }
        const t = this.nameTons.get(p.label.toLowerCase().trim());
        return t != null && Number.isFinite(t) ? t : null;
    };

    // REBASE-1 P1 c: coerce the pin's `Equipment.tonnage` (number | 'variable') to a finite number, else null.
    private numTonnage(tonnage: number | 'variable'): number | null {
        return typeof tonnage === 'number' && Number.isFinite(tonnage) ? tonnage : null;
    }

    readonly rows = computed<OdmWalkRow[]>(() => {
        this.data.catalogVersion();
        const br = this.pendingBranch();
        if (!br?.resolution?.engaged) return [];
        const eng = br.resolution.engaged;
        const force = this.state.startingForce() ?? [];
        const pilots = this.state.pilots() ?? [];
        const blu = eng.bluforIds
            .map((id) => force.find((i) => i.instanceId === id))
            .filter((i): i is ProtoInstance => !!i)
            .map((inst) => this.row('blufor', inst, pilots.find((p) => p.assignedInstanceId === inst.instanceId)?.pilotId));
        const opf = eng.opfor.map((inst) => this.row('opfor', inst, undefined));
        return [...blu, ...opf];
    });

    private row(side: Side, inst: ProtoInstance, pilotId: string | undefined): OdmWalkRow {
        const unit = this.data.getUnitByName(inst.unitRef);
        const readout = readDamage(inst.damage, unit?.armor ?? 0);
        const q1 = q1ShipIt(readout);
        const q3 = q3WorthWhole(readout);
        const pilot = side === 'blufor' && pilotId ? pilotOutcome(inst.damage) : undefined;
        // FIELD-capable only: gyro/engine/jump-jet work is MAC-7's — those parts ride the hulk or are lost.
        const raw = odmStripYield(inst, unit, readout.severity, Number.POSITIVE_INFINITY);
        const { fieldable, mac7Only: denied } = fieldableYield(raw);
        const { ammoTons, componentTons, unpriced } = yieldTons(fieldable, this.tonsOf);
        // (the register's own coupling; the strip's field hours are the priced recovery work).
        const redPenalty = readout.severity === 'R' && this.support.redRecoveryDoubled() ? 2 : 1;
        return {
            side, instanceId: inst.instanceId, inst, unit, label: `${inst.chassis} ${inst.model}`.trim(),
            tons: inst.tons, readout, q1, q3, q3Reason: this.q3Reason(readout), pilot, pilotId,
            def: this.suggest(side, readout, q1, q3),
            yield: fieldable, mac7Denied: denied,
            stripTons: round1(ammoTons + componentTons),
            fieldHours: Math.round(yieldFieldHours(fieldable, this.tonsOf) * redPenalty * 10) / 10,
            unpriced,
        };
    }

    private q3Reason(r: DamageReadout): string {
        if (r.unitDestroyed || r.engineDead || r.cockpitDead) return 'a gutted hulk — the lift weight is not justified; strip what the field can take';
        if (r.severity === 'R') return 'heavy damage — justified: the frame repairs cheaper than it replaces';
        if (r.severity === 'Y') return 'moderate damage — justified: worth the lift';
        return 'light damage — justified: it rides home';
    }

    /** The survival defaults: a dead hulk is parts (STRIP, never LEAVE — a resistance abandons nothing by
     *  default); an intact own machine RECOVERS; an intact enemy machine is a capture candidate. */
    private suggest(side: Side, r: DamageReadout, q1: boolean, q3: boolean): OdmDisposition {
        if (side === 'blufor') return !r.unitDestroyed && q1 && q3 ? 'RECOVER' : 'STRIP';
        return !r.unitDestroyed && q1 ? 'RECOVER' : 'STRIP';
    }

    manifestFor(dispositions: Record<string, OdmDisposition>): WalkLoadManifest | null {
        const lift = this.liftBays(); const cargo = this.cargoCap(); const window = this.fieldHoursWindow();
        if (lift == null || cargo == null || window == null) return null;
        let ammoTons = 0, componentTons = 0, hulks = 0, hulkTons = 0, fieldHours = 0, ownRiding = 0;
        let slots = this.prizeSlots();
        for (const row of this.rows()) {
            const d = dispositions[row.instanceId] ?? row.def;
            const strip = () => {
                ammoTons = round1(ammoTons + row.yield.ammo.reduce((s, a) => s + a.tons, 0));
                componentTons = round1(componentTons + Math.max(0, round1(row.stripTons - row.yield.ammo.reduce((s, a) => s + a.tons, 0))));
                fieldHours = Math.round((fieldHours + row.fieldHours) * 10) / 10;
            };
            if (row.side === 'blufor') {
                if (d === 'RECOVER') ownRiding++;
                else if (d === 'STRIP') strip();
            } else {
                if (d === 'RECOVER' && slots > 0) { slots--; hulks++; hulkTons += row.tons; }
                else if (d === 'RECOVER' || d === 'STRIP') strip(); // no slot → the field clock says strip it
            }
        }
        return {
            ammoTons, componentTons, hulks, hulkTons,
            baysUsed: ownRiding + hulks, liftBays: lift,
            cargoUsed: round1(ammoTons + componentTons), cargoTons: cargo,
            fieldHours, fieldHoursWindow: window,
        };
    }

    apply(dispositions: Record<string, OdmDisposition>, overrides: Record<string, string[]> = {}, overrideReason?: string): { ok: true } | { ok: false; reason: string } {
        const br = this.pendingBranch();
        if (!br?.resolution?.engaged) return { ok: false, reason: 'No pending walk.' };
        if (!this.fleetReady()) return { ok: false, reason: 'The fleet manifest and catalog have not finished loading — the walk waits.' };
        const manifest = this.manifestFor(dispositions);
        if (!manifest) return { ok: false, reason: 'The fleet manifest has not loaded — the walk waits.' };
        if (manifest.fieldHours > manifest.fieldHoursWindow) {
            return { ok: false, reason: `The strip plan needs ${manifest.fieldHours} h — the extraction window is ${manifest.fieldHoursWindow} h of field-crew time. Leave something on the field.` };
        }
        const overBays = manifest.baysUsed > manifest.liftBays;
        const overCargo = manifest.cargoUsed > manifest.cargoTons;
        if (overBays || overCargo) {
            const why = (overrideReason ?? '').trim();
            if (!why) {
                const what = [overBays ? `bays ${manifest.baysUsed}/${manifest.liftBays}` : '', overCargo ? `holds ${manifest.cargoUsed}/${manifest.cargoTons} t` : ''].filter(Boolean).join(' · ');
                return { ok: false, reason: `Over the fleet's lift (${what}) — force it with a logged GM reason, or lighten the load.` };
            }
            manifest.overrideReason = why;
        }
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
        const rows = this.rows();

        let force = [...(this.state.startingForce() ?? [])];
        let pilots = [...(this.state.pilots() ?? [])];
        const inv = this.state.inventory();
        const invLines: InventoryLine[] = inv ? [...inv.lines] : [];
        const stocks = this.state.odmStocks() ?? odmStartingStocks();
        const bins = { ...stocks.bins };
        const log: { date: typeof today; text: string }[] = [];
        const results: WalkRowResult[] = [];
        let prizeSlots = this.prizeSlots();
        let binsTouched = false, partsTaken = 0;

        const strip = (row: OdmWalkRow): { ammoTons: number; parts: number } => {
            let ammoTons = 0;
            for (const a of row.yield.ammo) { if (addAmmoToBins(bins, a.bin, a.tons, a.src)) { binsTouched = true; ammoTons = round1(ammoTons + a.tons); } }
            for (const p of row.yield.parts) { addPartLine(invLines, p.label, p.count, row.label); partsTaken += p.count; }
            return { ammoTons, parts: row.yield.parts.reduce((s, p) => s + p.count, 0) };
        };

        const mac7Note = (row: OdmWalkRow): string => row.mac7Denied.length ? ` · left in the wreck (MAC-7-only work): ${[...new Set(row.mac7Denied)].join(', ')}` : '';

        for (const row of rows) {
            const disp = dispositions[row.instanceId] ?? row.def;
            const res: WalkRowResult = { side: row.side, instanceId: row.instanceId, label: row.label, severity: row.readout.severity, disposition: this.recordLiteral(row.side, disp), credit: 0, overrides: overrides[row.instanceId] };

            if (row.side === 'blufor') {
                const pout = this.applyPilot(pilots, row, today);
                pilots = pout.pilots; if (pout.outcome) res.pilot = { ...pout.outcome, pilotId: row.pilotId };
                if (disp === 'RECOVER') {
                    force = force.map((i) => i.instanceId === row.instanceId ? { ...i, condition: REPAIR, triage: row.readout.severity } : i);
                    res.triage = row.readout.severity;
                    log.push({ date: today, text: `Recovered ${row.label} → repair bay (triage ${row.readout.severity})` });
                } else if (disp === 'STRIP') {
                    const y = strip(row);
                    res.tons = row.stripTons; res.fieldHours = row.fieldHours;
                    force = force.filter((i) => i.instanceId !== row.instanceId);
                    pilots = this.unassign(pilots, row.instanceId);
                    log.push({ date: today, text: `Stripped ${row.label} — ${y.ammoTons ? `+${y.ammoTons} t ammunition to the magazine · ` : ''}${y.parts} component${y.parts === 1 ? '' : 's'} to stores (${row.stripTons} t · ${row.fieldHours} h field crew)${mac7Note(row)}` });
                } else { // LEAVE — an own machine left is written off where it fell
                    force = force.filter((i) => i.instanceId !== row.instanceId);
                    pilots = this.unassign(pilots, row.instanceId);
                    log.push({ date: today, text: `Left ${row.label} on the field` });
                }
            } else { // OPFOR
                if (disp === 'RECOVER' && prizeSlots > 0) { // capture — Ruling 4: a hulk is a COLD instance
                    prizeSlots--; res.captured = true;
                    res.tons = row.tons;
                    force = [...force, { ...row.inst, lanceId: undefined, isCommander: false, condition: COLD, triage: row.readout.severity, provenance: { origin: 'captured', acquiredDate: today } }];
                    log.push({ date: today, text: `Recovered ${row.label} → cold storage (captured hulk, ${row.tons} t — repairable or donor; one 'Mech bay)` });
                } else if (disp === 'STRIP' || disp === 'RECOVER') { // no slot → the field clock says strip it
                    if (disp === 'RECOVER') res.disposition = 'STRIP';
                    const y = strip(row);
                    res.tons = row.stripTons; res.fieldHours = row.fieldHours;
                    log.push({ date: today, text: `Stripped ${row.label} — ${y.ammoTons ? `+${y.ammoTons} t ammunition to the magazine · ` : ''}${y.parts} component${y.parts === 1 ? '' : 's'} to stores (${row.stripTons} t · ${row.fieldHours} h field crew)${mac7Note(row)}` });
                } else { // LEAVE — recorded; every wreck the enemy recovers is evidence (Exposure, later)
                    log.push({ date: today, text: `Left ${row.label} on the field` });
                }
            }
            results.push(res);
        }

        if (manifest.overrideReason) log.push({ date: today, text: `Lift forced past capacity — GM reason logged: "${manifest.overrideReason}"` });

        // Both stores, one atomic write set. NO setTreasury exists in this walk — materiel, never money.
        if (binsTouched) this.state.odmStocks.set({ ...stocks, bins });
        if (inv) this.state.setInventory({ ...inv, lines: invLines });
        else if (partsTaken > 0) this.state.setInventory({ lines: invLines, generatedAt: 'field walk', tier: this.state.resources() ?? 'normal' });
        this.state.setStartingForce(force);
        this.state.setPilots(pilots);
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), ...log.map((e) => ({ ...e, kind: 'walk' as const }))]);

        const fieldWalk: FieldWalkResult = { walkedDate: today, rows: results, totalCredit: 0, prizesClaimed: results.filter((r) => r.captured).length, manifest };
        this.state.setMissionTree((this.state.missionTree() ?? []).map((b) =>
            b.branchId === br.branchId ? { ...b, resolution: { ...b.resolution!, fieldWalk, engaged: undefined } } : b));
        this.selectedWalkBranchId.set(null); // TABLE-2 T2-1 — this mission is done; next open starts fresh
        void this.store.persistCurrent();
        return { ok: true };
    }

    private recordLiteral(side: Side, d: OdmDisposition): Disposition {
        if (d === 'RECOVER') return side === 'blufor' ? 'RECOVER' : 'CLAIM_PRIZE';
        if (d === 'STRIP') return 'STRIP';
        return side === 'blufor' ? 'ABANDON' : 'LEAVE';
    }

    /** TABLE-2 T2-1 — defer THIS mission only: clear the selection so the modal closes without completing;
     *  the branch stays pending (the absence of fieldWalk), and every OTHER pending mission is untouched. */
    skip(): void { this.selectedWalkBranchId.set(null); }

    private applyPilot(pilots: Pilot[], row: OdmWalkRow, today: { y: number; m: number; d: number }): { pilots: Pilot[]; outcome?: PilotOutcome } {
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
