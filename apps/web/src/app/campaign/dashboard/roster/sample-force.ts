/*
 * BCE retool — SAMPLE force for the Unit Roster (DIRECTIVE-010, supersedes D-009's
 * hand-feel data). Each entry names a REAL catalog chassis (resolved from DataService
 * → db.mekbay.com) so MekBay renders real sprites + a real Classic record sheet, plus
 * a sample battle-damage profile so the sheet shows live damage. NOT the real campaign
 * force — binding to the assembled force is the engine/state phase. Pilots are campaign
 * flavour (not in the catalog).
 */
export const CONDITIONS = ['Active', 'Deployed', 'Reserve', 'Cold storage', 'In repair'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Sample committed damage to apply after load (Mek location codes). */
export interface DamageProfile {
    armor?: Record<string, number>;    // loc → armor hits
    internal?: Record<string, number>; // loc → internal hits
}

export interface RosterUnit {
    id: string;
    chassis: string;     // catalog lookup key (Unit.chassis)
    modelHint?: string;  // prefer a model matching this (e.g. 'Prime')
    pilot: string;       // campaign flavour (tonnage comes from the real unit)
    cond: Condition;
    damage?: DamageProfile;
}

export interface RosterCategory {
    id: 'mech' | 'ground' | 'aero';
    label: string;
    cap: number;
    units: RosterUnit[];
}

// Sample Mek battle-damage profiles (committed hits on standard Mek locations).
const HURT: DamageProfile = { armor: { LT: 9, RA: 6, CT: 5, LL: 4 }, internal: { LA: 3 } };
const SCRATCHED: DamageProfile = { armor: { RT: 4, LA: 3 } };

export const SAMPLE_FORCE: readonly RosterCategory[] = [
    {
        id: 'mech', label: 'BattleMechs', cap: 12, units: [
            { id: 'm1', chassis: 'Mad Cat (Timber Wolf)', modelHint: 'Prime', pilot: 'Star Cmdr Vared', cond: 'Deployed', damage: HURT },
            { id: 'm2', chassis: 'Masakari (Warhawk)', modelHint: 'Prime', pilot: 'MW Dana', cond: 'Active', damage: SCRATCHED },
            { id: 'm3', chassis: 'Ryoken (Stormcrow)', modelHint: 'Prime', pilot: 'MW Jho', cond: 'Active' },
            { id: 'm4', chassis: 'Vulture (Mad Dog)', modelHint: 'Prime', pilot: 'MW Tor', cond: 'In repair', damage: HURT },
            { id: 'm5', chassis: 'Thor (Summoner)', modelHint: 'Prime', pilot: 'MW Kael', cond: 'Active', damage: SCRATCHED },
            { id: 'm6', chassis: 'Loki (Hellbringer)', modelHint: 'Prime', pilot: 'MW Sena', cond: 'Reserve' },
        ],
    },
    {
        id: 'ground', label: 'Ground units', cap: 6, units: [
            { id: 'g1', chassis: 'Epona Pursuit Tank', modelHint: 'Prime', pilot: 'Crew Δ', cond: 'Active' },
        ],
    },
    {
        id: 'aero', label: 'Aerospace', cap: 4, units: [
            { id: 'a1', chassis: 'Visigoth', pilot: 'MW Vask', cond: 'Cold storage' },
        ],
    },
];

export const SAMPLE_FLAT: readonly (RosterUnit & { cat: RosterCategory['id'] })[] =
    SAMPLE_FORCE.flatMap((c) => c.units.map((u) => ({ ...u, cat: c.id })));
