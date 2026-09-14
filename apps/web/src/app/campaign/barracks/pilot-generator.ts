/*
 * BCE campaign-pack — PILOT generation (DIRECTIVE-020, T-018/T-017). Pure TS, no Angular/DOM.
 *
 * Pilots are ENTITIES that outlive any one 'Mech: name + Gunnery/Piloting, a status lifecycle,
 * and a both-way assignment LINK to a roster instance (spares = the unassigned pool). Generated
 * once at Begin (and pilots-on-first-load for older saves), 1:1 auto-assigned, the commanding
 * unit's pilot getting the best rolled skills (completing D-019's command designation).
 *
 * Skills model the canon experience table — Gunnery/Mek TN = 7 − level, Piloting/Mek = 8 − level,
 * tier levels Green 2 / Regular 3 / Veteran 4 / Elite 5 (= canon Gun 5/4/3/2, Pilot 6/5/4/3) —
 * cross-checked against the GPLv3 MekHQ skill generators (campaign/personnel/generator +
 * skills/SkillType.java; concepts only, NO MekHQ data files / NC name assets). Variance ports
 * MekHQ Skill.randomizeLevel (1d6: 1 worse / 6 better / else same), rolled ONCE and stored
 * (the D-017/18 stored-not-rerolled principle). Names are BCE-ORIGINAL tunable pools.
 */
import type { ProtoInstance } from '../force/force-generator';

export type PilotStatus = 'Active' | 'Injured' | 'KIA'; // Injured/KIA reserved for the AAR/engine phase

export interface Pilot {
    pilotId: string;
    name: string;
    callsign?: string;
    gunnery: number;
    piloting: number;
    status: PilotStatus;
    assignedInstanceId?: string; // the LINK; absent = spare/bench
    note?: string; // D-024: "kin — shares the <surname> name" when a surname is deliberately shared
    recoveryDays?: number; // D-031: days left until an Injured pilot returns to Active (ticks on the D-022 clock)
    // ── D-036 Barracks v2 — ALL optional: pre-D-036 pilots migrate forward-only, no version bump ──
    perks?: string[];        // granted SPA ids (pilot-abilities.ts); display + print only this slice
    bio?: string;            // generated once at creation / ensured once on load (stored; GM-editable)
    gmNotes?: string;        // the GM's free-text on this pilot
    missionCount?: number;   // increments at RESOLVE for deployed pilots (forward-only; no invented history)
    recordsBegin?: { y: number; m: number; d: number }; // when the service record started counting
    hits?: number;           // last recorded wound level (walk-applied; cleared on recovery)
    kiaDate?: { y: number; m: number; d: number };      // the memorial date (walk-applied)
    named?: boolean;         // D-112: a Chaos "Named Pilot" (improvement-eligible, capped at 4). Optional/additive.
    trade?: string;          // ODM-15: the crew trade ('mechwarrior' | 'vehicle-crew' | 'aero'), stamped at muster
                             // from the machine's catalog type + re-derived on reassignment. ODM-only writer;
                             // Classic pilots are never stamped (the D-036 optional/additive pattern, no version bump).
    primaryHull?: string;    // ODM-25 (ruling 4): the CHASSIS this crew member calls their own — familiarity is
                             // per-hull, and an instanceId dies with the machine. DELIBERATELY NOT `pilotPrimary`
                             // (ODM-15b's stables/mint marker answers a different question; one field answering
                             // two is the bay bug). One per pilot — setting REPLACES. NO mechanic reads it yet;
                             // ODM-16 is where it earns a number. ODM-only writer; additive; no version bump.
    stableHulls?: string[];  // ODM-15b ADDENDUM: a stable pilot's owned hulls (instanceIds, primary first) —
                             // the recoverable person→both-hulls linkage, PRESERVED not modeled (the seed of a
                             // future hull-familiarity mechanic whose trigger is James's, not ours). ODM-only
                             // writer; additive; no version bump; NO mechanic reads it yet.
    // ── DIRECTIVE-125 — the Hot Spots Campaign Pilot Card (SP career + advancement). Optional/additive, HS-only;
    //    absent on Traditional pilots (no card, no behavior change). Persists with the pilot object (no version bump). ──
    campaignPilot?: CampaignPilot;
    /** GM-2 P1 — on a pilot minted by the GM-1 P3 import: the HOME campaign's pilot id (the re-minted `impp-` id is the
     *  live one). Echoed onto the results slip so a fate lands on the right home pilot. Absent on every other pilot. */
    originPilotId?: string;
}

