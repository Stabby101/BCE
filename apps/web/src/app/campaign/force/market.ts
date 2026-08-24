/*
 * BCE campaign-pack — UNIT MARKET model + gate logic (DIRECTIVE-029). Pure TS, no Angular/DOM.
 *
 * The acquisition surface: price a catalog 'Mech, evaluate the four MARKET GATES against the campaign's
 * faction/era context, and value a resale. BUY browses the eligibility-filtered catalog (D-018 reuse)
 * PLUS these gates; a GM override surfaces (not removes) the gate failures per row. All money/valuation is
 * flagged INTERIM until the cited CamOps/MekHQ valuation pass (T-022/T-025).
 */
import type { Unit } from '../../models/units.model';

export const MARKET_TUNABLES = {
    /** INTERIM flat resale (sticker × ratio). The cited CamOps/MekHQ sticker-vs-actual valuation is T-022/T-025. */
    resaleRatio: 0.5,
    /** Purchasable rules levels — excludes Advanced/Experimental lostech (era sets already drop most). Tunable, flagged. */
    marketLevels: ['Introductory', 'Standard'] as string[],
    /** INTERIM C-bills per BV when a catalog `cost` is 0/missing (flagged on the row; a real valuation lands T-022). */
    bvCostFallback: 3000,
};

const LEVEL_NAMES = ['Introductory', 'Standard', 'Advanced', 'Experimental'];
/** MekBay numeric rules level → name (0 Introductory … 3 Experimental). */
export function levelName(level: number): string {
    return LEVEL_NAMES[Math.min(Math.max(level | 0, 0), 3)] ?? 'Experimental';
}

/** Sticker price = catalog cost, or a flagged BV-derived fallback when the catalog cost is 0/missing. */
export function priceOf(u: Unit): number {
    return u.cost && u.cost > 0 ? Math.round(u.cost) : Math.round((u.bv || 0) * MARKET_TUNABLES.bvCostFallback);
}
export function resaleOf(u: Unit): number {
    return Math.round(priceOf(u) * MARKET_TUNABLES.resaleRatio);
}
export function priceIsFallback(u: Unit): boolean {
    return !(u.cost && u.cost > 0);
}

/** The campaign's gate context — the id sets the four market gates evaluate against. */
export interface MarketContext {
    factionIdSet: Set<number>; // the player faction's era set (or merc IS union) — the BUY browse pool
    eraUnion: Set<number>; // union of all non-meta factions' era sets — "in circulation this era" (not-extinct)
    heroIdSet: Set<number>; // available ONLY via the MUL "Unique" meta-bucket (hero 'Mechs)
    year: number; // the campaign date's year — intro-year gate
}

/** Per-unit gate evaluation — each flag TRUE means the unit FAILS that gate (needs a GM override to buy). */
export interface GateFlags {
    faction: boolean; // not in the player faction's era set
    era: boolean; // intro year is after the campaign date
    extinct: boolean; // out of circulation this era (in no real faction's set)
    prototype: boolean; // rules level not in marketLevels (Advanced/Experimental)
    hero: boolean; // a Unique-meta-bucket-only hero 'Mech
}
export function evalGates(u: Unit, ctx: MarketContext): GateFlags {
    return {
        faction: !ctx.factionIdSet.has(u.id),
        era: u.year > ctx.year,
        extinct: !ctx.eraUnion.has(u.id),
        prototype: !MARKET_TUNABLES.marketLevels.includes(levelName(u.level)),
        hero: ctx.heroIdSet.has(u.id),
    };
}
export function passesAllGates(g: GateFlags): boolean {
    return !g.faction && !g.era && !g.extinct && !g.prototype && !g.hero;
}
/** Short labels for the override chips shown on a GM-overridden row. */
export const GATE_LABEL: Record<keyof GateFlags, string> = {
    faction: 'off-faction',
    era: 'post-era',
    extinct: 'out-of-circulation',
    prototype: 'experimental',
    hero: 'hero',
};
export function overriddenGates(g: GateFlags): string[] {
    return (Object.keys(GATE_LABEL) as (keyof GateFlags)[]).filter((k) => g[k]).map((k) => GATE_LABEL[k]);
}
