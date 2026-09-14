/*
 * BCE Inventory II (DIRECTIVE-056, T-037 slice 2) — the PURE starting-inventory model.
 *
 * No Angular/DOM/service deps: given a resolved force summary + a tier + the era-legal catalog rows, it
 * deterministically produces the starting InventoryState. The owning InventoryService does the impure
 * work (resolve units → ammo needs via DataService, fetch the era-legal catalog) and calls this.
 *
 * HEURISTIC — PM-tunable (like D-046 vehicle-share / D-037 tech-pool). Item identity/cost/era come from
 * the D-055 catalog (cited there); the ALLOTMENT math here is BCE-authored (INVENTORY_TUNABLES). Canon
 * shots/ton are cited (TechManual). DATA-002/003: this output is structured campaign state, stored on the
 * snapshot; never parsed from prose. Determinism: quantities are formulaic with a stable-seed jitter, and
 * the realized state is STORED (reload reads it — never re-rolls).
 */

export type InventoryTier = 'lean' | 'normal' | 'established';
export type InventoryCategory = 'ammunition' | 'armor' | 'component';
export type InventoryStatus = 'GOOD' | 'LOW' | 'CRITICAL' | 'OUT';

export interface InventoryLine {
    catalogId: string | null;        // catalog row id; null for pure ammo-by-class tonnage (no 1:1 row)
    category: InventoryCategory;
    label: string;
    onHand: number;                  // tons for ammo/armor; count for components
    unit: 'tons' | 'count';
    floor: number;
    notes?: string;
    /** DIRECTIVE-ODM-17 P3 (additive; the ODM fork only — Classic never reads or writes it): per-grade
     *  counts for COMPONENT lines, the doctrine's A/B/C/RAW ledger (armor_parts qty_grade_a/b/c/raw_stock).
     *  onHand stays the TOTAL (every existing render remains truthful); grades sum to onHand. Absent on a
     *  legacy line = pre-P3; the fork migrates forward-only (a = onHand). */
    grades?: { a: number; b: number; c: number; raw: number };
}
export interface InventoryState {
    lines: InventoryLine[];
    generatedAt: string;             // campaign day / ISO marker
    tier: string;
}

/** The frontend's view of a /api/catalog row (era-legal rows the server pre-filtered). The `list()` endpoint
 *  returns the FULL CatalogRow, so availability + tech_rating + tonnage + the lostech-window years are on the
 *  wire — DIRECTIVE-064 surfaces them here for the shop's availability-TN rotation. (Older callers ignore them.) */
export interface CatalogItem {
    id: string;
    name: string;
    category: string;
    tech_base: string;
    intro_year: number | null;
    cost_cbills: number | null;
    cost_formula: string | null;
    provenance: string;
    /** DIRECTIVE-064: per-era availability brackets as a JSON string `{"sl","sw","clan","da"}` (codes A–F/X),
     *  or null for the authored structural rows (which ride STAPLES_FORCE / the moderate default). */
    availability?: string | null;
    tech_rating?: string | null;       // overall tech rating A–F — the proxy for the INTRO/STD vs ADV TN mod
    tonnage?: number | null;
    extinction_year?: number | null;
    reintro_year?: number | null;
}

/** One ammo-bearing weapon group resolved from the fielded force (by the service, from unit loadouts). */
export interface ForceAmmoInput {
    ammoType: string;   // MekBay AmmoType (LRM, SRM, AC, GAUSS, MG, …)
    rackSize: number;   // the weapon rack (the caliber digit for autocannons)
    weaponCount: number;
}
/** One weapon CLASS the force mounts, by display name × total mounted count (DIRECTIVE-057 spare-weapon spread). */
export interface ForceWeaponInput {
    name: string;
    count: number;
}
export interface StartingInventoryInput {
    ammo: ForceAmmoInput[];
    weapons: ForceWeaponInput[];   // every weapon the force mounts (name × count) — the spare-weapon spread
    jumperCount: number;           // # of jump-capable units in the force — gates/scales jump-jet spares
    fieldedMechTonnage: number;
    unitCount: number;
    tier: InventoryTier;
    year: number;
    catalog: CatalogItem[];   // era-legal rows (server pre-filtered by era + techBase)
    seed: string;             // stable per-campaign seed string
    generatedAt: string;
    logistics?: 'house-mic' | 'merc-market'; // DIRECTIVE-065 — the formation's logistics → starting depth
}

