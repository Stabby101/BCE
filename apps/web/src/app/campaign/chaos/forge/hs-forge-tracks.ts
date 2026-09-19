/*
 * BCE — HSFORGE-1: track-tree assembly. Pure (no Angular): a donor MissionSeed (the Classic library's
 * skeleton: forks, prose hooks, opfor sketch) + the §18 template vocabulary + the objective-pair corpus
 * → 1–4 HotSpotTracks chained by outcome-gated forks (C7), each with two-sided board-checkable
 * objectives (C8), template deployment/trackEnd/salvage (C9), and an explicit per-track playerRole.
 *
 * Numeric objective params + {SITE_*} nouns are resolved HERE (per-set params, deterministic rng);
 * {WORLD}/{DISTRICT}/{EMPLOYER}/… tokens are left for the orchestrator's single fillSlotsDeep bake (C11).
 */
import type { MissionSeed, SeedFork } from '../../mission/forge-types';
import { FAMILY_TRACK, TRACK_TEMPLATES, type TrackTemplateKey } from '../track-setup';
import type { MissionTypeId } from '../../contract/contract-terms';
import type { HotSpotFork, HotSpotObjective, HotSpotTrack } from '../hotspots-catalog';
import type { ObjectiveLibrary, ObjectiveSet, ObjectiveSpec } from './hs-forge-data';
import { pick, rngInt } from './hs-forge-rng';

export const AUTHORED_TEMPLATE_ID: Record<TrackTemplateKey, string> = {
    assault: 'Assault', breakthrough: 'Breakthrough', defend: 'Defend', flank: 'Flank',
    meeting: 'Meeting Engagement', 'objective-raid': 'Objective Raid', pursuit: 'Pursuit',
    pushback: 'Pushback', recon: 'Recon', retreat: 'Retreat', strike: 'Strike',
    'duel-arena': 'Duel Arena',
};

/** Root template for a donor family — ruling D8: a clan-register CADRE donor plays as a Duel
 *  (authored 'Duel' templateId aliases to the meeting template via templateKeyFor). */
export function rootTemplateFor(donor: MissionSeed): { key: TrackTemplateKey; templateId: string; playerSide: 'attacker' | 'defender' } {
    if (donor.family === 'CADRE_DUTY' && /clan/i.test(donor.register ?? '')) {
        return { key: 'meeting', templateId: 'Duel', playerSide: 'attacker' };
    }
    const f = FAMILY_TRACK[donor.family as MissionTypeId] ?? { template: 'meeting' as TrackTemplateKey, playerSide: 'attacker' as const };
    return { key: f.template, templateId: AUTHORED_TEMPLATE_ID[f.template], playerSide: f.playerSide };
}

/** Root template → the intended ChaosContractType id (C6 — the emitted `type` STRING must regex-map to
 *  exactly this id via hotspotTypeId; hs-forge-dressing builds the string from this). */
export function chaosTypeFor(rootKey: TrackTemplateKey, templateId: string, opponentFaction: string): string {
    if (templateId === 'Duel') return 'expedition'; // /duel|trial/ regex
    if (rootKey === 'pursuit' && /pirate|bandit/i.test(opponentFaction)) return 'pirate-hunt';
    switch (rootKey) {
        case 'assault': case 'pushback': return 'invasion';
        case 'defend': case 'meeting': return 'garrison';
        case 'recon': return 'expedition';
        case 'objective-raid': case 'strike': case 'flank': case 'breakthrough': case 'pursuit': return 'raid';
        default: return 'garrison';
    }
}

// Site nouns per settlement type ({SITE_A}/{SITE_B} fills). OUR plain vocabulary; the objective corpus
// declares the slots, the world's settlement picks the nouns (world-coherent by construction).
// HOTSPOT-BRIEF v1 (§7.6): every noun ≤20 chars — a 28-char noun filled twice blew the ≤160/200
// objective budget in the resolve-modal checklist cell.
const SITE_NOUNS: Record<string, string[]> = {
    capital: ['the government annex', 'the signal compound', 'the parade arsenal', 'the archive vaults'],
    industrial: ['the fabricator hall', 'the ore tipple', 'the coolant works', 'the gantry sheds'],
    agrarian: ['the grain terminal', 'the seed vaults', 'the irrigation works', 'the stockyard sheds'],
    port: ['the drayage yards', 'the bond stores', 'the lift-pad cradles', 'the fuel bunkers'],
    frontier: ['the relay compound', 'the survey depot', 'the water point', 'the airstrip sheds'],
};
const siteNoun = (settlement: string, rng: () => number, taken: Set<string>): string => {
    const pool = (SITE_NOUNS[settlement] ?? SITE_NOUNS['frontier']).filter((n) => !taken.has(n));
    const n = pool.length ? pick(pool, rng) : pick(SITE_NOUNS[settlement] ?? SITE_NOUNS['frontier'], rng);
    taken.add(n);
    return n;
};

