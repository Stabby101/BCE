import type { CatalogItem } from './starting-inventory';

// ── TUNABLES (HEURISTIC, PM-tunable) ─────────────────────────────────────────────────────────────────────
export const SHOP_TUNABLES = {
    /** restock cadence in campaign weeks — the in-system stock re-rolls when the clock crosses a boundary. */
    restockWeeks: 3,
    outOfSystemSurcharge: 0.3,
    outOfSystemDeliveryMonths: 2,
    inSystemMin: 30,
    inSystemMax: 50,
    marketRatingByResource: { lean: 0.3, normal: 0.6, established: 1.0 } as Record<string, number>,
    marketRatingDefault: 0.6,
    /** fraction of the non-staple fill reserved for an "occasional rare" (E/F lucky find), scaled by the rating. */
    rareFraction: 0.14,
    /** campaign-year → availability bracket cutoffs (Star League / Succession Wars / Clan-Jihad / Dark Age). */
    eraBoundaries: { sl: 2780, sw: 3049, clan: 3130 },
    /** authored structural rows carry no per-era brackets → a moderate default (their staples ride STAPLES_FORCE). */
    defaultCode: 'D',
    /** interim flat price for formula-priced / cost-0 rows (armor/structure/engine scale with 'Mech tonnage —
     *  a representative sticker for the shop; the real per-ton valuation is T-022/T-025). */
    fallbackCostByCategory: { armor: 10000, structure: 4000, engine: 1_000_000, gyro: 300000, cockpit: 200000, actuator: 1000, ammo: 1000, weapon: 100000, misc: 20000 } as Record<string, number>,
} as const;

/** MekHQ Procurement availability → 2d6 target number (normal | consumable/ammo). X = 13 = impossible. */
export const AVAILABILITY_TN = {
    normal: { A: 3, B: 4, C: 6, D: 8, E: 10, F: 11, X: 13 } as Record<string, number>,
    consumable: { A: 2, B: 3, C: 4, D: 6, E: 8, F: 10, X: 13 } as Record<string, number>,
};

export interface ShopEntry {
    item: CatalogItem;
    code: string; // the era's availability bracket code A–F / X
    tn: number; // the 2d6 target number (with the tech-level mod)
    price: number; // C-bills (already surcharged for out-of-system)
    qty: number | null; // in-system stock qty; null = unlimited (out-of-system special order)
    staple: boolean; // an always-stocked common (A/B auto-pass or a STAPLES_FORCE member)
    forced: boolean; // a STAPLES_FORCE member — guaranteed past the cap
    source: 'in-system' | 'out-of-system';
}

export interface ShopOrder {
    id: string;
    catalogId: string;
    name: string;
    category: 'ammunition' | 'armor' | 'component';
    unit: 'tons' | 'count';
    qty: number;
    price: number; // C-bills paid at order (already surcharged)
    orderedOn: string; // display date of the order
    deliver: { y: number; m: number; d: number }; // campaign date it lands
    delivered: boolean;
}

export type ShopCategory = 'weapon' | 'ammo' | 'armor' | 'structure' | 'component';
export function shopCategoryOf(item: CatalogItem): ShopCategory {
    const c = item.category;
    if (c === 'weapon') return 'weapon';
    if (c === 'ammo') return 'ammo';
    if (c === 'armor') return 'armor';
    if (c === 'structure') return 'structure';
    return 'component'; // misc / engine / gyro / cockpit / actuator
}

function seedHash(s: string): number {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const roll2d6 = (rng: () => number): number => (1 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 6));

/** The campaign year's availability bracket (the per-era code lives under this key in the JSON brackets). */
export function eraBracketKey(year: number): 'sl' | 'sw' | 'clan' | 'da' {
    const b = SHOP_TUNABLES.eraBoundaries;
    if (year <= b.sl) return 'sl';
    if (year <= b.sw) return 'sw';
    if (year <= b.clan) return 'clan';
    return 'da';
}

const STEP_UP: Record<string, string> = { A: 'B', B: 'C', C: 'D', D: 'E', E: 'F', F: 'X', X: 'X' };

/** The availability CODE (A–F/X) for an item in the campaign year — the right per-era bracket (default 'D'),
 *  with the MekHQ Clan-from-IS penalty: Clan-tech to a non-Clan command is one availability step harder
 *  (the lostech window + the X-pre-Clan bracket are already baked into the per-era codes from the catalog). */