// ── TUNABLES (HEURISTIC, PM-tunable — same house style as FORCE_GEN_TUNABLES / BAY_TUNABLES) ──────────
export const INVENTORY_TUNABLES = {
    /** depth multiplier on raw quantities: thin → working → deep. */
    depthByTier: { lean: 0.6, normal: 1.0, established: 1.6 } as Record<InventoryTier, number>,
    /** floor as a fraction of starting on-hand. HIGHER = tighter margin → Lean "feels the pinch" (lines
     *  begin LOW); Established begins deep (GOOD). Pure status is recomputed at render, never stored. */
    floorFractionByTier: { lean: 0.7, normal: 0.4, established: 0.25 } as Record<InventoryTier, number>,
    /** ammo: tons stocked per ammo-bearing weapon of a class (before depth). */
    ammoTonsPerWeapon: 1.5,
    /** armor: tons of spare armor per ton of fielded 'Mech (before depth). */
    armorTonsPerMechTon: 0.05,
    /** components (before depth): heat sinks ∝ units, actuators ∝ units. */
    heatSinksPerUnit: 1.0,
    actuatorsPerUnit: 0.5,
    /** DIRECTIVE-057 spare WEAPONS: stock spares of the top-N most-mounted weapon classes (breadth), each
     *  scaled by (how many the force fields ÷ spareWeaponPerUnits). A Lyran company → LL/PPC/LRM/AC spares. */
    spareWeaponPerUnits: 4,
    weaponSpreadBreadth: 4,
    /** DIRECTIVE-057 spare ENGINES: standard fusion cores ∝ units (big-ticket → low count, tight floor). One
     *  per this many fielded units before depth: a lance (~4) → ~1, a company (~12) → ~2 at normal tier. */
    enginePerUnits: 6,
    /** DIRECTIVE-057 JUMP JETS: spare jets per jump-capable unit (only stocked when the force has jumpers). */
    jumpJetsPerJumper: 1.5,
    /** DIRECTIVE-064 DEEPER START (the "shallow" fix) — a wider, era-legal common-kit spread so a fresh
     *  company's Inventory reads deep, not bare. All era-gated (skipped when no era-legal row exists). */
    structureTonsPerMechTon: 0.03, // spare internal-structure sections ∝ fielded 'Mech tonnage
    casePerUnits: 4,               // CASE ammo-protection kits ∝ units (era-legal; absent pre-2825 SW)
    gyroPerUnits: 8,               // spare standard gyros — big-ticket, low count
    cockpitPerUnits: 12,           // spare standard cockpit/life-support — rare, deep outfits only
    extraActuatorPerUnits: 6,      // broaden the actuator spread (foot/upper-arm beyond lower-arm/hand)
    /** DIRECTIVE-065 — starting depth by the formation's logistics: a House command (house-mic) draws on its
     *  military-industrial complex → deeper on-hand; a merc (merc-market) buys its own → the lean baseline.
     *  Applied as a multiplier ON TOP of the tier/size depth; house-mic also gets a wider spare-weapon spread. */
    startingDepthByLogistics: { 'house-mic': 1.7, 'merc-market': 1.0 } as Record<string, number>,
    houseMicSpreadBonus: 3,        // house-mic stocks a broader weapon spread (its armory carries more lines)
    /** stable-seed jitter band on quantities (±) — genuine RNG variation, reproducible per seed. */
    jitter: 0.12,
} as const;

export type Logistics = 'house-mic' | 'merc-market';

/**
 * Canon shots per ton (TechManual ammunition tables; xref Sarna). Display-note only this slice
 * (quantities are by the ton). Keyed by class or "AC/<caliber>".
 */
export const CANON_SHOTS_PER_TON: Record<string, number> = {
    'AC/2': 45, 'AC/5': 20, 'AC/10': 10, 'AC/20': 5,
    'LRM-5': 24, 'LRM-10': 12, 'LRM-15': 8, 'LRM-20': 6,
    'SRM-2': 50, 'SRM-4': 25, 'SRM-6': 15,
    MG: 200, 'Light Machine Gun': 200, 'Heavy Machine Gun': 100,
    Gauss: 8, 'Light Gauss': 16, 'Heavy Gauss': 4, MRM: 24, ATM: 999,
};

