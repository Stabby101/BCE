/*
 * BCE — HSFORGE-1: the dressing layer. Pure (no Angular): employer strings + per-side identity,
 * synopsis assembly (opener + bridge + closer scaffolds — the D7 hybrid), title, the chaos-type
 * STRING (crafted so hotspotTypeId regex-maps it to EXACTLY the intended ChaosContractType — C6/C15),
 * contract terms (snapValidStep everywhere — C5; Part E shared fields equal across sides — C3), and
 * the missionBrief (donor-sourced d6 complication table, contractVictory, behindScenes, antagonists).
 *
 * TOKEN LAW (the corpus _meta.law contracts — every token here is consumed BEFORE the C11 bake):
 *   {ORG} {FACTION_NAME} {FACTION_NAME_THE}      — per-side dress fills
 *   {EMPLOYER_NAME}                              — side A's prose-safe org (employerProseName)
 *   {TARGET_FACTION} {TARGET_FACTION_THE}        — display-map attributive / article-baked SINGULAR
 *                                                  forms of the opposing faction (sameFaction override)
 *   {OWNER} {INTENSITY} {SCALE} {TNOUN_*}        — scaffold/brief/title fills
 *   {WORLD}/{DISTRICT}/{YEAR}/{NPC:*}            — LEFT for the global SlotContext bake (C11)
 * Fragment lists may be side/posture-TAGGED objects ({text, posture: attack|defend|any} — and for
 * pirate-raid {side: raider|defender|either}); selection filters by the side being dressed.
 * Sentence-casing: a fill that opens a string is upper-cased after substitution (the corpus law).
 */
import { CHAOS_CONTRACT_TYPES, snapValidStep, nextValidStep, type ContractColumn } from '../chaos-contract-steps';
import type { HotSpotComplication, HotSpotContractTerms, HotSpotMissionBrief, HotSpotNamedCharacter, SideOffer } from '../hotspots-catalog';
import type { SeedComplication } from '../../mission/forge-types';
import type { EmployerArchetype, SynopsisCorpus, TaggedText, TitlePattern, TrackDressingCorpus } from './hs-forge-data';
import type { ConflictPair } from './hs-forge-pair';
import { pick, rngInt } from './hs-forge-rng';

const subLocal = (text: string, fills: Record<string, string>): string =>
    (text || '').replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (k in fills ? fills[k] : m));