export function availabilityCode(item: CatalogItem, year: number, playerClan = false): string {
    let code: string = SHOP_TUNABLES.defaultCode;
    if (item.availability) {
        try {
            const parsed = JSON.parse(item.availability) as Record<string, string>;
            if (parsed && typeof parsed === 'object') {
                const raw = parsed[eraBracketKey(year)] ?? parsed['sw'] ?? parsed['clan'] ?? parsed['sl'] ?? parsed['da'];
                if (typeof raw === 'string' && raw) code = raw.toUpperCase();
            }
        } catch { /* malformed brackets → the moderate default */ }
    }
    if (item.tech_base === 'Clan' && !playerClan && code !== 'X') code = STEP_UP[code] ?? code; // Clan-from-IS +1 step
    return code;
}

export function levelModFromRating(rating: string | null | undefined): number {
    const r = (rating ?? '').toUpperCase();
    return r === 'E' || r === 'F' ? -1 : -2;
}

/** The 2d6 target number for an item in the campaign year (availability bracket + the tech-level mod, floor 2). */
export function targetNumberFor(item: CatalogItem, year: number, playerClan = false): number {
    const code = availabilityCode(item, year, playerClan);
    if (code === 'X') return AVAILABILITY_TN.normal['X']; // impossible — out-of-system only
    const table = item.category === 'ammo' ? AVAILABILITY_TN.consumable : AVAILABILITY_TN.normal;
    const base = table[code] ?? table['D'];
    return Math.max(2, base + levelModFromRating(item.tech_rating));
}

/** C-bills for a part — the catalog flat cost, else the interim per-category fallback (formula rows are 0/null). */
export function priceOfPart(item: CatalogItem): number {
    if (item.cost_cbills && item.cost_cbills > 0) return Math.round(item.cost_cbills);
    return SHOP_TUNABLES.fallbackCostByCategory[item.category] ?? 50000;
}

const STAPLE_TESTS: ((c: CatalogItem) => boolean)[] = [
    (c) => /^standard armor$/i.test(c.name) || c.id === 'struct:armor_standard',
    (c) => c.category === 'ammo' && /machine gun ammo/i.test(c.name),
    (c) => c.category === 'ammo' && /^ac\/(2|5) ammo$/i.test(c.name),
    (c) => c.category === 'ammo' && /^(lrm|srm) \d+ ammo$/i.test(c.name),
    (c) => /^heat sink$/i.test(c.name),
    (c) => /^endo[- ]?steel$/i.test(c.name),
    (c) => typeof c.id === 'string' && c.id.startsWith('struct:actuator'),
];
export function isForcedStaple(c: CatalogItem): boolean {
    return STAPLE_TESTS.some((t) => t(c));
}

const byName = (a: ShopEntry, b: ShopEntry): number => a.item.name.localeCompare(b.item.name);
function stockQty(rng: () => number, staple: boolean): number {
    return staple ? 2 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2); // staples 2–5, rotation 1–2 (seeded)
}

/**
 * IN-SYSTEM stock for the current restock cycle: for each era-legal item, roll 2d6 vs its TN (deterministic
 * per seed+period+item) → in stock on a success, plus the STAPLES_FORCE union. X never appears (TN 13).
 */
const CLUTTER_NAME = /\b(auto-?pistol|pistol|revolver|whip|sub-?machine ?gun|smg|musket|derringer|blowgun|needler|gyrojet|nullifier|shotgun)\b|man-?portable|\b(laser|support|portable|semi-?portable)\s+(pistol|rifle|laser|ppc|smg|weapon)\b|rifle\s*\(|\bvibro-?(blade|knife|sword|katana|mace|axe|claw|dagger)\b|^ba /i;

export function isRelevantPart(item: CatalogItem, relevantIds: Set<string> | null | undefined): boolean {
    if (typeof item.id === 'string' && item.id.startsWith('struct:')) return true;
    if (relevantIds && relevantIds.size > 0) return relevantIds.has(String(item.id));
    return !CLUTTER_NAME.test(item.name || ''); // set unavailable → name-only safety net (never show clutter)
}

/** The system's market rating (0..1) from the campaign resource tier (the T-010 per-system hook lands here). */
export function marketRating(resource: string | null | undefined): number {
    return SHOP_TUNABLES.marketRatingByResource[resource ?? ''] ?? SHOP_TUNABLES.marketRatingDefault;
}
/** Realized in-system stock cap (between inSystemMin/Max) for a market rating. */
export function inSystemCap(rating: number): number {
    const { inSystemMin: lo, inSystemMax: hi } = SHOP_TUNABLES;
    return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, rating)));
}
const RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
const rankOf = (code: string): number => RANK[code] ?? 3; // common-first ordering for the cap fill
const isRareCode = (code: string): boolean => code === 'E' || code === 'F';

export interface InSystemOpts { playerClan?: boolean; relevantIds?: Set<string> | null; rating?: number }

