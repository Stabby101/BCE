import type { ProtoInstance } from '../force/force-generator';
import type { CBTSerializedState, CriticalSlot } from '../../models/force-serialization';

export type Severity = 'G' | 'Y' | 'R' | 'B'; // Green light / Yellow / Red / Black(destroyed) — bays' triage feed
export type Side = 'blufor' | 'opfor';
export type Disposition =
    | 'RECOVER' | 'FIELD_STRIP' | 'ABANDON'                   // BLUFOR
    | 'CLAIM_PRIZE' | 'SALVAGE' | 'LEAVE'                     // OPFOR
    | 'STRIP';
export type PilotOutcomeStatus = 'OK' | 'Injured' | 'KIA';

// ── WALK_TUNABLES — every interim number, flagged + in one block (the CamOps salvage-math + full
export const WALK_TUNABLES = {
    /** field-strip credit = stripFraction × cost × conditionFactor (INTERIM until parts/Inventory). */
    stripFraction: 0.25,
    /** value multiplier by severity (catalog cost × this) — INTERIM until the cited CamOps salvage math. */
    conditionFactors: { G: 0.9, Y: 0.65, R: 0.4, B: 0.2 } as Record<Severity, number>,
    /** severity boundaries. */
    severityThresholds: { armorYellow: 0.5, critsRed: 3 },
    /** prize storage caps by category (ODM D37 COLD_STORAGE_CAPS, mech default 4). */
    coldStorageCaps: { mech: 4 },
    /** recovery (haul-back) capacity by transport/resource tier (Lean/Standard/Established DropShip lift). */
    transportLift: { lean: 4, standard: 8, established: 16 } as Record<string, number>,
    exchangeShare: 0.5,
    recoveryDaysByHits: [0, 2, 5, 10, 20, 40] as number[],
};

const LEG_LOCS = new Set(['LL', 'RL', 'LLEG', 'RLEG']);
const isName = (c: CriticalSlot, re: RegExp) => re.test(c.name || c.originalName || '');
const destroyed = (c: CriticalSlot) => !!c.destroyed;

export interface DamageReadout {
    armorPct: number;           // 0..1 remaining armor (1 = pristine)
    armorHits: number;
    internalBreaches: string[]; // locations with internal damage
    destroyedCrits: number;
    engineDead: boolean;
    gyroDead: boolean;
    cockpitDead: boolean;
    legsKilled: boolean;        // both legs mobility-killed
    unitDestroyed: boolean;     // the serialized destroyed flag
    severity: Severity;
}

/** Read the damage envelope into a triage read-out. maxArmor = the catalog Unit.armor total. */
export function readDamage(damage: CBTSerializedState | undefined | null, maxArmor: number): DamageReadout {
    const crits = damage?.crits ?? [];
    const locs = damage?.locations ?? {};
    let armorHits = 0;
    const internalBreaches: string[] = [];
    for (const loc of Object.keys(locs)) {
        const l = locs[loc] as { armor?: number; internal?: number; pendingArmor?: number; pendingInternal?: number };
        armorHits += (l.armor ?? 0) + (l.pendingArmor ?? 0);
        if ((l.internal ?? 0) + (l.pendingInternal ?? 0) > 0) internalBreaches.push(loc);
    }
    const destroyedCrits = crits.filter(destroyed).length;
    const engineDead = crits.filter((c) => isName(c, /engine/i) && destroyed(c)).length >= 3;
    const gyroDead = crits.some((c) => isName(c, /gyro/i) && destroyed(c));
    const cockpitDead = crits.some((c) => isName(c, /cockpit/i) && destroyed(c));
    const legKilled = (loc: string) => crits.some((c) => (c.loc || '').toUpperCase() === loc && destroyed(c) && isName(c, /hip|leg actuator|foot/i)) || internalBreaches.map((x) => x.toUpperCase()).includes(loc);
    const legsKilled = [...LEG_LOCS].filter((l) => legKilled(l)).length >= 2 || (legKilled('LL') && legKilled('RL'));
    const unitDestroyed = !!damage?.destroyed;
    const armorPct = maxArmor > 0 ? Math.max(0, 1 - armorHits / maxArmor) : 1;

    let severity: Severity;
    if (unitDestroyed || engineDead || cockpitDead) severity = 'B';
    else if (gyroDead || internalBreaches.length > 0 || destroyedCrits >= WALK_TUNABLES.severityThresholds.critsRed) severity = 'R';
    else if (destroyedCrits >= 1 || armorPct < WALK_TUNABLES.severityThresholds.armorYellow) severity = 'Y';
    else severity = 'G';

    return { armorPct, armorHits, internalBreaches, destroyedCrits, engineDead, gyroDead, cockpitDead, legsKilled, unitDestroyed, severity };
}

/** Q1 — can we get it to the ship? NO if it can't move under its own power / is gutted. */
export function q1ShipIt(r: DamageReadout): boolean {
    return !(r.engineDead || r.gyroDead || r.cockpitDead || r.legsKilled || r.unitDestroyed);
}

/** Q3 — worth the cost? a black/destroyed hulk isn't worth a whole recovery (strip/salvage still are). */
export function q3WorthWhole(r: DamageReadout): boolean {
    return r.severity !== 'B';
}

