/*
 * DIRECTIVE-124 — Premade Hot Spots catalog. Hot Spots run on PM-authored, hand-written hotspots (a fixed contract +
 * a 1–3 track branching tree + a per-track OpFor spec the RNG sizes at play) — the Forge is Traditional-only now.
 * Content is LITERAL (fixed worlds — no slot-fill). Each Track → a preset MissionSeed (WITH forks, unlike the empty-
 * fork D-116 user preset) whose forks chain the tree by nextSeedId; the loader AGGREGATES EVERY hotspot PACK (a
 * manifest of forge-data/hotspots-*.json, each pack's _meta carrying era + region its hotspots inherit) plus any
 * per-campaign CUSTOM hotspots, and `hotSpotCatalog(era, region?)` filters to the campaign's era + area of space.
 * The authored content also rides onto MissionForge.hotspot at bind so BOTH the GM deploy brief and the player tablet
 * render the ONE authored brief from the persisted record alone (DATA-003 — no catalog access player-side).
 */
import { Injectable, inject, signal } from '@angular/core';
import type { MissionSeed, SeedFork } from '../mission/forge-types';
import type { MissionTypeId } from '../contract/contract-terms';
import { NewCampaignState } from '../new-campaign-state';
import { hsFactionToMulFaction } from './mul-allowlist.service'; // D-133 — resolve a (possibly prefixed) employer string → a combat/MUL faction (pure fn; new-campaign-state imports HotSpot type-only → no runtime cycle)
import { CHAOS_CONTRACT_TYPES } from './chaos-contract-steps'; // HARDEN-2 — hotspotTypeId maps a hotspot's free-text type → a contract-type id

// ── The authored data contract (matches content-forge/hotspots-*.json). Literal content; all fields optional-additive. ──
export type ObjectiveKind = 'primary' | 'secondary' | 'bonus';
export interface HotSpotSystemProfile {
    starType?: string; rechargeHours?: number; positionInSystem?: string; timeToJumpPointDays?: number;
    satellites?: string; surfaceGravity?: number; atmPressure?: string; equatorialTempC?: number;
    climate?: string; surfaceWaterPct?: number; rechargeStation?: string; hpgClass?: string;
    highestNativeLife?: string; population?: number; populationYear?: number; socioIndustrial?: string;
    landmasses?: string[]; capitalCity?: string;
    description?: string; // IMPORT-5 Part F — a free-text planet / hot-spot prose description (renders as a paragraph)
}
export interface HotSpotObjective { text: string; vp: number; kind?: ObjectiveKind; side?: 'both' | 'attacker' | 'defender'; }
export interface HotSpotFork { outcomeGate: string; nextTrackId: string | null; trigger: string; consequence: string; threat: string; }
export interface HotSpotTrack {
    id: string; name: string; templateId: string; root?: boolean;
    situation: string; deployment: string;
    // D-137 — the side-A player's tactical role ON THIS TRACK (flips between tracks: attack on a raid, defend on a
    // screen). Optional: absent → the engine infers it from the first attacker/defender-tagged objective (the author
    // lists the player's objective first). Phase-3 content can state it explicitly.
    playerRole?: 'attacker' | 'defender';
    objectives: HotSpotObjective[];
    specialRules?: string; trackEnd: string; salvagePolicy: string;
    opfor: { faction?: string; armsMix: 'MECH_ONLY' | 'COMBINED_ARMS'; vehicleShare?: number; bvRatio?: number };
    forks: HotSpotFork[];
}
export interface HotSpotContractTerms {
    scale: number; intensity: number; lengthMonths: number;
    steps: { basePay: number; support: number; transport: number; salvage: number; command: number };
    enemyFaction: string;
    constraints?: string; additionalRequirements?: string; bonus?: string;
}
// ── DIRECTIVE-133 — two-sided contracts (Phase 1): a hot spot offers TWO opposing contracts; you pick a side, and the
//    OpFor is the OTHER side's faction. Authored `HotSpot.sides` win; else one is synthesized (best-effort, tagged). ──
export interface SideOffer {
    key: 'a' | 'b';
    role: 'attacker' | 'defender';
    employer: string;   // who hires you (display)
    faction: string;    // this side's combat faction (used as the OpFor when the OTHER side is picked)
    contract: HotSpotContractTerms;
    blurb?: string;
    synthesized?: boolean; // a provisional opposing side (no authored contract yet)
    // IMPORT-5 Part E — per-side IDENTITY: in a true opposed pair each employer frames the SAME op differently
    // (its own name/type/briefing/employer-desc). All optional + additive — absent → the render falls back to the
    // shared top-level HotSpot value, so the 23 authored two-sided packs (which carry none of these) are unchanged.
    title?: string; type?: string; situation?: string; employerDesc?: string;
}
export interface HotSpotComplication { roll: string; effect: string; }
export interface HotSpotNamedCharacter { name: string; role: string; chassis?: string; skill?: string; rule?: string; npcId?: string; } // npcId — HSFORGE-1 P2: the forge's cast record (antagonist continuity); render never reads it
/** DIRECTIVE-IMPORT-3 Part 2 — a unique named mercenary a hot spot offers FOR HIRE (Support Points), fielded for
 *  a track (§17.1 track-prep step 3/4). Data-driven cost: `spCost` charged PER TRACK fielded by default, or ONCE
 *  for the whole contract when `oneTimeHire` is set. `bv`/`model` optional (else resolved from the catalog by
 *  chassis, else advisory 0). Distinct from the narrative `namedCharacters` (which are story colour, not hireable). */
