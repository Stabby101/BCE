/*
 * BCE Inventory I (DIRECTIVE-055, T-037 slice 1) — PURE catalog RULES. No Nest/DB deps so it is
 * testable and shared by the service. Implements canon TechManual RULES (era legality + tech-base
 * gating + the formula-priced cost rule). Rules/facts, never copied data (REF-001).
 */

export type Category = 'weapon' | 'ammo' | 'misc' | 'armor' | 'structure' | 'engine' | 'gyro' | 'cockpit' | 'actuator';
export type TechBase = 'IS' | 'Clan' | 'All';

export interface CatalogRow {
    id: string;
    source: 'mekbay' | 'structural';
    name: string;
    category: Category;
    tech_base: TechBase;
    tech_rating: string | null;
    intro_year: number | null;
    extinction_year: number | null;
    reintro_year: number | null;
    cost_cbills: number | null;
    cost_formula: string | null;
    tonnage: number | null;
    crit_slots: number | null;
    availability: string | null;
    provenance: string;
    notes: string | null;
}

/**
 * Era legality from intro / extinction / reintro. Available iff the year is at-or-after introduction
 * AND not inside an extinct-but-not-yet-reintroduced gap (the "lostech" window — why XL engines,
 * Endo-Steel, Ferro-Fibrous, Gauss, ER PPC are all gated out at 3025 but back by 3060).
 */
export function availableInEra(
    row: Pick<CatalogRow, 'intro_year' | 'extinction_year' | 'reintro_year'>,
    year: number,
): boolean {
    if (row.intro_year != null && year < row.intro_year) return false;
    if (row.extinction_year != null && year >= row.extinction_year) {
        return row.reintro_year != null && year >= row.reintro_year;
    }
    return true;
}

/** Tech-base filter: IS → {IS, All}; Clan → {Clan, All}; All (or omitted) → everything. */
export function techBaseMatches(rowBase: string, filter: TechBase): boolean {
    if (filter === 'All') return true;
    if (filter === 'IS') return rowBase === 'IS' || rowBase === 'All';
    if (filter === 'Clan') return rowBase === 'Clan' || rowBase === 'All';
    return true;
}

// ── Formula-priced cost (TechManual cost rules). Engine / internal structure / armor scale with the
//    'Mech's tonnage; cost_formula stores a stable KEY whose canon multiplier is applied here. ──
export interface CostContext {
    tons?: number;   // the 'Mech's mass (engine/structure) or tons of armor (armor)
    rating?: number; // the engine rating (engine only)
}
// Engine cost = multiplier × rating × tons / 75  (TechManual engine cost rule).
const ENGINE_MULT: Record<string, number> = { engine_std: 5000, engine_xl: 20000, engine_light: 15000, engine_compact: 10000, engine_xxl: 100000, engine_ice: 1250 };
// Internal structure cost = perTon × 'Mech tonnage.
const STRUCTURE_PER_TON: Record<string, number> = { struct_std: 400, struct_endo_steel: 1600, struct_composite: 1600, struct_reinforced: 6400, struct_endo_composite: 3200 };
// Armor cost = perTon × tons-of-armor.
const ARMOR_PER_TON: Record<string, number> = { armor_std: 10000, armor_ferro_fibrous: 20000, armor_light_ff: 15000, armor_heavy_ff: 25000, armor_stealth: 50000, armor_reactive: 30000, armor_reflective: 30000, armor_hardened: 15000 };

/** Evaluate a formula-priced row's cost for a context. Returns null for an unknown formula key. */
export function evalCostFormula(formula: string, ctx: CostContext): number | null {
    const tons = ctx.tons ?? 0;
    const rating = ctx.rating ?? 0;
    if (formula in ENGINE_MULT) return Math.round((ENGINE_MULT[formula] * rating * tons) / 75);
    if (formula in STRUCTURE_PER_TON) return Math.round(STRUCTURE_PER_TON[formula] * tons);
    if (formula in ARMOR_PER_TON) return Math.round(ARMOR_PER_TON[formula] * tons);
    return null;
}
