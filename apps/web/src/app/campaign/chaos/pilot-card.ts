/*
 * DIRECTIVE-125 — Campaign Pilot Card pricing + pure helpers (Hot Spots fork; modeled on Draconis Reach p.159).
 * SP-denominated advancement ladders (spend from the Warchest, D-110): raise Gunnery/Piloting, buy Edge tokens,
 * learn Edge Abilities/SPAs, plus Warchest costs (Heal, Formation Commander, Command Abilities). Handicap = the
 * summed H-column of every bought rung (a single balance number). Facts cited to Draconis Reach — our own tables.
 */
import type { CampaignPilot, Pilot } from '../barracks/pilot-generator';

/** One rung on a skill/edge/ability ladder: the SP price + the H-column (Handicap) it adds. */
export interface CardRung { readonly sp: number; readonly h: number; readonly to?: number; readonly n?: number; }

/** The four advancement ladders + the facing-page Warchest costs — the single source the card UI + spend read. */
export const PILOT_CARD_PRICES = {
    // Gunnery improve → target skill 3/2/1/0 (H-column 12/28/48/88). A pilot starts at their generated Gunnery.
    gunnery: [{ to: 3, sp: 300, h: 12 }, { to: 2, sp: 700, h: 28 }, { to: 1, sp: 1200, h: 48 }, { to: 0, sp: 2200, h: 88 }] as readonly CardRung[],
    // Piloting improve → target 4/3/2/1 (H 4/8/28/48).
    piloting: [{ to: 4, sp: 100, h: 4 }, { to: 3, sp: 200, h: 8 }, { to: 2, sp: 700, h: 28 }, { to: 1, sp: 1200, h: 48 }] as readonly CardRung[],
    // Edge tokens — the 2nd..10th (the 1st is base). H 2/5/8/13/17/22/29/36/44.
    edge: [{ n: 2, sp: 60, h: 2 }, { n: 3, sp: 120, h: 5 }, { n: 4, sp: 200, h: 8 }, { n: 5, sp: 300, h: 13 }, { n: 6, sp: 420, h: 17 }, { n: 7, sp: 560, h: 22 }, { n: 8, sp: 720, h: 29 }, { n: 9, sp: 900, h: 36 }, { n: 10, sp: 1100, h: 44 }] as readonly CardRung[],
    // Edge Abilities / SPAs — the 1st..5th. H 2/8/14/24/36.
    abilities: [{ n: 1, sp: 60, h: 2 }, { n: 2, sp: 180, h: 8 }, { n: 3, sp: 360, h: 14 }, { n: 4, sp: 600, h: 24 }, { n: 5, sp: 900, h: 36 }] as readonly CardRung[],
    heal: 30,                          // per wound box
    formationCommander: 500,           // train a Named Pilot as a Formation Commander
    commandAbility: [250, 500, 750] as readonly number[], // learn the 1st/2nd/3rd Special Command Ability
    replaceCommandAbility: 250,        // swap a command ability
} as const;

/** DIRECTIVE-125 — a short, IP-safe list of Special Command Abilities a Formation Commander can learn (our words). */
export const COMMAND_ABILITIES: readonly string[] = [
    'Coordinated Strike', 'Rapid Redeploy', 'Hold the Line', 'Forced Withdrawal', 'Focused Fire', 'Overwatch',
];

const G_BASE = 4, P_BASE = 5; // a new MechWarrior baseline (Gunnery 4 / Piloting 5)

/** Init a fresh campaign card for a named pilot (base Edge 1; wounds mirror the pilot's D-036 hits). */
export function initCampaignPilot(pilot: Pilot, type = 'BM'): CampaignPilot {
    return {
        careerSP: 0,
        investedSP: { gunnery: 0, piloting: 0, edge: 0, abilities: 0 },
        edgeTokens: 1,
        wounds: pilot.hits ?? 0,
        handicap: 0,
        learnedAbilities: [],
        formationCommander: false,
        commandAbilities: [],
        type,
    };
}

/** The next Gunnery rung (improving from the pilot's current skill), or null at Gunnery 0 / off-ladder. */
export function nextGunneryRung(gunnery: number): CardRung | null { return PILOT_CARD_PRICES.gunnery.find((r) => r.to === gunnery - 1) ?? null; }
export function nextPilotingRung(piloting: number): CardRung | null { return PILOT_CARD_PRICES.piloting.find((r) => r.to === piloting - 1) ?? null; }
/** The next Edge token to buy given the current count (base 1 → buy the 2nd…), or null at 10. */
export function nextEdgeRung(edgeTokens: number): CardRung | null { return PILOT_CARD_PRICES.edge.find((r) => r.n === edgeTokens + 1) ?? null; }
/** The next SPA to learn given how many are already learned (1st…5th), or null at 5. */
export function nextAbilityRung(learnedCount: number): CardRung | null { return PILOT_CARD_PRICES.abilities[learnedCount] ?? null; }
/** The cost of the next Command Ability given how many are learned (1st/2nd/3rd), or null at 3. */
export function nextCommandAbilityCost(learnedCount: number): number | null { return PILOT_CARD_PRICES.commandAbility[learnedCount] ?? null; }

/** The rungs of a ladder the pilot has REACHED, for a print/summary read (Handicap itself is a stored accumulator). */
export function gunneryLadder(gunnery: number): { rung: CardRung; owned: boolean }[] { return PILOT_CARD_PRICES.gunnery.map((r) => ({ rung: r, owned: (r.to ?? 0) >= gunnery && (r.to ?? 0) < G_BASE })); }
export function pilotingLadder(piloting: number): { rung: CardRung; owned: boolean }[] { return PILOT_CARD_PRICES.piloting.map((r) => ({ rung: r, owned: (r.to ?? 0) >= piloting && (r.to ?? 0) < P_BASE })); }
export function edgeLadder(edgeTokens: number): { rung: CardRung; owned: boolean }[] { return PILOT_CARD_PRICES.edge.map((r) => ({ rung: r, owned: (r.n ?? 99) <= edgeTokens })); }
export function abilityLadder(learnedCount: number): { rung: CardRung; owned: boolean }[] { return PILOT_CARD_PRICES.abilities.map((r) => ({ rung: r, owned: (r.n ?? 99) <= learnedCount })); }