export interface HotSpotHireable {
    name: string; role: string;
    gunnery: number; piloting: number;
    edge?: number;      // starting Edge tokens (campaign pilot card); default 1
    chassis?: string;   // the 'Mech they field
    model?: string;     // optional variant
    bv?: number;        // the 'Mech's BV (else resolved from the catalog by chassis, else 0/advisory)
    spCost: number;     // Support-Point cost to field
    oneTimeHire?: boolean; // true → charged ONCE for the contract; default (false) → per track fielded
}
export interface HotSpotMissionBrief {
    behindScenes?: string; complications: HotSpotComplication[]; contractVictory: string; tally?: string | null;
    namedCharacters?: HotSpotNamedCharacter[]; purchaseOptions?: string;
}
export interface HotSpot {
    id: string; title: string; world: string; employer: string; employerDesc?: string; type: string;
    blurb?: string; // D-124e — an optional 1-2 sentence teaser for the offer-preview "The op" gist (else `situation`)
    systemProfile: HotSpotSystemProfile; situation: string;
    contract: HotSpotContractTerms; missionBrief: HotSpotMissionBrief; tracks: HotSpotTrack[];
    era?: string; region?: string | null; // D-124 — optional per-hotspot override of the pack _meta
    custom?: boolean; // D-124 — a user-authored hotspot (persisted per-campaign), else a premade pack hotspot
    capstone?: boolean; // D-124c — an endgame-only "end boss" hotspot: excluded from normal deals + the negotiate draw
    sides?: { a: SideOffer; b?: SideOffer }; // D-133 — authored opposing pair (optional; absent → synthesized from the legacy fields). ERA-1: `b` optional — a single-sided forged hot spot carries its authored side A only
    singleSided?: boolean; // IMPORT-5 Part C — the GM built this as a SINGLE offer: resolveSides returns ONLY side A (no synthesized B). ERA-1: also inferred/forged when the enemy is a Clan that does not hire mercenaries
    hireable?: HotSpotHireable[]; // IMPORT-3 P2 — unique named mercs this hot spot offers for hire (Support Points)
    forged?: boolean; // HSFORGE-1 — INTERNAL provenance flag (debugging/support): minted by the Hot Spots Forge. No consumer branches on it (the zero-special-case rule).
    systemId?: string; // HSFORGE-1 (C16) — the star-map systemId the world was drawn from (id-join, never name-join; the future travel seam #169)
}
export interface HotSpotPackMeta { era: string; region?: string | null; title?: string; [k: string]: unknown; }
export interface HotSpotPack { _meta: HotSpotPackMeta; hotspots: HotSpot[]; }
/** A hotspot with its era/region resolved (hotspot override ?? pack _meta) — the catalog's working shape. */
export type CatalogHotSpot = HotSpot & { era: string; region: string | null };

/** The authored render payload stamped onto MissionForge.hotspot at bind. Persisted with the spec so the GM deploy
 *  brief AND the player tablet render the authored hotspot from the record alone. Its presence IS the hotspotBrief
 *  suppression flag (the Forge FRAGORD/WARNORD is hidden when it's set). */
