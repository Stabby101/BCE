import type { StarSystem } from '../star/star-types';

export interface LocaleFit {
    settlement?: string[];
    regionRole?: string[];
    terrain?: string[];
}
export interface LocalizeOpts {
    eraId: number;
    targetFaction: string;
    employer?: string;
    ownerAt: (sys: StarSystem, eraId: number) => string;
    localeFit?: LocaleFit | null;
    rng?: () => number;
}
export interface LocalizeResult {
    system: StarSystem;
    relaxLevel: number; // 0 = full localeFit honored; 1 dropped terrain; 2 dropped regionRole; 3 dropped settlement
    tier: number;
    friendlyFallback: boolean;
}

// settlement → a district appropriate to it (replaces the random district pool when localized).
const DISTRICTS: Record<string, string[]> = {
    port: ['the dockside wards', 'the harbor cordon'],
    industrial: ['the foundry quarter', 'the rail-yard precinct'],
    agrarian: ['the market commons', 'the granary district'],
    capital: ['the upper terraces', 'the government ring'],
    frontier: ['the garrison annex', 'the frontier station'],
};
export function districtForSettlement(settlement: string | undefined, rng: () => number = Math.random): string {
    const pool = DISTRICTS[settlement ?? ''] ?? ['Old Ring district', 'the cistern district'];
    return pool[Math.floor(rng() * pool.length)];
}

/** Pick a localized target system from an in-range pool. Faction bias is SOFT (prefer target-owned, then the
 *  border/contested frontier, then anywhere) so it never dead-ends; localeFit relaxes in order. Null only when
 *  candidates is empty (the caller then widens jumpLy / falls back to the random pool). */
export function pickLocalizedSystem(candidates: StarSystem[], opts: LocalizeOpts): LocalizeResult | null {
    if (!candidates.length) return null;
    const rng = opts.rng ?? Math.random;
    const lf = opts.localeFit ?? {};
    // localeFit predicates, most → least specific (relaxed in this order: terrain, then regionRole, then settlement).
    const passes = [
        (s: StarSystem) => !lf.terrain?.length || (s.localeAttrs.terrain ?? []).some((t) => lf.terrain!.includes(t)),
        (s: StarSystem) => !lf.regionRole?.length || lf.regionRole.includes(s.localeAttrs.regionRole),
        (s: StarSystem) => !lf.settlement?.length || lf.settlement.includes(s.localeAttrs.settlement),
    ];
    //   0 = the TARGET owns this system (the enemy's world — the right place to hit);
    //   1 = a border/contested CONFLICT FRONTIER that is NOT employer-owned (plausibly contested with the target);
    //   2 = friendly/interior in range (your own backyard) — LAST RESORT only, and flagged so the framing softens.
    // An employer-owned border world is friendly (tier 2), not a frontier to strike.
    const tierOf = (s: StarSystem): number => {
        const owner = opts.ownerAt(s, opts.eraId);
        if (opts.targetFaction && owner === opts.targetFaction) return 0; // the enemy's world
        const r = s.localeAttrs.regionRole;
        const frontier = r === 'border' || r === 'contested';
        if (frontier && (!opts.employer || owner !== opts.employer)) return 1; // a conflict frontier, not your own border
        return 2; // friendly / interior — last resort (striking your own space)
    };
    for (let drop = 0; drop <= 3; drop++) {
        const active = passes.slice(drop); // drop terrain, then regionRole, then settlement
        const pool = candidates.filter((s) => active.every((f) => f(s)));
        if (!pool.length) continue;
        for (let t = 0; t <= 2; t++) {
            const tier = pool.filter((s) => tierOf(s) === t);
            if (tier.length) return { system: tier[Math.floor(rng() * tier.length)], relaxLevel: drop, tier: t, friendlyFallback: t === 2 };
        }
    }
    return null;
}
