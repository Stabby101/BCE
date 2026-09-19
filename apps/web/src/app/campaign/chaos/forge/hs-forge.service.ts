/*
 * BCE — HSFORGE-1: the Hot Spots Forge orchestrator (design §6). Deterministic: one seedKey → one
 * byte-identical HotSpot (rng substreams only; no Date.now/Math.random in the pipeline). The output
 * is an AUTHORED-SHAPE HotSpot appended to state.forgedHotSpots — from there the ENTIRE existing
 * chain (offer board → Brief → negotiate → pick-a-side → tracks → two-sided resolve) runs with ZERO
 * downstream special cases (the Phase 0 governing rule). Slot-fill is BAKED here (C11): downstream
 * hotspot content is literal.
 *
 * Phase 1 surface = the dev seam only (localStorage['bce.test.hsforge'] → window.__hsforge);
 * offer-board top-up mixing is Phase 2 (ruling D10).
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../../new-campaign-state';
import { CampaignSaveStore } from '../../campaign-save-store';
import { StarSystemsService } from '../../star/star-systems.service';
import { ForgePackService } from '../../mission/forge-pack.service';
import { HotSpotsCatalogService, factionHiresMercenaries, type CatalogHotSpot, type HotSpot, type HotSpotNamedCharacter } from '../hotspots-catalog'; // ERA-1 — factionHiresMercenaries
import { MulAllowlistService, hsFactionToMulFaction } from '../mul-allowlist.service';
import { DataService } from '../../../services/data.service';
import { resolveMekbayEraId } from '../../faction/faction-select';
import { ERAS } from '../../era/eras';
import { selectSeed, factionTags, assignNpc, npcFlagsIn, rollSpecifics, fillSlotsDeep, type SlotContext } from '../../mission/forge-select';
import { districtForSettlement } from '../../mission/mission-locale';
import type { MissionTypeId } from '../../contract/contract-terms';
import { ensureForgeData, type ForgeRegion, type HsForgeCorpus } from './hs-forge-data';
import { campaignEraTag, pickWorld, profileFor, worldCandidates, ERA_YEARS, type EraCtx } from './hs-forge-worlds';
import { pickConflictPair, type PairCtx } from './hs-forge-pair';
import { buildTracks, chaosTypeFor, charFit, stripFamilyJargon } from './hs-forge-tracks';
import { buildContractTerms, buildMissionBrief, buildSides, buildSynopsis, buildTitle, collapseArticles, dressBlurb, dressSide, employerProseName, factionDisplay, rivalDisplay, sentenceCase, typeStringFor } from './hs-forge-dressing';
import { chamberTagSet, validateForged } from './hs-forge-validate';
import { hexId, pick, pickWeighted, rngFor } from './hs-forge-rng';

const MAX_ATTEMPTS = 8;
/** P2 (ruling D10) — the deal-time TOP-UP floor: when the era/region chamber (non-capstone) holds fewer
 *  than this, the forge fills it before the deal (floor > the 5-card hand keeps the reroll alive). */
export const HSFORGE_TOPUP_FLOOR = 8;
/** P2 — pruning keeps referenced records PLUS the most recent N others. // DECISION: a CAP, not the
 *  design §2 minimal keep-set — antagonist CONTINUITY reads prior forged hotspots' cast, so pruning to
 *  only-referenced would erase the recurrence history the feature depends on. 24 bounds growth (~level
 *  with the authored pack) while keeping several deals of theater memory. */
const PRUNE_KEEP_RECENT = 24;
/** WORLD-LOCAL pair adjacency (wave refinement): opponents are preferred from factions holding ≥1
 *  system within this radius of the chosen world. ~3 jumps — wide enough that border worlds always
 *  see the neighbor state, narrow enough to kill far-border matchups (FS-vs-Taurian on Kentares). */
const LOCAL_PAIR_RADIUS_LY = 90;
/** Chamber era tag → the representative wizard era id (the D6 breadth map; age-of-war/early-SW are
 *  listed but honestly UNSUPPORTED — no era-plausible donor content; generation fails loud). */