/** DIRECTIVE-125 — per-pilot campaign progression (Draconis Reach p.159). SP career ledger + invested SP + the
 *  balance Handicap (summed H-column of every bought rung). Wounds mirror the pilot's D-036 `hits`. */
export interface CampaignPilot {
    careerSP: number;                                                     // cumulative SP earned across missions (visibility of "who's earning")
    investedSP: { gunnery: number; piloting: number; edge: number; abilities: number }; // SP spent per track (from the Warchest)
    edgeTokens: number;                                                   // spendable luck/reroll pool (base 1; ladder prices the 2nd..10th)
    wounds: number;                                                       // mirrors Pilot.hits (the wound track)
    handicap: number;                                                     // summed H-column of every bought rung (a single balance number)
    learnedAbilities: string[];                                           // SP-learned SPA ids (pilot-abilities.ts) — distinct from the free `perks` slots
    formationCommander: boolean;                                          // trained as a Formation Commander (500 SP)
    commandAbilities: string[];                                           // learned Special Command Abilities (250/500/750)
    type: string;                                                         // AS unit-class code (e.g. 'BM')
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

// ── TUNABLE: spares, the canon skill table, variance, bounds, and BCE-original names ──
export const PILOT_TUNABLES = {
    sparePct: 0.1, // ~10% bench beyond 1:1
    sparesMin: 1,
    /** base [gunnery, piloting] by experience tier (canon; the merc rating keys this). */
    skillByRating: { Green: [5, 6], Regular: [4, 5], Veteran: [3, 4], Elite: [2, 3] } as Record<string, [number, number]>,
    defaultRating: 'Regular',
    /** ±1 jitter (MekHQ randomizeLevel: 1d6 1=worse, 6=better, else same), clamped. */
    gunneryBounds: [1, 8] as [number, number],
    pilotingBounds: [1, 9] as [number, number],
    callsignPct: 0.55,
    /** D-024: probability a surname is deliberately SHARED (kin) rather than fresh — marked in the note. */
    familyPct: 0.05,
    // BCE-ORIGINAL name pools (NOT MekHQ data). D-024 widened them ≥3×; FIRST names are sized to cover
    // a regiment-plus draw (≥160) so the within-campaign guard can keep every first name unique.
    firstNames: [
        'Mara', 'Tomas', 'Jen', 'Kade', 'Sasha', 'Rourke', 'Lena', 'Drex', 'Ivo', 'Petra', 'Garrick', 'Yana', 'Cole', 'Nadia', 'Bram', 'Suki', 'Elias', 'Vora', 'Dane', 'Risa',
        'Marek', 'Talia', 'Hollis', 'Cyra', 'Owen', 'Mika', 'Roan', 'Della', 'Soren', 'Asha', 'Aldric', 'Brigit', 'Caleb', 'Dasha', 'Emil', 'Fenn', 'Greta', 'Hadwin', 'Inez', 'Jukka',
        'Kira', 'Lars', 'Mireille', 'Nikolai', 'Odette', 'Pavel', 'Quill', 'Renata', 'Stig', 'Tova', 'Ulric', 'Vesna', 'Wei', 'Xandra', 'Yusuf', 'Zara', 'Anika', 'Boris', 'Calla', 'Dmitri',
        'Esme', 'Falk', 'Gunnar', 'Halle', 'Ingrid', 'Jorah', 'Kestrel', 'Liora', 'Magnus', 'Noor', 'Osric', 'Priya', 'Quentin', 'Rhea', 'Silas', 'Tamsin', 'Ulf', 'Veda', 'Wrenna', 'Xiu',
        'Yael', 'Zeke', 'Aren', 'Bex', 'Coral', 'Dov', 'Eira', 'Finnian', 'Galen', 'Hana', 'Idris', 'Juno', 'Kai', 'Linnea', 'Mads', 'Nyla', 'Orin', 'Paz', 'Ravi', 'Senna',
        'Tariq', 'Una', 'Viktor', 'Wade', 'Ximena', 'Yara', 'Zinnia', 'Anselm', 'Briar', 'Cassia', 'Davos', 'Elke', 'Fabian', 'Gwyn', 'Hugo', 'Isolde', 'Joaquin', 'Katya', 'Leif', 'Maren',
        'Nico', 'Ondine', 'Piers', 'Rosa', 'Stellan', 'Thea', 'Uriel', 'Vivi', 'Wolfe', 'Yannick', 'Zola', 'Amara', 'Bodhi', 'Citlali', 'Darius', 'Eun', 'Frida', 'Gideon', 'Hisako', 'Iker',
        'Jada', 'Kwame', 'Lucia', 'Mateo', 'Nadira', 'Oksana', 'Phoenix', 'Qadira', 'Ronan', 'Sefa', 'Teodor', 'Ulla', 'Vasco', 'Winona', 'Xander', 'Yelena', 'Zephyrine', 'Astrid', 'Bertram', 'Csilla',
        'Demir', 'Eleni', 'Faisal', 'Gita', 'Hennie', 'Imani', 'Jonas', 'Kano', 'Liesel', 'Moss', 'Nerys', 'Otto', 'Pell', 'Quincy', 'Rina', 'Sigrid', 'Tobias', 'Ursa', 'Vidar', 'Wilhelmina',
    ],
    lastNames: [
        'Voss', 'Karr', 'Mbeki', 'Tanaka', 'Okafor', 'Reyes', 'Holt', 'Sandoval', 'Frost', 'Kwan', 'Bauer', 'Asante', 'Lindqvist', 'Rahman', 'Calder', 'Dvorak', 'Nwosu', 'Petrov', 'Salazar', 'Whitlock',
        'Yilmaz', 'Brandt', 'Cho', 'Esposito', 'Hale', 'Moreau', 'Quint', 'Vance', 'Wren', 'Zane', 'Abara', 'Bellini', 'Castellan', 'Dunmore', 'Egwu', 'Fairweather', 'Goto', 'Haldane', 'Iqbal', 'Janssen',
        'Kovac', 'Larkin', 'Mardini', 'Novak', 'Oyelaran', 'Pradesh', 'Renner', 'Sato', 'Tarrant', 'Ueda', 'Valdez', 'Weaver', 'Xu', 'Yoon', 'Ziegler', 'Achterberg', 'Barlow', 'Cisneros', 'Drummond', 'Ericsson',
        'Faulkner', 'Garibaldi', 'Hawkins', 'Ito', 'Jovanovic', 'Kingsley', 'Lemaire', 'Mwangi', 'Nakamura', 'Oduya', 'Pemberton', 'Quaranta', 'Rosenthal', 'Sharma', 'Thorne', 'Ulvaeus', 'Varga', 'Whitman', 'Yamamoto', 'Zabel',
        'Ashford', 'Bergström', 'Connolly', 'Delacroix', 'Eberhardt', 'Foss', 'Grimaldi', 'Hartline', 'Ivers', 'Jericho', 'Kaufmann', 'Lindholm', 'Magnusson', 'Naumann', 'Okonkwo', 'Pulaski', 'Rourke2', 'Steiner-Hayes', 'Tomczak', 'Underhill',
        'Vasquez', 'Wendt', 'Yablonski', 'Zimmer', 'Albrecht', 'Bonham', 'Coyle', 'Delgado', 'Engström', 'Forsythe', 'Greco', 'Hollander', 'Imhoff', 'Jovic', 'Krause', 'Lockhart', 'Mortensen', 'Nilsson', 'Ostrowski', 'Ruark',
    ],
    callsigns: [
        'Ghost', 'Razor', 'Tinker', 'Echo', 'Vandal', 'Sable', 'Wraith', 'Cinder', 'Maverick', 'Lark', 'Brick', 'Halo', 'Joker', 'Drift', 'Saint', 'Nomad', 'Fang', 'Mercy', 'Tracer', 'Anvil',
        'Comet', 'Rook', 'Static', 'Vixen', 'Crow', 'Dagger', 'Ember', 'Flint', 'Grizzly', 'Havoc', 'Iron', 'Jolt', 'Kestrel', 'Lance', 'Marrow', 'Nighthawk', 'Onyx', 'Phantom', 'Quake', 'Raptor',
        'Scorch', 'Talon', 'Umbra', 'Viper', 'Warden', 'Xenon', 'Yarrow', 'Zephyr', 'Banshee', 'Cobalt', 'Diesel', 'Edge', 'Falcon', 'Gemini', 'Hammer', 'Ibex', 'Juggernaut', 'Karma', 'Lynx', 'Mirage',
        'Nova', 'Outlaw', 'Patch', 'Quasar', 'Ronin', 'Specter', 'Tundra', 'Vortex', 'Whisper', 'Zealot',
    ],
} as const;

const T = PILOT_TUNABLES;

/** MekHQ Skill.randomizeLevel ported: 1d6 -> 1 worse (+TN), 6 better (-TN), else same. */
function vary(base: number, d6: () => number, bounds: [number, number]): number {
    const r = d6();
    const tn = r === 1 ? base + 1 : r === 6 ? base - 1 : base;
    return clamp(tn, bounds[0], bounds[1]);
}

/** Generate one pilot per instance + a spare pool, skills by tier + variance; commander gets the best. */
export function generatePilots(instances: ProtoInstance[], rating: string | null, rng: () => number = Math.random): Pilot[] {
    const d6 = (): number => Math.floor(rng() * 6) + 1;
    const pick = <X>(arr: readonly X[]): X => arr[Math.floor(rng() * arr.length)];
    if (!instances.length) return [];

    const base = T.skillByRating[rating ?? T.defaultRating] ?? T.skillByRating[T.defaultRating];
    const spares = Math.max(T.sparesMin, Math.ceil(instances.length * T.sparePct));
    const total = instances.length + spares;

    const usedCall = new Set<string>();
    const usedFirst = new Set<string>(); // D-024: first names are NEVER duplicated within a campaign
    const usedLast = new Map<string, number>(); // surname -> index of its first bearer (for the kin note)
    const pilots: Pilot[] = [];
    for (let i = 0; i < total; i++) {
        let callsign: string | undefined;
        if (rng() < T.callsignPct) {
            const c = pick(T.callsigns);
            if (!usedCall.has(c)) {
                usedCall.add(c);
                callsign = c;
            }
        }
        // First name: always fresh (the pool is sized so a regiment-plus draw never runs dry).
        const freshFirst = T.firstNames.filter((n) => !usedFirst.has(n));
        const first = freshFirst.length ? pick(freshFirst) : pick(T.firstNames);
        usedFirst.add(first);
        // Surname: prefer fresh; share an existing one only on the family roll OR when the pool is spent —
        // and mark BOTH the new pilot and the original bearer as kin.
        const freshLast = T.lastNames.filter((n) => !usedLast.has(n));
        let last: string;
        let note: string | undefined;
        if (freshLast.length && rng() >= T.familyPct) {
            last = pick(freshLast);
        } else {
            const shared = [...usedLast.keys()];
            if (shared.length) {
                last = pick(shared);
                note = `kin — shares the ${last} name`;
                const firstIdx = usedLast.get(last)!;
                if (!pilots[firstIdx].note) pilots[firstIdx].note = note;
            } else {
                last = freshLast.length ? pick(freshLast) : pick(T.lastNames);
            }
        }
        const pilot: Pilot = {
            pilotId: `plt-${i + 1}-${Math.floor(rng() * 1e6)}`,
            name: `${first} ${last}`,
            callsign,
            gunnery: vary(base[0], d6, T.gunneryBounds),
            piloting: vary(base[1], d6, T.pilotingBounds),
            status: 'Active',
        };
        if (note) pilot.note = note;
        pilots.push(pilot);
        if (!usedLast.has(last)) usedLast.set(last, pilots.length - 1);
    }

    // Best-first (lower = better); commander unit gets the top pilot, the rest fill in order, leftovers = spares.
    const byBest = [...pilots].sort((a, b) => a.gunnery - b.gunnery || a.piloting - b.piloting);
    const commander = instances.find((i) => i.isCommander);
    const ordered = commander ? [commander, ...instances.filter((i) => i.instanceId !== commander.instanceId)] : [...instances];
    ordered.forEach((inst, idx) => {
        if (idx < byBest.length) byBest[idx].assignedInstanceId = inst.instanceId;
    });
    return pilots;
}
