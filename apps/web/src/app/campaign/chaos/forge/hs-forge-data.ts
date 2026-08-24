/*
 * BCE — HSFORGE-1: the Forge's DATA layer — lazy loaders + types for the dressing corpus
 * (forge-data/hsforge-*.json, one-way synced from content-forge/ like every content file), the
 * authored region table (ruling D4: authored table, anchor+radius INTERNAL), and the HSFORGE-1b
 * world-facts pack (star/world-facts.json — REAL per-world facts distilled from the mm-data witness).
 * Pure module (no Angular): cached dynamic imports, fail-soft to empty (generation then fail-louds
 * in the orchestrator with a named reason, never a silent degrade).
 */

// ── Corpus shapes (pinned by the HSFORGE-1 corpus authoring contract) ──
export interface ObjectiveSpec { kind: 'primary' | 'secondary' | 'bonus'; text: string; }
export interface ObjectiveSet {
    key: string;
    attacker: ObjectiveSpec[];
    defender: ObjectiveSpec[];
    both?: ObjectiveSpec[];
    params?: Record<string, { min: number; max: number }>;
    sites?: string[];
}
export interface ObjectiveLibrary { templates: Record<string, { sets: ObjectiveSet[] }>; }

/** A fragment that may be tagged by posture (attack|defend|any) and — pirate-raid only — by side
 *  (raider|defender|either). Plain strings = untagged (any). Selection: hs-forge-dressing pickTagged. */
export type TaggedText = string | { text: string; posture?: string; side?: string };
export interface EmployerArchetype {
    id: string;
    weight: number;
    sameFaction?: boolean;
    combatFactionRule: 'state-pair' | 'merc-both' | 'pirates-attacker' | 'clan-internal';
    eraGroups?: string[];
    employerPattern: TaggedText[];
    employerDesc: TaggedText[];
    sideSituation: TaggedText[];
    blurb: TaggedText[];
    orgPools: Record<string, string[]>;
}
export interface EmployerCorpus { archetypes: EmployerArchetype[]; }

export interface SynopsisFragment { settlement?: string[] | null; regionRole?: string[] | null; text: string; }
/** A title pattern may restrict a word slot to an allowlist (the corpus law). */
export type TitlePattern = string | { pattern: string; allow?: Record<string, string[]> };
export interface SynopsisCorpus {
    openers: SynopsisFragment[];
    bridges: { text: string }[];
    closers: { text: string }[];
    titles: { patterns: TitlePattern[]; words: Record<string, string[]> };
}

export interface TrackDressingCorpus {
    explainers: Record<string, string>;
    contractVictory: string[];
    behindScenes: string[];
    /** WAVE (Phase 3): the forge's OWN complication pool, mixed with the donor seed's complications
     *  in the d6 table draw. `effect` is the full plain-words rule (rendered "{name}. {effect}",
     *  the same row shape as donor name+mechanicalEffect). Optional — absent pre-wave. */
    complications?: { name: string; effect: string }[];
}

// ── Region table (ruling D4) ──
export interface ForgeRegion { id: string; name: string; anchorWorld: string; anchorSystemId: string; radiusLy: number; blurb?: string; }
export interface RegionTable { regions: ForgeRegion[]; }

// ── World facts (HSFORGE-1b; sparse era-keyed maps resolve at the LARGEST stored era ≤ E) ──
export interface WorldFacts {
    starType?: string; position?: number; gravity?: number; pressure?: string; tempC?: number;
    waterPct?: number; lifeForm?: string; landmasses?: string[]; capitalCity?: string;
    satellites?: string[]; smallMoons?: number;
    rechargeHours?: number; timeToJumpPointDays?: number;
    popByEra?: Record<string, number>; socioByEra?: Record<string, string>;
    hpgByEra?: Record<string, string>; stationByEra?: Record<string, string>;
}
export interface WorldFactsPack { facts: Record<string, WorldFacts>; }

/** Resolve a sparse era-keyed map at era E: the entry at the largest stored era ≤ E (else null). */
export function eraValue<T>(map: Record<string, T> | undefined, eraId: number): T | null {
    if (!map) return null;
    let best: number | null = null;
    for (const k of Object.keys(map)) { const n = Number(k); if (Number.isFinite(n) && n <= eraId && (best == null || n > best)) best = n; }
    return best == null ? null : map[String(best)];
}

export interface HsForgeCorpus {
    objectives: ObjectiveLibrary;
    employers: EmployerCorpus;
    synopsis: SynopsisCorpus;
    dressing: TrackDressingCorpus;
    regions: RegionTable;
    worldFacts: WorldFactsPack;
}

let cache: HsForgeCorpus | null = null;
let loading: Promise<HsForgeCorpus> | null = null;

/** Load every Forge data file once (idempotent; each is its own lazy chunk). Missing file → empty shape
 *  (the orchestrator's preflight then reports exactly which corpus is absent — fail-loud, not silent). */
export function ensureForgeData(): Promise<HsForgeCorpus> {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
        loading = Promise.all([
            import('../../mission/forge-data/hsforge-objectives.json').catch(() => null),
            import('../../mission/forge-data/hsforge-employers.json').catch(() => null),
            import('../../mission/forge-data/hsforge-synopsis.json').catch(() => null),
            import('../../mission/forge-data/hsforge-track-dressing.json').catch(() => null),
            import('../../mission/forge-data/hsforge-regions.json').catch(() => null),
            import('../../star/world-facts.json').catch(() => null),
        ]).then(([obj, emp, syn, dre, reg, wf]) => {
            const d = (m: unknown): Record<string, unknown> => ((m as { default?: unknown } | null)?.default ?? {}) as Record<string, unknown>;
            cache = {
                objectives: { templates: (d(obj)['templates'] ?? {}) as ObjectiveLibrary['templates'] },
                employers: { archetypes: (d(emp)['archetypes'] ?? []) as EmployerArchetype[] },
                synopsis: {
                    openers: (d(syn)['openers'] ?? []) as SynopsisFragment[],
                    bridges: (d(syn)['bridges'] ?? []) as { text: string }[],
                    closers: (d(syn)['closers'] ?? []) as { text: string }[],
                    titles: (d(syn)['titles'] ?? { patterns: [], words: {} }) as SynopsisCorpus['titles'],
                },
                dressing: {
                    explainers: (d(dre)['explainers'] ?? {}) as Record<string, string>,
                    contractVictory: (d(dre)['contractVictory'] ?? []) as string[],
                    behindScenes: (d(dre)['behindScenes'] ?? []) as string[],
                    complications: (d(dre)['complications'] ?? []) as { name: string; effect: string }[],
                },
                regions: { regions: (d(reg)['regions'] ?? []) as ForgeRegion[] },
                worldFacts: { facts: (d(wf)['facts'] ?? {}) as Record<string, WorldFacts> },
            };
            return cache;
        });
    }
    return loading;
}