export interface HotSpotBrief {
    id: string; title: string; world: string; employer: string; employerDesc?: string; type: string;
    systemProfile: HotSpotSystemProfile; situation: string;
    trackName: string; trackTemplate: string; trackSituation: string; deployment: string;
    playerRole?: 'attacker' | 'defender'; // D-137 — the track's authored side-A role (see HotSpotTrack.playerRole)
    objectives: { text: string; vp: number; kind: ObjectiveKind; side?: string }[];
    specialRules?: string; templateRules?: string; trackEnd: string; salvagePolicy: string;
    contractVictory: string; tally?: string | null; behindScenes?: string;
    complications: HotSpotComplication[]; namedCharacters?: HotSpotNamedCharacter[]; purchaseOptions?: string;
    hireable?: HotSpotHireable[]; // IMPORT-3 P2 — rides onto forge.hotspot so the deploy area (+ player brief) sees the for-hire personnel
    constraints?: string; additionalRequirements?: string; bonus?: string;
    // IMPORT-6 Part B — the hot spot was built SINGLE-SIDED (no authored opposition): the resolve lists every authored
    // objective in ONE column and tiers on the VP share (singleSidedResolve). Emitted only when true, so the 23 authored
    // two-sided packs + every forged hot spot (sides mandatory) are byte-identical → the D-134/137 two-sided path is untouched.
    singleSided?: boolean;
    // IMPORT-7 Part D — display honesty for scale-dependent authored requirements: the Track Scale the CONTENT was written at
    // (hotspot.contract.scale, shared by both sides) and the Scale the GM actually SIGNED at (D-129/D-136 scale freedom is
    // unchanged — stamped at bind from the active contract). The package/brief render "Authored at Scale N · signed at Scale M"
    // instead of a bare authored assertion that contradicts the contract. Both optional (pre-IMPORT-7 specs lack them).
    authoredScale?: number;
    signedScale?: number;
}

/** DIRECTIVE-124 — the hotspot PACK manifest. Adding content = drop a `hotspots-*.json` into forge-data + one line
 *  here (mirror-synced by tools/copy-forge-content.mjs). Hinterlands, general-per-era packs, etc. drop in the same way. */
const PACK_LOADERS: readonly (() => Promise<unknown>)[] = [
    () => import('../mission/forge-data/hotspots-draconis-march.json'),
    // DIRECTIVE-CLI-1 — the Clan Invasion pack (era 'clan-invasion', region 'invasion-corridor'): ten side-A-only
    // contracts against the invading Clans. Clears the HSFORGE-1 top-up floor (8) so a 3050 corridor board deals authored.
    () => import('../mission/forge-data/hotspots-clan-invasion.json'),
    // DIRECTIVE-HIN-1 — the Hinterlands pack (era 'ilclan', region 'hinterlands'): nine side-A-only contracts against the remnant
    // Clans of the collapsed Falcon OZ + one two-sided Lyran-vs-League pair (Bolan). Region-strict: never co-deals with the March.
    () => import('../mission/forge-data/hotspots-hinterlands.json'),
    // DIRECTIVE-135 — the endgame CAPSTONE pool (capstone:true). Loaded into the chamber but held OUT of normal deals
    // by the offer-pool filter; surfaced only behind the "Begin the Reckoning" finale gate (chaos-contracts-tab).
    () => import('../mission/forge-data/hotspots-draconis-march-capstones.json'),
];

/** Map an authored §18 templateId → a MissionTypeId family (drives the fallback archetype / weighted pool — inert for
 *  a preset seed, which short-circuits selection. The authored brief renders from forge.hotspot, not the family). */
const TEMPLATE_FAMILY: Record<string, MissionTypeId> = {
    Assault: 'PLANETARY_ASSAULT', Defend: 'GARRISON_DUTY', Breakthrough: 'EXTRACTION_RAID', Retreat: 'RELIEF_DUTY',
    Strike: 'OBJECTIVE_RAID', Recon: 'RECON_RAID', Duel: 'CADRE_DUTY', Extraction: 'EXTRACTION_RAID',
    Objective: 'OBJECTIVE_RAID', Escort: 'SECURITY_DUTY', Chase: 'RECON_RAID', Hold: 'GARRISON_DUTY',
};
const familyFor = (templateId: string): MissionTypeId => TEMPLATE_FAMILY[templateId] ?? 'OBJECTIVE_RAID';

