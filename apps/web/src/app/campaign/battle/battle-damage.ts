/*
 * BCE — battle-damage envelope (DIRECTIVE-030). The persisted record of a 'Mech's battle damage IS
 * MekBay's own serialized unit state (DATA-003 — structure is the record, no parallel schema): armor
 * + internal hits, criticals, ammo (crits.consumed + inventory.consumed), destroyed/shutdown. Pure;
 * reuses fu.serialize()/fu.update() so we stay 1-1 with MekBay's deserialize on the way back in.
 *
 * Heat is LIVE-ONLY (D-030): real during the engagement, never persisted (D-031 clears it at
 * engagement-done). We neutralize heat in the stored envelope so a reload always returns heat 0 while
 * the live fu still holds real heat in-session.
 */
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

/** HOTFIX-024 — RESET a loaded ForceUnit to pristine (full armor/internal, no crits/inventory state, neutral
 *  heat), in place. Needed for the repair→Roster refresh: applyDamage(fu, undefined) is a deliberate no-op
 *  above, and MekBay's state.update() treats locations/crits as SPARSE — an ABSENT location/crit is reset to
 *  pristine, but ONLY when the key is present at all (`locations` defined, `crits` truthy). So to actually CLEAR
 *  a cached fu we hand it EXPLICIT empty locations {} + crits [] (else the old armor pips survive). Crew is left
 *  untouched (update() doesn't read state.crew and the alias is unchanged). */
export function resetDamage(fu: CBTForceUnit): void {
    const cur = fu.serialize().state; // keep crew + any non-damage state; override only the damage envelope to pristine
    fu.update({ id: fu.id, state: { ...cur, locations: {}, crits: [], inventory: [], heat: { ...NEUTRAL_HEAT }, modified: false, destroyed: false, shutdown: false }, alias: fu.alias(), unit: fu.getUnit().name });
}

/* ── D-048 phase B — the LIVE fan (heat intact) ────────────────────────────────────────────────
 * The fanned payload is the FULL serialized state, heat included, so a 'Mech's current heat shows
 * live on every tablet + the GM. This is the LIVE channel — distinct from the persisted envelope
 * (extractDamage, heat-neutralized). Both go through MekBay's own serialize()/update() (we wire
 * AROUND the core sheet, never into it — MERGE-002 one-way). */

/** The full live serialized state (heat intact) — the battle-fan payload + the dedup key. */
export function liveState(fu: CBTForceUnit): CBTSerializedState {
    return fu.serialize().state;
}

/** Heat-neutralize a RAW serialized state (a live-fan payload) into the persisted envelope — the
 *  D-048 phase-D reconcile path (battle_state -> inst.damage at resolve) where no live fu is loaded
 *  to extractDamage from. Mirrors extractDamage's heat handling exactly (D-030 live-only-heat). */
export function neutralizeHeat(state: CBTSerializedState): BattleDamage {
    return { ...state, heat: { ...NEUTRAL_HEAT } };
}

/** Apply a full live state (heat intact) to a ForceUnit — the inbound-fan apply path. Mirrors
 *  applyDamage but does NOT neutralize heat (the live channel shows real heat). */
export function applyLiveState(fu: CBTForceUnit, state: CBTSerializedState | undefined | null): void {
    if (!state) return;
    fu.update({ id: fu.id, state, alias: fu.alias(), unit: fu.getUnit().name });
}