/**
 * IN-SYSTEM stock for the current cycle: relevance-filtered → availability-TN roll (+ STAPLES_FORCE) → CAPPED to
 * a believable local count, weighted toward common (A/B/C) with an occasional rare (E/F) scaled to the market
 * rating. STAPLES_FORCE always survive the cap. Deterministic per (seed, periodKey).
 */
export function buildInSystemStock(catalog: CatalogItem[], year: number, seed: string, periodKey: string, opts: InSystemOpts = {}): ShopEntry[] {
    const playerClan = opts.playerClan ?? false;
    const rating = opts.rating ?? SHOP_TUNABLES.marketRatingDefault;
    // 1) relevance + the availability roll → the in-stock pool (rolled-in + forced staples)
    const pool: ShopEntry[] = [];
    for (const item of catalog) {
        if (!isRelevantPart(item, opts.relevantIds)) continue;
        const code = availabilityCode(item, year, playerClan);
        const tn = targetNumberFor(item, year, playerClan);
        const forced = isForcedStaple(item);
        const rng = mulberry32(seedHash(`${seed}|${periodKey}|shop|${item.id}`));
        const passed = code !== 'X' && roll2d6(rng) >= tn; // X (TN 13) can never pass — out-of-system only
        if (!forced && !passed) continue;
        pool.push({ item, code, tn, price: priceOfPart(item), qty: stockQty(rng, forced || code === 'A' || code === 'B'), staple: forced || code === 'A' || code === 'B', forced, source: 'in-system' });
    }
    // 2) CAP: keep every forced staple; fill the rest common-weighted to the cap, reserving a few rare slots.
    const cap = inSystemCap(rating);
    const staples = pool.filter((e) => e.forced);
    const rest = pool.filter((e) => !e.forced);
    const slots = Math.max(0, cap - staples.length);
    const rareSlots = Math.min(slots, Math.round(slots * SHOP_TUNABLES.rareFraction * rating));
    // deterministic weighted order: common rank first, seeded tiebreak within a rank (stable per seed+period).
    const ordered = (arr: ShopEntry[]) => arr
        .map((e) => ({ e, k: rankOf(e.code) * 100000 + (seedHash(`${seed}|${periodKey}|samp|${e.item.id}`) % 100000) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.e);
    const commons = ordered(rest.filter((e) => !isRareCode(e.code))).slice(0, Math.max(0, slots - rareSlots));
    const rares = ordered(rest.filter((e) => isRareCode(e.code))).slice(0, rareSlots);
    return [...staples, ...commons, ...rares].sort(byName);
}

/**
 * OUT-OF-SYSTEM list: the FULL era-legal catalog (incl. the rare/high-TN/X-but-era-legal items the in-system
 * roll won't surface) at the transport surcharge. Unlimited qty (special order).
 */
/** The surcharged out-of-system price (catalog price × (1 + surcharge)). */
export function outOfSystemPrice(item: CatalogItem): number {
    return Math.round(priceOfPart(item) * (1 + SHOP_TUNABLES.outOfSystemSurcharge));
}

/**
 * OUT-OF-SYSTEM SEARCH (not a browse): the era-legal RELEVANT items whose name matches the query, as request
 * candidates (TN + the +surcharge price). Empty query → []. Capped so the picker stays small.
 */
export function searchOutOfSystem(catalog: CatalogItem[], year: number, query: string, opts: InSystemOpts = {}, limit = 40): ShopEntry[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const playerClan = opts.playerClan ?? false;
    const out: ShopEntry[] = [];
    for (const item of catalog) {
        if (!isRelevantPart(item, opts.relevantIds)) continue;
        if (!item.name.toLowerCase().includes(q)) continue;
        out.push({ item, code: availabilityCode(item, year, playerClan), tn: targetNumberFor(item, year, playerClan), price: outOfSystemPrice(item), qty: null, staple: false, forced: false, source: 'out-of-system' });
    }
    return out.sort(byName).slice(0, limit);
}

/**
 * The out-of-system sourcing ROLL — 2d6 vs the availability TN (clamped to 12 so even an X item has the slim
 * boxcars chance — out-of-system reaches the rare stock the in-system roll won't). DETERMINISTIC per
 * (seed, periodKey, item): a failure means "not sourced this cycle — try again after the next restock".
 */
export function outOfSystemRoll(item: CatalogItem, year: number, seed: string, periodKey: string, playerClan = false): { sourced: boolean; roll: number; tn: number } {
    const tn = Math.min(12, targetNumberFor(item, year, playerClan));
    const rng = mulberry32(seedHash(`${seed}|${periodKey}|oos|${item.id}`));
    const roll = roll2d6(rng);
    return { sourced: roll >= tn, roll, tn };
}