/** The seed id for an authored track: 'preset-<hotspotId>-<trackId>' (e.g. preset-hs-drm-01-t2a). */
export const hotspotSeedId = (hotspotId: string, trackId: string): string => `preset-${hotspotId}-${trackId}`;

// ── DIRECTIVE-133 — resolve a hot spot into its two opposing SideOffers. ──
/** The DR track templates whose root role is DEFENDER (else the root is an attacker). */
const DEFENDER_TEMPLATES = new Set(['Defend', 'Retreat', 'Hold']);
const rootRole = (h: HotSpot): 'attacker' | 'defender' => {
    const root = h.tracks.find((t) => t.root) ?? h.tracks[0];
    return root && DEFENDER_TEMPLATES.has(root.templateId) ? 'defender' : 'attacker';
};
const opposite = (r: 'attacker' | 'defender'): 'attacker' | 'defender' => (r === 'defender' ? 'attacker' : 'defender');
/** D-133 — the label used when an employer string doesn't map to a combat/MUL faction (feeds the existing IS-union
 *  OpFor fallback in generateOpFor when this side becomes the OpFor). */
export const GENERIC_EMPLOYER_FACTION = 'Local / planetary forces';
/** The employer side's combat FACTION: the employer mapped to a combat/MUL faction (handles the prefixed
 *  "Federated Suns — …" employer strings via hsFactionToMulFaction's contains pass), else a generic label.
 *  DECISION (flagged): the directive's "else current-system owner" fallback is DROPPED — the campaign's current
 *  LOCATION is not the hotspot's WORLD, so keying the employer to it would mislabel; the generic label + a
 *  "provisional" tag on the synthesized side is the honest best-effort. Real authored sides land in Phase 3. */
const employerFaction = (h: HotSpot): string => hsFactionToMulFaction(h.employer) ?? GENERIC_EMPLOYER_FACTION;

/** ERA-1 (ruling 2, 2026-09-02) — does this faction HIRE mercenaries? Clans do not; the exception is the Hot Spots-
 *  modeled trading Clans (Sea Fox, Raven Alliance — exactly the Clans with a MUL allowlist, D-127), which have authored
 *  precedent as employers (hs-drm-02). A faction that does not hire never gets a mercenary offer authored FOR it: a
 *  non-hiring Clan enemy makes the hot spot side-A-only. The Clan test mirrors D-102's `isClan` (`/clan/i`). */
export function factionHiresMercenaries(name: string | null | undefined): boolean {
    const n = (name ?? '').trim();
    if (!n) return true;
    return !/clan/i.test(n) || hsFactionToMulFaction(n) != null;
}

/** ERA-1 (ruling 4) — the chamber predicate `hotSpotCatalog` filters on, extracted pure so a spec can pin it:
 *  a CUSTOM hot spot always lists (IMPORT-2 Part A); else the era must match EXACTLY (a null query era passes all —
 *  the id-resolution pool) and the region must match unless the hot spot (region-null = general) or the query
 *  (null = era-wide) has none. STRICT by design: a 3050 campaign is never silently dealt another era's content. */
export function inChamber(h: { custom?: boolean; era: string; region: string | null }, era?: string | null, region?: string | null): boolean {
    return !!h.custom || ((!era || h.era === era) && (!region || !h.region || h.region === region));
}

/** DIRECTIVE-133 — the two opposing SideOffers for a hot spot. Authored `h.sides` are honored verbatim; else side A
 *  is the authored/legacy side and side B is a PROVISIONAL opposing contract (terms mirrored — only the enemy flips;
 *  real per-side terms are Phase 3). */
