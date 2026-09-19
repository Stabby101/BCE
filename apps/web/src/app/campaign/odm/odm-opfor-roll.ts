
export interface OdmCatalogAnnotation { name: string; mulId: number; tons: number; bv: number; type: string }
export interface OdmForceSpecFixed {
    chassis: string; variant: string;
    pilot: { name: string; gunnery: number; piloting: number };
    catalog?: OdmCatalogAnnotation;
}
export interface OdmForceSpecSlot {
    role: string;
    count: number | [number, number];
    quality: 'Green' | 'Regular' | 'Veteran' | 'Elite';
    pool: { chassis: string; variant: string; catalog?: OdmCatalogAnnotation }[];
    weightBand?: [number, number];
    armsMix?: 'mech' | 'vehicle' | 'any';
}
export interface OdmForceSpec {
    mission: string;
    faction: string;
    legality: { year: number; mulFactions?: string[]; factionCheck?: 'year-only' };
    bvEnvelope: { target: number; tolerance: number };
    fixed: OdmForceSpecFixed[];
    slots: OdmForceSpecSlot[];
    pilotNames: string[];
}
export interface OdmRolledUnit {
    chassis: string; variant: string; unitRef: string; mulId: number;
    bv: number; tons: number; type: string;
    pilotName: string; gunnery: number; piloting: number;
    role: string; fixed: boolean;
}
export interface OdmRolledRoster {
    units: OdmRolledUnit[];
    totalBv: number;
    envelope: { target: number; tolerance: number; inEnvelope: boolean; fallback: boolean };
    seed: string;
}
export type OdmResolveUnit = (chassis: string, variant: string) => OdmCatalogAnnotation | undefined;

// ── the deterministic RNG (cyrb53 hash → mulberry32 stream; substreams by key) ──
function hashKey(str: string): number {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function mulberry32(a: number): () => number {
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rngFor = (seed: string, sub: string): (() => number) => mulberry32(hashKey(`odm7|${seed}|${sub}`));
export const seedToNumber = (seed: string): number => hashKey(seed) % 2147483647;
const rngInt = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** BT convention bands: the stated pair ±1, clamped to [0,8] — jitter never drifts MekHQ-style outward. */
const QUALITY: Record<OdmForceSpecSlot['quality'], { g: number; p: number }> = {
    Green: { g: 5, p: 6 }, Regular: { g: 4, p: 5 }, Veteran: { g: 3, p: 4 }, Elite: { g: 2, p: 3 },
};
function jitterSkill(base: number, rng: () => number): number {
    const j = rng(); // 25% better · 50% stated · 25% worse — clamped to the band edge (±1) and [0,8]
    const d = j < 0.25 ? -1 : j < 0.75 ? 0 : 1;
    return Math.max(0, Math.min(8, base + d));
}

const MAX_ATTEMPTS = 24;

/** Roll the concrete roster — a pure function of (spec, seed, resolve). See the header for the laws. */
export function rollOpfor(spec: OdmForceSpec, seed: string, resolve: OdmResolveUnit): OdmRolledRoster {
    // catalog drift must never silently override. The live catalog is the FALLBACK only (unstamped dev specs);
    // this also kills the hydration race (a stamped spec rolls identically whatever the catalog's load state).
    const resolveOr = (chassis: string, variant: string, ann?: OdmCatalogAnnotation): OdmCatalogAnnotation => {
        const cat = ann ?? resolve(chassis, variant);
        if (!cat) throw new Error(`unresolvable unit "${chassis} ${variant}" — the ingest validator must stamp annotations`);
        return cat;
    };
    const fixedUnits: OdmRolledUnit[] = spec.fixed.map((f) => {
        const cat = resolveOr(f.chassis, f.variant, f.catalog);
        return { chassis: f.chassis, variant: f.variant, unitRef: cat.name, mulId: cat.mulId, bv: cat.bv, tons: cat.tons, type: cat.type,
                 pilotName: f.pilot.name, gunnery: f.pilot.gunnery, piloting: f.pilot.piloting, role: 'fixed', fixed: true };
    });
    const fixedBv = fixedUnits.reduce((s, u) => s + u.bv, 0);
    const { target, tolerance } = spec.bvEnvelope;

    let best: { units: OdmRolledUnit[]; totalBv: number; dist: number } | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const units: OdmRolledUnit[] = [];
        // pilot names: a deterministic without-replacement order per attempt (wraps if the pool runs short)
        const nameOrder = [...spec.pilotNames];
        const nameRng = rngFor(seed, `names|${attempt}`);
        for (let i = nameOrder.length - 1; i > 0; i--) { const j = rngInt(nameRng, 0, i); [nameOrder[i], nameOrder[j]] = [nameOrder[j], nameOrder[i]]; }
        let nameIx = 0;
        for (let s2 = 0; s2 < spec.slots.length; s2++) {
            const slot = spec.slots[s2];
            const countRng = rngFor(seed, `slot${s2}|count|${attempt}`);
            const count = Array.isArray(slot.count) ? rngInt(countRng, slot.count[0], slot.count[1]) : slot.count;
            for (let u = 0; u < count; u++) {
                const pickRng = rngFor(seed, `slot${s2}|u${u}|pick|${attempt}`);
                const cand = slot.pool[rngInt(pickRng, 0, slot.pool.length - 1)];
                const cat = resolveOr(cand.chassis, cand.variant, cand.catalog);
                const skillRng = rngFor(seed, `slot${s2}|u${u}|skill|${attempt}`);
                const q = QUALITY[slot.quality];
                // FORGE LINE (Phase 1 review, MAJOR 5): an empty pilotNames pool THROWS — the roll never
                // invents a name (the validator forbids shipping such a spec; this is the belt).
                if (!nameOrder.length) throw new Error('pilotNames is empty — the roll cannot invent names');
                // LOAD-BEARING PROPERTY ORDER: the object literal below DRAWS from the RNG in property order
                // (pilotName consumes nameIx, then gunnery/piloting each consume skillRng). Reordering these
                // properties — by hand, lint autofix, or key sort — silently changes every roster. DO NOT SORT.
                units.push({
                    chassis: cand.chassis, variant: cand.variant, unitRef: cat.name, mulId: cat.mulId,
                    bv: cat.bv, tons: cat.tons, type: cat.type,
                    pilotName: nameOrder[nameIx++ % nameOrder.length], // without-replacement order; WRAPS once units exceed the pool
                    gunnery: jitterSkill(q.g, skillRng), piloting: jitterSkill(q.p, skillRng),
                    role: slot.role, fixed: false,
                });
            }
        }
        const totalBv = fixedBv + units.reduce((s3, u) => s3 + u.bv, 0);
        const dist = Math.abs(totalBv - target);
        if (!best || dist < best.dist) best = { units, totalBv, dist };
        if (dist <= tolerance) break; // in-envelope — done (the common case; reachability is ingest-asserted)
    }
    const totalBv = best!.totalBv;
    const inEnvelope = Math.abs(totalBv - target) <= tolerance;
    return {
        units: [...fixedUnits, ...best!.units],
        totalBv,
        envelope: { target, tolerance, inEnvelope, fallback: !inEnvelope }, // fallback = closest-legal IN-POOL, flagged
        seed,
    };
}