const TAG_WIZARD_ERA: Record<string, number> = {
    'age-of-war': 1, 'star-league': 2, 'early-succession-wars': 3, 'late-succession-wars': 5,
    'clan-invasion': 6, 'civil-war': 7, jihad: 8, 'dark-age': 11, ilclan: 12,
};
const UNSUPPORTED_MARK = 'no era-plausible donor families';
/** Ruling D6 — HARD-GATED tags: the ±1 adjacency draw would technically serve these (age-of-war
 *  borrows star-league donors, early-SW borrows both neighbors), but the ruling marks them honestly
 *  unsupported until a seed wave gives them their OWN content. Un-gate = delete the tag here. */
const UNSUPPORTED_TAGS = new Set(['age-of-war', 'early-succession-wars']);
const ALL_FAMILIES: MissionTypeId[] = ['OBJECTIVE_RAID', 'GARRISON_DUTY', 'PLANETARY_ASSAULT', 'RECON_RAID', 'EXTRACTION_RAID', 'RELIEF_DUTY', 'SECURITY_DUTY', 'DIVERSIONARY_RAID', 'PIRATE_HUNTING', 'GUERRILLA_WARFARE', 'CADRE_DUTY', 'RIOT_DUTY'];
const FAMILIES_BY_RULE: Record<string, MissionTypeId[]> = {
    'pirates-attacker': ['GARRISON_DUTY', 'SECURITY_DUTY', 'PIRATE_HUNTING', 'RIOT_DUTY'],
    'clan-internal': ['CADRE_DUTY', 'SECURITY_DUTY', 'RECON_RAID'],
};