export function resolveSides(h: CatalogHotSpot): { a: SideOffer; b?: SideOffer } {
    if (h.sides) return h.sides;
    const aRole = rootRole(h);
    const aFaction = employerFaction(h);
    const a: SideOffer = { key: 'a', role: aRole, employer: h.employer, faction: aFaction, contract: h.contract, blurb: h.blurb };
    // IMPORT-5 Part C — the GM built this as a SINGLE offer: exactly ONE side, no synthesized opponent. Only fires on the
    // explicit flag; a flag-less legacy/authored hotspot still synthesizes a provisional B below (byte-unchanged).
    // ERA-1 (ruling 2) — ALSO single-sided when the enemy is a Clan that does not hire mercenaries: the mirror would
    // otherwise author "fight for Clan X", which no mercenary is ever offered. Authored `sides` (above) stay verbatim.
    if (h.singleSided || !factionHiresMercenaries(h.contract.enemyFaction)) return { a };
    const b: SideOffer = {
        key: 'b', role: opposite(aRole), employer: h.contract.enemyFaction, faction: h.contract.enemyFaction,
        contract: { ...h.contract, enemyFaction: aFaction }, // mirror: same steps/scale/intensity/lengthMonths, only the enemy flips
        synthesized: true,
        blurb: '(Provisional) Fight for ' + h.contract.enemyFaction + ' — an authored opposing contract is pending.',
    };
    return { a, b };
}
/** DIRECTIVE-133 — the OpFor faction for the picked `side` = the OTHER side's faction. For a SINGLE-sided hot spot
 *  (no side B) the OpFor is side A's own authored enemyFaction. (An unknown/generic string falls through to the
 *  existing IS-union OpFor fallback in generateOpFor.) */
export function opposingFaction(h: CatalogHotSpot, side: 'a' | 'b'): string {
    const s = resolveSides(h);
    return side === 'a' ? (s.b?.faction ?? s.a.contract.enemyFaction) : s.a.faction;
}

/** DIRECTIVE-IMPORT-5 (Part C backfill) — a CUSTOM hot spot authored BEFORE the two-sided toggle carries no `sides`
 *  and no `singleSided` flag; by construction it IS single-sided (there was no toggle to make it two-sided). Stamp
 *  it so resolveSides returns one side instead of synthesizing a phantom opponent. Fires ONLY on custom + no sides +
 *  no flag; a premade/AUTHORED pack (custom !== true) is NEVER touched, so its provisional-B synthesis is preserved.
 *  Pure + idempotent (applied at catalog ingest, so no persisted-data migration is required). */
export function backfillSingleSided<T extends { custom?: boolean; sides?: unknown; singleSided?: boolean }>(h: T): T {
    return h.custom && !h.sides && h.singleSided === undefined ? { ...h, singleSided: true } : h;
}

/** Resolve each objective's kind: the authored `kind` if present, else inferred by ORDER (0→primary · 1→secondary ·
 *  ≥2→bonus) so the current kind-less packs still map into the primary/secondary/bonus resolve slots + brief flags. */
export function objectiveKind(o: HotSpotObjective, index: number): ObjectiveKind {
    return o.kind ?? (index === 0 ? 'primary' : index === 1 ? 'secondary' : 'bonus');
}

/**
 * DIRECTIVE-124 — synthesize a MissionSeed from an authored hotspot track (extends the D-116 synthSeedFromPreset
 * shape). Unlike the user preset, this BUILDS forks[] from track.forks (each → nextSeedId = the linked track's seed)
 * so the existing fork/gate tree branches the authored tree; carries the OpFor arms + bvRatio for sizing; and maps
 * objectives INTO the primary/secondary/bonus slots BY KIND so the existing computeTier fires (D-039, no engine change).
 */
export function seedFromHotspotTrack(hotspot: HotSpot, track: HotSpotTrack): MissionSeed {
    const nameOf = (id: string | null): string => (id ? hotspot.tracks.find((t) => t.id === id)?.name ?? 'Next operation' : 'Contract closes');
    // A nextTrackId:null fork ENDS the tree (the contract auto-completes at intensity) — don't mint a child for it
    // (else generating that childless branch would fall to the random Forge). Only linked forks become children.
    const forks: SeedFork[] = (track.forks ?? []).filter((f) => f.nextTrackId).map((f) => ({
        name: nameOf(f.nextTrackId),
        outcomeGate: f.outcomeGate,
        trigger: f.trigger,
        consequence: f.consequence,
        threat: f.threat,
        nextSeedId: f.nextTrackId ? hotspotSeedId(hotspot.id, f.nextTrackId) : undefined,
    }));
    // Map by KIND into the three canonical resolve slots (first objective of each kind; falls back to order).
    const byKind = (k: ObjectiveKind): string => (track.objectives ?? []).find((o, i) => objectiveKind(o, i) === k)?.text ?? '';
    const objs = track.objectives ?? [];
    return {
        seedId: hotspotSeedId(hotspot.id, track.id),
        family: familyFor(track.templateId),
        title: track.name,
        eraFit: [], factionFit: [],
        register: 'hotspot',
        threatRange: [],
        situation: track.situation,
        objectives: { primary: byKind('primary') || objs[0]?.text || '', secondary: byKind('secondary') || objs[1]?.text || '', bonus: byKind('bonus') || objs[2]?.text || '' },
        complications: [],
        decisionPoints: [],
        reactionTimeline: { entries: [], hardDeadline: '' },
        opforSketch: {
            composition: `${track.opfor.faction ?? hotspot.contract.enemyFaction} ${track.opfor.armsMix === 'COMBINED_ARMS' ? 'combined-arms' : "'Mech"} force`,
            behavior: track.situation,
        },
        forks,
        storyElementSeed: '',
        voiceSlots: [],
        armsMix: track.opfor.armsMix,
        vehicleShare: track.opfor.vehicleShare,
        bvRatio: track.opfor.bvRatio ?? 1.0,
        opforFaction: track.opfor.faction, // D-124 — per-track OpFor faction override (else the contract enemy)
    };
}

