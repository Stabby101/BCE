
const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const isClan = (name: string): boolean => /clan/i.test(name);
const isPirate = (name: string): boolean => /pirate|bandit/i.test(name);

/** The year the Clans cross the Periphery — before it, no Inner-Sphere realm fights a Clan (the categorical floor). */
export const CLAN_INVASION_YEAR = 3050;

export interface MatchupCtx {
    /** faction name → the faction names that BORDER it at this era (from systems.json ownerByEra adjacency). */
    adjacency: Record<string, string[]>;
    /** campaign year — drives the categorical Clan floor. */
    year: number;
}

/** Is TARGET a plausible opponent of EMPLOYER at this era? Pirates: always (raiders cross any border).
 *  Clans: only at/after 3050 AND only where they border the employer (their occupation front). Everyone
 *  else: a territory border. */
export function isPlausibleMatchup(employer: string, target: string, ctx: MatchupCtx): boolean {
    if (!target || target === employer) return false;
    if (isPirate(target)) return true; // raiders/bandits are a plausible foe for anyone
    const borders = (ctx.adjacency[employer] ?? []).map(norm);
    if (isClan(target)) {
        if (ctx.year < CLAN_INVASION_YEAR) return false; // categorical floor — no IS realm fought a Clan pre-3050
        return borders.includes(norm(target)); // a Clan is a plausible target only on the front it occupies
    }
    return borders.includes(norm(target)); // IS↔IS / IS↔periphery: a real territorial border
}

/** Filter candidate targets to those plausibly opposed to the employer. NEVER DEAD-ENDS: an empty result
 *  signals the caller to relax to the full (era-active) pool — mirrors the selectSeed relax discipline. */
export function plausibleTargets<T extends { name: string }>(employer: string, candidates: T[], ctx: MatchupCtx): T[] {
    return candidates.filter((t) => isPlausibleMatchup(employer, t.name, ctx));
}
