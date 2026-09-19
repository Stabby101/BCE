import type { MissionSeed, ForgeNpc, ForgeVoice, SeedCosts, SeedResourceGate } from './forge-types';

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── TUNABLE: world/district name pools (BCE-original) + the faction-faithful selection weight. ──
export const MISSION_FORGE_TUNABLES = {
    factionMatchWeight: 3, // a seed whose factionFit specifically matches (not via ANY) is preferred
    anyWeight: 1,
    worlds: ['Vega', 'Quentin', 'Marduk', 'Kessel', 'Halstead Station', 'New Mendham', 'Sorenson', 'Cebalrai', 'Towne', 'Cylene', 'An Ting', 'Galedon', 'Markab', 'Tabit', 'Lyreton'],
    districts: ['Old Ring district', 'the foundry quarter', 'the dockside wards', 'the upper terraces', 'the rail-yard precinct', 'the cistern district', 'the garrison annex', 'the market commons'],
} as const;

/** Wizard era → seed era tag (coarse, by start year). */
export function eraTag(year: number): string {
    if (year < 2571) return 'age-of-war';
    if (year <= 2780) return 'star-league';
    if (year <= 2900) return 'early-succession-wars';
    if (year <= 3049) return 'late-succession-wars';
    if (year <= 3061) return 'clan-invasion';
    if (year <= 3067) return 'civil-war';
    if (year <= 3080) return 'jihad';
    return 'dark-age';
}

/** Faction name → seed faction tags (loose). */
const FACTION_TAGS: { match: string[]; tags: string[] }[] = [
    { match: ['Draconis Combine', 'House Kurita'], tags: ['is-kurita', 'kurita'] },
    { match: ['Federated Suns', 'House Davion'], tags: ['is-davion', 'davion'] },
    { match: ['Lyran Commonwealth', 'Lyran Alliance', 'House Steiner'], tags: ['is-steiner', 'steiner'] },
    { match: ['Free Worlds League', 'House Marik'], tags: ['is-marik', 'marik'] },
    { match: ['Capellan Confederation', 'House Liao'], tags: ['is-liao', 'liao'] },
    { match: ['ComStar'], tags: ['comstar'] },
    { match: ['Star League'], tags: ['sldf', 'star-league'] },
];
export function factionTags(...names: (string | null | undefined)[]): string[] {
    const out = new Set<string>();
    for (const n of names) {
        if (!n) continue;
        const nn = norm(n);
        const rec = FACTION_TAGS.find((r) => r.match.some((m) => norm(m) === nn));
        if (rec) rec.tags.forEach((t) => out.add(t));
        if (/clan/i.test(n)) out.add('clan');
        if (/pirate|bandit/i.test(n)) out.add('periphery/pirate');
    }
    return [...out];
}

/** Threat tier from the OpFor:player BV ratio (the seed threatRange filter). */
export function deriveThreat(opforBv: number, playerBv: number): string {
    const r = playerBv > 0 ? opforBv / playerBv : 1;
    if (r < 0.7) return 'LOW';
    if (r < 1.0) return 'MEDIUM';
    if (r < 1.35) return 'HIGH';
    return 'EXTREME';
}

const eraFits = (s: MissionSeed, tag: string): boolean => s.eraFit.some((e) => norm(e) === 'any' || norm(e) === norm(tag));
const factionFitSpecific = (s: MissionSeed, tags: string[]): boolean => {
    const ff = s.factionFit.map(norm);
    const reg = norm(s.register);
    return tags.some((t) => ff.includes(norm(t)) || reg === norm(t));
};
const factionFits = (s: MissionSeed, tags: string[]): boolean => s.factionFit.some((f) => norm(f) === 'any') || factionFitSpecific(s, tags);