const AUTOCANNON = new Set(['AC', 'LAC', 'AC_LBX', 'AC_ULTRA', 'AC_ROTARY', 'AC_LBX_THB', 'AC_ULTRA_THB', 'AC_IMP', 'ACi', 'PAC', 'HYPER_VELOCITY', 'AC_PRIMITIVE']);
const UNIVERSAL_MISSILE = new Set(['LRM', 'SRM', 'MRM', 'ATM', 'LRM_STREAK', 'SRM_STREAK', 'NLRM', 'EXLRM', 'SRM_ADVANCED', 'LRM_TORPEDO', 'SRM_TORPEDO', 'IATM', 'LRM_IMP', 'SRM_IMP', 'LRM_PRIMITIVE', 'SRM_PRIMITIVE']);

// Distinct label per autocannon variant so no two ammo lines collide on a label (the group KEY already
// carries the ammoType, so distinct variants never pool — this only fixes the display).
const AC_PREFIX: Record<string, string> = { AC: 'AC', LAC: 'LAC', AC_LBX: 'LB-X AC', AC_ULTRA: 'Ultra AC', AC_ROTARY: 'Rotary AC', AC_LBX_THB: 'LB-X AC (THB)', AC_ULTRA_THB: 'Ultra AC (THB)', AC_IMP: 'Improved AC', ACi: 'Improved AC', PAC: 'Proto AC', HYPER_VELOCITY: 'HVAC', AC_PRIMITIVE: 'Primitive AC' };
const CLASS_LABEL: Record<string, string> = {
    LRM: 'LRM', SRM: 'SRM', MRM: 'MRM', ATM: 'ATM', LRM_STREAK: 'Streak LRM', SRM_STREAK: 'Streak SRM',
    GAUSS: 'Gauss', GAUSS_LIGHT: 'Light Gauss', GAUSS_HEAVY: 'Heavy Gauss', APGAUSS: 'AP Gauss', HAG: 'HAG',
    MG: 'Machine Gun', MG_LIGHT: 'Light Machine Gun', MG_HEAVY: 'Heavy Machine Gun',
    NARC: 'Narc', INARC: 'iNarc', AMS: 'AMS', ARROW_IV: 'Arrow IV', LONG_TOM: 'Long Tom', SNIPER: 'Sniper',
    THUMPER: 'Thumper', MML: 'MML', PLASMA: 'Plasma', ROCKET_LAUNCHER: 'Rocket Launcher', MEK_MORTAR: "'Mech Mortar",
};

const prettify = (t: string): string => t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Group signature + display for an ammo-bearing weapon (autocannons are caliber-split; missiles pooled). */
function ammoGroup(ammoType: string, rackSize: number): { key: string; label: string; universal: boolean; shotsKey: string } {
    if (AUTOCANNON.has(ammoType)) {
        const prefix = AC_PREFIX[ammoType] ?? 'AC';
        const cal = rackSize > 0 ? `/${rackSize}` : '';
        return { key: `${ammoType}:${rackSize}`, label: `${prefix}${cal} ammo`, universal: false, shotsKey: `AC/${rackSize}` };
    }
    const label = CLASS_LABEL[ammoType] ?? prettify(ammoType);
    return { key: ammoType, label: `${label} ammo`, universal: UNIVERSAL_MISSILE.has(ammoType), shotsKey: label };
}

// ── deterministic PRNG (mulberry32 over a cyrb-style string hash) — same seed → same roll ──
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

const tierOf = (t: string): InventoryTier => (t === 'lean' || t === 'established' ? t : 'normal');
const findCatalog = (catalog: CatalogItem[], pred: (c: CatalogItem) => boolean): CatalogItem | undefined => catalog.find(pred);

/** Status from on-hand vs floor (pure; recomputed at render so no stored status can drift). */
export function statusOf(line: { onHand: number; floor: number }): InventoryStatus {
    if (line.onHand <= 0) return 'OUT';
    if (line.onHand < line.floor) return 'CRITICAL';
    if (line.onHand < line.floor * 1.5) return 'LOW';
    return 'GOOD';
}

const STATUS_LABEL: Record<InventoryStatus, string> = { GOOD: 'GOOD', LOW: 'LOW', CRITICAL: 'CRITICAL', OUT: 'OUT' };
export const statusLabel = (s: InventoryStatus): string => STATUS_LABEL[s];

