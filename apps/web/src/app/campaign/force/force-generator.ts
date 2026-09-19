
import { RAT_WEIGHTS, RAT_TIER_WEIGHT, UNLISTED_DAMPING, type RatWeightTable } from './rat-weights';
import type { CBTSerializedState } from '../../models/force-serialization';

/** Lite catalog projection the generator draws from (decoupled from MekBay's full Unit). */
export interface GenUnit {
    name: string; // Unit.name — internal unique, the serialized unitRef
    chassis: string;
    model: string;
    id: number; // MUL id
    year: number;
    level: string; // Introductory | Standard | Advanced | Experimental
    techRating: string; // composite; first char = base rating (D/E/F for Meks)
    weightClass: string; // Light | Medium | Heavy | Assault | ...
    role: string;
    tons: number;
    bv: number;
    unitType: 'mech' | 'vehicle';
}

/** A generated unit, the minimal envelope the engine later mints into a real instance (T-017). */
export interface ProtoInstance {
    instanceId: string;
    unitRef: string; // Unit.name, re-resolved via DataService.getUnitByName
    chassis: string;
    model: string;
    mulId: number;
    tons: number;
    bv: number;
    // The motor-pool + OpFor-composition display key. Vehicle battle-damage triage/repair degrades
    // gracefully (the Mech-crit readers find none — no crash); full vehicle crit handling is a follow-up.
    unitType?: 'mech' | 'vehicle';
    condition: string;
    lanceId?: string;
    isCommander?: boolean;
    provenance?: Provenance;
    // live-only). Optional + JSON-persisted with the instance (no version bump). Absent = pristine.
    damage?: CBTSerializedState;
    triage?: 'G' | 'Y' | 'R' | 'B';
    // Same set as chaos-sp-costs RepairLevel; read DIRECTLY (no CBTSerializedState synthesis). Optional / migration-safe.
    chaosDamage?: 'armor' | 'structure' | 'crippled' | 'destroyed';
}

export interface Provenance {
    origin: 'generated' | 'purchased' | 'gm-added' | 'captured' | 'hired-merc' | 'player-import';
    acquiredDate?: { y: number; m: number; d: number };
    owner?: string;
    sourceCampaignId?: string;
    originInstanceId?: string;
    homeReputation?: number;
}

export interface GeneratedForce {
    instances: ProtoInstance[];
    meta: {
        nominal: number;
        count: number;
        tier: ResourceTier;
        poolSize: number;
        seeded: number;
        clanBasis: boolean;
        weightSpread: Record<string, number>;
        levelSpread: Record<string, number>;
    };
}

export type ResourceTier = 'lean' | 'normal' | 'established';
type WeightClass = 'Light' | 'Medium' | 'Heavy' | 'Assault';