// VP by kind, calibrated to the authored packs (primaries uniformly 50; secondary p50 250; bonus p50 100).
const vpFor = (kind: 'primary' | 'secondary' | 'bonus', rng: () => number): number =>
    kind === 'primary' ? 50 : kind === 'secondary' ? pick([200, 250, 300], rng) : pick([50, 100, 150], rng);

/** Resolved objectives + the table-convention facts planToTrack must RENDER (the CLEAN-gate rule:
 *  the corpus _meta.law is designer metadata — placement/commander conventions must reach the sheet). */
export interface ResolvedObjectives { objectives: HotSpotObjective[]; siteNouns: string[]; bothRefSites: string[]; commanderNamed: boolean; }

/** Resolve one objective set → side-tagged HotSpotObjectives with VP; params + sites filled deterministically.
 *  SCALE conventions BAKED at emit (the corpus law, engine-implemented): Scale 2+ doubles {R} and adds
 *  +1 to {T}/{T2}; unit-referencing count params ({N}/{K}, except strike's structure counts) clamp to
 *  half the scale's nominal side size (Scale 1=4 · 2=8 · 3=12 units) so no objective is impossible or
 *  auto-met at the table. */
export function objectivesFromSet(set: ObjectiveSet, settlement: string, templateKey: TrackTemplateKey, scale: number, rng: () => number): ResolvedObjectives {
    const nominalSide = scale >= 3 ? 12 : scale === 2 ? 8 : 4;
    const unitCap = Math.max(1, Math.ceil(nominalSide / 2));
    const fills: Record<string, string> = {};
    for (const [k, v] of Object.entries(set.params ?? {})) {
        let val = rngInt(v.min, v.max, rng);
        if (/^R\d*$/.test(k) && scale >= 2) val *= 2;
        if (/^T\d*$/.test(k) && scale >= 2) val += 1;
        // Unit-count clamp (the corpus law). Exempt ONLY strike's STRUCTURE counts (find-the-hq's {N}
        // scans the four buildings; burn-it-all's {N2} destroys them) — strike's other {N}/{K} are units.
        const structureParam = templateKey === 'strike' && (k === 'N2' || (set.key === 'find-the-hq' && k === 'N'));
        if (/^[NK]\d*$/.test(k) && !structureParam) val = Math.max(v.min > unitCap ? unitCap : Math.min(val, unitCap), 1);
        fills[k] = String(val);
    }
    const taken = new Set<string>();
    for (const s of set.sites ?? []) fills[s] = siteNoun(settlement, rng, taken);
    const sub = (t: string): string => t.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (k in fills ? fills[k] : m));
    // Mirrored objectives (identical RAW text on both sides — the symmetric meeting sets) share ONE
    const vpByRaw = new Map<string, number>();
    const mk = (o: ObjectiveSpec, side: 'attacker' | 'defender' | 'both'): HotSpotObjective => {
        let vp = vpByRaw.get(o.kind + '|' + o.text);
        if (vp == null) { vp = vpFor(o.kind, rng); vpByRaw.set(o.kind + '|' + o.text, vp); }
        return { text: sub(o.text), vp, kind: o.kind, side };
    };
    const a = set.attacker.map((o) => mk(o, 'attacker'));
    const d = set.defender.map((o) => mk(o, 'defender'));
    const b = (set.both ?? []).map((o) => mk(o, 'both'));
    // Order: paired primaries first (A then B), then the rest — the authored reading order.
    const primaryFirst = (xs: HotSpotObjective[]): HotSpotObjective[] => [...xs.filter((o) => o.kind === 'primary'), ...xs.filter((o) => o.kind !== 'primary')];
    const [ap, ...ar] = primaryFirst(a); const [dp, ...dr] = primaryFirst(d);
    const objectives = [ap, dp, ...ar, ...dr, ...b].filter(Boolean) as HotSpotObjective[];
    // Which resolved site nouns are referenced by BOTH sides' raw texts (→ GM places at center, the law)?
    const refsSite = (specs: ObjectiveSpec[], slot: string): boolean => specs.some((o) => o.text.includes(`{${slot}}`));
    const bothRefSites = (set.sites ?? []).filter((s) => (refsSite(set.attacker, s) || refsSite(set.both ?? [], s)) && (refsSite(set.defender, s) || refsSite(set.both ?? [], s))).map((s) => fills[s]);
    return {
        objectives,
        siteNouns: (set.sites ?? []).map((s) => fills[s]),
        bothRefSites,
        commanderNamed: objectives.some((o) => /commander/i.test(o.text)),
    };
}