@Injectable({ providedIn: 'root' })
export class HsForgeService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly star = inject(StarSystemsService);
    private readonly pack = inject(ForgePackService);
    private readonly catalog = inject(HotSpotsCatalogService);
    private readonly mulAllow = inject(MulAllowlistService);
    private readonly data = inject(DataService);

    constructor() { this.installDevSeam(); }

    /** Generate one forged HotSpot for the campaign's era (+ an optional region id; + an optional era-tag
     *  OVERRIDE — the P2 breadth surface, used by the dev seam/harness to sweep all 9 chamber tags without
     *  booting 9 campaigns). Deterministic per seedKey. Does NOT persist — see forgeIntoCampaign. Throws
     *  (fail-loud) when no attempt passes the emit gate; an UNSUPPORTED era (no era-plausible donor
     *  content — age-of-war/early-SW per ruling D6) fails FAST with the honest reason. */
    async generateHotSpot(seedKey: string, regionId?: string | null, eraTagOverride?: string | null): Promise<CatalogHotSpot> {
        const [corpus] = await Promise.all([ensureForgeData(), this.star.ensureLoaded(), this.pack.ensureLoaded(), this.mulAllow.ensure(), this.catalog.ensureLoaded()]);
        this.preflight(corpus);
        const era = eraTagOverride ? this.eraCtxForTag(eraTagOverride) : this.eraCtx();
        if (UNSUPPORTED_TAGS.has(era.chamberTag)) {
            throw new Error(`hs-forge: era '${era.chamberTag}' is unsupported — it has no era-plausible donor content of its own (ruling D6: age-of-war/early-succession-wars await a seed wave; the ±1 adjacency draw stays reserved for supported eras)`);
        }
        const region = regionId ? (corpus.regions.regions.find((r) => r.id === regionId) ?? null) : null;
        if (regionId && !region) throw new Error(`hs-forge: unknown region '${regionId}'`);

        let lastErrors: string[] = [];
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const rng = rngFor(seedKey, `a${attempt}`);
            const built = this.buildOnce(seedKey, attempt, era, region, corpus, rng);
            if (!built.errors.length) return built.hotspot as CatalogHotSpot;
            lastErrors = built.errors;
            // Donor-content absence is state-shaped, not rng-shaped — rerolling can't fix an empty era.
            if (attempt === 0 && lastErrors.some((e) => e.includes(UNSUPPORTED_MARK))) {
                throw new Error(`hs-forge: era '${era.chamberTag}' is unsupported — no era-plausible donor content (ruling D6: age-of-war/early-succession-wars await a seed wave)`);
            }
        }
        throw new Error(`hs-forge: no valid hotspot after ${MAX_ATTEMPTS} attempts for '${seedKey}' — last: ${lastErrors.join(' · ')}`);
    }

    /** Generate + append to the campaign's forgedHotSpots + persist (the injection seam — design §2). */
    async forgeIntoCampaign(seedKey: string, regionId?: string | null): Promise<CatalogHotSpot> {
        const h = await this.generateHotSpot(seedKey, regionId);
        this.state.addForgedHotSpot(h);
        this.store.persistCurrent();
        return h;
    }

    /** P2 (ruling D10) — the deal-time TOP-UP: when the campaign's era/region chamber (non-capstone)
     *  holds fewer than `floor` hotspots, forge the difference into forgedHotSpots (deterministic
     *  state-derived seedKeys → reload-stable; the records persist, so a reload never re-forges).
     *  Runs the cap-prune first (the deal boundary is the safe point — the hand is empty, no active
     *  contract). Failures are per-key and non-fatal (an unsupported era tops up 0 and the board
     *  honestly stays as-is); in-flight-guarded (the tab's effect can fire repeatedly). */
    topUpChamber(floor: number = HSFORGE_TOPUP_FLOOR): Promise<number> {
        if (this.topUpInFlight) return this.topUpInFlight;
        this.topUpInFlight = this.doTopUp(floor).finally(() => { this.topUpInFlight = null; });
        return this.topUpInFlight;
    }
    private topUpInFlight: Promise<number> | null = null;
    private async doTopUp(floor: number): Promise<number> {
        await Promise.all([ensureForgeData(), this.star.ensureLoaded(), this.pack.ensureLoaded(), this.mulAllow.ensure(), this.catalog.ensureLoaded()]);
        this.pruneForged();
        const era = this.eraCtx();
        const region = this.state.hsRegion();
        const poolCount = (): number => this.catalog.hotSpotCatalog(era.chamberTag, region).filter((h) => !h.capstone).length;
        let minted = 0;
        let warned = false;
        for (let guard = 0; guard < floor * 2 && poolCount() < floor; guard++) {
            // Key collision note (P2 review): pruning can shrink `n`, so an (n,guard) pair may repeat and
            // regenerate an id that still lives — the emit validator's existingIds gate is the DELIBERATE
            // backstop (a collision fails attempt 0 and the reroll mints a '-N'-suffixed id). A persisted
            // mint counter would cost another snapshot field for a case the gate already absorbs.
            const n = (this.state.forgedHotSpots() ?? []).length;
            const seedKey = `topup|${era.chamberTag}|${region ?? 'all'}|${n}|${guard}`;
            try {
                const h = await this.generateHotSpot(seedKey, region);
                this.state.addForgedHotSpot(h);
                minted++;
            } catch (e) {
                if (!warned) { console.warn('[hs-forge] top-up:', e instanceof Error ? e.message : e); warned = true; }
                // State-shaped failures can't be rerolled — burn no further attempts on them
                // (an unsupported era never fills; a stale persisted region id never resolves).
                if (e instanceof Error && (e.message.includes('unsupported') || e.message.includes('unknown region'))) break;
            }
        }
        if (minted) this.store.persistCurrent();
        return minted;
    }

    /** Prune forged hotspots at the deal boundary. Keep-set = every REFERENCED id (the active contract's
     *  hotspotId + its offerSnapshot + the live dealt hand) PLUS the most recent PRUNE_KEEP_RECENT others
     *  (// DECISION vs the design §2 minimal keep-set: antagonist continuity reads prior forged casts —
     *  a minimal prune would erase the theater's memory; the cap bounds growth instead). */
    pruneForged(): number {
        const keep = new Set<string>(this.state.hotSpotOffer() ?? []);
        const c = this.state.activeChaosContract();
        if (c?.hotspotId) keep.add(c.hotspotId);
        for (const id of c?.offerSnapshot ?? []) keep.add(id);
        const before = this.state.forgedHotSpots() ?? [];
        const others = before.filter((h) => !keep.has(h.id));
        const recent = new Set(others.slice(-PRUNE_KEEP_RECENT).map((h) => h.id));
        const kept = before.filter((h) => keep.has(h.id) || recent.has(h.id));
        if (kept.length !== before.length) { this.state.setForgedHotSpots(kept); this.store.persistCurrent(); }
        return before.length - kept.length;
    }

    // ── the pipeline (design §6 steps 1–9) ──
    private buildOnce(seedKey: string, attempt: number, era: EraCtx, region: ForgeRegion | null, corpus: HsForgeCorpus, rng: () => number): { hotspot: HotSpot; errors: string[] } {
        const factionOk = (n: string): boolean => !!this.data.getFactionByName?.(n) || hsFactionToMulFaction(n) != null;
        const mulOk = (n: string): boolean => !this.mulAllow.isIlClan() || this.state.campaignSystem() !== 'hotspots' || hsFactionToMulFaction(n) != null;

        // 1. WORLD (C16 — by systemId; owner must be a viable defender)
        const candidates = worldCandidates(this.star.systems(), region, era, (s, e) => this.star.ownerAt(s, e), factionOk);
        const world = pickWorld(candidates, era, (s, e) => this.star.ownerAt(s, e), districtForSettlement, rng);
        if (!world) return { hotspot: {} as HotSpot, errors: [region ? `no candidate worlds in region '${region.id}' at era ${era.wizardEraId}` : 'no candidate worlds at era'] };

        const localFactions = new Set(this.star.systemsInRange(world.system.id, LOCAL_PAIR_RADIUS_LY)
            .map((s) => this.star.ownerAt(s, era.wizardEraId)).filter((o): o is string => !!o));
        const pairCtx: PairCtx = { era, adjacency: this.star.factionAdjacency(era.wizardEraId), factionOk, mulOk, isClanFaction: (n) => /clan/i.test(n), localFactions, hiresMercs: factionHiresMercenaries, rng }; // ERA-1 — Clans don't hire
        const pair = pickConflictPair(world.owner, corpus.employers.archetypes, pairCtx);
        if (!pair) return { hotspot: {} as HotSpot, errors: [`no legal conflict pair for owner '${world.owner}'`] };

        // 3+4. DONOR SEED + TRACKS (D6 ±1-era adjacency rides the selectSeed era floor)
        const threat = pickWeighted(['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const, (t) => (t === 'LOW' || t === 'EXTREME' ? 1 : 3), rng);
        const familyPool = FAMILIES_BY_RULE[pair.archetype.combatFactionRule] ?? ALL_FAMILIES;
        const tags = factionTags(pair.a.employerFaction, pair.b.employerFaction);
        const probe = rngFor(seedKey, `probe${attempt}`);
        const eligibleFamilies = familyPool.filter((f) => selectSeed(this.pack.seeds(), f, era.chamberTag, tags, threat, probe) != null);
        if (!eligibleFamilies.length) {
            // P2 review: only the FULL family set going empty is ERA-shaped (→ the fast-fail/unsupported
            // path); an empty archetype-RESTRICTED pool is pair-shaped — reroll like any attempt failure.
            const eraShaped = familyPool === ALL_FAMILIES;
            return { hotspot: {} as HotSpot, errors: [eraShaped ? `${UNSUPPORTED_MARK} for '${era.chamberTag}'` : `no era-plausible donors in the '${pair.archetype.id}' archetype's family pool`] };
        }
        const family = pick(eligibleFamilies, rng);
        const donor = selectSeed(this.pack.seeds(), family, era.chamberTag, tags, threat, rng);
        if (!donor) return { hotspot: {} as HotSpot, errors: [`donor selection failed for family '${family}'`] };

        // 5. ROOT TEMPLATE + ROLES first (the dressing postures + the chaos type both need side A's role)
        const rootProbe = buildTracks({ donor, library: corpus.objectives, explainers: corpus.dressing.explainers, settlement: world.system.localeAttrs.settlement, depth: 1, scale: 1, sideBFaction: pair.b.faction, armsMix: donor.armsMix ?? 'COMBINED_ARMS', vehicleShare: donor.vehicleShare, baseBvRatio: 1, rng: rngFor(seedKey, `rootprobe${attempt}`) });
        const aRole = rootProbe.rootRole;
        const chaosType = chaosTypeFor(rootProbe.rootKey, rootProbe.rootTemplateId, pair.b.faction);

        // The display fills (the corpus token law): TARGET_* = the OPPOSING faction's singular display
        // forms (sameFaction → the rival override); EMPLOYER_NAME = side A's prose-safe org.
        const pirateRaid = pair.archetype.combatFactionRule === 'pirates-attacker';
        const mercBoth = pair.archetype.combatFactionRule === 'merc-both';
        const targetDisplay = pair.sameFaction ? rivalDisplay(pair.archetype.combatFactionRule) : factionDisplay(pair.b.faction);
        const sharedOrgPool = pair.archetype.orgPools['Mercenary'] ?? pair.archetype.orgPools['generic'] ?? [];
        const sharedOrg = mercBoth ? (sharedOrgPool.length ? pick(sharedOrgPool, rng) : 'the rival command') : undefined;
        const baseFills: Record<string, string> = { OWNER: world.owner, TARGET_FACTION: targetDisplay.attr, TARGET_FACTION_THE: targetDisplay.the };
        const dressA = dressSide({ archetype: pair.archetype, employerFaction: pair.a.employerFaction, role: aRole, pirateSide: pirateRaid ? 'defender' : undefined, sharedOrg, fills: baseFills, rng });
        const employerName = employerProseName(mercBoth ? (sharedOrg as string) : dressA.org, pair.archetype.id);
        const fills = { ...baseFills, EMPLOYER_NAME: employerName };
        // Side B's TARGET is SIDE A (the corpus law: the OPPOSING side's faction, per side) — never its own.
        const targetDisplayB = pair.sameFaction ? rivalDisplay(pair.archetype.combatFactionRule) : factionDisplay(pair.a.faction);
        const fillsB = { ...fills, TARGET_FACTION: targetDisplayB.attr, TARGET_FACTION_THE: targetDisplayB.the };
        const dressB = dressSide({ archetype: pair.archetype, employerFaction: pair.b.employerFaction, role: aRole === 'attacker' ? 'defender' : 'attacker', pirateSide: pirateRaid ? 'raider' : undefined, sharedOrg, excludeOrg: dressA.org, fills: fillsB, rng });

        // CONTRACT TERMS (C5/C6 co-constraint: intensity == main-path depth, within the mapped type's range)
        const terms = buildContractTerms(chaosType, threat, pair.b.faction, pair.a.faction, rng);
        const baseBvRatio = threat === 'LOW' ? 0.8 : threat === 'MEDIUM' ? 0.95 : threat === 'HIGH' ? 1.05 : 1.2;
        const { tracks, rootTemplateId, rootRole } = buildTracks({
            donor, library: corpus.objectives, explainers: corpus.dressing.explainers,
            settlement: world.system.localeAttrs.settlement, depth: terms.intensity, scale: terms.scale,
            sideBFaction: pair.b.faction, armsMix: donor.armsMix ?? 'COMBINED_ARMS', vehicleShare: donor.vehicleShare, baseBvRatio, rng,
        });

        // 6. DRESSING (title/synopsis/type string/brief/antagonists)
        // generation window. Window = the prune cap's recent set (the same bound that keeps the
        // theater's memory); deterministic GIVEN state, like the antagonist-continuity reads.
        const recentTitles = new Set((this.state.forgedHotSpots() ?? []).slice(-PRUNE_KEEP_RECENT).map((h) => h.title).filter((t): t is string => !!t));
        const title = buildTitle(corpus.synopsis, rng, recentTitles);
        const typeString = typeStringFor(chaosType, rootTemplateId === 'Duel' ? 'Duel' : (tracks.find((t) => t.root)?.templateId ?? rootTemplateId));
        const synopsis = buildSynopsis(corpus.synopsis, world.system.localeAttrs.settlement, world.system.localeAttrs.regionRole, fills, rng);
        const antagonists = this.castAntagonists(pair.b.employerFaction, mercBoth ? (sharedOrg as string) : dressB.org, pair.a.employerFaction, employerName, region?.id ?? null, era, rng);
        const brief = buildMissionBrief(corpus.dressing, donor.complications ?? [], terms.intensity, terms.scale, fills, antagonists, rng);
        const bothSides = buildSides(pair, rootRole, title, typeString, terms, dressA, dressB);
        // ERA-1 (ruling 2) — a Clan that does not hire mercenaries is never offered as a side to fight FOR: the hot
        // spot ships side A only (`singleSided`), the Clan stays the enemy. An IS/hiring enemy keeps both sides.
        const singleSided = !factionHiresMercenaries(pair.b.faction);
        const sides = singleSided ? { a: bothSides.a } : bothSides;

        // 7. ASSEMBLE + SLOT-FILL BAKE (C11 — one deep fill; downstream renders literal content)
        const npcNames: Record<string, string> = {};
        for (const flag of npcFlagsIn(donor)) {
            const npcId = assignNpc(this.pack.npcs(), flag, tags, era.chamberTag, rng);
            const npc = npcId ? this.pack.npcById(npcId) : undefined;
            if (npc) npcNames[flag] = npc.name;
        }
        // Donor-prose slots (CLEAN-gate fixes): EMPLOYER = the PROSE-SAFE employer name (the headline
        // card string reads broken mid-sentence); TARGET_FACTION = the display noun for the special
        // classes (sameFaction would name the shared faction as its own enemy; bare 'Mercenary'/'Pirates'
        const donorTarget = pair.sameFaction ? rivalDisplay(pair.archetype.combatFactionRule).the
            : /^(pirates?|mercenar)/i.test(pair.b.faction) ? factionDisplay(pair.b.faction).the : pair.b.faction;
        const slots: SlotContext = {
            EMPLOYER: employerName, TARGET_FACTION: donorTarget, WORLD: world.system.name, DISTRICT: world.district,
            YEAR: String(era.year), FORCE_SIZE: terms.scale >= 3 ? 'a battalion' : terms.scale === 2 ? 'a company' : 'a lance',
            specifics: rollSpecifics(donor, rng), npcNames,
        };
        const id = `hs-forged-${hexId(seedKey)}${attempt ? `-${attempt}` : ''}`;
        const draft: HotSpot = {
            id, title, world: world.system.name, employer: sides.a.employer, employerDesc: sides.a.employerDesc, type: typeString,
            blurb: dressBlurb(pair.archetype, aRole, pirateRaid ? 'defender' : undefined, dressA.org, pair.a.employerFaction, fills, rng),
            systemProfile: profileFor(corpus.worldFacts.facts[world.system.id], era, ERA_YEARS),
            situation: synopsis,
            contract: terms.a, missionBrief: brief, tracks, sides,
            ...(singleSided ? { singleSided: true } : {}), // ERA-1 — the flag every consumer already honors (resolveSides / resolve mode)
            era: era.chamberTag, region: region?.id ?? null,
            forged: true, systemId: world.system.id, // C14 internal provenance + C16 id-join (both additive)
        };
        // The donor-bake post-pass (CLEAN round 4 + HOTSPOT-BRIEF v1 pilot fix): cross-article collapse
        // (an article-baked TARGET fill after the donor's own article) + sentence-boundary casing on the
        // baked PROSE fields, PLUS the HOTSPOT-BRIEF v1 char-cap trim for every field that carries
        // UNRESOLVED global tokens pre-bake (WORLD/EMPLOYER/TARGET_FACTION/DISTRICT — donor prose, 43–258
        // of 223 seeds per field): track situation, fork trigger/consequence, complication effects. A
        // pre-bake trim on these is unsound (a token can expand 40+ ch after fillSlotsDeep) — the cap can
        // only be enforced HERE, after the bake. (blurb/employerDesc/side.situation/contractVictory/
        // behindScenes are forge-corpus text whose LOCAL tokens are already resolved at dress time —
        // dressSide/buildSynopsis/buildMissionBrief — so they carry no residual global tokens and were
        // already budget-shaped at generation; no re-trim needed here.)
        const baked = fillSlotsDeep(draft, slots);
        const tidyProse = (s: string): string => sentenceCase(collapseArticles(stripFamilyJargon(s)));
        const tidyFit = (s: string, cap: number): string => charFit(tidyProse(s), cap);
        const hotspot: HotSpot = {
            ...baked,
            situation: tidyProse(baked.situation),
            ...(baked.blurb ? { blurb: tidyProse(baked.blurb) } : {}),
            tracks: baked.tracks.map((t) => ({
                ...t,
                situation: tidyFit(t.situation, 1100),
                forks: t.forks.map((f) => ({ ...f, trigger: tidyFit(f.trigger, 160), consequence: tidyFit(f.consequence, 240) })),
            })),
            missionBrief: {
                ...baked.missionBrief,
                complications: baked.missionBrief.complications.map((c) => ({ ...c, effect: tidyFit(c.effect, 360) })),
                ...(baked.missionBrief.behindScenes ? { behindScenes: tidyProse(baked.missionBrief.behindScenes) } : {}),
            },
        };

        // 8. VALIDATE (the emit gate — §8.1)
        const errors = validateForged(hotspot, {
            existingIds: new Set(this.catalog.hotSpotCatalog(null, null).map((h) => h.id)),
            chamberTags: chamberTagSet(),
            factionOk, mulOk,
            sameFactionAllowed: pair.sameFaction,
            expectedDepth: terms.intensity,
            canonWorlds: new Map(this.star.systems().map((s) => [s.name.toLowerCase(), s.name])),
        });
        return { hotspot, errors };
    }

    private castAntagonists(oppFaction: string, oppOrg: string, ownFaction: string, ownOrg: string, regionId: string | null, era: EraCtx, rng: () => number): HotSpotNamedCharacter[] {
        const out: HotSpotNamedCharacter[] = [];
        const cmdId = this.recurringCommander(oppFaction, regionId)
            ?? assignNpc(this.pack.npcs(), 'opfor-commander', factionTags(oppFaction), era.chamberTag, rng);
        const cmd = cmdId ? this.pack.npcById(cmdId) : undefined;
        if (cmd) out.push({ name: cmd.name, role: `Opposing commander — ${oppOrg}`, skill: pick(['4/5', '3/4', '4/4'], rng), npcId: cmd.npcId });
        const conId = assignNpc(this.pack.npcs(), 'employer-contact', factionTags(ownFaction), era.chamberTag, rng);
        const con = conId ? this.pack.npcById(conId) : undefined;
        if (con && con.name !== cmd?.name) out.push({ name: con.name, role: `Employer contact — ${ownOrg}`, npcId: con.npcId });
        return out;
    }

    private recurringCommander(oppFaction: string, regionId: string | null): string | null {
        const ledger = this.state.outcomeLedger() ?? [];
        const priors = (this.state.forgedHotSpots() ?? []).filter((h) => (h.region ?? null) === regionId);
        const commanderOf = (h: { missionBrief?: { namedCharacters?: { npcId?: string; role: string }[] } }): string | undefined =>
            (h.missionBrief?.namedCharacters ?? []).find((c) => c.npcId && c.role.startsWith('Opposing commander'))?.npcId;
        const beatenRecord = (hsId: string): boolean => ledger.some((r) => r.contractId?.endsWith(hsId) && r.tier === 'FULL_SUCCESS');
        const beatenNpcs = new Set<string>([
            ...priors.filter((h) => beatenRecord(h.id)).map(commanderOf).filter((id): id is string => !!id),
            ...ledger.filter((r) => r.tier === 'FULL_SUCCESS' && r.opforCommanderNpcId).map((r) => r.opforCommanderNpcId as string),
        ]);
        for (let i = priors.length - 1; i >= 0; i--) {
            const npcId = commanderOf(priors[i]);
            if (!npcId || beatenNpcs.has(npcId)) continue;
            const npc = this.pack.npcById(npcId);
            if (npc && this.affinityFits(npc.factionAffinity, oppFaction)) return npc.npcId;
        }
        return null;
    }

    /** assignNpc-parity affinity fit (kept in lockstep with forge-select's pool rule): a direct
     *  faction-tag intersect, a NEUTRAL record (merc/periphery affinity — castable for anyone), the
     *  'periphery/pirate' composite split, or the generic 'clan' tag against any clan-* affinity. */
    private affinityFits(affinity: readonly string[], oppFaction: string): boolean {
        const nrm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const tags = factionTags(oppFaction).flatMap((t) => (t === 'periphery/pirate' ? ['periphery', 'pirate', t] : [t])).map(nrm);
        const aff = affinity.map(nrm);
        if (aff.some((a) => a === 'merc' || a === 'periphery')) return true; // neutral — assignNpc's own fallback class
        if (aff.some((a) => tags.includes(a))) return true;
        if (tags.includes('clan') && aff.some((a) => a.startsWith('clan'))) return true;
        return false;
    }

    /** P2 breadth — an EraCtx for an explicit chamber tag (the 9-tag vocabulary), independent of the
     *  campaign's own era. Used by the dev seam/harness sweep; top-up always uses the campaign era. */
    private eraCtxForTag(tag: string): EraCtx {
        const wizardEraId = TAG_WIZARD_ERA[tag];
        if (!wizardEraId) throw new Error(`hs-forge: unknown era tag '${tag}' (expected one of ${Object.keys(TAG_WIZARD_ERA).join('|')})`);
        const card = ERAS.find((e) => e.id === wizardEraId);
        const year = ERA_YEARS[String(wizardEraId)] ?? card?.from ?? 3025;
        return { wizardEraId, mekbayEraId: resolveMekbayEraId(card, this.data.getEras()), year, chamberTag: tag };
    }

    private eraCtx(): EraCtx {
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3151;
        return {
            wizardEraId: this.state.era()?.id ?? 12,
            mekbayEraId: resolveMekbayEraId(this.state.era(), this.data.getEras()),
            year,
            chamberTag: campaignEraTag(year),
        };
    }

    /** Fail-loud preflight: name exactly which data is missing instead of degrading silently. */
    private preflight(corpus: HsForgeCorpus): void {
        const missing: string[] = [];
        if (!Object.keys(corpus.objectives.templates).length) missing.push('hsforge-objectives.json');
        if (!corpus.employers.archetypes.length) missing.push('hsforge-employers.json');
        if (!corpus.synopsis.openers.length) missing.push('hsforge-synopsis.json');
        if (!Object.keys(corpus.dressing.explainers).length) missing.push('hsforge-track-dressing.json');
        if (!this.star.systems().length) missing.push('star/systems.json');
        if (!this.pack.seeds().length) missing.push('forge-data seed packs');
        if (missing.length) throw new Error(`hs-forge: missing data — ${missing.join(', ')}`);
    }

    /** OPT-IN dev seam (localStorage['bce.test.hsforge']) — the Phase 1 surface + the harness driver. */
    private installDevSeam(): void {
        if (typeof window === 'undefined' || typeof localStorage === 'undefined' || !localStorage.getItem('bce.test.hsforge')) return;
        (window as unknown as Record<string, unknown>)['__hsforge'] = {
            generate: (seedKey: string, regionId?: string | null, eraTag?: string | null): Promise<CatalogHotSpot> => this.generateHotSpot(seedKey, regionId, eraTag),
            forge: (seedKey: string, regionId?: string | null): Promise<CatalogHotSpot> => this.forgeIntoCampaign(seedKey, regionId),
            topUp: (floor?: number): Promise<number> => this.topUpChamber(floor),
            prune: (): number => this.pruneForged(),
            list: (): { id: string; title: string; era?: string; region?: string | null; oppFaction?: string; employerFaction?: string; singleSided?: boolean; commanderNpcId?: string }[] =>
                (this.state.forgedHotSpots() ?? []).map((h) => ({
                    id: h.id, title: h.title, era: h.era, region: h.region,
                    oppFaction: h.sides?.b?.faction ?? h.sides?.a.contract.enemyFaction, // ERA-1 — single-sided: the enemy is side A's authored enemyFaction
                    employerFaction: h.sides?.a.faction, singleSided: !!h.singleSided,
                    commanderNpcId: (h.missionBrief?.namedCharacters ?? []).find((c) => c.role.startsWith('Opposing commander'))?.npcId,
                })),
            count: (): number => (this.state.forgedHotSpots() ?? []).length,
            region: (): string | null => this.state.hsRegion(),
        };
    }
}
