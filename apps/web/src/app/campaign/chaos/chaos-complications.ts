import type { SeedComplication } from '../mission/forge-types';
import type { CommandRights } from '../contract/contract-terms';

/** Our own general track modifiers (name · text · mechanicalEffect). Editable; GM-extendable. */
export const CHAOS_COMPLICATION_POOL: readonly SeedComplication[] = [
    { name: 'Weather Front', text: 'A storm rolls across the engagement area mid-operation.', mechanicalEffect: 'From the end of turn 3, halve visual/spotting range and apply a +1 to-hit for weather until the front passes (GM: ~1d3 turns).' },
    { name: 'Hostile Reinforcements', text: 'The opposition has a relief element within reach of the fight.', mechanicalEffect: 'A reinforcement lance (~25% of the listed OpFor BV) enters from the enemy home edge on a turn of the GM\'s choosing after turn 4.' },
    { name: 'Faulty Intel', text: 'The briefing under-counted the enemy strength.', mechanicalEffect: 'The fielded OpFor is heavier than briefed — add one unit to the enemy force (GM picks a unit near the OpFor\'s average BV).' },
    { name: 'Comms Jamming', text: 'The enemy is running electronic warfare across the band.', mechanicalEffect: 'No Initiative re-rolls; coordinated actions (spotting for indirect fire, C3-style links) are unavailable for the track.' },
    { name: 'Terrain Hazard', text: 'The ground itself is working against you — unstable footing, rubble, or industrial hazards.', mechanicalEffect: 'Designate 20% of the map as hazard terrain: entering it requires a Piloting check or the unit takes 1 point of falling-style damage and ends its move.' },
    { name: 'Supply Shortfall', text: 'You deployed light on ammunition and coolant.', mechanicalEffect: 'Each unit starts the track with one ammo bin at half load (GM/player choice); overheating checks are at +1.' },
    { name: 'Collateral Limits', text: 'Civilians or protected infrastructure share the battlespace.', mechanicalEffect: 'Damage to marked protected hexes/structures costs 1 objective point each and can void the bonus objective; the employer\'s standing suffers on egregious collateral.' },
    { name: 'Equipment Fault', text: 'A unit deployed with an unresolved maintenance gremlin.', mechanicalEffect: 'At track start, roll one random friendly unit: one of its weapon systems (GM choice) is offline until the pilot passes a Tech/Piloting check at the end of a turn.' },
    { name: 'Night Engagement', text: 'The operation runs in darkness.', mechanicalEffect: 'Apply the night lighting modifiers: +2 to-hit beyond short range for units without a functioning searchlight/active probe.' },
    { name: 'Extraction Deadline', text: 'A hard timer governs your withdrawal window.', mechanicalEffect: 'The primary objective must be met by the end of turn 8; any friendly unit not moving toward its home edge after that forfeits its salvage/withdrawal.' },
];

/** Extra complications rolled per track, by negotiated Command term: looser command = fewer, tighter = more. */
export function extraComplicationCount(cmd: CommandRights): number {
    switch (cmd) {
        case 'Integrated': return 2;
        case 'House': return 1;
        case 'Liaison': return 1;
        case 'Independent': return 0;
        default: return 0;
    }
}

// ── Deterministic string-seeded RNG (cyrb-style hash → mulberry32) so the roll is stable across reload/re-render. ──
function hashStr(s: string): number {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return (h ^= h >>> 16) >>> 0;
}
function mulberry32(a: number): () => number {
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Deterministically pick extraComplicationCount(cmd) pool entries that don't duplicate the seed's own complications
 * (by name). RNG is seeded by seedKey (the mission/branch id) so re-render + reload yield the SAME extras.
 */
export function rollComplications(cmd: CommandRights, seedComps: readonly SeedComplication[], seedKey: string): SeedComplication[] {
    const n = extraComplicationCount(cmd);
    if (n <= 0) return [];
    const used = new Set((seedComps ?? []).map((c) => (c.name || '').toLowerCase()));
    const pool = CHAOS_COMPLICATION_POOL.filter((c) => !used.has(c.name.toLowerCase()));
    if (!pool.length) return [];
    const rng = mulberry32(hashStr(seedKey || 'chaos'));
    const arr = pool.map((c) => ({ ...c })); // deterministic Fisher–Yates over a copy
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr.slice(0, Math.min(n, arr.length));
}

/** Universal Chaos track rules — OUR OWN summaries (no rulebook prose). Static; shown on every Hot Spots track. */
export const CHAOS_STANDING_RULES: readonly { name: string; text: string }[] = [
    { name: 'Commander', text: 'If the unit carrying your force commander is destroyed, your force suffers −2 to Initiative for the remainder of the track.' },
    { name: 'Forced Withdrawal', text: 'A unit reduced to crippling damage must move toward its home edge each turn until it leaves the field; it may still fire while withdrawing.' },
    { name: 'Crippling Damage', text: 'A unit counts as crippled once it loses roughly half its armor/structure, a side torso or two limbs, or its ability to move or fire effectively — GM adjudicates the threshold.' },
    { name: 'Scanning', text: 'Recon / scan objectives are confirmed at the end of the following turn, and only if a friendly unit held the target within its probe/sensor range during that turn.' },
];