// excludes era-IMPOSSIBLE seeds BEFORE any relax, so the never-dead-end relaxation can NEVER cross the floor into
// an anachronism (the 2571 Clan-batchall bug). "Impossible" = categorically incompatible, not merely non-preferred.
const ERA_ORDINAL: Record<string, number> = {
    ageofwar: 0, starleague: 1, amariscivilwar: 1, earlysuccessionwars: 2,
    latesuccessionwars: 3, successionwars: 3, claninvasion: 4, civilwar: 5, jihad: 6, darkage: 7, ilclan: 8,
};
function eraImpossible(s: MissionSeed, era: string): boolean {
    const c = ERA_ORDINAL[norm(era)];
    if (c == null) return false; // unknown campaign era → don't exclude (safe)
    // Clan content is categorically impossible before the Clan Invasion (3050) — the reproducible 2571 case.
    const isClan = s.eraFit.some((e) => /clan/.test(norm(e))) || /clan/.test(norm(s.register)) || s.factionFit.some((f) => /^clan/.test(norm(f)));
    if (isClan && c < ERA_ORDINAL['claninvasion']) return true;
    // Word of Blake exists only in the Civil-War → Jihad window (forms ~3052, broken ~3081).
    const isWob = /wordofblake|wob|blakist/.test(norm(s.register)) || s.factionFit.some((f) => /wordofblake|blake/.test(norm(f)));
    if (isWob && (c < ERA_ORDINAL['civilwar'] || c > ERA_ORDINAL['jihad'])) return true;
    // General categorical gap — content from the far future or the deep past (±1 era of adjacency stays plausible).
    const ords = s.eraFit.filter((e) => norm(e) !== 'any').map((e) => ERA_ORDINAL[norm(e)]).filter((o): o is number => o != null);
    if (ords.length) { const GAP = 1; if (Math.min(...ords) > c + GAP || Math.max(...ords) < c - GAP) return true; }
    return false;
}

export function selectSeed(
    seeds: MissionSeed[],
    family: string,
    era: string,
    tags: string[],
    threat: string,
    rng: () => number = Math.random,
    forcedId?: string | null,
    preferredId?: string | null,
): MissionSeed | null {
    if (forcedId) return seeds.find((s) => s.seedId === forcedId) ?? null;
    // through to the weighted family pool below — never a dead-end, never an anachronism. No faction/threat gate
    // (the author chose the chain); the era floor is the only hard constraint, exactly as the directive specifies.
    if (preferredId) { const pref = seeds.find((s) => s.seedId === preferredId); if (pref && !eraImpossible(pref, era)) return pref; }
    const fam = seeds.filter((s) => norm(s.family) === norm(family) && !eraImpossible(s, era));
    if (!fam.length) return null;
    let matches = fam.filter((s) => eraFits(s, era) && factionFits(s, tags));
    if (!matches.length) matches = fam.filter((s) => factionFits(s, tags)); // relax era (within era-plausible)
    if (!matches.length) matches = fam.filter((s) => eraFits(s, era)); // relax faction
    if (!matches.length) matches = fam; // family-only — STILL era-plausible (the floor is never crossed)
    const threatM = matches.filter((s) => s.threatRange.map(norm).includes(norm(threat)));
    const pool = threatM.length ? threatM : matches;
    const weights = pool.map((s) => (factionFitSpecific(s, tags) ? MISSION_FORGE_TUNABLES.factionMatchWeight : MISSION_FORGE_TUNABLES.anyWeight));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
}

/** All {NPC:flag} tie-in flags referenced anywhere in a seed's prose. */
export function npcFlagsIn(seed: MissionSeed): string[] {
    const text = JSON.stringify(seed);
    const out = new Set<string>();
    for (const m of text.matchAll(/\{NPC:([a-z-]+)\}/g)) out.add(m[1]);
    return [...out];
}

/** Roll each `specifics` range once (stored, never re-rolled). */
export function rollSpecifics(seed: MissionSeed, rng: () => number = Math.random): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(seed.specifics ?? {})) {
        out[k] = Math.round(v.min + rng() * (v.max - v.min));
    }
    return out;
}

/** Assign an NPC for a tie-in flag: flag ∩ faction-affinity ∩ era, ANY-pool fallback. */
export function assignNpc(npcs: ForgeNpc[], flag: string, tags: string[], era: string, rng: () => number = Math.random): string | null {
    const flagged = npcs.filter((n) => n.tieInFlags.map(norm).includes(norm(flag)));
    if (!flagged.length) return null;
    const facEra = flagged.filter((n) => n.factionAffinity.some((f) => tags.map(norm).includes(norm(f))) && n.eraFit.some((e) => norm(e) === 'any' || norm(e) === norm(era)));
    const fac = facEra.length ? facEra : flagged.filter((n) => n.factionAffinity.some((f) => tags.map(norm).includes(norm(f))));
    // pool, so a wrong-faction NPC (an enemy "First Prince" on a non-Davion contract) is never cast.
    const neutral = flagged.filter((n) => n.factionAffinity.some((f) => norm(f) === 'merc' || norm(f) === 'periphery'));
    const pool = fac.length ? fac : (neutral.length ? neutral : flagged);
    return pool[Math.floor(rng() * pool.length)].npcId;
}