/** D-124 — map a hotspot's free-text `type` onto a ChaosContractType id (label + missionType; bvRatio rides the
 *  track). Pure; moved here from the contracts tab by DIRECTIVE-HARDEN-2 (used by the negotiate + accept paths). */
export function hotspotTypeId(h: HotSpot): string {
    const t = (h.type || '').toLowerCase();
    const pick = /raid/.test(t) ? 'raid' : /invasion|assault/.test(t) ? 'invasion' : /pirate/.test(t) ? 'pirate-hunt'
        : /duel|trial|recon|expedition/.test(t) ? 'expedition' : /retainer|cadre/.test(t) ? 'retainer' : 'garrison';
    return CHAOS_CONTRACT_TYPES.some((x) => x.id === pick) ? pick : CHAOS_CONTRACT_TYPES[0].id;
}

/** The authored render payload for a track (GM + player brief). Literal — no slot-fill. `templateRules` (the DR
 *  template's STANDARD special rules) is layered in by the caller (bindTrackForge) from track-setup.ts. */
export function hotspotBriefFor(hotspot: HotSpot, track: HotSpotTrack): HotSpotBrief {
    return {
        id: hotspot.id, title: hotspot.title, world: hotspot.world, employer: hotspot.employer, employerDesc: hotspot.employerDesc, type: hotspot.type,
        systemProfile: hotspot.systemProfile, situation: hotspot.situation,
        trackName: track.name, trackTemplate: track.templateId, trackSituation: track.situation, deployment: track.deployment,
        playerRole: track.playerRole, // D-137 — per-track role rides onto spec.forge.hotspot for the two-sided resolve
        objectives: (track.objectives ?? []).map((o, i) => ({ text: o.text, vp: o.vp, kind: objectiveKind(o, i), side: o.side })),
        specialRules: track.specialRules, trackEnd: track.trackEnd, salvagePolicy: track.salvagePolicy,
        contractVictory: hotspot.missionBrief.contractVictory, tally: hotspot.missionBrief.tally, behindScenes: hotspot.missionBrief.behindScenes,
        complications: hotspot.missionBrief.complications ?? [], namedCharacters: hotspot.missionBrief.namedCharacters, purchaseOptions: hotspot.missionBrief.purchaseOptions,
        hireable: hotspot.hireable, // IMPORT-3 P2 — carry the for-hire personnel onto the brief (deploy area + player-safe)
        constraints: hotspot.contract.constraints, additionalRequirements: hotspot.contract.additionalRequirements, bonus: hotspot.contract.bonus,
        ...(hotspot.singleSided && !hotspot.sides ? { singleSided: true } : {}), // IMPORT-6 Part B — one-column resolve for a single-sided custom (key absent otherwise; authored `sides` win, as in resolveSides)
        ...(hotspot.contract?.scale ? { authoredScale: hotspot.contract.scale } : {}), // IMPORT-7 Part D — the Track Scale the content was authored at (provenance)
    };
}

@Injectable({ providedIn: 'root' })
export class HotSpotsCatalogService {
    private readonly state = inject(NewCampaignState);
    private readonly premade = signal<CatalogHotSpot[]>([]);
    private loading?: Promise<CatalogHotSpot[]>;

    constructor() { void this.ensureLoaded(); } // eager (tiny) so seedById can resolve after a reload