// ─────────────────────────────────────────────────────────────────────────────
// lets cited per-faction+era RAT data override these wholesale later.)
// ─────────────────────────────────────────────────────────────────────────────
export const FORCE_GEN_TUNABLES = {
    /** Nominal 'Mech counts by unit-size id. */
    sizeBands: { single: 1, lance: 4, company: 12, battalion: 36, regiment: 108 } as Record<string, number>,
    /** CLAN archetype uses the Star basis (Star/Trinary/Cluster/Galaxy). */
    clanSizeBands: { single: 1, lance: 5, company: 15, battalion: 45, regiment: 135 } as Record<string, number>,
    /** Resource tier -> [min,max] multiplier of nominal. Company: Lean 8-11 / Standard 10-16 / Established 13-16. */
    resourceCount: { lean: [0.7, 0.95], normal: [0.85, 1.33], established: [1.05, 1.33] } as Record<ResourceTier, [number, number]>,
    /** Per-chassis duplicate cap (duplicates are canon — a Kurita company fields multiple Panthers). */
    dupCap: 3,
    allowIndustrials: false,
    signatureSeedCap: { max: 3, pctOfForce: 0.25 },
    /** Commander (first slot) weight-roll modifier — a heavier command 'Mech (AtB +2). */
    commanderWeightMod: 2,
    /** rules-`level` draw weight by tier (Lean = older/common; Established = newer/advanced+experimental). */
    levelWeights: {
        lean: { Introductory: 3, Standard: 2, Advanced: 0.35, Experimental: 0 },
        normal: { Introductory: 1.5, Standard: 3, Advanced: 1, Experimental: 0.12 },
        established: { Introductory: 0.7, Standard: 2, Advanced: 1.6, Experimental: 0.5 },
    } as Record<ResourceTier, Record<string, number>>,
    /** base tech-rating (techRating[0]) draw weight by tier. */
    techWeights: {
        lean: { D: 3, E: 1.4, F: 0.5 },
        normal: { D: 1.6, E: 2, F: 1 },
        established: { D: 1, E: 2, F: 2 },
    } as Record<ResourceTier, Record<string, number>>,
    /** recency skew: how strongly intro-year recency is favored (+) or penalized (-) per tier. */
    recencySkew: { lean: -1, normal: 0, established: 1 } as Record<ResourceTier, number>,
    // Star League, thin in the 3025 'Mech-cult, common again Jihad+. Best-knowledge figures; tune live (★ HEURISTIC
    // — cross-check vs canon TO&E later). The FACTION modifier (below) multiplies this; the result clamps to the band.
    vehicleShareByYear: [
        { to: 2780, vehicleShare: 0.45 }, // Star League (2571–2780) — heavy combined arms (armor at parity)
        { to: 2900, vehicleShare: 0.30 }, // early Succession War (2786–2900) — attrition begins
        { to: 3049, vehicleShare: 0.15 }, // late SW / 3025 (2900–3049) — 'Mech-centric; lostech armor attrited
        { to: 3061, vehicleShare: 0.25 }, // Clan Invasion / FedCom (3050–3061) — combined arms returns
        { to: 3067, vehicleShare: 0.30 }, // FedCom Civil War (3062–3067)
        { to: 3081, vehicleShare: 0.40 }, // Jihad (3067–3081) — armor-heavy doctrine
        { to: 9999, vehicleShare: 0.40 }, // Dark Age / ilClan (3081+)
    ] as { to: number; vehicleShare: number }[],
    // periphery/pirates can't field 'Mechs at scale → armor-heavy; Houses/ComStar/merc are the baseline.
    vehicleFactionMod: { clan: 0.2, periphery: 1.5, baseline: 1.0 },
    vehicleShareClamp: [0, 0.6] as [number, number], // era × faction mod, clamped
} as const;

/** Collapse to lowercase alphanumerics — loose chassis/faction equality (the standing pattern). */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Match a RAT table to a faction (loose) + campaign year (coarse window). Null = no table → heuristic. */
function matchRatTable(faction: string | null, year: number): RatWeightTable | null {
    if (!faction) return null;
    const f = norm(faction);
    return RAT_WEIGHTS.find((t) => t.faction.some((m) => norm(m) === f) && year >= t.yearFrom && year <= t.yearTo) ?? null;
}

/** RAT chassis listed for a matched faction+year that DON'T resolve against the catalog (resolve-probe
 *  patched manually). `catalogChassis` is the normalized full-catalog chassis set (not year-gated, so
 *  intro-gated-but-valid chassis aren't false misses). Empty when no table matches. */
export function ratResolveProbe(faction: string | null, year: number, catalogChassis: Set<string>): string[] {
    const t = matchRatTable(faction, year);
    if (!t) return [];
    return t.entries.filter((e) => !catalogChassis.has(norm(e.chassis))).map((e) => e.chassis);
}

export interface FactionEraWeights {
    levelWeights: Record<string, number>;
    techWeights: Record<string, number>;
    recencySkew: number;
    ratMul: (chassis: string) => number; // per-chassis RAT multiplier (1 when no table)
}
export function resolveWeights(faction: string | null, year: number, tier: ResourceTier): FactionEraWeights {
    const base = {
        levelWeights: FORCE_GEN_TUNABLES.levelWeights[tier],
        techWeights: FORCE_GEN_TUNABLES.techWeights[tier],
        recencySkew: FORCE_GEN_TUNABLES.recencySkew[tier],
    };
    const table = matchRatTable(faction, year);
    if (!table) return { ...base, ratMul: () => 1 };
    const byChassis = new Map(table.entries.map((e) => [norm(e.chassis), RAT_TIER_WEIGHT[e.tier]] as const));
    return { ...base, ratMul: (chassis: string) => byChassis.get(norm(chassis)) ?? UNLISTED_DAMPING };
}