/** Mint a staff voice for a role family: roleFamily ∩ factionFit, ANY-pool fallback. */
export function mintVoice(voices: ForgeVoice[], roleFamily: string, tags: string[], rng: () => number = Math.random): string | null {
    const role = voices.filter((v) => norm(v.roleFamily) === norm(roleFamily));
    if (!role.length) return null;
    const fac = role.filter((v) => v.factionFit.some((f) => norm(f) === 'any' || tags.map(norm).includes(norm(f))));
    const neutral = role.filter((v) => v.factionFit.some((f) => norm(f) === 'merc' || norm(f) === 'periphery'));
    const pool = fac.length ? fac : (neutral.length ? neutral : role);
    return pool[Math.floor(rng() * pool.length)].voiceId;
}

export interface SlotContext {
    EMPLOYER: string;
    TARGET_FACTION: string;
    WORLD: string;
    DISTRICT: string;
    YEAR: string;
    FORCE_SIZE: string;
    specifics: Record<string, number>;
    npcNames: Record<string, string>;
    PRIOR_TIER?: string;
    PRIOR_WORLD?: string;
}
export function fillSlots(text: string, ctx: SlotContext): string {
    if (!text) return text;
    const direct: Record<string, string> = {
        EMPLOYER: ctx.EMPLOYER, TARGET_FACTION: ctx.TARGET_FACTION, WORLD: ctx.WORLD,
        DISTRICT: ctx.DISTRICT, YEAR: ctx.YEAR, FORCE_SIZE: ctx.FORCE_SIZE,
        PRIOR_TIER: ctx.PRIOR_TIER ?? '', PRIOR_WORLD: ctx.PRIOR_WORLD ?? '',
    };
    return text
        .replace(/\{NPC:([a-z-]+)\}/g, (_, f) => ctx.npcNames[f] ?? `the ${f.replace(/-/g, ' ')}`)
        // seeds store `specifics` under camelCase keys; the rolled value exists but the old [A-Z_] regex never
        // substituted it, so ~45 tokens (e.g. {departureWindow}) leaked raw to the player. ({NPC:…} already consumed.)
        .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
            if (k in direct) return direct[k];
            if (k in ctx.specifics) return String(ctx.specifics[k]);
            return `[${k}]`;
        })
        // that itself leads with an article ("the harbor cordon") rendered "the the harbor cordon". Same-article
        // doubles only (the the / a a / an an) — never a legitimate phrase. The render-lint (mission-lint.js) guards it.
        .replace(/\b(the|a|an)\s+\1\b/gi, '$1');
}

export function fillSlotsDeep<T>(value: T, ctx: SlotContext): T {
    if (typeof value === 'string') return fillSlots(value, ctx) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => fillSlotsDeep(v, ctx)) as unknown as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>)) out[k] = fillSlotsDeep((value as Record<string, unknown>)[k], ctx);
        return out as unknown as T;
    }
    return value;
}

export function costParts(costs: SeedCosts | undefined | null): string[] {
    if (!costs) return [];
    const parts: string[] = [];
    // print it as a gain, never a bare "-300,000 C-bills". Symmetric for cbills + days (treasuryAfter below
    // only deducts POSITIVE cbills, so a gain never mis-debits the treasury).
    if (costs.cbills != null) parts.push(costs.cbills === 0 ? 'no C-bill cost' : costs.cbills < 0 ? `−${(-costs.cbills).toLocaleString('en-US')} C-bills (gained)` : `${costs.cbills.toLocaleString('en-US')} C-bills`);
    if (costs.days != null) parts.push(costs.days < 0 ? `−${-costs.days} days (gained)` : `${costs.days} days`);
    if (costs.resource) parts.push(costs.resource);
    if (costs.risk) parts.push(`risk — ${costs.risk}`);
    return parts;
}

export function filledObjectives(
    seed: MissionSeed | undefined,
    forge: { slots: { EMPLOYER: string; TARGET_FACTION: string; WORLD: string; DISTRICT: string; YEAR: string; FORCE_SIZE: string }; rolledSpecifics: Record<string, number> } | undefined | null,
    npcNames: Record<string, string>,
    fallback: readonly string[],
): { primary: string; secondary: string; bonus: string } {
    if (seed && forge) {
        const ctx: SlotContext = { ...forge.slots, specifics: forge.rolledSpecifics, npcNames };
        return { primary: fillSlots(seed.objectives.primary, ctx), secondary: fillSlots(seed.objectives.secondary, ctx), bonus: fillSlots(seed.objectives.bonus, ctx) };
    }
    return { primary: fallback[0] ?? 'Primary objective met', secondary: fallback[1] ?? 'Secondary objective met', bonus: fallback[2] ?? 'Bonus objective met' };
}

