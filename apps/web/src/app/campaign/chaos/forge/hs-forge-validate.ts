/*
 * BCE — HSFORGE-1: the EMIT-TIME VALIDATOR (design §8.1). Every generated HotSpot passes this gate or
 * is rerolled on the next RNG substream; N failures fail LOUD in the orchestrator. Pure (no Angular).
 * Checks: structure (C1/C7) · contract math (C5/C6/C13, asserted against BOTH sides) · two-sided
 * completeness incl. the Part E shared-field rule (C3/C8) · faction legality via injected predicates
 * (C4) · era vocabulary (C2) · prose: slot residue (C11), the TWO-PLANET class (D-090/D-098/D-100 —
 * canon-world names ≠ the chosen world), player-safety on pre-sign fields (C12), profile sanity (C17).
 */
import { stepValue, CHAOS_CONTRACT_TYPES, type ContractColumn } from '../chaos-contract-steps';
import { hotspotTypeId, type HotSpot, type HotSpotContractTerms } from '../hotspots-catalog';

export interface ValidateCtx {
    existingIds: ReadonlySet<string>;
    chamberTags: ReadonlySet<string>;             // the 9 legal era tags
    factionOk: (name: string) => boolean;         // catalog-resolvable + era pool non-empty
    mulOk: (name: string) => boolean;             // ilClan MUL-mappable (inert true off-ilClan)
    sameFactionAllowed: boolean;                  // the archetype whitelist (merc-vs-merc / clan-internal)
    expectedDepth: number;                        // main-path track depth == intensity (C6)
    canonWorlds: ReadonlyMap<string, string>;     // lower-cased canon world name → display (two-planet scan)
}

const GATES = new Set(['FULL_SUCCESS', 'SUCCESS', 'PARTIAL', 'FAILURE', 'COMPROMISED', 'ANY']);
const COLS: ContractColumn[] = ['basePay', 'command', 'salvage', 'support', 'transport'];

/** Every string field of a value, with a JSON-ish path (for error messages). */
function stringsOf(value: unknown, path = ''): { path: string; text: string }[] {
    if (typeof value === 'string') return [{ path, text: value }];
    if (Array.isArray(value)) return value.flatMap((v, i) => stringsOf(v, `${path}[${i}]`));
    if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => stringsOf(v, path ? `${path}.${k}` : k));
    return [];
}

// Common-English canon world names excluded from the two-planet scan (false-positive stoplist; the
// harness sweep tunes it). Names shorter than 5 chars are skipped outright.
const WORLD_STOPLIST = new Set(['liberty', 'protection', 'victoria', 'concord', 'union', 'unity', 'hope', 'avalon', 'trials', 'homer', 'paradise', 'harmony', 'independence', 'bounty', 'summit', 'oasis', 'crossing', 'glory', 'small world', 'andiron', 'foothold', 'standoff']);