// Sentence-boundary casing (the corpus law): a lowercase fill that OPENS a sentence — at position 0
// OR after ./!/? — is upper-cased. Safe over corpus prose (no abbreviations); the donor-bake path
// (hs-forge.service) applies it to the baked prose fields too — the same defect class, second fill path.
export const sentenceCase = (s: string): string => s.replace(/(^|(?<!\b(?:vs|e\.g|i\.e))[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
/** Cross-article collapse for the donor bake: an article-baked fill landing after the donor's own
 *  article ("A {TARGET_FACTION} garrison" + 'the pirate band') renders "A the …" — keep the LATTER
 *  article (the fill's own form reads correctly; sentenceCase then fixes a lowered sentence start). */
export const collapseArticles = (s: string): string => s.replace(/\b(?:a|an|the)\s+((?:a|an|the)\s)/gi, '$1');
const dress = (text: string, fills: Record<string, string>): string => sentenceCase(subLocal(text, fills));

// ── the per-faction display map (the corpus law: grammatically SINGULAR noun forms) ──
export interface FactionDisplay { attr: string; the: string; }
export function factionDisplay(name: string): FactionDisplay {
    if (/^pirates?$/i.test((name || '').trim())) return { attr: 'pirate', the: 'the pirate band' };
    if (/^mercenar/i.test((name || '').trim())) return { attr: 'mercenary', the: 'a rival mercenary command' };
    if (/^(clan\s|comstar|word of blake)/i.test((name || '').trim())) return { attr: name, the: name }; // no article
    return { attr: name, the: `the ${name}` };
}
/** The sameFaction override (the corpus law): never name the shared faction as its own enemy. */
export function rivalDisplay(rule: string): FactionDisplay {
    return rule === 'clan-internal' ? { attr: 'rival', the: 'the rival faction' } : { attr: 'rival', the: 'the rival command' };
}

/** {EMPLOYER_NAME} — the prose-safe org form (the corpus law): parenthetical stripped; plural-named
 *  orgs wrapped 'the {ORG} command'; merc-sub → 'the prime contractor'; merc-vs-merc → the paymaster
 *  phrase (the {ORG} is the RIVAL there, never the hirer). */
export function employerProseName(org: string, archetypeId: string): string {
    if (archetypeId === 'merc-vs-merc') return "the contract's paymaster";
    if (archetypeId === 'merc-sub') return 'the prime contractor';
    let n = (org || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (/[a-z]s$/.test(n) && !/(ss|us|is|os)$/i.test(n) && !/^an? /i.test(n)) {
        n = (/^the /i.test(n) ? n : `the ${n}`) + ' command';
    }
    return n;
}

/** Pick from a side/posture-TAGGED fragment list for the side being dressed (untagged = any).
 *  Empty-pool relax ladder: drop POSTURE first, then side (wrong-SIDE prose is the worse failure). */
export function pickTagged(list: readonly TaggedText[], want: { posture?: 'attack' | 'defend'; side?: 'raider' | 'defender' }, rng: () => number): string {
    const norm = list.map((x) => (typeof x === 'string' ? { text: x } : x));
    const sideOk = (x: { side?: string }): boolean => !x.side || x.side === 'either' || !want.side || x.side === want.side;
    const postureOk = (x: { posture?: string }): boolean => !x.posture || x.posture === 'any' || !want.posture || x.posture === want.posture;
    let pool = norm.filter((x) => sideOk(x) && postureOk(x));
    if (!pool.length) pool = norm.filter(sideOk); // relax posture, keep side
    if (!pool.length) pool = norm;
    return pick(pool, rng).text;
}

/** An employer display string + desc + side situation for one side of the pair. */
export interface SideDressing { employer: string; employerDesc: string; situation: string; org: string; }
export interface DressSideCtx {
    archetype: EmployerArchetype;
    employerFaction: string;
    role: 'attacker' | 'defender';                 // this side's contract role (posture filter)
    pirateSide?: 'raider' | 'defender';            // pirate-raid fragment binding (raider = the band)
    sharedOrg?: string;                            // merc-vs-merc: the ONE rival org both sides name
    excludeOrg?: string;                           // the OTHER side's org — two opposed sides never share one
    fills: Record<string, string>;                 // the shared display fills (TARGET_*/EMPLOYER_NAME/OWNER)
    rng: () => number;
}
export function dressSide(ctx: DressSideCtx): SideDressing {
    const a = ctx.archetype;
    const fullPool = ctx.pirateSide === 'raider'
        ? (a.orgPools['Pirates'] ?? a.orgPools['generic'] ?? [])
        : (a.orgPools[ctx.employerFaction] ?? a.orgPools['generic'] ?? []);
    const pool = fullPool.length > 1 && ctx.excludeOrg ? fullPool.filter((x) => x !== ctx.excludeOrg) : fullPool;
    const org = ctx.sharedOrg ?? (pool.length ? pick(pool, ctx.rng) : `${ctx.employerFaction} field command`);
    const fills = { ...ctx.fills, ORG: org, FACTION_NAME: ctx.employerFaction, FACTION_NAME_THE: factionDisplay(ctx.employerFaction).the };
    const want = { posture: (ctx.role === 'attacker' ? 'attack' : 'defend') as 'attack' | 'defend', side: ctx.pirateSide };
    return {
        org,
        employer: dress(pickTagged(a.employerPattern, want, ctx.rng), fills),
        employerDesc: dress(pickTagged(a.employerDesc, want, ctx.rng), fills),
        situation: dress(pickTagged(a.sideSituation, want, ctx.rng), fills),
    };
}

/** The card blurb (side-A perspective; pirate-raid binds to the defender-side fragments). */
export function dressBlurb(archetype: EmployerArchetype, aRole: 'attacker' | 'defender', pirateSideA: 'raider' | 'defender' | undefined, org: string, employerFaction: string, fills: Record<string, string>, rng: () => number): string {
    const want = { posture: (aRole === 'attacker' ? 'attack' : 'defend') as 'attack' | 'defend', side: pirateSideA };
    const text = archetype.blurb.length ? pickTagged(archetype.blurb, want, rng) : 'A contract is on offer on {WORLD}.';
    return dress(text, { ...fills, ORG: org, FACTION_NAME: employerFaction, FACTION_NAME_THE: factionDisplay(employerFaction).the });
}

/** The synopsis (D7 hybrid): settlement/regionRole-matched opener + bridge(s) + closer. 3rd-person
 *  world-portrait register; the donor's 2nd-person stakes live in the TRACK situations instead.
 *  HOTSPOT-BRIEF v1 (§7.1, Amendment A approved): fragments join with \n\n so paragraphs RENDER;
 *  a second distinct bridge deepens ~half of synopses → 3–4 ¶, ~700–1,000 ch (budget 600–1,700 · 2–4 ¶). */
export function buildSynopsis(corpus: SynopsisCorpus, settlement: string, regionRole: string, fills: Record<string, string>, rng: () => number): string {
    const fits = (f: { settlement?: string[] | null; regionRole?: string[] | null }): boolean =>
        (!f.settlement?.length || f.settlement.includes(settlement)) && (!f.regionRole?.length || f.regionRole.includes(regionRole));
    const openers = corpus.openers.filter(fits);
    const opener = openers.length ? pick(openers, rng) : corpus.openers[0];
    const bridge = corpus.bridges.length ? pick(corpus.bridges, rng) : { text: '' };
    const rest = corpus.bridges.filter((b) => b !== bridge);
    let bridge2 = rest.length && rng() < 0.5 ? pick(rest, rng) : null;
    const closer = corpus.closers.length ? pick(corpus.closers, rng) : { text: '' };
    const assemble = (): string => [opener?.text, bridge.text, bridge2?.text, closer.text].filter(Boolean).map((t) => dress(t as string, fills)).join('\n\n');
    let out = assemble();
    // The 600-char floor is a BUDGET, not a coin flip — a short 3-¶ draw backfills the second bridge.
    if (out.length < 620 && !bridge2 && rest.length) { bridge2 = pick(rest, rng); out = assemble(); }
    return out;
}

// 'operation' is a frame word, not content — without it every "Operation X Y" draft collides with any
// prior Operation title, degrading the pattern to once-per-window and burning retries (W1c proofread).
const TITLE_STOPWORDS = new Set(['the', 'on', 'at', 'of', 'and', 'a', 'an', 'operation']);
export function buildTitle(corpus: SynopsisCorpus, rng: () => number, recentTitles?: ReadonlySet<string>): string {
    const { patterns, words } = corpus.titles;
    if (!patterns.length) return 'The Contested Ground';
    const draft = (): string => {
        const p: TitlePattern = pick(patterns, rng);
        const pattern = typeof p === 'string' ? p : p.pattern;
        const allow = typeof p === 'string' ? undefined : p.allow;
        const fills: Record<string, string> = {};
        for (const k of Object.keys(words)) {
            const pool = allow?.[k]?.length ? allow[k] : words[k];
            if (pool?.length) fills[k] = pick(pool, rng);
        }
        return subLocal(pattern, fills);
    };
    if (!recentTitles?.size) return draft();
    const recentLower = [...recentTitles].map((t) => t.toLowerCase());
    // Whole-word match, not substring — 'Late' ⊂ 'Galatea' / 'Iron' ⊂ 'Andiron' in a baked world name
    // must not block unrelated drafts (W1c proofread m6).
    const recentWords = recentLower.map((r) => new Set(r.split(/\s+/)));
    let out = draft();
    for (let i = 0; i < 8; i++) {
        const lower = out.toLowerCase();
        const distinct = lower.split(/\s+/).filter((w) => w.length > 3 && !TITLE_STOPWORDS.has(w) && w !== '{world}');
        const collides = recentLower.some((r, ri) => r === lower || distinct.some((w) => recentWords[ri].has(w)));
        if (!collides) return out;
        out = draft();
    }
    return out;
}

/** The type STRING for a chaos-type id, crafted to regex-map back to exactly that id via hotspotTypeId
 *  (C6): /raid/→raid · /invasion|assault/→invasion · /pirate/→pirate-hunt · /duel|trial|recon|expedition/
 *  →expedition · else garrison. The root template's display name rides as flavor where safe. */
export function typeStringFor(chaosType: string, rootTemplateName: string): string {
    switch (chaosType) {
        case 'raid': return /raid/i.test(rootTemplateName) ? rootTemplateName : `Raid / ${rootTemplateName}`;
        case 'invasion': return `Invasion / ${rootTemplateName}`;
        case 'pirate-hunt': return 'Pirate Hunt';
        case 'expedition': return rootTemplateName === 'Duel' ? 'Trial / Duel' : 'Recon Expedition';
        case 'garrison': default: return `Garrison / ${rootTemplateName}`;
    }
}

/** Contract terms for the pair (C3/C5/C6): type defaults ± a small drift, everything snapped; the
 *  Part E SHARED fields (scale/intensity/lengthMonths) computed ONCE and equal on both sides. */
export function buildContractTerms(
    chaosType: string, threat: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME', enemyOfA: string, enemyOfB: string, rng: () => number,
): { a: HotSpotContractTerms; b: HotSpotContractTerms; scale: number; intensity: number; lengthMonths: number } {
    const t = CHAOS_CONTRACT_TYPES.find((x) => x.id === chaosType) ?? CHAOS_CONTRACT_TYPES[0];
    const [lo, hi] = t.intensityRange;
    const intensity = rngInt(Math.min(lo, 3), Math.min(hi, 3), rng); // main-path depth ≤ 3 (C6)
    const scale = threat === 'EXTREME' ? rngInt(2, 3, rng) : threat === 'HIGH' ? 2 : rngInt(1, 2, rng);
    const lengthMonths = intensity + rngInt(0, 1, rng);
    const drift = (col: ContractColumn, from: number, dir: 1 | -1 | 0): number =>
        dir === 0 ? snapValidStep(col, from) : (nextValidStep(col, snapValidStep(col, from), dir) ?? snapValidStep(col, from));
    const steps = (payDir: 1 | -1 | 0, salvDir: 1 | -1 | 0): HotSpotContractTerms['steps'] => ({
        basePay: drift('basePay', t.defaultSteps.basePay, payDir),
        command: snapValidStep('command', t.defaultSteps.command),
        salvage: drift('salvage', t.defaultSteps.salvage, salvDir),
        support: snapValidStep('support', t.defaultSteps.support),
        transport: snapValidStep('transport', t.defaultSteps.transport),
    });
    const aPay = pick([-1, 0, 1] as const, rng), aSalv = pick([-1, 0, 1] as const, rng);
    const bSalv = pick([-1, 0, 1] as const, rng);
    const shared = { scale, intensity, lengthMonths };
    return {
        scale, intensity, lengthMonths,
        a: { ...shared, steps: steps(aPay, aSalv), enemyFaction: enemyOfA },
        b: { ...shared, steps: steps(aPay, bSalv), enemyFaction: enemyOfB },
    };
}

/** The two fully-authored SideOffers (C3): opposed roles, per-side identity (Part E quartet — type/title
 *  shared by design so the signed ChaosContractType is side-independent; situation/employerDesc per side),
 *  per-side enemyFaction cross-derived, `synthesized` absent, per-side blurb omitted (display-dead). */
export function buildSides(
    pair: ConflictPair, aRole: 'attacker' | 'defender', title: string, typeString: string,
    terms: { a: HotSpotContractTerms; b: HotSpotContractTerms }, dressA: SideDressing, dressB: SideDressing,
): { a: SideOffer; b: SideOffer } {
    const bRole = aRole === 'attacker' ? 'defender' : 'attacker';
    return {
        a: { key: 'a', role: aRole, employer: dressA.employer, faction: pair.a.faction, contract: terms.a, title, type: typeString, situation: dressA.situation, employerDesc: dressA.employerDesc },
        b: { key: 'b', role: bRole, employer: dressB.employer, faction: pair.b.faction, contract: terms.b, title, type: typeString, situation: dressB.situation, employerDesc: dressB.employerDesc },
    };
}

export function buildComplicationTable(donorComps: readonly SeedComplication[], corpusComps: readonly { name: string; effect: string }[], rng: () => number): HotSpotComplication[] {
    const rowsOf = [
        ...donorComps.map((c) => ({ name: c.name, row: `${c.name}. ${c.mechanicalEffect}` })),
        ...corpusComps.map((c) => ({ name: c.name, row: `${c.name}. ${c.effect}` })),
    ];
    const seen = new Set<string>();
    const pool = rowsOf.filter((c) => c.row.length <= 360 && !seen.has(c.name) && (seen.add(c.name), true));
    const chosen: string[] = [];
    while (chosen.length < Math.min(4, pool.length + chosen.length) && pool.length) {
        const i = Math.floor(rng() * pool.length);
        chosen.push(pool.splice(i, 1)[0].row);
    }
    const rows: HotSpotComplication[] = [{ roll: '1-3', effect: 'None.' }];
    const bands = chosen.length === 4 ? [['4'], ['5'], ['6'], ['7']] : chosen.length === 3 ? [['4'], ['5'], ['6-7']] : chosen.length === 2 ? [['4-5'], ['6-7']] : chosen.length === 1 ? [['4-7']] : [];
    chosen.forEach((c, i) => rows.push({ roll: bands[i][0], effect: c }));
    if (!chosen.length) rows.push({ roll: '4-7', effect: 'None.' });
    rows.push({ roll: '8+', effect: 'Roll twice on this table and apply both results.' });
    return rows;
}

/** The missionBrief (C10). contractVictory/behindScenes from the corpus patterns (display fills per the
 *  dressing law); antagonists from the orchestrator's NPC casting (thread continuity is Phase 2). */
export function buildMissionBrief(
    dressing: TrackDressingCorpus, donorComps: readonly SeedComplication[], intensity: number, scale: number,
    fills: Record<string, string>, antagonists: HotSpotNamedCharacter[], rng: () => number,
): HotSpotMissionBrief {
    const f = { ...fills, INTENSITY: String(intensity), SCALE: String(scale) };
    // HOTSPOT-BRIEF v1 (§7.5): a pattern naming {EMPLOYER_NAME} twice dedupes to 'the employer' on the
    // second mention (worst-case org names doubled blew the ≤330 budget).
    const dedupeEmployer = (t: string): string => { let n = 0; return t.replace(/\{EMPLOYER_NAME\}/g, () => (n++ === 0 ? '{EMPLOYER_NAME}' : 'the employer')); };
    return {
        contractVictory: dress(dedupeEmployer(dressing.contractVictory.length ? pick(dressing.contractVictory, rng) : 'Complete the contract, track by track.'), f),
        complications: buildComplicationTable(donorComps, dressing.complications ?? [], rng),
        behindScenes: dress(dressing.behindScenes.length ? pick(dressing.behindScenes, rng) : '', f) || undefined,
        ...(antagonists.length ? { namedCharacters: antagonists } : {}),
    };
}