    /** Aggregate EVERY pack (manifest), stamping each hotspot's era/region (override ?? pack _meta). Idempotent. */
    async ensureLoaded(): Promise<CatalogHotSpot[]> {
        if (this.premade().length) return this.premade();
        if (!this.loading) {
            this.loading = Promise.all(PACK_LOADERS.map((load) => load().catch(() => null))).then((mods) => {
                const out: CatalogHotSpot[] = [];
                for (const m of mods) {
                    const pack = (m as { default?: unknown } | null)?.default as HotSpotPack | undefined;
                    if (!pack || !Array.isArray(pack.hotspots)) continue;
                    const era = pack._meta?.era ?? 'general';
                    const region = pack._meta?.region ?? null;
                    for (const h of pack.hotspots) out.push({ ...h, era: h.era ?? era, region: h.region ?? region });
                }
                this.premade.set(out);
                return out;
            }).catch(() => { this.premade.set([]); return [] as CatalogHotSpot[]; });
        }
        return this.loading;
    }

    /** Premade packs + the campaign's custom hotspots + its FORGED hotspots (HSFORGE-1 — the third
     *  source; design §2). All three resolvable + pickable, era/region-resolved. Forged entries carry
     *  their exact chamber era + authored sides by the emit contract, so they filter like pack content
     *  (NO custom stamp — the era bypass / guest gate / homebrew semantics are custom-only). */
    private all(): CatalogHotSpot[] {
        const custom = (this.state.customHotSpots() ?? []).map((h) => backfillSingleSided({ ...h, era: h.era ?? 'general', region: h.region ?? null, custom: true } as CatalogHotSpot));
        const forged = (this.state.forgedHotSpots() ?? []).map((h) => ({ ...h, era: h.era ?? 'general', region: h.region ?? null } as CatalogHotSpot));
        return [...this.premade(), ...custom, ...forged];
    }

    /** The catalog filtered to the campaign's era + region (region null on a pack = general, offered anywhere in-era;
     *  a null query region shows all in-era). Reactive over the premade + custom signals.
     *  IMPORT-2 Part A — a user's OWN `custom:true` hot spots ALWAYS list for them, regardless of era/region: the
     *  builder stamps no era (defaults to 'general'), so an era filter would silently hide the GM's own creation. */
    hotSpotCatalog(era?: string | null, region?: string | null): CatalogHotSpot[] {
        void this.ensureLoaded();
        return this.all().filter((h) => inChamber(h, era, region)); // ERA-1 — the predicate is pure + spec-pinned (hotspots-catalog.spec)
    }
    hotSpotById(id: string): CatalogHotSpot | undefined { return this.all().find((h) => h.id === id); }

    /** Resolve a 'preset-<hotspotId>-<trackId>' seed id → the authored MissionSeed (with forks). Sync over the cache. */
    seedForSeedId(seedId: string): MissionSeed | undefined {
        const found = this.trackBySeedId(seedId);
        return found ? seedFromHotspotTrack(found.hotspot, found.track) : undefined;
    }
    /** Resolve a seed id → the authored render payload (for bindTrackForge → forge.hotspot). */
    briefForSeedId(seedId: string): HotSpotBrief | undefined {
        const found = this.trackBySeedId(seedId);
        return found ? hotspotBriefFor(found.hotspot, found.track) : undefined;
    }
    /** The root track's seed id for a hotspot (the root:true track, else the first). */
    rootSeedId(hotspot: HotSpot): string {
        const root = hotspot.tracks.find((t) => t.root) ?? hotspot.tracks[0];
        return hotspotSeedId(hotspot.id, root.id);
    }

    /** D-129 — the authored DR template id for a 'preset-<hotspotId>-<trackId>' seed id (the flow node's track-type
     *  label). undefined for a non-preset / unknown id (Traditional fork seeds never resolve here). */
    templateForSeedId(seedId: string | undefined): string | undefined {
        return seedId ? this.trackBySeedId(seedId)?.track.templateId : undefined;
    }

    private trackBySeedId(seedId: string): { hotspot: HotSpot; track: HotSpotTrack } | undefined {
        for (const hs of this.all()) for (const t of hs.tracks) if (hotspotSeedId(hs.id, t.id) === seedId) return { hotspot: hs, track: t };
        return undefined;
    }
}