/**
 * The deterministic starting-inventory roll. Quantities are formulaic (force counts × tier depth) with a
 * stable-seed ±jitter; the realized state is meant to be STORED (reload reads it, never re-rolls).
 */
export function generateStartingInventory(input: StartingInventoryInput): InventoryState {
    const tier = tierOf(input.tier);
    // DIRECTIVE-065 — logistics multiplies the tier/size depth: a House MIC starts deep, a merc lean.
    const logiMult = INVENTORY_TUNABLES.startingDepthByLogistics[input.logistics ?? 'merc-market'] ?? 1.0;
    const depth = INVENTORY_TUNABLES.depthByTier[tier] * logiMult;
    const ff = INVENTORY_TUNABLES.floorFractionByTier[tier];
    const rng = mulberry32(seedHash(input.seed));
    const jit = () => 1 + (rng() * 2 - 1) * INVENTORY_TUNABLES.jitter; // ±jitter, deterministic per seed
    const floorOf = (n: number) => Math.max(1, Math.ceil(n * ff));

    const lines: InventoryLine[] = [];

    // ── AMMUNITION — matched to the force's mounted weapons ──
    const groups = new Map<string, { label: string; universal: boolean; shotsKey: string; count: number }>();
    for (const a of input.ammo) {
        if (!a.ammoType || a.ammoType === 'NA') continue;
        const g = ammoGroup(a.ammoType, a.rackSize);
        const cur = groups.get(g.key) ?? { label: g.label, universal: g.universal, shotsKey: g.shotsKey, count: 0 };
        cur.count += Math.max(1, a.weaponCount);
        groups.set(g.key, cur);
    }
    for (const g of [...groups.values()].sort((x, y) => x.label.localeCompare(y.label))) {
        const tons = Math.max(1, Math.round(g.count * INVENTORY_TUNABLES.ammoTonsPerWeapon * depth * jit()));
        const shots = CANON_SHOTS_PER_TON[g.shotsKey];
        const note = g.universal
            ? `Feeds any ${g.label.replace(/ ammo$/, '')} launcher in the force${shots ? ` · ~${shots} shots/ton (TechManual)` : ''}`
            : shots
              ? `${shots} shots/ton (TechManual)`
              : 'Caliber-specific (TechManual ammunition tables)';
        lines.push({ catalogId: null, category: 'ammunition', label: g.label, onHand: tons, unit: 'tons', floor: floorOf(tons), notes: note });
    }

    // ── ARMOR — by the ton, scaled to total fielded 'Mech tonnage ──
    if (input.fieldedMechTonnage > 0) {
        const tons = Math.max(1, Math.round(input.fieldedMechTonnage * INVENTORY_TUNABLES.armorTonsPerMechTon * depth * jit()));
        const std = findCatalog(input.catalog, (c) => c.id === 'struct:armor_standard');
        lines.push({
            catalogId: std?.id ?? null, category: 'armor', label: std?.name ?? 'Standard Armor', onHand: tons, unit: 'tons',
            floor: floorOf(tons), notes: `Spare plate for ${Math.round(input.fieldedMechTonnage)} tons of fielded 'Mechs · 16 points/ton standard (TechManual)`,
        });
    }

    // ── COMPONENTS — a modest pool of common, era-legal catalog items ──
    const addComponent = (item: CatalogItem | undefined, count: number, note: string) => {
        if (!item || count <= 0) return;
        lines.push({ catalogId: item.id, category: 'component', label: item.name, onHand: count, unit: 'count', floor: floorOf(count), notes: note });
    };
    const units = Math.max(1, input.unitCount);
    // prefer Double Heat Sink when the era makes it legal (it is in the era-filtered catalog), else single
    const dhs = findCatalog(input.catalog, (c) => c.category === 'misc' && /^Double Heat Sink$/i.test(c.name));
    const shs = findCatalog(input.catalog, (c) => c.category === 'misc' && /^Heat Sink$/i.test(c.name));
    addComponent(dhs ?? shs, Math.max(1, Math.round(units * INVENTORY_TUNABLES.heatSinksPerUnit * depth * jit())), 'Common spare; era-legal (D-055 catalog)');
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:actuator_lower_arm'), Math.max(1, Math.round(units * INVENTORY_TUNABLES.actuatorsPerUnit * depth * jit())), 'Standard actuator spare');
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:actuator_hand'), Math.max(1, Math.round(units * INVENTORY_TUNABLES.actuatorsPerUnit * depth * jit())), 'Standard actuator spare');

    // ── SPARE ENGINES (D-057) — standard fusion cores ∝ company size; big-ticket → low count, tight floor.
    //    A lean lance may stock 0 (thin); a normal company ~2; established deeper. era-legal (D-055 catalog). ──
    const engine = findCatalog(input.catalog, (c) => c.category === 'engine' && /standard fusion/i.test(c.name))
        ?? findCatalog(input.catalog, (c) => c.category === 'engine' && /^standard/i.test(c.name));
    addComponent(engine, Math.round((units / INVENTORY_TUNABLES.enginePerUnits) * depth * jit()), 'Spare standard fusion engine core; era-legal (D-055)');

    // ── FORCE-MATCHED SPARE WEAPONS (D-057) — top-N most-mounted weapon classes the command actually fields,
    //    each scaled by how many it mounts ÷ spareWeaponPerUnits. Replaces the lone hard-coded Medium Laser. ──
    const breadth = INVENTORY_TUNABLES.weaponSpreadBreadth + (input.logistics === 'house-mic' ? INVENTORY_TUNABLES.houseMicSpreadBonus : 0);
    const topWeapons = [...input.weapons].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, breadth);
    for (const w of topWeapons) {
        const item = findCatalog(input.catalog, (c) => c.category === 'weapon' && c.name.toLowerCase() === w.name.toLowerCase());
        addComponent(item, Math.max(1, Math.round((w.count / INVENTORY_TUNABLES.spareWeaponPerUnits) * depth * jit())), `Force-matched spare — the command fields ${w.count}; era-legal`);
    }

    // ── JUMP JETS (D-057) — only when the force has jump-capable units; scaled to that count. era-legal. ──
    if (input.jumperCount > 0) {
        const jj = findCatalog(input.catalog, (c) => /^jump jet$/i.test(c.name));
        addComponent(jj, Math.max(1, Math.round(input.jumperCount * INVENTORY_TUNABLES.jumpJetsPerJumper * depth * jit())), `Spare jets for ${input.jumperCount} jump-capable unit${input.jumperCount === 1 ? '' : 's'}; era-legal`);
    }

    // ── DIRECTIVE-064 DEEPER START — a wider era-legal common-kit spread so the Inventory reads deep, not bare.
    //    Each line is era-gated (findCatalog over the era-filtered catalog → absent rows are simply skipped, e.g.
    //    CASE before 2825) and tier/size-scaled like the rest; the SHOP covers everything else on demand. ──
    const T = INVENTORY_TUNABLES;
    // spare internal-structure sections ∝ fielded 'Mech tonnage (the standard skeleton sections crews swap)
    const struct = findCatalog(input.catalog, (c) => c.id === 'struct:structure_standard') ?? findCatalog(input.catalog, (c) => c.category === 'structure' && /^standard/i.test(c.name));
    addComponent(struct, Math.round(input.fieldedMechTonnage * T.structureTonsPerMechTon * depth * jit()), 'Spare standard internal-structure sections; era-legal (D-055)');
    // CASE (ammo-protection) ∝ units — era-legal only (absent in early Succession Wars; in by ~2825)
    addComponent(findCatalog(input.catalog, (c) => /^case$/i.test(c.name)), Math.round((units / T.casePerUnits) * depth * jit()), 'CASE ammo-protection kit; era-legal (D-055)');
    // spare standard gyro — big-ticket, low count (a company ~1, a lance ~0)
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:gyro_standard'), Math.round((units / T.gyroPerUnits) * depth * jit()), 'Spare standard gyro; era-legal (D-055)');
    // spare standard cockpit/life-support — rare, deep outfits only
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:cockpit_standard'), Math.round((units / T.cockpitPerUnits) * depth * jit()), 'Spare standard cockpit + life support; era-legal (D-055)');
    // broaden the actuator spread beyond lower-arm/hand → foot + upper-arm
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:actuator_foot'), Math.round((units / T.extraActuatorPerUnits) * depth * jit()), 'Standard foot actuator spare');
    addComponent(findCatalog(input.catalog, (c) => c.id === 'struct:actuator_upper_arm'), Math.round((units / T.extraActuatorPerUnits) * depth * jit()), 'Standard upper-arm actuator spare');

    return { lines, generatedAt: input.generatedAt, tier };
}