export function validateForged(h: HotSpot, ctx: ValidateCtx): string[] {
    const errs: string[] = [];
    const err = (m: string): void => { errs.push(m); };

    // ── structure (C1/C7) ──
    if (!h.id || ctx.existingIds.has(h.id)) err(`id missing/collides: '${h.id}'`);
    if (!h.title || !h.world || !h.employer || !h.type || !h.situation) err('top-level identity fields incomplete (C15 mirror)');
    const roots = h.tracks.filter((t) => t.root);
    if (roots.length !== 1) err(`exactly one root track required (got ${roots.length})`);
    const trackIds = new Set<string>();
    for (const t of h.tracks) {
        if (trackIds.has(t.id)) err(`duplicate track id '${t.id}'`);
        trackIds.add(t.id);
    }
    for (const t of h.tracks) for (const f of t.forks) {
        if (!GATES.has((f.outcomeGate || '').toUpperCase())) err(`track ${t.id}: bad gate '${f.outcomeGate}'`);
        if (f.nextTrackId != null && !trackIds.has(f.nextTrackId)) err(`track ${t.id}: fork → unknown track '${f.nextTrackId}'`);
    }

    // ── two-sided completeness (C3/C8) ──
    if (!h.sides) { err('sides:{a,b} must be fully authored'); return errs; }
    const { a, b } = h.sides;
    if (a.synthesized || b.synthesized) err('synthesized flag must be absent on authored sides');
    if (a.role === b.role) err('side roles must be opposed');
    if (!ctx.sameFactionAllowed && a.faction === b.faction) err(`side factions identical ('${a.faction}') without a same-faction archetype whitelist`);
    if (a.contract.enemyFaction !== b.faction || b.contract.enemyFaction !== a.faction) err('per-side enemyFaction must cross-derive from the other side');
    for (const k of ['scale', 'intensity', 'lengthMonths'] as const) {
        if (a.contract[k] !== b.contract[k]) err(`Part E shared field '${k}' differs across sides (${a.contract[k]} vs ${b.contract[k]})`);
    }
    for (const [label, side] of [['a', a], ['b', b]] as const) {
        if (!side.employer || !side.faction) err(`side ${label}: employer/faction missing`);
        if (!side.situation || !side.employerDesc) err(`side ${label}: Part E situation/employerDesc missing`);
    }
    // Two opposed sides must never render the SAME employer (a directorate hiring both sides against
    // itself). sameFaction archetypes are exempt: merc-both deliberately shares the rival org.
    if (!ctx.sameFactionAllowed && a.employer === b.employer) err(`both sides carry the identical employer '${a.employer}'`);

    // ── contract math (C5/C6/C13) — asserted against BOTH sides + the top-level mirror ──
    const checkTerms = (label: string, c: HotSpotContractTerms): void => {
        for (const col of COLS) {
            const idx = c.steps[col];
            if (stepValue(col, idx) == null) err(`${label}: steps.${col}=${idx} lands on an invalid '—' row (C5)`);
        }
        if (c.scale < 1 || c.scale > 3) err(`${label}: scale ${c.scale} out of range`);
        if ((c.lengthMonths ?? 0) < c.intensity) err(`${label}: lengthMonths ${c.lengthMonths} < intensity ${c.intensity} (C13)`);
    };
    checkTerms('sides.a.contract', a.contract);
    checkTerms('sides.b.contract', b.contract);
    checkTerms('contract (top-level mirror)', h.contract);
    const typeId = hotspotTypeId(h);
    const ct = CHAOS_CONTRACT_TYPES.find((x) => x.id === typeId);
    if (!ct) err(`type '${h.type}' maps to no ChaosContractType`);
    else if (h.contract.intensity < ct.intensityRange[0] || h.contract.intensity > ct.intensityRange[1]) {
        // C6 (post-IMPORT-6): negotiation signs the AUTHORED intensity verbatim (authoredIntensity) — there is no clamp any
        // more. This stays an EMIT-TIME forge invariant: the type string the forge chose must be the one whose range contains
        // the intensity it rolled (and that intensity must equal the main-path depth — the next check).
        err(`intensity ${h.contract.intensity} outside '${typeId}' range [${ct.intensityRange}] — a forged hot spot must sign inside its mapped type's range AND at main-path depth ${ctx.expectedDepth} (C6)`);
    }
    if (h.contract.intensity !== ctx.expectedDepth) err(`intensity ${h.contract.intensity} ≠ main-path depth ${ctx.expectedDepth} (C6)`);
    const bTypeId = b.type ? hotspotTypeId({ ...h, type: b.type }) : typeId;
    if (bTypeId !== typeId) err(`side b type string maps to '${bTypeId}' ≠ '${typeId}' (C3 — the signed type derives from the top level for BOTH sides)`);

    // ── per-track objectives + role (C8/C9) ──
    for (const t of h.tracks) {
        if (!t.objectives?.length) err(`track ${t.id}: no objectives`);
        if (!t.playerRole) err(`track ${t.id}: playerRole must be explicit`);
        if (!t.trackEnd || !t.salvagePolicy || !t.deployment || !t.situation) err(`track ${t.id}: template fields incomplete (C9)`);
        if (!t.opfor?.armsMix) err(`track ${t.id}: opfor.armsMix missing`);
        let atk = 0, def = 0;
        for (const [i, o] of (t.objectives ?? []).entries()) {
            if (!o.text || o.vp == null || !o.kind || !o.side) err(`track ${t.id} objective[${i}]: text/vp/kind/side must all be explicit (C8)`);
            if (o.side === 'attacker' || o.side === 'both') atk++;
            if (o.side === 'defender' || o.side === 'both') def++;
        }
        if (!atk || !def) err(`track ${t.id}: both VP columns must be non-empty (attacker ${atk} / defender ${def}) — D-134 renders two columns`);
    }

    // ── faction legality (C4) ──
    for (const f of [a.faction, b.faction]) {
        if (!ctx.factionOk(f)) err(`faction '${f}' not resolvable to a fieldable era pool (C4)`);
        if (!ctx.mulOk(f)) err(`faction '${f}' not MUL-mappable for ilClan (C4)`);
        if (/local\s*\/\s*planetary/i.test(f)) err(`generic employer label emitted as a combat faction: '${f}'`);
    }

    // ── era (C2) ──
    if (!h.era || !ctx.chamberTags.has(h.era)) err(`era '${h.era}' not a chamber tag (C2)`);

    // ── prose gates (C11 / two-planet / C12) ──
    const all = stringsOf(h);
    for (const { path, text } of all) {
        const tok = text.match(/\{[A-Za-z_][A-Za-z0-9_:.-]*\}/);
        if (tok) err(`slot residue '${tok[0]}' at ${path} (C11)`);
        const leak = text.match(/\[[A-Za-z_][A-Za-z0-9_]*\]/);
        if (leak) err(`fill-leak marker '${leak[0]}' at ${path} (C11)`);
    }
    // TWO-PLANET: any canon world name ≠ the chosen world, in any PROSE field (word-boundary, ≥5 chars,
    // stoplisted common words excluded; the world's own name + its landmass/capital strings are fine).
    // Identity/proper-noun fields are EXEMPT — a named character's personal name (from the npc-marquee
    // pool, e.g. 'Wyatt') is not a "this world's name" narration just because it collides with an
    // unrelated system in the 1046-world star map; flagging it produced false-positive reroll exhaustion.
    const IDENTITY_FIELD = /namedCharacters\[\d+\]\.(name|chassis)$/;
    const own = (h.world || '').toLowerCase();
    for (const { path, text } of all) {
        if (IDENTITY_FIELD.test(path)) continue;
        const lower = text.toLowerCase();
        for (const [nameLower, display] of ctx.canonWorlds) {
            if (nameLower === own || nameLower.length < 5 || WORLD_STOPLIST.has(nameLower)) continue;
            if (own.includes(nameLower) || nameLower.includes(own)) continue; // base-name variants of the chosen world
            const re = new RegExp(`\\b${nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (re.test(lower)) { err(`TWO-PLANET: '${display}' named at ${path} but the hotspot world is '${h.world}'`); break; }
        }
    }
    // ── HOTSPOT-BRIEF v1 BUDGETS (frozen 2026-07-17) — the format enforced mechanically on forged
    // output (authored packs are never validated here). Clamp-driven caps are hard truth (text is
    // LOST past them); ceilings keep every surface inside its measured frame. ──
    const over = (label: string, text: string | undefined, cap: number): void => {
        if (text && text.length > cap) err(`BUDGET: ${label} ${text.length} > ${cap} ch (HOTSPOT-BRIEF v1)`);
    };
    over('title', h.title, 36);
    over('blurb', h.blurb, 240);
    over('situation (synopsis)', h.situation, 1700);
    over('employerDesc', h.employerDesc, 260);
    for (const [sl, sd] of [['a', a], ['b', b]] as const) {
        over(`sides.${sl}.situation`, sd.situation, 340);
        over(`sides.${sl}.employerDesc`, sd.employerDesc, 260);
        over(`sides.${sl}.blurb`, sd.blurb, 240);
        over(`sides.${sl}.employer`, sd.employer, 100);
    }
    over('systemProfile.description', h.systemProfile?.description, 300);
    over('missionBrief.contractVictory', h.missionBrief?.contractVictory, 330);
    over('missionBrief.behindScenes', h.missionBrief?.behindScenes, 600);
    for (const [i, c] of (h.missionBrief?.complications ?? []).entries()) over(`complication[${i}].effect`, c.effect, 360);
    for (const t of h.tracks) {
        over(`track ${t.id} name`, t.name, 30);
        over(`track ${t.id} situation`, t.situation, 1100);
        over(`track ${t.id} deployment`, t.deployment, 960);
        over(`track ${t.id} trackEnd`, t.trackEnd, 131); // v1.0.1 (James 2026-07-18): +1 over the shared defend template's 129-ch string — margin, not a shared-string edit
        over(`track ${t.id} salvagePolicy`, t.salvagePolicy, 150);
        over(`track ${t.id} specialRules`, t.specialRules, 390);
        for (const [i, o] of (t.objectives ?? []).entries()) over(`track ${t.id} objective[${i}]`, o.text, 200);
        for (const [i, f] of (t.forks ?? []).entries()) { over(`track ${t.id} fork[${i}].trigger`, f.trigger, 160); over(`track ${t.id} fork[${i}].consequence`, f.consequence, 240); }
    }

    // Player-safety (C12) on the PRE-SIGN surface: blurb/situation/side identity leak no tactical data.
    const preSign: { path: string; text: string }[] = [
        { path: 'blurb', text: h.blurb ?? '' }, { path: 'situation', text: h.situation },
        { path: 'sides.a.situation', text: a.situation ?? '' }, { path: 'sides.b.situation', text: b.situation ?? '' },
        { path: 'sides.a.employerDesc', text: a.employerDesc ?? '' }, { path: 'sides.b.employerDesc', text: b.employerDesc ?? '' },
        { path: 'title', text: h.title },
    ];
    const LEAKS: [RegExp, string][] = [
        [/\b\d+\s*VP\b/i, 'VP value'], [/\bvictory point/i, 'VP wording'], [/\bturn\s+\d+/i, 'turn count'],
        [/\bobjective structure/i, 'objective structure'], [/\bBV\b/, 'BV figure'], [/\bnextTrack/i, 'tree internals'],
    ];
    for (const { path, text } of preSign) for (const [re, what] of LEAKS) {
        if (re.test(text)) err(`player-safety: ${what} leaks pre-sign at ${path} (C12)`);
    }

    return errs;
}

/** The 9 legal chamber era tags (the 8 eraTag() buckets + 'ilclan'). */
export function chamberTagSet(): Set<string> {
    return new Set(['age-of-war', 'star-league', 'early-succession-wars', 'late-succession-wars', 'clan-invasion', 'civil-war', 'jihad', 'dark-age', 'ilclan']);
}
