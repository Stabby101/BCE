import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CBTSerializedState, HeatProfile } from '../../models/force-serialization';

const NEUTRAL_HEAT: HeatProfile = { current: 0, previous: 0 };

/** The persisted battle-damage envelope = MekBay's CBTSerializedState with heat neutralized. */
export type BattleDamage = CBTSerializedState;

/** Extract the persistable damage from a live ForceUnit (heat stripped → live-only). */
export function extractDamage(fu: CBTForceUnit): BattleDamage {
    return { ...fu.serialize().state, heat: { ...NEUTRAL_HEAT } };
}

/** Apply a stored damage envelope to a freshly-loaded ForceUnit via MekBay's own update() path.
 *  alias is passed unchanged so update() leaves the crew name alone — the caller re-drives the
 *  campaign pilot (applyCrew) afterwards. Heat is forced neutral (live-only). */
export function applyDamage(fu: CBTForceUnit, damage: BattleDamage | undefined | null): void {
    if (!damage) return;
    fu.update({ id: fu.id, state: { ...damage, heat: { ...NEUTRAL_HEAT } }, alias: fu.alias(), unit: fu.getUnit().name });
}

export function resetDamage(fu: CBTForceUnit): void {
    const cur = fu.serialize().state; // keep crew + any non-damage state; override only the damage envelope to pristine
    // REBASE-1 P1 c: upstream removed the top-level `shutdown` from CBTSerializedState (it lives in the PSR
    // checks now); a pristine reset drives heat to NEUTRAL, which is what cleared the heat-shutdown anyway.
    // Watched at the P2 battle harness (resetDamage's witness) that a repaired unit is not left shut down.
    fu.update({ id: fu.id, state: { ...cur, locations: {}, crits: [], inventory: [], heat: { ...NEUTRAL_HEAT }, modified: false, destroyed: false }, alias: fu.alias(), unit: fu.getUnit().name });
}


/** The full live serialized state (heat intact) — the battle-fan payload + the dedup key. */
export function liveState(fu: CBTForceUnit): CBTSerializedState {
    return fu.serialize().state;
}

export function neutralizeHeat(state: CBTSerializedState): BattleDamage {
    return { ...state, heat: { ...NEUTRAL_HEAT } };
}

/** Apply a full live state (heat intact) to a ForceUnit — the inbound-fan apply path. Mirrors
 *  applyDamage but does NOT neutralize heat (the live channel shows real heat). */
export function applyLiveState(fu: CBTForceUnit, state: CBTSerializedState | undefined | null): void {
    if (!state) return;
    fu.update({ id: fu.id, state, alias: fu.alias(), unit: fu.getUnit().name });
}
