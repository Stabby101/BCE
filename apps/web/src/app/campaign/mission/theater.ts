
export interface TheaterSheet {
    population: string;     // display string, e.g. "≈ 410 million (concentrated in the lowland arcologies)"
    terrain: string;        // the mission biome restated with the theater's own character
    climate: string;
    season: string;
    gravity: string;        // e.g. "0.96 g"
    dayLength: string;      // e.g. "26.4 hours"
    infrastructure: string;
    hpg: string;            // HPG class line
    occupation: string;     // the in-register situation-character paragraph (slot-fillable)
}

export interface CommsPlan {
    syncSchedule: string;            // command-net synchronization line
    reportWindow: string;            // routine reporting cadence
    codewords: { meaning: string; word: string }[];
    emergency: string[];             // emergency procedure lines (reference the codewords)
}

const BIOME_CLIMATE: Record<string, { climate: string[]; seasons: string[] }> = {
    'Temperate plains': { climate: ['Temperate continental', 'Maritime temperate'], seasons: ['early spring — wet ground', 'high summer — long sightlines', 'autumn — harvest traffic on every road', 'first frost — hard ground, bare cover'] },
    'Arid badlands': { climate: ['Hot arid', 'High-desert continental'], seasons: ['dry season — dust plumes betray movement', 'storm season — flash floods in the cuts', 'cold nights — thermal blooms carry'] },
    'Dense urban': { climate: ['Urban heat-island temperate', 'Smog-layered subtropical'], seasons: ['monsoon weeks — sensor clutter in every street', 'dry months — riot weather', 'winter inversion — smoke holds at rooftop level'] },
    'Marshland': { climate: ['Humid subtropical', 'Fen maritime'], seasons: ['flood season — causeways only', 'midge season — optics fouled by dusk swarms', 'dry-down — new ground opens that maps call water'] },
    'Mountain': { climate: ['Alpine', 'High continental'], seasons: ['pass season — routes open six weeks', 'first snows — avalanche risk on the north faces', 'spring melt — every ford runs high'] },
    'Tundra': { climate: ['Subarctic', 'Polar maritime'], seasons: ['white season — contrast near zero', 'thaw — the ground will not hold an Atlas', 'aurora season — HF comms unreliable'] },
    'Jungle': { climate: ['Equatorial rainforest', 'Monsoon tropical'], seasons: ['wet season — canopy drip defeats thermal imaging', 'burn season — slash clearings change the map weekly'] },
    'Coastal': { climate: ['Maritime', 'Storm-belt temperate'], seasons: ['storm season — landings gated by surf', 'fishing season — civilian hulls crowd every approach', 'fog season — the littoral closes to visual flight'] },
    'Desert': { climate: ['Hyper-arid', 'Hot desert'], seasons: ['high heat — daytime ops cost double water', 'wind season — sand infiltrates every actuator', 'cold season — clear, freezing nights'] },
    'Industrial sprawl': { climate: ['Industrial microclimate (particulate haze)', 'Temperate, smog-bound'], seasons: ['production quarter — three shifts, full rail traffic', 'maintenance stand-down — quiet lines, alert guards', 'strike season — pickets at every gate'] },
};

const INFRASTRUCTURE: { line: string; popBand: [number, number]; popNote: string }[] = [
    { line: 'Agrarian world — grain combines, rail spines to the lift sites, little else', popBand: [40, 900], popNote: 'rural, dispersed across the arable belts' },
    { line: 'Mining/extraction colony — pit-heads, ore monorails, company towns', popBand: [2, 80], popNote: 'concentrated in company settlements' },
    { line: 'Industrial world — foundry districts, orbital-lift corridors, union halls', popBand: [300, 3200], popNote: 'massed in the manufacturing arcologies' },
    { line: 'Garrison/depot world — military cantonments anchor the civil economy', popBand: [60, 700], popNote: 'clustered around the cantonment economies' },
    { line: 'Trade-crossroads world — recharge-station traffic, bonded warehouses, customs sheds', popBand: [120, 1500], popNote: 'ported along the jump-route corridors' },
];