export interface TrackBuildCtx {
    donor: MissionSeed;
    library: ObjectiveLibrary;
    explainers: Record<string, string>;
    settlement: string;
    depth: number;               // main-path length == contract intensity (C6)
    scale: number;               // contract scale — bakes the param conventions (R×2, T+1, unit clamp)
    sideBFaction: string;
    armsMix: 'MECH_ONLY' | 'COMBINED_ARMS';
    vehicleShare?: number;
    baseBvRatio: number;
    rng: () => number;
}

interface TrackPlan { id: string; key: TrackTemplateKey; templateId: string; name: string; role: 'attacker' | 'defender'; gateFrom?: string; stakes: string; bvDrift: number; forks: HotSpotFork[]; root?: boolean; }

/** Child template for an advancing donor fork (fork.family → FAMILY_TRACK), else the root family.
 *  `family` is carried by 458/608 forks in the shipped seed DATA but was never declared on the
 *  SeedFork type (the Classic renderer doesn't read it) — typed locally so mission/ stays byte-untouched. */
function advancingChild(fork: SeedFork | undefined, fallbackKey: TrackTemplateKey): { key: TrackTemplateKey; playerSide: 'attacker' | 'defender' } {
    const fam = (fork as (SeedFork & { family?: string }) | undefined)?.family as MissionTypeId | undefined;
    const f = fam && FAMILY_TRACK[fam];
    return f ? { key: f.template, playerSide: f.playerSide } : { key: fallbackKey, playerSide: FAMILY_TRACK['OBJECTIVE_RAID'].playerSide };
}

/** Build the 1–4 track tree from the donor's forks (authored-pack shape: SUCCESS chain + a shared
 *  FAILURE covering action; terminal ANY→null forks close the tree at the intensity boundary). */
