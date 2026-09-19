import { deployedSet } from '../force/deployed';
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ForceGeneratorService, type OpForArmsOpts } from '../force/force-generator.service';
import { buildMissionSpec, MISSION_TUNABLES, type MissionForge, type MissionSpec, type MissionTravel } from './mission-spec';
import { ForgePackService } from './forge-pack.service';
import type { MissionSeed } from './forge-types';
import { selectSeed, eraTag, factionTags, deriveThreat, rollSpecifics, npcFlagsIn, assignNpc, mintVoice, campaignRegister, fillSlots, fillSlotsDeep, type SlotContext, MISSION_FORGE_TUNABLES } from './forge-select';
import { trackArchetypeFor, standardRulesForTemplate } from '../chaos/track-setup';
import { generateTheater, generateComms, type WorldContext } from './theater';
import { StarSystemsService } from '../star/star-systems.service';
import { pickLocalizedSystem, districtForSettlement, type LocaleFit, type LocalizeResult } from './mission-locale';
import { ERA_3025_BASELINE, type StarSystem } from '../star/star-types';
import type { ContractOffer } from '../contract/contract-market';
import { rollComplications } from '../chaos/chaos-complications';
import { HotSpotsCatalogService } from '../chaos/hotspots-catalog';
import { MulAllowlistService } from '../chaos/mul-allowlist.service';
import { hiredWithYouRows } from '../chaos/hire-personnel';
import { coherentTerrain } from '../chaos/track-terrain';
import { DataService } from '../../services/data.service';

interface ForgeSelection { seed: MissionSeed | null; disabled: boolean; tags: string[]; year: number; }

const D096_CONTINUITY = {
    antagDefault: `{NPC:opfor-commander} commands the other side of this one too — the same officer you faced at {PRIOR_WORLD}. They have your measure now, and you have theirs.`,
    antagClan: `{NPC:opfor-commander} stands against you again — the same warrior from {PRIOR_WORLD}. The Trial did not end there; it only paused.`,
    intelDefault: `{NPC:intel-source} is your eyes on this one too — the same contact who called {PRIOR_WORLD}. Trust the picture as far as it earned there.`,
    intelClan: `{NPC:intel-source} reports again — the same source that read {PRIOR_WORLD}. The Watch does not forget; weigh it as such.`,
} as const;