const HPG_LINES = [
    'HPG class B — ComStar compound at the capital; queue measured in days',
    'HPG class B — single compound, traffic logged; assume your message is read',
    'HPG class C — relay only; priority traffic rides JumpShip mail',
];

/** The §2.1 occupation/situation-character paragraph, in the CAMPAIGN register's voice. Slot tokens
 *  ({WORLD}/{TARGET_FACTION}/{EMPLOYER}) survive to render time — fillSlots applies them. */
const OCCUPATION: Record<string, string> = {
    'is-kurita': 'The Dragon administers {WORLD} through the district prefectures: ration ledgers current, work quotas posted, the ISF resident known to all and acknowledged by none. {TARGET_FACTION} pressure has not changed the trash-collection schedule — the Combine measures control in exactly such things.',
    'is-davion': 'Civil administration on {WORLD} runs on March-standard audit: militia musters documented, supply receipts countersigned, the AFFS liaison office open to complaint. {TARGET_FACTION} activity is a line item in the planetary assembly minutes — public, priced, and budgeted against.',
    'is-steiner': 'Commerce governs {WORLD}; the occupation answers to the ledger. Insurance rates along the corridors price {TARGET_FACTION} risk to the decimal, and the Commonwealth garrison is funded exactly as well as those rates justify — no better.',
    'is-liao': 'The Confederation holds {WORLD} the way the Maskirovka prefers: quietly, completely, and with every neighborhood committee filing weekly. {TARGET_FACTION} sympathies exist; so do the lists on which they are recorded.',
    'is-marik': 'Authority on {WORLD} is divided the League way — planetary parliament, provincial governor, and the garrison commander each holding a third of every decision. {TARGET_FACTION} agents exploit the seams; everyone files protests through them.',
    clan: 'The occupation zone is administered by caste: warriors govern, laborers produce, the cutdown is posted at the work-hall door. {TARGET_FACTION} resistance is handled by Trial; the population is handled by schedule.',
    merc: 'Whoever claims {WORLD} on the maps, the ground answers to whoever is paying this season. The employer’s writ runs to the fence line of what it garrisons; past that, {TARGET_FACTION} patrols, local militias, and commerce sort out the rest by precedent.',
    'periphery/pirate': 'No flag holds {WORLD} so much as a rotation of armed interests does. The settlements pay protection in fuel and foodstuffs, fly whatever colors last landed, and keep honest counts of everything — paid twice is remembered forever.',
    comstar: 'The Blessed Order maintains formal neutrality on {WORLD}; the compound logs all traffic and the Precentor receives all parties. {TARGET_FACTION} and {EMPLOYER} both transmit through the same queue — neither believes the queue is blind.',
    sldf: 'The Star League administers {WORLD} under the Council mandate: civil law local, strategic assets federal, the SLDF cantonment extraterritorial. {TARGET_FACTION} agitation is a police matter until the day it is not.',
};

// ── Appendix B word banks (BLACK REED-style pairings; era-neutral, BCE-original) ──
const CODE_ADJ = ['BLACK', 'IRON', 'PALE', 'LONG', 'COLD', 'BRASS', 'QUIET', 'RED', 'HOLLOW', 'GRAY', 'STONE', 'LAST'];
const CODE_NOUN = ['REED', 'LANTERN', 'FURROW', 'ANVIL', 'CISTERN', 'PALISADE', 'LEDGER', 'CANDLE', 'GATE', 'HARROW', 'SPINDLE', 'BELL'];

const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];
const range = (lo: number, hi: number, rng: () => number): number => lo + rng() * (hi - lo);

export interface WorldContext {
    name: string;
    owner: string;
    settlement: string;
    regionRole: string;
    eraName: string;
    terrain?: string[];
}

/** a/an by the following word's initial sound (vowel-letter heuristic; good enough for our region/settlement words). */
function aOrAn(word: string): string {
    return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}