export function buildTracks(ctx: TrackBuildCtx): { tracks: HotSpotTrack[]; rootKey: TrackTemplateKey; rootTemplateId: string; rootRole: 'attacker' | 'defender' } {
    const { donor, rng } = ctx;
    const root = rootTemplateFor(donor);
    const donorForks = donor.forks ?? [];
    const advancing = donorForks.filter((f) => ['SUCCESS', 'FULL_SUCCESS', 'PARTIAL'].includes((f.outcomeGate || '').toUpperCase()));
    const failing = donorForks.filter((f) => ['FAILURE', 'COMPROMISED'].includes((f.outcomeGate || '').toUpperCase()));

    const plans: TrackPlan[] = [];
    // HOTSPOT-BRIEF v1 (§3): fork trigger ≤160 / consequence ≤240. Donor trigger/consequence text
    // carries UNRESOLVED global tokens (WORLD/EMPLOYER/TARGET_FACTION/DISTRICT — 43/258-of-223 seeds)
    // that the orchestrator's SINGLE fillSlotsDeep bake fills LATER — trimming here, pre-bake, can
    // still overflow post-bake (a token can expand by 40+ ch). The hard cap is enforced POST-BAKE
    // (hs-forge.service.ts tidyProse); leave the raw donor text untouched here.
    const mkFork = (gate: string, next: string | null, donorFork?: SeedFork): HotSpotFork => ({
        outcomeGate: gate,
        nextTrackId: next,
        trigger: donorFork?.trigger || 'The engagement is decided on the ground.',
        consequence: donorFork?.consequence || (next ? 'The contract moves to its next track.' : 'The contract closes out.'),
        threat: (donorFork?.threat || 'MEDIUM').toUpperCase(),
    });

    // Root. HOTSPOT-BRIEF v1 (§7.2): the stakes opener is CHAR-capped, not just sentence-capped — two
    // donor sentences can run 668 ch; past ~300 the second sentence drops so track.situation stays ≤1,100.
    const twoSent = firstSentences(donor.situation, 2);
    const rootStakes = twoSent.length <= 300 ? twoSent : firstSentences(donor.situation, 1);
    const rootPlan: TrackPlan = {
        id: 't1', key: root.key, templateId: root.templateId, name: nameFit(donor.title || TRACK_TEMPLATES[root.key].name),
        role: root.playerSide, stakes: rootStakes, bvDrift: 0, forks: [], root: true,
    };
    plans.push(rootPlan);

    if (ctx.depth <= 1) {
        rootPlan.forks = [mkFork('ANY', null, advancing[0] ?? donorForks[0])];
    } else {
        // Shared FAILURE covering action (the authored convention: fail the op → cover the withdrawal).
        const failFork = failing[0];
        const failKey: TrackTemplateKey = pick(['retreat', 'defend'] as TrackTemplateKey[], rng);
        const fail: TrackPlan = {
            id: 't2b', key: failKey, templateId: AUTHORED_TEMPLATE_ID[failKey],
            name: nameFit(failFork?.name || (failKey === 'retreat' ? 'Fighting Withdrawal' : 'Hold the Line')),
            role: 'defender', gateFrom: 'FAILURE', stakes: failFork?.consequence || 'The op has gone wrong. Get the force out intact.',
            bvDrift: 0.05, forks: [mkFork('ANY', null)],
        };
        // Advancing chain: t2a (+ t3a at depth 3).
        const adv1 = advancing[0];
        const c1 = advancingChild(adv1, root.key);
        const t2a: TrackPlan = {
            id: 't2a', key: c1.key, templateId: AUTHORED_TEMPLATE_ID[c1.key], name: nameFit(adv1?.name || TRACK_TEMPLATES[c1.key].name),
            role: c1.playerSide, gateFrom: 'SUCCESS', stakes: adv1?.consequence || 'The first blow landed. Press the advantage.',
            bvDrift: 0.1, forks: [],
        };
        rootPlan.forks = [mkFork('SUCCESS', 't2a', adv1), mkFork('FAILURE', 't2b', failFork)];
        if (ctx.depth >= 3) {
            const adv2 = advancing[1] ?? advancing[0];
            const c2 = advancingChild(adv2, c1.key);
            const t3a: TrackPlan = {
                id: 't3a', key: c2.key, templateId: AUTHORED_TEMPLATE_ID[c2.key], name: nameFit(adv2?.name || TRACK_TEMPLATES[c2.key].name),
                role: c2.playerSide, gateFrom: 'SUCCESS', stakes: adv2?.consequence || 'One push remains to settle the contract.',
                bvDrift: 0.15, forks: [mkFork('ANY', null)],
            };
            t2a.forks = [mkFork('SUCCESS', 't3a', adv2), mkFork('FAILURE', 't2b', failFork)];
            plans.push(t2a, t3a, fail);
        } else {
            t2a.forks = [mkFork('ANY', null)];
            plans.push(t2a, fail);
        }
    }

    const tracks = plans.map((p) => planToTrack(p, ctx));
    return { tracks, rootKey: root.key, rootTemplateId: root.templateId, rootRole: root.playerSide };
}

function planToTrack(p: TrackPlan, ctx: TrackBuildCtx): HotSpotTrack {
    const t = TRACK_TEMPLATES[p.key];
    const explainer = ctx.explainers[p.key] ?? '';
    const sets = ctx.library.templates[p.key]?.sets ?? [];
    if (!sets.length) throw new Error(`hs-forge: no objective sets for template '${p.key}'`);
    const set = pick(sets, ctx.rng);
    const resolved = objectivesFromSet(set, ctx.settlement, p.key, ctx.scale, ctx.rng);
    const situation = [p.stakes, explainer].filter(Boolean).join('\n\n');
    // The table conventions RENDER on the sheet (the CLEAN-gate rule — _meta.law is designer metadata):
    // site placement + CF, and the commander-naming rule, ride the deployment text. objective-raid is
    // EXEMPT (its template ALREADY defines two indestructible objective structures — the law's carve-out;
    // the sites BIND to them instead of adding contradictory destructible-CF-40 duplicates).
    const conventions: string[] = [];
    if (resolved.siteNouns.length && p.key === 'objective-raid') {
        conventions.push(`The named sites — ${resolved.siteNouns.join(' and ')} — are the track's two objective structures (the template's placement and indestructibility rules apply).`);
    } else if (resolved.siteNouns.length) {
        // HOTSPOT-BRIEF v1 (§7.4): compressed toward the ≤700-typical deployment tier.
        const list = resolved.siteNouns.join(' and ');
        const bothNote = resolved.bothRefSites.length ? `; a site both sides reference sits at or beside the center hex` : '';
        conventions.push(`Before deployment, place ${list} within four hexes of the map center — the defender places a site its objectives reference, the GM places the rest${bothNote}. Each is a destructible medium building (CF 40).`);
    }
    if (resolved.commanderNamed) conventions.push('Each side publicly names one deployed unit as its commander before deployment.');
    return {
        id: p.id, name: p.name, templateId: p.templateId, ...(p.root ? { root: true } : {}),
        situation,
        deployment: [`${t.setupText} Attacker: ${t.attackerText} Defender: ${t.defenderText}`, ...conventions].join(' '),
        playerRole: p.role,
        objectives: resolved.objectives,
        trackEnd: t.trackEndText,
        salvagePolicy: salvageSentence(t.salvagePolicy),
        opfor: { faction: ctx.sideBFaction, armsMix: ctx.armsMix, ...(ctx.vehicleShare != null ? { vehicleShare: ctx.vehicleShare } : {}), bvRatio: clamp2(ctx.baseBvRatio + p.bvDrift) },
        forks: p.forks,
    };
}

