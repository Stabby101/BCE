/*
 * BCE campaign-pack — WALK THE FIELD core (DIRECTIVE-031). Pure TS, no Angular/DOM. Reads the LIVE
 * persisted battle end-state (D-030 instance.damage = MekBay's CBTSerializedState) and derives, per
 * engaged unit: a damage read-out, the Three Questions (ODM D-26 / pub_triage.py concepts, cited), the
 * severity triage tag (the D-032 bays' feed), the unit value (the salvage clause's base), and the pilot
 * outcome. DATA-003 — nothing is captured or parsed; we read the structure the engine already committed.
 */
import type { ProtoInstance } from '../force/force-generator';
import type { CBTSerializedState, CriticalSlot } from '../../models/force-serialization';

export type Severity = 'G' | 'Y' | 'R' | 'B'; // Green light / Yellow / Red / Black(destroyed) — bays' triage feed
export type Side = 'blufor' | 'opfor';
export type Disposition =
    | 'RECOVER' | 'FIELD_STRIP' | 'ABANDON'                   // BLUFOR
    | 'CLAIM_PRIZE' | 'SALVAGE' | 'LEAVE'                     // OPFOR
    | 'STRIP';                                                // ODM-13 — the materiel strip (both sides; the odm walk's record literal — Classic never produces it; aar-render falls through to the raw label)
export type PilotOutcomeStatus = 'OK' | 'Injured' | 'KIA';

// ── WALK_TUNABLES — every interim number, flagged + in one block (the CamOps salvage-math + full
//    infirmary passes replace these wholesale; D-032/034). ──
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
    /** salvage-exchange contracts: the player's C-bill share of value (D-017 stored exchange term; INTERIM
     *  fraction until the cited CamOps exchange math — read the flag, this is the rate). */
    exchangeShare: 0.5,
    /** hits -> recovery DAYS (ODM pub_triage recovery model concept, cited; INTERIM table, full infirmary D-032/034). */
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

// ── The walk records — stored on the D-026 resolution (D-033's raw material). ──
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
    tons?: number;             // DIRECTIVE-ODM-17 P2 (additive; odm walk only): what this row put on the lift — strip yield tonnage, or the hulk's catalog tons on a capture. Classic never writes it.
    fieldHours?: number;       // DIRECTIVE-ODM-17 P2 (additive; odm walk only): the strip's FIELD-pool price (the doctrine table). Classic never writes it.
}
/** DIRECTIVE-ODM-17 P2 (additive; odm walk only) — the LOAD MANIFEST the walk settled under: what rode
 *  home, against what the operational fleet could lift. Classic walks never write one. */
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
    manifest?: WalkLoadManifest; // ODM-17 P2 additive — absent on every Classic (and pre-P2 odm) record
}