function vehicleFactionMod(factionCode: string | null | undefined): number {
    const m = FORCE_GEN_TUNABLES.vehicleFactionMod;
    const n = (factionCode ?? '').toLowerCase();
    if (!n) return m.baseline;
    if (/^clan\b/.test(n)) return m.clan;
    if (/\b(taurian|magistracy|canopus|outworlds|marian|circinus|aurigan|rim worlds|illyrian|lothian|oberon|tortuga|fronc|calderon|niops|new colony|hanseatic|umayyad|periphery|pirate|bandit|raider)\b/.test(n)) return m.periphery;
    return m.baseline;
}
export function vehicleShareForYear(year: number, factionCode?: string | null): number {
    const band = FORCE_GEN_TUNABLES.vehicleShareByYear.find((b) => year <= b.to);
    const era = band ? band.vehicleShare : 0.25;
    const [lo, hi] = FORCE_GEN_TUNABLES.vehicleShareClamp;
    return Math.max(lo, Math.min(hi, era * vehicleFactionMod(factionCode)));
}

const CLASS_KEYS: WeightClass[] = ['Light', 'Medium', 'Heavy', 'Assault'];
const normClass = (wc: string): WeightClass => {
    if (wc === 'Light' || wc === 'Medium' || wc === 'Heavy' || wc === 'Assault') return wc;
    if (/ultra|exoskel|pa\(l\)/i.test(wc)) return 'Light'; // rare; bucket sensibly
    return 'Assault'; // Colossal/Super-Heavy
};
const levelKey = (u: GenUnit): string => {
    const v = u.level as unknown;
    if (typeof v === 'number') return ['Introductory', 'Standard', 'Advanced', 'Experimental'][Math.min(Math.max(v, 0), 3)];
    return typeof v === 'string' && v ? v : 'Standard';
};
const techKey = (u: GenUnit): string => (u.techRating?.[0] ?? 'E').toUpperCase();

export function formationSeedCap(unitSizeId: string, clanBasis: boolean): number {
    const bands = clanBasis ? FORCE_GEN_TUNABLES.clanSizeBands : FORCE_GEN_TUNABLES.sizeBands;
    const nominal = bands[unitSizeId] ?? FORCE_GEN_TUNABLES.sizeBands['lance'];
    const cap = FORCE_GEN_TUNABLES.signatureSeedCap;
    return Math.min(cap.max, Math.floor(nominal * cap.pctOfForce));
}

/** Resolve the count for a size+tier (single is always 1; CLAN uses the Star basis). */
export function forceCount(unitSizeId: string, tier: ResourceTier, clanBasis: boolean, rng: () => number): { nominal: number; count: number } {
    const bands = clanBasis ? FORCE_GEN_TUNABLES.clanSizeBands : FORCE_GEN_TUNABLES.sizeBands;
    const nominal = bands[unitSizeId] ?? FORCE_GEN_TUNABLES.sizeBands['lance'];
    if (nominal <= 1) return { nominal, count: nominal };
    const [lo, hi] = FORCE_GEN_TUNABLES.resourceCount[tier];
    const count = Math.max(1, Math.round(nominal * (lo + rng() * (hi - lo))));
    return { nominal, count };
}

/** AtB 2d6 -> weight class (cited). 2-3 reroll (BCE fills the size-band count, so no empty slots);
 *  >=13 = Star League heavy, capped at Assault. */
function rollWeightClass(d6: () => number, mod: number, depth = 0): WeightClass {
    const roll = d6() + d6() + mod;
    if (roll <= 3) return depth > 4 ? 'Light' : rollWeightClass(d6, 0, depth + 1);
    if (roll <= 6) return 'Light';
    if (roll <= 9) return 'Medium';
    if (roll <= 11) return 'Heavy';
    return 'Assault'; // 12 and the >=13 Star-League tail both cap at Assault here
}

/** Heuristic draw weight for a unit within its class, skewed by tier (level/tech/recency). */
function drawWeight(u: GenUnit, w: FactionEraWeights, minYear: number, maxYear: number): number {
    const lvl = w.levelWeights[levelKey(u)] ?? 0.5;
    if (lvl <= 0) return 0;
    const tech = w.techWeights[techKey(u)] ?? 1;
    // recency in [0,1]; skew>0 favors newer, skew<0 favors older.
    const span = Math.max(1, maxYear - minYear);
    const r = (u.year - minYear) / span;
    const rec = w.recencySkew >= 0 ? 0.4 + 0.6 * r * w.recencySkew + 0.6 * (1 - Math.abs(w.recencySkew)) * r : 0.4 + 0.6 * (1 - r) * -w.recencySkew;
    return lvl * tech * Math.max(0.1, rec) * w.ratMul(u.chassis);
}