const clamp2 = (n: number): number => Math.round(Math.max(0.7, Math.min(1.3, n)) * 100) / 100;

/** The template's default salvage policy as an authored-style sentence (free text downstream). */
function salvageSentence(policy: string): string {
    switch (policy) {
        case 'winner-all': return 'Winner takes the field: the victor keeps all recoverable salvage.';
        case 'pool-draft': return 'Pool-draft: wrecks are pooled; the winner drafts first, then sides alternate picks.';
        case 'none': return 'No battlefield salvage — every wreck returns to its owner.';
        case 'attacker-if-win': return 'The attacker keeps the salvage on a win; otherwise each side recovers its own.';
        case 'defender-if-win': return 'The defender keeps the salvage on a win; otherwise each side recovers its own.';
        default: return 'Salvage is divided as the two commands negotiate.';
    }
}

/** Track-name fit (HOTSPOT-BRIEF v1: ≤30 ch — the flow-node 2-line clamp). 3/831 donor names run
 *  31–32 ch: drop a leading 'Operation ' first, then word-boundary trim. Deterministic. */
export function nameFit(name: string): string {
    let n = (name || '').trim();
    if (n.length > 30) n = n.replace(/^operation\s+/i, '');
    if (n.length > 30) n = charFit(n, 30);
    return n;
}

/** A scoped donor-content defect (found by the Phase 3 pilot, NOT introduced by the forge): 51
 *  fork.consequence strings across exactly 2 seed files (seeds-insp-wave1.json ×29,
 *  seeds-sw-defense.json ×22 — every other of the 19 packs is clean) embed the internal
 *  MissionTypeId literally as authored shorthand ("It is a RECON_RAID to confirm…"). The shared
 *  donor content is untouched (Classic Forge implications, out of this scope) — the FORGE'S OWN
 *  rendered output is sanitized instead, since FORGE-BRIEF/HOTSPOT-BRIEF both require plain words. */
const FAMILY_PLAIN: Record<string, string> = {
    OBJECTIVE_RAID: 'objective raid', GARRISON_DUTY: 'garrison action', PLANETARY_ASSAULT: 'planetary assault',
    RECON_RAID: 'recon sweep', EXTRACTION_RAID: 'extraction run', RELIEF_DUTY: 'relief action',
    SECURITY_DUTY: 'security detail', DIVERSIONARY_RAID: 'diversionary raid', PIRATE_HUNTING: 'pirate hunt',
    GUERRILLA_WARFARE: 'guerrilla campaign', CADRE_DUTY: 'cadre posting', RIOT_DUTY: 'riot response',
};
const FAMILY_JARGON_RE = new RegExp(`\\b(${Object.keys(FAMILY_PLAIN).join('|')})\\b`, 'g');
/** Strip a literal MissionTypeId token from donor prose, in-place plain-English swap. */
export function stripFamilyJargon(text: string): string {
    return (text || '').replace(FAMILY_JARGON_RE, (m) => FAMILY_PLAIN[m] ?? m);
}

/** Word-boundary trim to a hard char cap (never mid-word; never empty on non-empty input — the
 *  string is pre-trimmed so index 0 is non-whitespace). Ends on a full stop where one survives.
 *  Exported: the orchestrator applies this POST-BAKE to fields that carry unresolved global tokens
 *  pre-bake (fork trigger/consequence, track situation, complication effects) — see hs-forge.service.ts. */
export function charFit(text: string, cap: number): string {
    const t = (text || '').trim();
    if (t.length <= cap) return t;
    const cut = t.slice(0, cap).replace(/\s+\S*$/, '');
    return /[.!?]$/.test(cut) ? cut : cut + '.';
}

/** The first N sentences of a prose block (the donor's stakes paragraph for the root track). */
export function firstSentences(text: string, n: number): string {
    const m = (text || '').match(/[^.!?]+[.!?]+(\s|$)/g);
    if (!m) return (text || '').slice(0, 300);
    return m.slice(0, n).join('').trim();
}