export function generateTheater(biome: string, biomeNote: string, register: string, world?: WorldContext, rng: () => number = Math.random): TheaterSheet {
    const cl = BIOME_CLIMATE[biome] ?? BIOME_CLIMATE['Temperate plains'];
    const infra = pick(INFRASTRUCTURE, rng);
    const popM = Math.round(range(infra.popBand[0], infra.popBand[1], rng));
    const population = popM >= 1000
        ? `≈ ${(popM / 1000).toFixed(1)} billion — ${infra.popNote}`
        : `≈ ${popM} million — ${infra.popNote}`;
    // and settlement type — ahead of the generated infrastructure character.
    const owner = world && world.owner && world.owner !== 'periphery-independent' ? world.owner : world ? 'an unaligned periphery power' : '';
    const worldLine = world ? `${world.name} is ${owner}-held — ${aOrAn(world.regionRole)} ${world.regionRole} ${world.settlement} world${world.eraName ? ` (${world.eraName})` : ''}. ${infra.line}` : infra.line;
    // GENERATED THEATER TEXTURE — flag it so the §2.1 sheet never ASSERTS a specific world terrain that the body
    // (seed prose, a separate Forge fix) might contradict.
    const terrain = world?.terrain?.length
        ? `${world.terrain.join(' / ')} — surveyed`
        : `${biome} — ${biomeNote} · generated texture (no surveyed terrain on file)`;
    return {
        population,
        terrain,
        climate: pick(cl.climate, rng),
        season: pick(cl.seasons, rng),
        gravity: `${range(0.84, 1.12, rng).toFixed(2)} g`,
        dayLength: `${range(21, 31, rng).toFixed(1)} hours`,
        infrastructure: worldLine,
        hpg: pick(HPG_LINES, rng),
        occupation: OCCUPATION[register] ?? OCCUPATION['merc'],
    };
}

/** Roll the Appendix B comms plan ONCE (caller stores it on the spec). Codewords are unique per plan. */
export function generateComms(deployByDays: number, engagementDays: number, rng: () => number = Math.random): CommsPlan {
    const adjs = [...CODE_ADJ];
    const nouns = [...CODE_NOUN];
    const draw = (): string => {
        const a = adjs.splice(Math.floor(rng() * adjs.length), 1)[0];
        const n = nouns.splice(Math.floor(rng() * nouns.length), 1)[0];
        return `${a} ${n}`;
    };
    const codewords = [
        { meaning: 'Contact confirmed — all stations stand to', word: draw() },
        { meaning: 'Compromise assumed — rotate frequencies, landline only', word: draw() },
        { meaning: 'Early extraction — collapse to the rally point', word: draw() },
        { meaning: 'Mission abort — destroy sensitive material, disperse', word: draw() },
    ];
    const sync = `${String(Math.floor(range(4, 7, rng))).padStart(2, '0')}00`;
    const sync2 = `${String(Math.floor(range(17, 20, rng))).padStart(2, '0')}00`;
    return {
        syncSchedule: `Command net synchronizes ${sync} and ${sync2} local, burst transmission, ${Math.floor(range(20, 45, rng))}-second window.`,
        reportWindow: `Routine traffic rides the ${sync2} window only; the deploy clock (${deployByDays} days) and the engagement window (~${engagementDays} days) are confirmed at each synchronization.`,
        codewords,
        emergency: [
            `Loss of the command net for two consecutive windows = assume compromise; revert to courier and pre-briefed rally procedure.`,
            `Codewords are spoken IN CLEAR by design — brevity beats encryption when the roof is coming down. One use each; a used codeword is dead.`,
            `Medical/extraction emergencies override all schedules: any station may break the net with the extraction codeword, twice, on the guard channel.`,
        ],
    };
}

// ── Appendix A — support/naval activation (INTERIM tunables, flagged: T-022/T-025 price the real
//    charter economy; these are planning-figure texture for the paper, not a ledger). ──
export const SUPPORT_TUNABLES = {
    charterDropshipPerDrop: 180000,  // C-bills, Lean tier per-drop lift charter (INTERIM)
    charterJumpPerCollar: 95000,     // C-bills, jump passage per collar per jump (INTERIM)
    retainerNavalContact: 12000,     // C-bills/mo, keeping a naval fixer on call (INTERIM)
} as const;