function pickWeighted(cands: GenUnit[], weights: number[], rng: () => number): GenUnit {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return cands[Math.floor(rng() * cands.length)];
    let r = rng() * total;
    for (let i = 0; i < cands.length; i++) {
        r -= weights[i];
        if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
}

export interface GenerateForceParams {
    pool: GenUnit[];
    seeds: GenUnit[]; // merc signature 'Mechs (resolved), guaranteed first
    unitSizeId: string;
    tier: ResourceTier;
    clanBasis: boolean;
    factionCode: string | null; // the faction NAME (RAT loose-match)
    year: number; // campaign start year (RAT window)
    eraId: number | null;
}

export interface GenerateOpForParams {
    pool: GenUnit[]; // already faction+era+combat-only filtered by the caller
    bvTarget: number; // player active-force BV × ratio
    tolerance: number; // fractional band half-width (±)
    factionCode: string | null; // the target faction NAME (RAT loose-match)
    year: number; // campaign year (RAT window)
    eraId: number | null;
    tier: ResourceTier;
    vehicleShare?: number;
}

export function generateForceToBV(p: GenerateOpForParams, rng: () => number = Math.random): { instances: ProtoInstance[]; bvTotal: number; bvTarget: number } {
    const d6 = (): number => Math.floor(rng() * 6) + 1;
    const w = resolveWeights(p.factionCode, p.year, p.tier);
    const minYear = p.pool.length ? Math.min(...p.pool.map((u) => u.year)) : 2500;
    const maxYear = p.pool.length ? Math.max(...p.pool.map((u) => u.year)) : 3150;
    const lo = p.bvTarget * (1 - p.tolerance);
    const hi = p.bvTarget * (1 + p.tolerance);
    const used: Record<string, number> = {};
    const instances: ProtoInstance[] = [];
    let bvTotal = 0;
    const mint = (u: GenUnit): void => {
        used[u.chassis] = (used[u.chassis] ?? 0) + 1;
        instances.push({ instanceId: `op-${instances.length + 1}-${Math.floor(rng() * 1e6)}`, unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv, condition: 'Active', unitType: u.unitType });
        bvTotal += u.bv;
    };
    const vShare = p.vehicleShare ?? vehicleShareForYear(p.year, p.factionCode);
    let guard = 0;
    const CAP = 300; // hard backstop (a regiment of light 'Mechs is ~150)
    while (bvTotal < lo && p.pool.length && guard < CAP) {
        guard++;
        const wc = rollWeightClass(d6, 0);
        // that type is empty/dup-capped — a 'Mech-only or vehicle-thin pool still completes the draw).
        const wantVehicle = rng() < vShare;
        const avail = p.pool.filter((u) => (used[u.chassis] ?? 0) < FORCE_GEN_TUNABLES.dupCap);
        const typeAvail = avail.filter((u) => (u.unitType === 'vehicle') === wantVehicle);
        const base = typeAvail.length ? typeAvail : avail;
        if (!base.length) break; // pool exhausted under the dup cap
        const inClass = base.filter((u) => normClass(u.weightClass) === wc);
        let cands = inClass.length ? inClass : base;
        const fitting = cands.filter((u) => bvTotal + u.bv <= hi);
        if (fitting.length) cands = fitting;
        else cands = [cands.reduce((a, b) => (b.bv < a.bv ? b : a))]; // nothing fits -> smallest, minimize overshoot
        const weights = cands.map((u) => drawWeight(u, w, minYear, maxYear));
        mint(pickWeighted(cands, weights, rng));
    }
    // combat vehicle that keeps BV IN THE ±tolerance BAND (the floor is a minimum; the share is the target, so
    // 3025 stays mostly 'Mechs + a token tank, never half-tanks). Strictly in-band; never adds recovery/engineering.
    const poolVeh = p.pool.filter((u) => u.unitType === 'vehicle');
    if (poolVeh.length && instances.length && !instances.some((u) => u.unitType === 'vehicle')) {
        let best: { mi: number; v: GenUnit; nt: number; dist: number } | null = null;
        for (let mi = 0; mi < instances.length; mi++) {
            if (instances[mi].unitType === 'vehicle') continue;
            const mbv = instances[mi].bv ?? 0;
            for (const v of poolVeh) {
                const nt = bvTotal - mbv + v.bv;
                if (nt < lo || nt > hi) continue; // keep the OpFor BV in the band
                const dist = Math.abs(nt - p.bvTarget);
                if (!best || dist < best.dist) best = { mi, v, nt, dist };
            }
        }
        if (best) {
            const v = best.v;
            bvTotal = best.nt;
            instances[best.mi] = { instanceId: instances[best.mi].instanceId, unitRef: v.name, chassis: v.chassis, model: v.model, mulId: v.id, tons: v.tons, bv: v.bv, condition: 'Active', unitType: v.unitType };
        }
    }
    return { instances, bvTotal, bvTarget: p.bvTarget };
}

export function generateForce(p: GenerateForceParams, rng: () => number = Math.random): GeneratedForce {
    const d6 = (): number => Math.floor(rng() * 6) + 1;
    const w = resolveWeights(p.factionCode, p.year, p.tier);
    const { nominal, count } = forceCount(p.unitSizeId, p.tier, p.clanBasis, rng);

    const minYear = p.pool.length ? Math.min(...p.pool.map((u) => u.year)) : 2500;
    const maxYear = p.pool.length ? Math.max(...p.pool.map((u) => u.year)) : 3150;
    const used: Record<string, number> = {};
    const instances: ProtoInstance[] = [];

    const mint = (u: GenUnit): void => {
        used[u.chassis] = (used[u.chassis] ?? 0) + 1;
        instances.push({ instanceId: `pi-${instances.length + 1}-${Math.floor(rng() * 1e6)}`, unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv, condition: 'Active', unitType: u.unitType });
    };

    // 1) Seed the command's signature 'Mechs first (merc model-on-canon), capped at count.
    for (const s of p.seeds) {
        if (instances.length >= count) break;
        if ((used[s.chassis] ?? 0) >= FORCE_GEN_TUNABLES.dupCap) continue;
        mint(s);
    }

    // 2) Fill the remainder by AtB weight-class roll -> heuristic-weighted draw of that class.
    const vShare = vehicleShareForYear(p.year);
    let guard = 0;
    while (instances.length < count && p.pool.length && guard < count * 40) {
        guard++;
        const isCommander = instances.length === 0;
        const wc = rollWeightClass(d6, isCommander ? FORCE_GEN_TUNABLES.commanderWeightMod : 0);
        // share, then draws within it (fall back to the other type when empty/dup-capped).
        const wantVehicle = !isCommander && rng() < vShare;
        const avail = p.pool.filter((u) => (used[u.chassis] ?? 0) < FORCE_GEN_TUNABLES.dupCap);
        const typeAvail = avail.filter((u) => (u.unitType === 'vehicle') === wantVehicle);
        const base = typeAvail.length ? typeAvail : avail;
        if (!base.length) break; // whole pool exhausted under the dup cap
        let cands = base.filter((u) => normClass(u.weightClass) === wc);
        if (!cands.length) cands = base; // any class within the chosen type
        const weights = cands.map((u) => drawWeight(u, w, minYear, maxYear));
        mint(pickWeighted(cands, weights, rng));
    }

    const spread = (key: (u: ProtoInstance) => string): Record<string, number> => {
        const m: Record<string, number> = {};
        for (const i of instances) m[key(i)] = (m[key(i)] ?? 0) + 1;
        return m;
    };
    const byName = new Map(p.pool.map((u) => [u.name, u] as const));
    return {
        instances,
        meta: {
            nominal,
            count,
            tier: p.tier,
            poolSize: p.pool.length,
            seeded: Math.min(p.seeds.length, instances.length),
            clanBasis: p.clanBasis,
            weightSpread: spread((i) => normClass(byName.get(i.unitRef)?.weightClass ?? 'Medium')),
            levelSpread: spread((i) => { const u = byName.get(i.unitRef); return u ? levelKey(u) : '—'; }),
        },
    };
}