/** Salvage/repair value = catalog cost × the severity condition factor (INTERIM). */
export function unitValue(cost: number, severity: Severity): number {
    return Math.round((cost || 0) * (WALK_TUNABLES.conditionFactors[severity] ?? 0.5));
}
/** Field-strip credit (BLUFOR) — stripFraction × cost × conditionFactor (INTERIM until parts/Inventory). */
export function stripCredit(cost: number, severity: Severity): number {
    return Math.round(WALK_TUNABLES.stripFraction * (cost || 0) * (WALK_TUNABLES.conditionFactors[severity] ?? 0.5));
}
/** Salvage credit (OpFor) — the STORED salvage clause governs: pct of value, or the exchange share. */
export function salvageCredit(value: number, salvagePct: number, exchange: boolean): number {
    return Math.round(value * (exchange ? WALK_TUNABLES.exchangeShare : (salvagePct || 0) / 100));
}

export interface PilotOutcome {
    status: PilotOutcomeStatus;
    hits: number;
    recoveryDays: number;
}
/** Derive the pilot outcome from the serialized crew hit track. 6 (or dead state) = KIA. */
export function pilotOutcome(damage: CBTSerializedState | undefined | null): PilotOutcome {
    const crew = (damage?.crew ?? []) as Array<{ hits?: number; state?: number }>;
    const c0 = crew[0];
    const hits = Math.max(0, Math.min(6, c0?.hits ?? 0));
    const dead = (c0?.state === 2) || hits >= 6;
    if (dead) return { status: 'KIA', hits: 6, recoveryDays: 0 };
    if (hits >= 1) return { status: 'Injured', hits, recoveryDays: WALK_TUNABLES.recoveryDaysByHits[hits] ?? hits * 7 };
    return { status: 'OK', hits: 0, recoveryDays: 0 };
}

export interface EngagedSnapshot {
    bluforIds: string[];       // deployed BLUFOR instanceIds (live in startingForce)
    opfor: ProtoInstance[];    // the OpFor instances, snapshotted at RESOLVE (the spec is cleared)
}
export interface WalkRowResult {
    side: Side;
    instanceId: string;
    label: string;             // chassis + model
    severity: Severity;
    disposition: Disposition;
    credit: number;            // treasury delta applied
    triage?: Severity;         // RECOVER tag (bays feed)
    captured?: boolean;
    pilot?: PilotOutcome & { pilotId?: string };
    overrides?: string[];      // logged GM overrides
    tons?: number;
    fieldHours?: number;
}
export interface WalkLoadManifest {
    ammoTons: number; componentTons: number;   // the strip haul (cargo holds)
    hulks: number; hulkTons: number;           // captures (bay slots)
    baysUsed: number; liftBays: number;        // own machines riding home + hulks vs operational 'Mech bays
    cargoUsed: number; cargoTons: number;      // strip tonnage vs operational holds
    fieldHours: number; fieldHoursWindow: number; // strip pricing vs the extraction window (the FIELD pool's day)
    overrideReason?: string;                   // the logged GM reason when a full lift was forced (Q2 override)
}
export interface FieldWalkResult {
    walkedDate: { y: number; m: number; d: number };
    rows: WalkRowResult[];
    totalCredit: number;
    prizesClaimed: number;
    manifest?: WalkLoadManifest;
}

/** S66 (2026-09-18) — the BattleTech weight class off tonnage: Light 20–35 · Medium 40–55 · Heavy 60–75 · Assault 80+.
 *  The walk row shows it beside the tonnage so the DAMAGE badge ("LIGHT" = light damage) can no longer be read as the
 *  class — a 50 t Rifleman is MEDIUM. Vehicles share the bands here (the walk's rows are mixed). */
export type WeightClass = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'ASSAULT';
export function weightClassOf(tons: number | null | undefined): WeightClass | null {
    if (tons == null || !Number.isFinite(tons) || tons <= 0) return null;
    if (tons <= 35) return 'LIGHT';
    if (tons <= 55) return 'MEDIUM';
    if (tons <= 75) return 'HEAVY';
    return 'ASSAULT';
}

export const WALK_MANIFEST_TIMEOUT_MS = 10_000;
export type ManifestPartState = 'ready' | 'loading' | `failed: ${string}`;
export interface ManifestParts { fleet: ManifestPartState; shop: ManifestPartState; catalog: ManifestPartState; equipment: ManifestPartState }
export interface ManifestLoadState {
    ready: boolean;
    /** the loud line — null while genuinely loading inside the timeout */
    failure: string | null;
    /** the per-part readout for the loading line, e.g. "fleet ✓ · shop ✓ · catalog … · equipment …" */
    parts: string;
}
const PART_MARK = (s: ManifestPartState): string => (s === 'ready' ? '✓' : s === 'loading' ? '…' : '✗');
export function manifestLoadState(parts: ManifestParts, timedOut: boolean): ManifestLoadState {
    const entries = Object.entries(parts) as [keyof ManifestParts, ManifestPartState][];
    const ready = entries.every(([, s]) => s === 'ready');
    const line = entries.map(([k, s]) => `${k} ${PART_MARK(s)}`).join(' · ');
    if (ready) return { ready: true, failure: null, parts: line };
    const failed = entries.filter(([, s]) => s.startsWith('failed'));
    if (failed.length) return { ready: false, failure: failed.map(([k, s]) => `${k} ${s.slice('failed: '.length)}`).join(' · '), parts: line };
    if (timedOut) {
        const pending = entries.filter(([, s]) => s === 'loading').map(([k]) => k).join(', ');
        return { ready: false, failure: `timeout after ${WALK_MANIFEST_TIMEOUT_MS / 1000} s — still loading: ${pending}`, parts: line };
    }
    return { ready: false, failure: null, parts: line };
}