@Injectable({ providedIn: 'root' })
export class MissionGeneratorService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly forceGen = inject(ForceGeneratorService);
    private readonly pack = inject(ForgePackService);
    private readonly star = inject(StarSystemsService);
    private readonly hotspots = inject(HotSpotsCatalogService);
    private readonly mulAllow = inject(MulAllowlistService);
    private readonly data = inject(DataService);
    private lastBvTarget = 0;
    private lastOpforFaction = '';
    private lastLocalize: { world: string; owner: string; regionRole: string; tier: number; friendlyFallback: boolean; target: string; employer: string; offensive: boolean; missionType: string; terrain: string[]; relaxLevel: number } | null = null;

    constructor() {
        // unit-type composition + BV so a headless render can prove the arms-mix (0 vehicles vs vehicles present).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d076')) {
            (window as unknown as Record<string, unknown>)['__d076readOpFor'] = (): unknown => {
                const s = this.state.missionSpec();
                if (!s) return null;
                const vehicles = s.opforForce.filter((u) => u.unitType === 'vehicle').length;
                const names = s.opforForce.map((u) => `${u.chassis} ${u.model}`.trim());
                const A = this.state.npcAssignments(); const nm = (flag: string): string | null => { const npc = A[flag] ? this.pack.npcById(A[flag]) : null; return npc?.name ?? null; };
                return { units: s.opforForce.length, vehicles, mechs: s.opforForce.length - vehicles, opforBv: s.opforBv, playerBv: s.playerBv, seedId: s.forge?.seedId ?? '', names, lastOpFor: this.forceGen.lastOpFor, travel: s.travel ?? null, operationDays: s.operationDays ?? null, systemId: s.forge?.systemId ?? null, currentDate: this.state.currentDate() ?? null, opforCommander: nm('opfor-commander'), intelSource: nm('intel-source'), continuityLead: s.forge?.continuityLead ?? null };
            };
            (window as unknown as Record<string, unknown>)['__d099clock'] = (): unknown => ({ currentDate: this.state.currentDate() ?? null, treasury: this.state.treasury() ?? null });
            // first so `forced` doesn't win): a preferred seedId is returned when era-plausible + present, else the
            // family pool. + read the LOCKED fork children's nextSeedId wiring (advancing child links, recovery child doesn't).
            (window as unknown as Record<string, unknown>)['__d097select'] = async (preferredId: string | null, family?: string): Promise<unknown> => {
                const ac = this.state.offerFor(); if (!ac) return null;
                const sel = await this.selectForgeSeed(ac, family ?? ac.missionType, 'HIGH', preferredId);
                return { selected: sel.seed?.seedId ?? null, family: sel.seed?.family ?? null };
            };
            (window as unknown as Record<string, unknown>)['__d097tree'] = (): unknown => (this.state.missionTree() ?? []).filter((b) => b.state === 'LOCKED').map((b) => ({ name: b.name, gate: b.outcomeGate, family: b.seedFamilyHint ?? null, nextSeedId: b.nextSeedId ?? null }));
        }
        // read a faction's allow-list, draw a GATED OpFor for any faction (incl. Raven/RotS not in the current pack),
        // draw the UNGATED pool for contrast, and inspect the resident slice + a unit's techBase — so a headless
        // render proves "the faction MUL list is the ONLY source; off-list never appears" for OpFor + spot-checks.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d127')) {
            const pvOf = (u: unknown): number | null => (u as { pv?: number } | undefined)?.pv ?? null;
            const draw = (faction: string, bvTarget: number, gated: boolean): unknown => {
                const s = gated ? this.mulAllow.idsFor(faction) : null;
                const inst = this.forceGen.generateOpFor(faction, bvTarget, 0.5, s ? { allowIds: s, noFallback: true } : undefined);
                return inst.map((i) => { const u = this.data.getUnits().find((x) => x.id === i.mulId); return { mulId: i.mulId, chassis: i.chassis, model: i.model, bv: i.bv, pv: pvOf(u), techBase: u?.techBase ?? null, onList: s ? s.has(i.mulId) : null }; });
            };
            (window as unknown as Record<string, unknown>)['__d127'] = {
                load: (): Promise<void> => this.mulAllow.ensure(), // await the allow-list fetch before asserting
                system: (): unknown => this.state.campaignSystem(),
                isIlClan: (): unknown => this.mulAllow.isIlClan(),
                allow: (faction: string): unknown => { const s = this.mulAllow.idsFor(faction); return s ? [...s] : null; },
                sliceMekIds: (): unknown => this.data.getUnits().filter((u) => u.type === 'Mek').map((u) => u.id),
                info: (id: number): unknown => { const u = this.data.getUnits().find((x) => x.id === id); return u ? { id: u.id, chassis: u.chassis, model: u.model, techBase: u.techBase, type: u.type, bv: u.bv, pv: pvOf(u) } : null; },
                opforFor: (faction: string, bvTarget = 6000): unknown => draw(faction, bvTarget, true),
                opforUngated: (faction: string, bvTarget = 6000): unknown => draw(faction, bvTarget, false),
                opforFactionUsed: (): unknown => this.lastOpforFaction,
            };
        }
        // the ledger length so a headless render can prove the drift (win→higher, loss→lower) + persistence.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d077')) {
            (window as unknown as Record<string, unknown>)['__d077state'] = (): unknown => {
                const ac = this.state.offerFor();
                const prior = ac ? [...this.state.outcomeLedger()].reverse().find((r) => r.threadTag === ac.id) : null;
                return { level: this.state.escalationLevelFor(ac?.id), campaign: this.state.escalationCampaign(), ledger: this.state.outcomeLedger().length, priorTier: prior?.tier ?? null, priorWorld: prior?.world ?? null, bvTarget: Math.round(this.lastBvTarget) };
            };
        }
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d085')) {
            (window as unknown as Record<string, unknown>)['__d085localize'] = (): unknown => this.lastLocalize;
        }
        // localized world's owner — proves A2 (employer cast matches employer) + the Bonus (territory-correct world).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d102')) {
            const ENEMY_FLAGS = new Set(['opfor-commander', 'recurring-villain']);
            (window as unknown as Record<string, unknown>)['__d102cast'] = (): unknown => {
                const ac = this.state.offerFor();
                const spec = this.state.missionSpec();
                const npcs = this.pack.npcs(); const vc = this.pack.voices();
                const cast = Object.entries(this.state.npcAssignments()).map(([flag, id]) => { const n = npcs.find((x) => x.npcId === id); return { flag, side: ENEMY_FLAGS.has(flag) ? 'enemy' : 'employer', name: n?.name, affinity: n?.factionAffinity ?? [] }; });
                const voiceCast = Object.entries(this.state.staffVoices()).map(([role, id]) => { const v = vc.find((x) => x.voiceId === id); return { role, factionFit: v?.factionFit ?? [] }; });
                const world = spec?.forge?.slots?.WORLD ?? null;
                const eraId = this.state.era()?.id ?? ERA_3025_BASELINE;
                const sys = world ? this.star.systems().find((s) => s.name === world) : undefined;
                return { employer: ac?.employer?.name ?? null, target: ac?.target ?? null, quickMission: this.state.quickMission(), cast, voiceCast, world, worldOwner: sys ? this.star.ownerAt(sys, eraId) : null };
            };
        }
    }

    private playerBv(): number {
        // brought companies arrive Deployed from the mint; whatever the GM chose to field counts too) — never the
        // parked starter company the wizard forced at creation. Non-GM campaigns: the fieldable roster, byte-identical.
        const force = this.state.startingForce() ?? [];
        const pool = this.state.gmSession() ? deployedSet(force, this.state.quickMission()) : force.filter((u) => u.condition !== 'In repair');
        return pool.reduce((a, b) => a + (b.bv ?? 0), 0);
    }

    /** Generate (or REROLL) the mission spec from the active contract → store in place. Returns true
     *  on success; no-op without an ACTIVE contract. OpFor is GM-facing (ROLE-002 player/GM split is
     *  deferred to the roles/engine slice — the OpFor list is not yet hidden from a player view). */
    async generate(opts?: { familyHint?: string; branchLead?: string; originSystemId?: string | null; nextSeedId?: string | null; presetSeed?: MissionSeed; branchId?: string }): Promise<boolean> {
        const ac = this.state.offerFor();
        if (!ac || ac.status !== 'ACTIVE') return false;
        // authored seed (with forks). Await it here (idempotent, tiny) so chaining survives a reload mid-tree.
        if (opts?.nextSeedId?.startsWith('preset-')) await this.hotspots.ensureLoaded();
        const pBv = Math.max(1, this.playerBv());
        // ±20%; campaign keeps the per-type narrative ratio. Both use the tightened 0.20 band (MISSION_TUNABLES).
        // the GM difficulty slider), NOT the campaign per-type ratio / escalation drift. Traditional (centered=false)
        // keeps both exactly as today — byte-identical.
        const centered = this.state.quickMission() || this.state.campaignSystem() === 'hotspots';
        const typeMod = centered ? 1.0 : (MISSION_TUNABLES.perTypeBvRatio[ac.missionType] ?? 1.0);
        // ON TOP of the per-type ratio (unchanged). The drifted target also lifts the threat tier (deriveThreat
        // below reads bvTarget), biasing the seed threatRange pick. Quick Mission + Hot Spots are unaffected (esc = 0).
        // The OpFor still lands in ±bvTolerance around the DRIFTED target.
        const esc = centered ? 0 : this.state.escalationLevelFor(ac.id);
        const eTun = MISSION_TUNABLES.escalation;
        const drift = Math.max(-eTun.bvCap, Math.min(eTun.bvCap, esc * eTun.bvStep));
        // winning streak + an assault ratio can't balloon the OpFor into "2 lances vs 1". Quick Mission (esc 0,
        // typeMod 1.0) is well under the cap, unchanged.
        const baseBvTarget = Math.min(pBv * MISSION_TUNABLES.bvRatioBase * typeMod * (1 + drift), pBv * MISSION_TUNABLES.bvHardCap);
        // GM toggle > seed.armsMix > campaign default). threat derives from the deterministic base target — the
        // OpFor aims for it within ±tolerance so the tier is identical to deriving from the post-hoc opforBv —
        // which BREAKS the old circular dependency (selectSeed needed opforBv; the OpFor now needs the seed).
        // Selection is byte-identical for a forced seed; the selectSeed algorithm itself is unchanged.
        const sel = await this.selectForgeSeed(ac, opts?.familyHint, deriveThreat(baseBvTarget, pBv), opts?.nextSeedId, opts?.presetSeed);
        // is allowed to raise danger past it (Traditional never reads gmDifficulty → ×1, byte-identical). // DECISION
        const gmDiff = this.state.campaignSystem() === 'hotspots' ? (this.state.gmDifficulty() ?? 1) : 1;
        const bvRatio = sel.seed?.bvRatio ?? 1;
        const bvTarget = baseBvTarget * gmDiff * bvRatio;
        this.lastBvTarget = bvTarget;
        // opposingFaction(h,'b') → syntheticOfferFromChaos carried it to ac.target, so ac.target IS the opposing faction.
        // The authored per-track opfor.faction assumes side A, so side B must ignore it and use ac.target. Side A / legacy
        const opforFaction = this.state.contractFor()?.side === 'b' ? ac.target : (sel.seed?.opforFaction ?? ac.target);
        this.lastOpforFaction = opforFaction;
        // fallback, no off-list unit). idsFor() self-gates to HS + ilClan + a mapped faction; null everywhere else
        // (Traditional / other eras / unmapped) → today's behavior, byte-identical. Preload the asset (idempotent).
        let armsOpts = this.resolveOpForArms(sel.seed);
        if (this.state.campaignSystem() === 'hotspots') {
            await this.mulAllow.ensure();
            const allowIds = this.mulAllow.idsFor(opforFaction);
            if (allowIds) armsOpts = { ...(armsOpts ?? {}), allowIds, noFallback: true };
        }
        const opfor = this.forceGen.generateOpFor(opforFaction, bvTarget, MISSION_TUNABLES.bvTolerance, armsOpts);
        const spec = buildMissionSpec(ac, opfor, pBv);
        spec.forge = await this.bindForge(ac, sel, opts?.branchLead, opts?.originSystemId ?? null);
        // (seeded by the seed id + branch/mission id → identical on reload/re-render). Traditional gets none (seed-only).
        if (this.state.campaignSystem() === 'hotspots' && sel.seed && spec.forge) {
            spec.forge.rolledComplications = rollComplications(spec.clauses.command, sel.seed.complications ?? [], (spec.forge.seedId ?? '') + '|' + (opts?.branchId ?? spec.missionId));
            //   + slot-filled complications, template id) so the PLAYER briefing renders the book track layout from
            //   the record alone (DATA-003). Additive, HS-only, forward-only; Traditional never enters this block.
            this.bindTrackForge(sel.seed, spec);
            // words (an authored "Reading the Jungle" on a Tundra roll). Title outranks body; a hot spot's system profile counts.
            // Deterministic override of the already-rolled value (no RNG consumed); Traditional never enters this block.
            const hb = spec.forge.hotspot;
            spec.terrain = coherentTerrain([
                hb?.trackName ?? spec.forge.opName ?? sel.seed.title, hb?.trackSituation ?? sel.seed.situation, hb?.deployment,
                spec.forge.trackSheet?.deployment, hb?.situation, hb?.systemProfile?.climate, hb?.systemProfile?.description,
            ], spec.terrain);
        }
        // appended travel/insertion timer from the unit's current system to the localized target world ({WORLD}).
        spec.operationDays = sel.seed?.operationDays ?? spec.window.engagementDays;
        spec.travel = this.estimateTravel(this.state.currentLocation(), spec.forge?.systemId, spec.operationDays);
        // (owner/settlement/region/era) where one was chosen, else the generated texture.
        spec.theater = generateTheater(spec.terrain.biome, spec.terrain.note, campaignRegister(this.state.force(), this.state.faction()), this.worldContext(spec.forge?.systemId));
        spec.comms = generateComms(spec.window.deployByDays, spec.window.engagementDays);
        // per-track release) ride the new spec so the player brief names them. HS-only by construction (hiredMercs is written
        // only by the HS deploy hire panel; empty in Traditional → key absent, byte-identical).
        const fielded = hiredWithYouRows(this.state.hiredMercs(), this.state.startingForce(), this.state.pilots());
        if (fielded.length && spec.forge) spec.forge.hiredWithYou = fielded;
        this.state.setMissionSpec(spec);
        void this.store.persistCurrent();
        return true;
    }

    /** A slot-fill context assembled from the already-bound forge (mirrors mission-package's `ctx`). */
    private slotContext(forge: MissionForge): SlotContext {
        const npcNames: Record<string, string> = {};
        const assigns = this.state.npcAssignments();
        for (const flag of forge.npcFlags ?? []) { const npc = this.pack.npcById(assigns[flag]); if (npc) npcNames[flag] = npc.name; }
        for (const flag of ['opfor-commander', 'intel-source']) { if (!npcNames[flag] && assigns[flag]) { const npc = this.pack.npcById(assigns[flag]); if (npc) npcNames[flag] = npc.name; } }
        return {
            EMPLOYER: forge.slots.EMPLOYER, TARGET_FACTION: forge.slots.TARGET_FACTION, WORLD: forge.slots.WORLD,
            DISTRICT: forge.slots.DISTRICT, YEAR: forge.slots.YEAR, FORCE_SIZE: forge.slots.FORCE_SIZE,
            PRIOR_TIER: forge.slots.PRIOR_TIER, PRIOR_WORLD: forge.slots.PRIOR_WORLD,
            specifics: forge.rolledSpecifics ?? {}, npcNames,
        };
    }
    /** The first ~2 sentences of a lead paragraph (mirrors mission-package.fragSituation, so the player blurb matches). */
    private fragLead(text: string): string {
        const t = (text ?? '').trim();
        if (!t) return t;
        const sentences = t.match(/[^.!?]+[.!?]+(?:["'’”)\]]+)?\s*/g);
        let brief = sentences && sentences.length > 2 ? sentences.slice(0, 2).join('').trim() : t;
        if (brief.length > 460) brief = brief.slice(0, 460).replace(/\s+\S*$/, '').trim() + '…';
        return brief;
    }
    /** Slot-fill the seed title / situation lead / merged complications and stamp them (+ the template id) on the forge. */
    private bindTrackForge(seed: MissionSeed, spec: MissionSpec): void {
        const forge = spec.forge;
        if (!forge) return;
        const ctx = this.slotContext(forge);
        forge.opName = fillSlots(seed.title ?? '', ctx).replace(/^OPERATION\s+/i, '').trim() || undefined;
        const paras = [
            ...(forge.continuityLead ? [fillSlots(forge.continuityLead, ctx)] : []),
            ...(forge.branchLead ? [fillSlots(forge.branchLead, ctx)] : []),
            ...fillSlots(seed.situation ?? '', ctx).split(/\n{2,}|(?<=\.)\s{2,}/).map((p) => p.trim()).filter((p) => p.length > 40),
        ];
        forge.situationLead = this.fragLead(paras[0] ?? '') || undefined;
        const comps = [...(seed.complications ?? []), ...(forge.rolledComplications ?? [])]
            .map((x) => fillSlotsDeep(x, ctx))
            .map((x) => ({ name: x.name, text: x.text, effect: x.mechanicalEffect }));
        forge.trackComplications = comps.length ? comps : undefined;
        forge.trackTemplate = trackArchetypeFor(spec.type).templateKey;
        // the GM/player track sheets render the picked template's setup/track-end/salvage instead of the contract type's.
        if (seed.seedId.startsWith('preset-tpl-')) forge.trackTemplate = seed.seedId.slice('preset-tpl-'.length);
        // GM deploy brief AND the player tablet render the ONE authored brief; its presence suppresses the Forge
        // FRAGORD/WARNORD. Also override opName/template/objectiveVp with the authored literals (no slot-fill).
        const brief = this.hotspots.briefForSeedId(seed.seedId);
        // stamp it onto the record (resolve modal + track sheets read it) + the by-kind objectiveVp. NEVER a fake brief.
        if (!brief && seed.trackObjectives?.length) {
            forge.trackObjectives = seed.trackObjectives.map((o) => ({ text: o.text, vp: o.vp, kind: o.kind, ...(o.side ? { side: o.side } : {}) }));
            const vpOf = (k: 'primary' | 'secondary' | 'bonus'): number | undefined => forge.trackObjectives?.find((o) => o.kind === k)?.vp;
            forge.objectiveVp = { primary: vpOf('primary'), secondary: vpOf('secondary'), bonus: vpOf('bonus') };
        }
        if (!brief && seed.trackSheet && Object.keys(seed.trackSheet).length) forge.trackSheet = { ...seed.trackSheet };
        if (brief) {
            const std = standardRulesForTemplate(brief.trackTemplate);
            brief.templateRules = std.length ? std.join(' ') : undefined;
            // package + player brief can render authored scale-dependent requirements as provenance + the live value.
            const signed = this.state.contractFor()?.scale;
            if (signed) brief.signedScale = signed;
            forge.hotspot = brief;
            forge.opName = brief.trackName;
            forge.trackTemplate = brief.trackTemplate;
            // objectiveVp by KIND (primary/secondary/bonus) from the mapped objectives.
            const vpOf = (k: 'primary' | 'secondary' | 'bonus'): number | undefined => brief.objectives.find((o) => o.kind === k)?.vp;
            forge.objectiveVp = { primary: vpOf('primary'), secondary: vpOf('secondary'), bonus: vpOf('bonus') };
        }
    }

    private static readonly TRAVEL = { jumpLy: 30, daysPerJump: 8, insertionDays: 5 } as const;

    private estimateTravel(fromId: string | null, toId: string | undefined | null, operationDays: number): MissionTravel {
        const T = MissionGeneratorService.TRAVEL;
        const op = Math.max(0, Math.round(operationDays || 0));
        const a = fromId ? this.star.byId(fromId) : null;
        const b = toId ? this.star.byId(toId) : null;
        if (!a || !b || a.id === b.id) {
            return { jumps: 0, jumpTransitDays: 0, insertionDays: 0, operationDays: op, totalDays: op, hasTravel: false, fromSystem: a?.name ?? null, toSystem: b?.name ?? null, ly: 0 };
        }
        const ly = Math.hypot(b.x - a.x, b.y - a.y);
        const jumps = Math.max(1, Math.ceil(ly / T.jumpLy));
        const jumpTransitDays = jumps * T.daysPerJump;
        return { jumps, jumpTransitDays, insertionDays: T.insertionDays, operationDays: op, totalDays: jumpTransitDays + T.insertionDays + op, hasTravel: true, fromSystem: a.name, toSystem: b.name, ly: Math.round(ly) };
    }

    private async selectForgeSeed(ac: ContractOffer, familyHint: string | undefined, threat: string, preferredSeedId?: string | null, presetSeed?: MissionSeed): Promise<ForgeSelection> {
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
        const tags = [...factionTags(ac.employer.name, ac.target), ...(this.state.force() === 'MERC' ? ['merc'] : [])];
        // sizes to the contract + honors seed.armsMix via the unchanged downstream (bindForge/generateOpFor).
        if (presetSeed) return { seed: presetSeed, disabled: false, tags, year };
        // the catalog (with its forks) rather than the random pool; selectSeed only searches pack.seeds() and would miss
        // it. This is the child-generation counterpart of the presetSeed short-circuit (which handles the picked root).
        if (preferredSeedId?.startsWith('preset-')) {
            const s = this.pack.seedById(preferredSeedId);
            if (s) return { seed: s, disabled: false, tags, year };
        }
        let disabled = false;
        let forced: string | null = null;
        try { disabled = localStorage.getItem('bce.forge.disable') === '1'; forced = localStorage.getItem('bce.forge.seed'); } catch { /* no storage */ }
        if (disabled) return { seed: null, disabled: true, tags, year };
        await this.pack.ensureLoaded();
        let seed = selectSeed(this.pack.seeds(), familyHint ?? ac.missionType, eraTag(year), tags, threat, Math.random, forced, preferredSeedId);
        seed = this.stampSeedArmsMixSmoke(seed);
        return { seed, disabled: false, tags, year };
    }

    private stampSeedArmsMixSmoke(seed: MissionSeed | null): MissionSeed | null {
        if (!seed) return seed;
        try {
            const a = localStorage.getItem('bce.forge.seedArmsMix');
            if (a !== 'MECH_ONLY' && a !== 'COMBINED_ARMS') return seed;
            const vs = localStorage.getItem('bce.forge.seedVehicleShare');
            return { ...seed, armsMix: a, vehicleShare: vs ? +vs : seed.vehicleShare };
        } catch { return seed; }
    }

    private resolveOpForArms(seed: MissionSeed | null): OpForArmsOpts | undefined {
        if (this.state.quickMission()) return undefined;
        const gm = this.state.missionArmsMixOverride();
        if (gm === 'mechs') return { armsMix: 'mechs' };
        if (gm === 'combined') return { armsMix: 'combined', vehicleShare: seed?.vehicleShare };
        if (seed?.armsMix === 'MECH_ONLY') return { armsMix: 'mechs' };
        if (seed?.armsMix === 'COMBINED_ARMS') return { armsMix: 'combined', vehicleShare: seed.vehicleShare };
        return undefined;
    }

    private async bindForge(ac: ContractOffer, sel: ForgeSelection, branchLead?: string, originSystemId: string | null = null): Promise<MissionForge> {
        const year = sel.year;
        const size = this.state.unitSize();
        const pick = <X>(arr: readonly X[]): X => arr[Math.floor(Math.random() * arr.length)];
        const slots: MissionForge['slots'] = {
            EMPLOYER: ac.employer.name,
            TARGET_FACTION: ac.target,
            WORLD: pick(MISSION_FORGE_TUNABLES.worlds),
            DISTRICT: pick(MISSION_FORGE_TUNABLES.districts),
            YEAR: String(year),
            FORCE_SIZE: size ? `a ${size.name.toLowerCase()} (${size.count} ’Mechs)` : 'one company',
        };
        // degrades when there is no prior (first op of a thread → slots stay absent → fillSlots renders empty).
        const prior = [...this.state.outcomeLedger()].reverse().find((r) => r.threadTag === (this.state.offerFor()?.id ?? ''));
        if (prior) { slots.PRIOR_TIER = prior.tier; if (prior.world) slots.PRIOR_WORLD = prior.world; }

        const generic: MissionForge = { seedId: '', register: '', generic: true, rolledSpecifics: {}, slots, npcFlags: [], branchLead };

        if (sel.disabled) return generic;
        await this.star.ensureLoaded();
        const seed = sel.seed;
        // A tree child localizes near its PARENT's system; the opener near currentLocation. No map → keep the
        // random pool (slots already hold it) = today's behavior. Applies to BOTH the seed + generic paths.
        // Quick Mission is ephemeral with no campaign location → keep the random pool (today's behavior, unaffected).
        const offensive = /RAID|ASSAULT|GUERRILLA/i.test(ac.missionType);
        // signed contract's hotspotId names it, and that world is the operation's — the mission panel, the flow, the brief and the
        // AAR ("engaged on …") all read {WORLD}. Before this the slot was ROLLED from the current location like a Forge contract, so
        // a Twycross contract fought "on Bryant". The star-map system is joined by id when the pack carries one, else by name; a
        // world the map does not know keeps the authored name with no district/travel (honest, never a substitute).
        const hs = this.hotspotWorld();
        const localized = this.state.quickMission() || hs ? null : this.localizeWorld(originSystemId ?? this.state.currentLocation(), ac.target, ac.employer.name, this.state.era()?.id ?? ERA_3025_BASELINE, (seed?.localeFit as LocaleFit | undefined) ?? null, offensive);
        let systemId: string | undefined;
        if (hs) {
            slots.WORLD = hs.world;
            const sys = (hs.systemId ? this.star.systems().find((s) => s.id === hs.systemId) : undefined) ?? this.star.systems().find((s) => s.name === hs.world);
            if (sys) { systemId = sys.id; slots.DISTRICT = districtForSettlement(sys.localeAttrs.settlement); }
        } else if (localized) {
            slots.WORLD = localized.system.name; slots.DISTRICT = districtForSettlement(localized.system.localeAttrs.settlement); systemId = localized.system.id;
            this.lastLocalize = { world: localized.system.name, owner: this.star.ownerAt(localized.system, this.state.era()?.id ?? ERA_3025_BASELINE), regionRole: localized.system.localeAttrs.regionRole, tier: localized.tier, friendlyFallback: localized.friendlyFallback, target: ac.target, employer: ac.employer.name, offensive, missionType: ac.missionType, terrain: localized.system.localeAttrs.terrain ?? [], relaxLevel: localized.relaxLevel };
        } else {
            // {WORLD} with a TERRITORY-correct world (the target's own space, else a non-employer frontier) so a
            // DCMS-target op never lands on "Solaris 7". Keeps the marquee pick only when the map is empty.
            const tw = this.territoryWorld(ac.target, ac.employer.name, this.state.era()?.id ?? ERA_3025_BASELINE);
            if (tw) slots.WORLD = tw;
        }
        if (!seed) {
            console.info(`[forge] no seed for ${ac.missionType} → generic template fallback${systemId ? ` @ ${slots.WORLD}` : ''}`);
            return { ...generic, systemId };
        }

        const flags = npcFlagsIn(seed);
        const npcA = { ...this.state.npcAssignments() };
        // stored assignments stand (a flag may go uncast when its whole pool is taken — honest absence).
        // is a merc); ENEMY-side flags from the TARGET. The old merged employer∪target bag let a Davion "First
        // Prince" voice land on a Capellan contract (Davion was the *target*); side-scoping pins each cast to its
        // faction, and the neutral-before-ANY fallback (forge-select) stops the wrong-faction lexicon leak.
        const employerTags = [...factionTags(ac.employer.name), ...(this.state.force() === 'MERC' ? ['merc'] : [])];
        const targetTags = factionTags(ac.target);
        const ENEMY_FLAGS = new Set(['opfor-commander', 'recurring-villain']);
        const cast = new Set(Object.values(npcA));
        const draw = (flag: string): void => {
            const id = assignNpc(this.pack.npcs().filter((n) => !cast.has(n.npcId)), flag, ENEMY_FLAGS.has(flag) ? targetTags : employerTags, eraTag(year));
            if (id) { npcA[flag] = id; cast.add(id); }
        };
        for (const f of flags) if (!npcA[f]) draw(f);
        if (!npcA['opfor-commander']) draw('opfor-commander');
        // STANDING intel contact return across this thread's missions, but a DIFFERENT contract gets a different pair.
        // npcAssignments is global, so first CLEAR any carried-over assignment for these two flags, then bind per
        // thread: recur the thread's last id (the ledger `prior`, :215) when present, else draw FRESH for a thread's
        // first op (the draw excludes `cast`, so a new thread's pick differs from the prior thread's). Validity-checked
        // → an id gone from the pack falls to fresh (migration-safe). Quick Mission (no thread/contract) is untouched.
        // The removal hook (kill/capture/burn) is OUT OF SCOPE — the clean seam is `prior?.x`: drop the id to retire it.
        let opforRecurred = false, intelRecurred = false;
        if (!this.state.quickMission()) {
            for (const flag of ['opfor-commander', 'intel-source']) if (npcA[flag]) delete npcA[flag]; // drop the carried-over global; cast still excludes the old id
            const bind = (flag: string, priorId: string | undefined): boolean => {
                if (priorId && this.pack.npcById(priorId)) { npcA[flag] = priorId; cast.add(priorId); return true; } // same thread → recur
                draw(flag); // new thread → fresh (and ≠ the prior thread's, which is still in `cast`)
                return false;
            };
            opforRecurred = bind('opfor-commander', prior?.opforCommanderNpcId);
            intelRecurred = bind('intel-source', prior?.intelSourceNpcId);
        }
        this.state.setNpcAssignments(npcA);

        // never mints rolled staff voices. Reachable under ODM only via the legacy generateBranch fallback;
        // the forks no longer READ staffVoices either, so the field is inert under a pack (no migration).
        if (!this.state.packId()) {
            const sv = { ...this.state.staffVoices() };
            for (const rf of seed.voiceSlots) if (!sv[rf]) { const id = mintVoice(this.pack.voices(), rf, employerTags); if (id) sv[rf] = id; }
            this.state.setStaffVoices(sv);
        }

        // Intel line first (context), antagonist second (threat); undefined on a thread's first op (neither recurred).
        const clan = this.state.force() === 'CLAN';
        // Forge slot, never a hot spot's authored world (bindTrackForge stamps forge.hotspot after this and never touches the
        // slots). Under a hotspot-backed contract the thread IS that one hot spot (threadTag = the contract id), so name the
        // hot spot's own world and bake it in; if it can't be derived, SUPPRESS the callback rather than name the wrong
        // planet. HS-only by construction (hotspotId is only ever stamped by the HS sign path) — no new mode-branch read.
        const hsId = this.state.contractFor()?.hotspotId;
        const hsWorld = hsId ? this.hotspots.hotSpotById(hsId)?.world : undefined;
        const composed = hsId && !hsWorld ? undefined : [
            intelRecurred ? (clan ? D096_CONTINUITY.intelClan : D096_CONTINUITY.intelDefault) : null,
            opforRecurred ? (clan ? D096_CONTINUITY.antagClan : D096_CONTINUITY.antagDefault) : null,
        ].filter(Boolean).join(' ') || undefined;
        const continuityLead = composed && hsWorld ? composed.replace(/\{PRIOR_WORLD\}/g, hsWorld) : composed;

        console.info(`[forge] seed ${seed.seedId} (${seed.family}/${seed.register}) → ${flags.length} NPC flags, ${seed.voiceSlots.length} voice slots${systemId ? ` @ ${slots.WORLD} (${this.star.ownerAt(this.star.byId(systemId), this.state.era()?.id ?? ERA_3025_BASELINE)})` : ''}`);
        return { seedId: seed.seedId, register: seed.register, rolledSpecifics: rollSpecifics(seed), slots, npcFlags: flags, branchLead, continuityLead, systemId };
    }

    /** R0-2 — the world a PREMADE hot spot contract is authored on (null for a Forge / negotiated / Traditional contract). */
    private hotspotWorld(): { world: string; systemId?: string } | null {
        const c = this.state.contractFor();
        const h = c?.hotspotId ? this.hotspots.hotSpotById(c.hotspotId) : undefined;
        return h?.world ? { world: h.world, systemId: h.systemId } : null;
    }
    private localizeWorld(originId: string | null | undefined, target: string, employer: string, eraId: number, localeFit: LocaleFit | null, offensive: boolean): LocalizeResult | null {
        const origin = this.star.byId(originId);
        if (!origin) return null;
        let friendly: LocalizeResult | null = null;
        for (const jumpLy of [30, 45, 60, 90]) {
            const cands = [origin, ...this.star.systemsInRange(origin.id, jumpLy)];
            const r = pickLocalizedSystem(cands, { eraId, targetFaction: target, employer, ownerAt: (s, e) => this.star.ownerAt(s, e), localeFit, rng: Math.random });
            if (r && !r.friendlyFallback) return r; // a close enemy world / conflict frontier — the right place to hit
            if (r && !friendly) friendly = r;        // remember the friendly backyard as the last resort
        }
        // the nearest target-owned/contested world before settling for home. Defensive ops keep the local friendly.
        if (offensive) {
            const reach = this.reachEnemyWorld(origin, target, employer, eraId, localeFit);
            if (reach) return reach;
        }
        return friendly; // genuine last resort — friendly soil (flagged friendlyFallback)
    }

    private reachEnemyWorld(origin: StarSystem, target: string, employer: string, eraId: number, localeFit: LocaleFit | null): LocalizeResult | null {
        for (const jumpLy of [150, 300, 500, 800]) { // a deep raid reaches a bordering / near enemy realm
            const cands = this.star.systemsInRange(origin.id, jumpLy).filter((s) => {
                const o = this.star.ownerAt(s, eraId);
                const r = s.localeAttrs.regionRole;
                return o === target || ((r === 'border' || r === 'contested') && o !== employer);
            });
            const r = pickLocalizedSystem(cands, { eraId, targetFaction: target, employer, ownerAt: (s, e) => this.star.ownerAt(s, e), localeFit, rng: Math.random });
            if (r && !r.friendlyFallback) return r;
        }
        return null;
    }

    private worldContext(systemId?: string): WorldContext | undefined {
        const sys = this.star.byId(systemId);
        if (!sys) return undefined;
        const eraId = this.state.era()?.id ?? ERA_3025_BASELINE;
        return { name: sys.name, owner: this.star.ownerAt(sys, eraId), settlement: sys.localeAttrs.settlement, regionRole: sys.localeAttrs.regionRole, eraName: this.state.era()?.name ?? '', terrain: sys.localeAttrs.terrain };
    }

    private territoryWorld(target: string, employer: string, eraId: number): string | null {
        const sys = this.star.systems();
        if (!sys.length) return null;
        const owned = sys.filter((s) => this.star.ownerAt(s, eraId) === target);
        const pool = owned.length ? owned : sys.filter((s) => {
            const r = s.localeAttrs.regionRole;
            return (r === 'border' || r === 'contested') && this.star.ownerAt(s, eraId) !== employer;
        });
        return pool.length ? pool[Math.floor(Math.random() * pool.length)].name : null;
    }

    /** Drop the active mission (e.g. on contract completion). Caller persists. */
    clear(): void {
        this.state.setMissionSpec(null);
    }
}