export function gateMet(requires: string, resourceTier: string | null, treasury: number): boolean {
    const tier = norm(resourceTier ?? 'normal');
    if (requires.startsWith('treasury-min:')) return treasury >= (parseInt(requires.split(':')[1], 10) || 0);
    switch (requires) {
        case 'jumpship': return tier === 'established';
        case 'established-base': return tier === 'established';
        case 'dropship': return tier !== 'lean';
        case 'depot-access': return tier !== 'lean';
        default: return true; // unknown gate -> don't block (GM visibility)
    }
}
/** The gate (if any) that applies to a decision-point name or option title. */
export function gateFor(seed: MissionSeed | undefined, target: string): SeedResourceGate | undefined {
    return (seed?.resourceGates ?? []).find((g) => norm(g.appliesTo) === norm(target));
}

// ── Register tables (PM-extendable): closings, classification bars, stamps. ──
export const REGISTER_CLOSINGS: Record<string, string> = {
    'is-kurita': 'THE DRAGON ENDURES.',
    'is-davion': 'FOR THE FEDERATED SUNS.',
    'is-steiner': 'FOR THE COMMONWEALTH.',
    'is-liao': 'STRENGTH THROUGH UNITY.',
    'is-marik': 'FOR THE FREE WORLDS.',
    clan: 'SEYLA.',
    merc: 'THE CONTRACT IS THE CONTRACT.',
    'periphery/pirate': 'TAKE WHAT HOLDS.',
    comstar: 'AS THE BLESSED ORDER WILLS.',
    sldf: 'HOLD THE CIRCLE.',
};
export const REGISTER_CLASSBAR: Record<string, string> = {
    'is-kurita': 'BY ORDER OF THE COORDINATOR — UNIT EYES ONLY — DESTROY IF COMPROMISED',
    'is-davion': 'BY ORDER OF THE FIRST PRINCE — UNIT EYES ONLY — DESTROY IF COMPROMISED',
    'is-steiner': 'ARCHON’S SEAL — UNIT EYES ONLY — DESTROY IF COMPROMISED',
    'is-liao': 'MASKIROVKA CLEARANCE — EYES ONLY — DESTROY UNREAD IF COMPROMISED',
    'is-marik': 'CAPTAIN-GENERAL’S AUTHORITY — UNIT EYES ONLY — DESTROY IF COMPROMISED',
    clan: 'BY THE KHAN’S WORD — COMMANDERS ONLY — NO RECORD KEPT',
    merc: 'CONTRACT-PRIVILEGED — UNIT EYES ONLY — DESTROY IF COMPROMISED',
    'periphery/pirate': 'NO FLAG BUT OURS — CREW ONLY — BURN IF TAKEN',
    comstar: 'BLESSED ORDER — INITIATE EYES ONLY — DESTROY IF DEFILED',
    sldf: 'STAR LEAGUE DEFENSE FORCE — UNIT EYES ONLY — DESTROY IF COMPROMISED',
};
export const REGISTER_STAMP: Record<string, string> = {
    'is-kurita': 'DUTY IS THE PROOF OF LOYALTY',
    'is-davion': 'OUTCOMES, NOT EXCUSES',
    'is-steiner': 'THE LEDGER BALANCES',
    'is-liao': 'TRUST IS A LOAN',
    'is-marik': 'PROVINCE AND PARLIAMENT',
    clan: 'WASTE IS DISHONOR',
    merc: 'THE MARGIN IS THE MISSION',
    'periphery/pirate': 'SURVIVE FIRST',
    comstar: 'INFORMATION IS SACRAMENT',
    sldf: 'HOLD THE CIRCLE',
};
export const registerClosing = (register: string): string => REGISTER_CLOSINGS[register] ?? 'END OF PACKAGE.';

/** The CAMPAIGN's own register (the AAR's closing/classbar key — the campaign, not the seed): a merc
 *  command reads 'merc'; otherwise the faction's register tag. '' = neutral (no invented fit). */
export function campaignRegister(force: string | null, faction: string | null): string {
    if (force === 'MERC') return 'merc';
    const tag = factionTags(faction).find((t) => t in REGISTER_CLOSINGS);
    return tag ?? (force === 'CLAN' ? 'clan' : '');
}
export const registerClassbar = (register: string): string => REGISTER_CLASSBAR[register] ?? 'CLASSIFIED — UNIT EYES ONLY — DESTROY IF COMPROMISED';
export const registerStamp = (register: string): string => REGISTER_STAMP[register] ?? '';

/** Apply registerVariants: returns the variant text for a fieldPath if this register overrides it. */
export function registerVariant(seed: MissionSeed, register: string, fieldPath: string): string | undefined {
    return seed.registerVariants?.[register]?.[fieldPath] ?? seed.registerVariants?.[norm(register)]?.[fieldPath];
}
