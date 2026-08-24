/*
 * BCE — HSFORGE-1: deterministic RNG for the Hot Spots Forge. Same-seedKey → byte-identical hotspot
 * (the Phase 1 determinism gate). cyrb53→mulberry32 is the D-110e rollComplications pattern; substreams
 * derive by suffixing the key so a validation reroll never replays the failed draw.
 */

/** cyrb53 string hash (public-domain construction) — stable across sessions/platforms. */
export function hashKey(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32 PRNG over a 32-bit seed. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A deterministic RNG stream for a seed key (+ optional substream suffix). */
export function rngFor(seedKey: string, substream = ''): () => number {
    return mulberry32(hashKey(seedKey + (substream ? '|' + substream : '')));
}

/** Deterministic pick from a non-empty array. */
export function pick<T>(arr: readonly T[], rng: () => number): T {
    return arr[Math.floor(rng() * arr.length)];
}

/** Deterministic weighted pick. Weights ≤ 0 are excluded; throws on an all-zero pool (fail-loud). */
export function pickWeighted<T>(arr: readonly T[], weightOf: (t: T) => number, rng: () => number): T {
    const pool = arr.map((t) => ({ t, w: weightOf(t) })).filter((x) => x.w > 0);
    if (!pool.length) throw new Error('hs-forge: pickWeighted over an empty/zero-weight pool');
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rng() * total;
    for (const x of pool) { r -= x.w; if (r <= 0) return x.t; }
    return pool[pool.length - 1].t;
}

/** Deterministic integer in [min, max] inclusive. */
export function rngInt(min: number, max: number, rng: () => number): number {
    return Math.round(min + rng() * (max - min));
}

/** An 8-hex id fragment from a seed key (the forged-hotspot id scheme `hs-forged-<hex>`). */
export function hexId(seedKey: string): string {
    return (hashKey(seedKey) >>> 0).toString(16).padStart(8, '0');
}
