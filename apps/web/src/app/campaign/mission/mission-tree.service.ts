/*
 * BCE retool — mission TREE service (DIRECTIVE-026). Orchestrates the branching campaign spine over the
 * D-025 generator: mints a root branch when a contract is accepted, runs GENERATE on an AVAILABLE branch
 * (D-025 mission → ACTIVE), mints the spec's seed forks as LOCKED children, resolves the active branch
 * via the GM tier, evaluates gates (match/ANY → AVAILABLE, siblings → RETIRED), and closes the tree on
 * contract completion. All mutations persist in place (persistCurrent). No prose parsing — forks are data.
 */
import { Injectable, Injector, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from '../chaos/warchest.service'; // D-109 — Hot Spots combat pay at resolution
import { initCampaignPilot } from '../chaos/pilot-card'; // D-125 — earn-side careerSP credit at resolve
import { resolved } from '../chaos/chaos-contract'; // D-110b — chaos contract terms (Salvage %) at resolution
import { HotSpotsCatalogService } from '../chaos/hotspots-catalog'; // D-129 — resolve a pending child's authored track template
import { MissionGeneratorService } from './mission-generator.service';
import { ForgePackService } from './forge-pack.service';
import { CampaignClockService } from '../clock/campaign-clock.service'; // D-099 — lazy-resolved (clock↔tree DI cycle)
import { formatDate } from '../clock/campaign-clock';
import { MISSION_TYPES } from '../contract/contract-terms';
import { computeTier, selectUnlocks, twoSidedResolve, singleSidedResolve, resolveModelFor, type MissionBranch, type BranchState, type OutcomeGate, type ResolveAnswers, type BranchResolution, type OutcomeRecord, type IterationLedger } from './mission-tree';
import { MISSION_TUNABLES, type MissionSpec } from './mission-spec';
import { filledObjectives, fillSlotsDeep, type SlotContext } from './forge-select';
import type { ContractOffer } from '../contract/contract-market';
import type { MissionSeed } from './forge-types';
import { deployedSet } from '../force/deployed';

@Injectable({ providedIn: 'root' })
export class MissionTreeService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService); // D-109
    private readonly missionGen = inject(MissionGeneratorService);
    private readonly pack = inject(ForgePackService);
    private readonly catalog = inject(HotSpotsCatalogService); // D-129 — pending-child track-type resolution
    private readonly injector = inject(Injector); // D-099 — resolve CampaignClockService lazily at AAR time (breaks the clock↔tree cycle)

    private tree(): MissionBranch[] {
        return this.state.missionTree() ?? [];
    }
    private setTree(t: MissionBranch[]): void {
        this.state.setMissionTree(t);
    }
    /** DIRECTIVE-119 — Hot Spots ADVANCE PHASE: mark a RESOLVED branch finalized (additive `resolution.advanced`) so
     *  the flow rail leaves it (→ idle/CONTRACT) and the clock-advance can't double-fire. Immutable replace + persist;
     *  Traditional never calls this (it finalizes via the field walk). */
    markPhaseAdvanced(branchId: string): void {
        const tree = this.state.missionTree() ?? [];
        const next = tree.map((b) => (b.branchId === branchId && b.resolution ? { ...b, resolution: { ...b.resolution, advanced: true } } : b));
        this.setTree(next);
        void this.store.persistCurrent();
    }
    /** DIRECTIVE-121 — apply the Hot Spots field settlement (recorded in place of the C-bill field walk): remove LOST
     *  units + handle their pilots (unassign + Injured/KIA, D-036, dead-stays-dead), claim PRIZE 'Mechs into Cold
     *  Storage (provenance 'captured', reusing the walk's CLAIM_PRIZE shape), and record resolution.losses/prizes.
     *  Reuses the field-walk force/pilot paths — no new engine. HS-only (Traditional uses the full field walk). */
    applyHsSettlement(branchId: string, plan: {
        losses: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[];
        prizes: { instanceId: string; label: string }[];
    }): void {
        const today = this.today() ?? { y: 3025, m: 0, d: 1 };
        const tree = this.state.missionTree() ?? [];
        const opforPool = tree.find((b) => b.branchId === branchId)?.resolution?.engaged?.opfor ?? [];
        let force = this.state.startingForce() ?? [];
        let pilots = this.state.pilots() ?? [];
        // LOSSES — pilot fate (dead stays dead), then remove the 'Mech from the live force.
        for (const loss of plan.losses) {
            pilots = pilots.map((p) => {
                if (p.assignedInstanceId !== loss.instanceId) return p;
                if (p.status === 'KIA') return p; // D-036 reversibility guard
                if (loss.pilotFate === 'kia') return { ...p, status: 'KIA' as const, hits: 6, recoveryDays: undefined, kiaDate: today, assignedInstanceId: undefined };
                if (loss.pilotFate === 'injured') return { ...p, status: 'Injured' as const, hits: Math.max(1, p.hits ?? 2), recoveryDays: p.recoveryDays ?? 14, assignedInstanceId: undefined };
                return { ...p, assignedInstanceId: undefined }; // 'ok' — the pilot walked out; just free the lost 'Mech
            });
        }
        const lostIds = new Set(plan.losses.map((l) => l.instanceId));
        force = force.filter((i) => !lostIds.has(i.instanceId));
        // PRIZES — push the captured OpFor instance into the force (Cold storage, provenance 'captured').
        for (const prize of plan.prizes) {
            const opf = opforPool.find((o) => o.instanceId === prize.instanceId);
            if (!opf) continue;
            force = [...force, { ...opf, lanceId: undefined, isCommander: false, condition: 'Cold storage', provenance: { origin: 'captured' as const, acquiredDate: today } }];
        }
        this.state.setStartingForce(force);
        this.state.setPilots(pilots);
        // Record on the resolution (additive; the AAR renders LOSSES/PRIZES from these).
        this.setTree((this.state.missionTree() ?? []).map((b) => {
            if (b.branchId !== branchId || !b.resolution) return b;
            const settled: BranchResolution = { ...b.resolution, losses: plan.losses, prizes: plan.prizes };
            // D-122 — complete the iteration ledger now that losses/prizes are known (the resolveBranch snapshot had
            // none yet). The Warchest window is unchanged since resolve (settlement posts no SP), so this is idempotent
            // — it only fills in lost/gained/wounds. HS-only; a Traditional resolution never reaches this method.
            if (b.resolution.ledger) settled.ledger = this.buildIterationLedger(settled);
            return { ...b, resolution: settled };
        }));
        void this.store.persistCurrent();
    }

    /** DIRECTIVE-122 — snapshot the per-mission ITERATION LEDGER (Hot Spots-only) from the resolution + the Warchest
     *  ledger. Pure over stored state (DATA-003): the Warchest window is bounded by the per-cycle 'Combat pay:'
     *  settlement marker (exactly one posts every resolve, mission-tree.service:283), the field counts come from the
     *  resolution's engaged/losses/prizes, and the two damage totals from the GM's resolve answers. Runs at resolve
     *  and once more when the D-121 settlement lands — idempotent, the window doesn't move. */
    private buildIterationLedger(r: BranchResolution): IterationLedger {
        const ledger = this.state.warchestLedger() ?? [];
        // The cycle window = the ledger entries after the PREVIOUS mission's combat-pay settlement (this cycle's is the
        // last such entry, just posted). Cycle 1 has no previous → start after the 'Starting Warchest' opener (index 0).
        const combatPayIdxs: number[] = [];
        for (let i = 0; i < ledger.length; i++) if (ledger[i].event.startsWith('Combat pay:')) combatPayIdxs.push(i);
        const prevIdx = combatPayIdxs.length >= 2 ? combatPayIdxs[combatPayIdxs.length - 2] : -1;
        let startIdx = prevIdx >= 0 ? prevIdx + 1 : Math.min(1, ledger.length);
        // The previous cycle's settlement TAIL (its Salvage line + a 'Contract completed' line) posts right after its
        // combat pay — skip it so cycles are contiguous (this cycle's warchestStart == the previous cycle's warchestEnd).
        if (prevIdx >= 0) while (startIdx < ledger.length && (ledger[startIdx].event.startsWith('Salvage') || ledger[startIdx].event.startsWith('Contract completed'))) startIdx++;
        const window = ledger.slice(startIdx);
        const warchestStart = ledger[startIdx - 1]?.balance ?? (this.state.warchestSP() ?? 0);
        const warchestEnd = ledger.length ? ledger[ledger.length - 1].balance : warchestStart;
        const spSpent = window.reduce((s, e) => s + (e.paid > 0 ? e.paid : 0), 0); // debits only — income (combat pay/salvage) excluded
        // D-112 market buys post as 'Purchase — <chassis> <model>' (chaos-market-tab:135), NOT 'Market buy:' as the
        // directive recon named — matched to the real label. // DECISION
        const purchases = window.filter((e) => e.event.startsWith('Purchase')).map((e) => ({ label: e.event, sp: e.paid }));
        const losses = r.losses ?? [];
        const out: IterationLedger = {
            warchestStart, warchestEnd, spSpent,
            deployed: r.engaged?.bluforIds?.length ?? 0,
            gained: (r.prizes?.length ?? 0) + purchases.length,
            lost: losses.length,
            wounds: losses.filter((l) => l.pilotFate === 'injured' || l.pilotFate === 'kia').length,
            purchases,
            dateFrom: r.aar?.advancedFrom ?? (r.resolvedDate ? formatDate(r.resolvedDate) : ''),
            dateTo: r.aar?.advancedTo ?? r.aar?.advancedFrom ?? (r.resolvedDate ? formatDate(r.resolvedDate) : ''),
        };
        if (r.answers?.damageTaken != null) out.damageTaken = r.answers.damageTaken;
        if (r.answers?.damageGiven != null) out.damageGiven = r.answers.damageGiven;
        return out;
    }
    private newId(prefix: string): string {
        return `br-${prefix}-${Math.floor(Math.random() * 1e9)}`;
    }
    private today(): { y: number; m: number; d: number } | undefined {
        return this.state.currentDate() ?? this.state.startDate() ?? undefined;
    }
    activeBranch(): MissionBranch | undefined {
        return this.tree().find((b) => b.state === 'ACTIVE');
    }
    /** DIRECTIVE-IMPORT-5 (Part A) — the first AVAILABLE branch (the one a track can be generated into) for the
     *  active-contract "▶ Play a track" surface; symmetry with activeBranch(). undefined once a track is ACTIVE. */
    firstAvailableBranch(): MissionBranch | undefined {
        return this.tree().find((b) => b.state === 'AVAILABLE');
    }

    /** DIRECTIVE-128 — Hot Spots: has a track been generated/built for the active contract? True once any branch is
     *  ACTIVE or RESOLVED, or a mission spec exists — the point past which Back-to-contracts is closed (you're
     *  committed). Signing mints the root AVAILABLE with no mission → the pristine, backable state returns false. */
    hasGeneratedTrack(): boolean {
        return this.tree().some((b) => b.state === 'ACTIVE' || b.state === 'RESOLVED') || !!this.state.missionSpec();
    }

    /** D-091 — the {SLOT} context from the generating spec, so the board's fork-preview text fills with the
     *  parent op's employer/target/world (the fork IS a consequence of the parent). Mirrors mission-package's ctx. */
    private slotCtxFor(spec: MissionSpec): SlotContext {
        const f = spec.forge;
        const npcNames: Record<string, string> = {};
        const assigns = this.state.npcAssignments();
        for (const flag of f?.npcFlags ?? []) { const npc = this.pack.npcById(assigns[flag]); if (npc) npcNames[flag] = npc.name; }
        return {
            EMPLOYER: f?.slots.EMPLOYER ?? '—', TARGET_FACTION: f?.slots.TARGET_FACTION ?? '—', WORLD: f?.slots.WORLD ?? '—',
            DISTRICT: f?.slots.DISTRICT ?? '—', YEAR: f?.slots.YEAR ?? '—', FORCE_SIZE: f?.slots.FORCE_SIZE ?? '—',
            PRIOR_TIER: f?.slots.PRIOR_TIER, PRIOR_WORLD: f?.slots.PRIOR_WORLD,
            specifics: f?.rolledSpecifics ?? {}, npcNames,
        };
    }

    /** Build the LOCKED lookahead children from a generated spec's seed forks (DATA-003 — forks are data). D-091:
     *  fill {SLOT}s in the fork's name/trigger/consequence so the operations board never shows a raw token. */
    private forkChildren(seed: MissionSeed | undefined, parentBranchId: string, ctx?: SlotContext): MissionBranch[] {
        return (seed?.forks ?? []).map((fRaw) => {
            const f = ctx ? fillSlotsDeep(fRaw, ctx) : fRaw;
            const tt = this.catalog.templateForSeedId(fRaw.nextSeedId); // D-129 — HS preset fork → its authored track template (undefined for Traditional)
            return {
                branchId: this.newId('ch'),
                name: f.name,
                parentBranchId,
                outcomeGate: (f.outcomeGate as OutcomeGate) || 'ANY',
                threat: f.threat || 'MEDIUM',
                state: 'LOCKED' as BranchState,
                seedFamilyHint: (fRaw as { family?: string }).family,
                nextSeedId: fRaw.nextSeedId, // D-097 — carry the authored arc link to GENERATE (soft-preferred there)
                forkContext: { trigger: f.trigger, consequence: f.consequence },
                ...(tt ? { trackType: tt } : {}), // D-129 — only when a preset track resolves (Traditional → omitted, byte-identical)
            };
        });
    }

    /** The opening branch for a contract (shared by accept-mint + pre-D-026 migration). D-124: a premade hotspot seeds
     *  the root with the root-track's preset seed id (via `root`) + its authored name, so the first GENERATE resolves
     *  the authored track (selectForgeSeed's preset short-circuit) and mints its forks. */
    private rootBranch(contract: ContractOffer, root?: { seedId: string; name: string; trackType?: string }): MissionBranch {
        const mt = MISSION_TYPES[contract.missionType as keyof typeof MISSION_TYPES];
        return {
            branchId: this.newId('root'),
            name: root?.name ?? `${mt?.name ?? contract.missionType} — opening operation`,
            parentBranchId: null,
            outcomeGate: 'ANY',
            threat: contract.durationMonths >= 12 ? 'MEDIUM' : 'LOW',
            state: 'AVAILABLE',
            nextSeedId: root?.seedId, // D-124 — arc link to the authored root track (else undefined = the random pool)
            ...(root?.trackType ? { trackType: root.trackType } : {}), // D-129 — the authored root track template (HS only)
        };
    }

    /** Contract accept → a fresh tree with the root opener AVAILABLE (no mission until GENERATE). D-124 `root` seeds a
     *  premade hotspot's opening track; omitted = the Traditional/negotiated random-pool root (byte-identical). */
    mintRoot(contract: ContractOffer, root?: { seedId: string; name: string; trackType?: string }): void {
        this.setTree([this.rootBranch(contract, root)]); // openerCount default 1
        void this.store.persistCurrent();
    }

    /** Migration: a pre-D-026 save with a live contract but no tree gets a root on load. If it was mid-
     *  mission, bind the existing spec to an ACTIVE root + mint its forks (best-effort if the pack is
     *  loaded — graceful degradation otherwise). Returns true if it changed something (caller persists). */
    ensureTree(): boolean {
        if (this.tree().length) return false;
        const ac = this.state.acceptedContract();
        if (!ac || ac.status !== 'ACTIVE') return false;
        const root = this.rootBranch(ac);
        const spec = this.state.missionSpec();
        if (spec) {
            const seed = this.pack.seedById(spec.forge?.seedId);
            root.state = 'ACTIVE';
            root.missionSpecRef = spec.missionId;
            if (seed?.title) root.name = seed.title.replace(/^OPERATION\s+/i, '');
            this.setTree([root, ...this.forkChildren(seed, root.branchId, this.slotCtxFor(spec))]); // D-091
        } else {
            this.setTree([root]);
        }
        return true;
    }

    /** GENERATE on an AVAILABLE branch → ACTIVE + LOCKED children (one ACTIVE at a time). */
    async generateBranch(branchId: string, opts?: { presetSeed?: MissionSeed }): Promise<boolean> {
        const br = this.tree().find((b) => b.branchId === branchId);
        if (!br || br.state !== 'AVAILABLE') return false;
        if (this.tree().some((b) => b.state === 'ACTIVE')) return false;
        this.state.releasePerTrackMercs(); // IMPORT-3 P2 — a new track begins: per-track hired mercs from the prior track leave the field (oneTime stay)
        return this.runGeneration(br, opts?.presetSeed); // D-116 — an optional user track preset
    }

    /** REROLL the active branch's mission + re-mint its children (nothing was resolved). */
    async rerollActive(): Promise<boolean> {
        const br = this.activeBranch();
        if (!br) return false;
        return this.runGeneration(br);
    }

    private async runGeneration(br: MissionBranch, presetSeed?: MissionSeed): Promise<boolean> {
        // D-080: a child branch localizes near its PARENT's system so an arc clusters geographically; the opener
        // (no parent) localizes near currentLocation. currentLocation itself does NOT move here (travel = D-081).
        const parent = br.parentBranchId ? this.tree().find((b) => b.branchId === br.parentBranchId) : null;
        const originSystemId = parent?.systemId ?? this.state.currentLocation() ?? null;
        const ok = await this.missionGen.generate({ familyHint: br.seedFamilyHint, branchLead: br.forkContext?.trigger, originSystemId, nextSeedId: br.nextSeedId, presetSeed, branchId: br.branchId }); // D-116 preset · D-110e branchId (deterministic complication seed)
        if (!ok) return false;
        const spec = this.state.missionSpec();
        if (!spec) return false;
        const seed = this.pack.seedById(spec.forge?.seedId);
        const children = this.forkChildren(seed, br.branchId, this.slotCtxFor(spec)); // D-091: fill the board fork preview
        const opName = seed?.title ? seed.title.replace(/^OPERATION\s+/i, '') : br.name;
        const sysId = spec.forge?.systemId; // D-080 — record where this branch's mission landed; children localize near it
        // D-129 — the authored DR track type for the flow node's label. HS-gated: Traditional also sets
        // spec.forge.trackTemplate (an archetype key), so only stamp it in Hot Spots → Traditional branches stay byte-identical.
        const activeTrackType = this.state.campaignSystem() === 'hotspots' ? spec.forge?.trackTemplate : undefined;
        const next = this.tree()
            .filter((b) => b.parentBranchId !== br.branchId) // drop prior children (reroll re-mint)
            .map((b) => (b.branchId === br.branchId ? { ...b, state: 'ACTIVE' as BranchState, name: opName, missionSpecRef: spec.missionId, systemId: sysId, ...(activeTrackType ? { trackType: activeTrackType } : {}) } : b))
            .concat(children);
        this.setTree(next);
        void this.store.persistCurrent();
        return true;
    }

    /** RESOLVE the active branch with the GM's answers → tier → gate evaluation. */
    resolveBranch(answers: ResolveAnswers, override?: OutcomeGate): void {
        const active = this.activeBranch();
        if (!active) return;
        const children = this.tree().filter((b) => b.parentBranchId === active.branchId);
        // D-134 — a two-sided contract (has a Phase-1 `side`) resolves by the DR VP model: twoSidedResolve maps the
        // per-objective MET marks → the SAME OutcomeGate. Legacy/single-sided contracts keep computeTier, byte-identical.
        // Everything downstream (combatPay/salvage/pilot-SP/selectUnlocks/OutcomeRecord) reads `tier` and is UNCHANGED.
        // IMPORT-6 Part B — the dispatch is the ONE shared rule (resolveModelFor: 'two' = D-134 unchanged · 'one' = the
        // single-sided authored list, VP-share tier · 'legacy' = computeTier); the resolve modal's live verdict reads the
        // same rule, so what the GM saw is what posts.
        const tsContract = this.state.activeChaosContract();
        const tsSpec = this.state.missionSpec();
        const model = resolveModelFor(tsSpec, tsContract);
        // IMPORT-6 FOLLOWUPS — keep the model's VIEW (the authored objectives + marks), not just its tier: it is snapshotted
        // onto resolution.aar below so the AAR / flow render what the GM actually marked (the spec is cleared after resolve).
        const view = model === 'two' ? twoSidedResolve(tsSpec, tsContract, answers)
            : model === 'one' ? singleSidedResolve(tsSpec, answers) : null;
        const computed = view ? view.tier : computeTier(answers, children.map((b) => b.outcomeGate));
        const tier = override ?? computed;
        // D-039: GRADED, never-dead-end matching — gates are thresholds, the highest authored advancing
        // fork ≤ tier opens (FULL_SUCCESS bonus-exclusive); matched=false → a continuation is minted below.
        const sel = selectUnlocks(children.map((b) => ({ branchId: b.branchId, outcomeGate: b.outcomeGate })), tier);
        const unlock = new Set(sel.unlock);
        const reduced = new Set(sel.reducedSpoils);
        const reducedNote = reduced.size ? ` [reduced spoils: a ${tier} outcome out-graded the authored fork — advanced on a lesser branch]` : '';
        const resolution: BranchResolution = {
            outcomeTier: tier,
            resolvedDate: this.today(),
            notes: (answers.notes || '') + (override && override !== computed ? ` [GM OVERRIDE: computed ${computed} → ${override}]` : '') + reducedNote,
            answers,
            override: !!override && override !== computed,
        };
        // D-031: snapshot the engaged units NOW — the walk reads them after the spec is cleared below.
        const bluforIds = deployedSet(this.state.startingForce(), this.state.quickMission()).map((i) => i.instanceId); // HF-020: quick one-shot engages the whole force
        const opfor = (this.state.missionSpec()?.opforForce ?? []).map((o) => ({ ...o }));
        if (bluforIds.length || opfor.length) resolution.engaged = { bluforIds, opfor };
        // D-036: the service record — missionCount bumps at RESOLVE for pilots whose 'Mech was
        // deployed (forward-only; pre-D-036 history is never invented).
        if (bluforIds.length) {
            const deployed = new Set(bluforIds);
            this.state.setPilots((this.state.pilots() ?? []).map((p) =>
                p.assignedInstanceId && deployed.has(p.assignedInstanceId)
                    ? { ...p, missionCount: (p.missionCount ?? 0) + 1 }
                    : p));
        }
        // D-034: snapshot the AAR's spec data NOW (objective texts + NPC flags + op slots) — same reason;
        // the after-action render reads these after the spec below is gone (forward-only, never invented).
        const spec = this.state.missionSpec();
        if (spec) {
            const npcNames: Record<string, string> = {};
            for (const flag of spec.forge?.npcFlags ?? []) { const npc = this.pack.npcById(this.state.npcAssignments()[flag]); if (npc) npcNames[flag] = npc.name; }
            resolution.aar = {
                objectives: filledObjectives(this.pack.seedById(spec.forge?.seedId), spec.forge, npcNames, spec.objectives ?? []),
                npcFlags: spec.forge?.npcFlags,
                world: spec.forge?.slots.WORLD,
                district: spec.forge?.slots.DISTRICT,
                employer: spec.forge?.slots.EMPLOYER,
                target: spec.forge?.slots.TARGET_FACTION,
            };
            // IMPORT-6 FOLLOWUPS — the authored objectives AS RESOLVED (VP models only; legacy/Traditional never emit the keys).
            if (view && model !== 'legacy') {
                resolution.aar.model = model;
                resolution.aar.objectiveMarks = [
                    ...view.ourObjs.map((o) => ({ text: o.text, vp: o.vp, met: o.met, side: 'our' as const })),
                    ...('oppObjs' in view ? view.oppObjs.map((o) => ({ text: o.text, vp: o.vp, met: o.met, side: 'opp' as const })) : []),
                ];
            }
        }
        // D-099 — force-advance the campaign clock by the mission's transit + insertion + operation span, so repair,
        // shop, hiring, and payroll all settle over the elapsed time. Campaign missions only (Quick Mission exempt —
        // ephemeral, no clock). Reuses CampaignClockService.advanceDays (lazy-injected to dodge the clock↔tree cycle).
        if (spec?.travel && !this.state.quickMission()) {
            const days = spec.travel.totalDays;
            const clock = this.injector.get(CampaignClockService);
            const before = clock.currentDate();
            if (days > 0 && before) {
                clock.advanceDays(days); // reuses the existing advance ripple (boundaries → date → bays.burnDays → persist)
                const after = clock.currentDate();
                if (resolution.aar) {
                    resolution.aar.elapsedDays = days;
                    resolution.aar.advancedFrom = formatDate(before);
                    if (after) resolution.aar.advancedTo = formatDate(after);
                    const t = spec.travel;
                    resolution.aar.travel = { jumps: t.jumps, jumpTransitDays: t.jumpTransitDays, insertionDays: t.insertionDays, operationDays: t.operationDays, totalDays: t.totalDays, hasTravel: t.hasTravel };
                }
            }
        }
        // D-077: append the outcome to the rolling ledger + move the escalation tempo (per-thread + campaign),
        // clamped. The tier GATE / fork-unlock above is UNCHANGED — this only feeds the NEXT generation's drift.
        this.recordOutcome(active, tier, spec);
        // D-109 — Hot Spots: a resolved track earns Combat Pay (§7) = tier SP × Contract Scale, posted to the
        // Warchest ledger as income (negative cost → balance up). Posted every resolution (0 on a failure) so the
        // Contract Record Sheet records each track. Traditional posts nothing here.
        let hsCombatPay = 0, hsSalvageSp = 0; // D-121 — snapshot the SP settlement onto the resolution for the AAR render
        if (this.state.campaignSystem() === 'hotspots') {
            hsCombatPay = this.warchest.combatPay(tier, this.state.contractScale() ?? 1);
            this.warchest.post(`Combat pay: ${active.name}`, -hsCombatPay, 0, null, { silent: true }); // D-139 — resolve settlement (the resolve modal already shows this); not toasted
        }
        // D-110b — Hot Spots contract ↔ track loop. A resolved track (a) posts ESTIMATED salvage on a success and
        // (b) counts toward the contract's Intensity; the last track AUTO-COMPLETES (Rep +1, tree closed). The
        // tree-close is deferred to AFTER the fork rebuild below (else it would fight the unlock). Traditional (no
        // activeChaosContract) is untouched. Per-track intensity GATING + accurate salvage are D-110c.
        let hotspotsCompleted: ContractOffer | null = null;
        const cc = this.state.activeChaosContract();
        if (this.state.campaignSystem() === 'hotspots' && cc?.status === 'active') {
            const salv = resolved(cc.steps).salvage;
            const salvagePct = typeof salv === 'number' ? salv : 0; // 'None'/'Exchange' → no straight-% estimate
            // D-110c — a GM-entered salvage SP (from the resolve dialog) posts as 'Salvage —'; an untouched dialog
            // (salvageValue undefined) posts the D-110b estimate as 'Salvage (est.) —'. Both only when > 0 (no 0-SP noise).
            if (answers.salvageValue !== undefined) {
                hsSalvageSp = Math.max(0, answers.salvageValue);
                if (hsSalvageSp > 0) this.warchest.post(`Salvage — ${active.name}`, -hsSalvageSp, 0, null, { silent: true }); // D-139 — resolve settlement, not toasted
            } else {
                const frac = this.warchest.salvageFraction(tier);
                if (frac > 0 && salvagePct > 0 && spec) {
                    // D-121 — no double-dip: a CLAIMED prize 'Mech is kept physically, so its full BV leaves the salvage pool.
                    const salvageBase = Math.max(0, (spec.opforBv ?? 0) - (answers.claimedPrizeBv ?? 0));
                    hsSalvageSp = Math.round((salvageBase * frac * 0.5 * salvagePct) / 100); // 0.5 = sell economy (BV÷2)
                    if (hsSalvageSp > 0) this.warchest.post(`Salvage (est.) — ${active.name}`, -hsSalvageSp, 0, null, { silent: true }); // D-139 — resolve settlement, not toasted
                }
            }
            const done = cc.tracksDone + 1;
            if (done >= cc.intensity) {
                this.state.setReputation((this.state.reputation() ?? 1) + 1);
                this.warchest.post('Contract completed', 0, 0, null, { silent: true }); // D-139 — resolve settlement, not toasted
                this.state.setActiveChaosContract(null);
                this.state.clearHiredMercs(); this.state.clearContractHiredKeys(); // IMPORT-3 P2 — the contract's over: any hired mercs disband
                hotspotsCompleted = this.state.acceptedContract(); // the synthetic offer, closed after the rebuild
                this.state.setAcceptedContract(null); // clears the never-dead-end continuation guard below
            } else {
                this.state.setActiveChaosContract({ ...cc, tracksDone: done }); // immutable replace
            }
        }
        // D-121 — snapshot the SP settlement onto the resolution so the AAR renders SETTLEMENT (HS-only; combat pay +
        // salvage SP are otherwise transient, posted straight to the Warchest and discarded).
        if (this.state.campaignSystem() === 'hotspots') {
            resolution.settlement = { combatPay: hsCombatPay, salvageSp: hsSalvageSp };
            // D-122 — snapshot the ITERATION LEDGER now that the Warchest posts (combat pay + salvage + completion)
            // are on the ledger and the clock window (aar.advancedFrom→To) is set. losses/prizes land in the D-121
            // applyHsSettlement pass that follows this call, so lost/gained/wounds fill in there (buildIterationLedger
            // is re-run — the Warchest window doesn't move, so it's idempotent). A clean resolve keeps these zeros.
            resolution.ledger = this.buildIterationLedger(resolution);
            // D-125 — EARN side: credit each DEPLOYED NAMED pilot an equal share of the combat pay into careerSP
            // (visibility of "who's earning"; the SPEND still draws the Warchest, unchanged). Card lazily initialized.
            // IMPORT-6 FOLLOWUPS — keying made consistent with the SPEND side (campaign-pilot.service): (a) the lazily
            // initialized card gets the pilot's unit CLASS ('CV' for a vehicle, else 'BM') exactly as `typeFor` does, so a
            // vehicle pilot who earns before anyone opens their card isn't stamped 'BM' for good; (b) HIRED SPECIALISTS
            // (hiredMercs, per-track or contract-long) neither earn nor dilute — their pilot record is deleted at release
            // (releasePerTrackMercs / clearHiredMercs), so a share credited to them was thrown away while shrinking every
            // real pilot's share; the divisor is the deployed units that are NOT hired mercs. // DECISION
            if (hsCombatPay > 0 && bluforIds.length) {
                const force = this.state.startingForce() ?? [];
                const mercInstanceIds = new Set((this.state.hiredMercs() ?? []).map((m) => m.instanceId));
                const earningUnits = bluforIds.filter((id) => !mercInstanceIds.has(id));
                const deployed = new Set(earningUnits);
                const share = earningUnits.length ? Math.round(hsCombatPay / earningUnits.length) : 0;
                if (share > 0) this.state.setPilots((this.state.pilots() ?? []).map((p) => {
                    if (!p.named || p.status === 'KIA' || !p.assignedInstanceId || !deployed.has(p.assignedInstanceId)) return p;
                    const unit = force.find((i) => i.instanceId === p.assignedInstanceId);
                    const cp = p.campaignPilot ?? initCampaignPilot(p, unit?.unitType === 'vehicle' ? 'CV' : 'BM');
                    return { ...p, campaignPilot: { ...cp, careerSP: cp.careerSP + share } };
                }));
            }
        }
        // D-039: a child whose gate opened under grading → AVAILABLE (reducedSpoils flagged); others RETIRE.
        // Un-taken AVAILABLE branches ELSEWHERE in the tree are untouched — they stay playable while the
        // window holds (non-linear flow; closeTree retires the unplayed only at contract/window close).
        const next: MissionBranch[] = this.tree().map((b) => {
            if (b.branchId === active.branchId) return { ...b, state: 'RESOLVED' as BranchState, resolution };
            if (b.parentBranchId === active.branchId) return unlock.has(b.branchId)
                ? { ...b, state: 'AVAILABLE' as BranchState, reducedSpoils: reduced.has(b.branchId) || undefined }
                : { ...b, state: 'RETIRED' as BranchState };
            return b;
        });
        // NEVER DEAD-END: if no fork matched AND nothing is left AVAILABLE anywhere, roll the next
        // operation under the live contract/order so the campaign continues (the app-wide guarantee).
        if (!next.some((b) => b.state === 'AVAILABLE') && this.state.acceptedContract()?.status === 'ACTIVE') {
            next.push(this.continuationBranch(active));
        }
        this.setTree(next);
        // D-110b — the contract auto-completed this track: retire the just-unlocked forks + archive the tree (parity
        // with the clock's Traditional complete() → closeTree, and with the manual End Contract). AFTER the rebuild.
        if (hotspotsCompleted) this.closeTree(hotspotsCompleted);
        this.missionGen.clear(); // the active mission is resolved; clear the spec (history holds the ref)
        void this.store.persistCurrent();
    }

    /** D-077 — append the resolved outcome to the rolling ledger (capped) + move the escalation tempo by tier,
     *  per-thread (the contract chain) AND campaign-wide (the fallback for a new thread), each CLAMPED. Pure
     *  STATE the generator reads back next time (DATA-003-safe); the tier gate / fork-unlock is untouched. */
    private recordOutcome(active: MissionBranch, tier: OutcomeGate, spec: ReturnType<NewCampaignState['missionSpec']>): void {
        const t = MISSION_TUNABLES.escalation;
        const contractId = this.state.acceptedContract()?.id ?? '';
        const threadTag = contractId || '__campaign__';
        const rec: OutcomeRecord = {
            contractId, branchId: active.branchId, threadTag, tier, date: this.today(),
            opforCommanderNpcId: this.state.npcAssignments()['opfor-commander'] || undefined,
            intelSourceNpcId: this.state.npcAssignments()['intel-source'] || undefined, // D-096 — recurring intel contact
            bvTarget: spec?.opforBv ?? 0, world: spec?.forge?.slots.WORLD,
        };
        this.state.setOutcomeLedger([...this.state.outcomeLedger(), rec].slice(-t.ledgerCap));
        const delta = t.tierDelta[tier] ?? 0;
        const clamp = (n: number): number => Math.max(t.min, Math.min(t.max, n));
        this.state.setEscalationByThread({ ...this.state.escalationByThread(), [threadTag]: clamp((this.state.escalationByThread()[threadTag] ?? 0) + delta) });
        this.state.setEscalationCampaign(clamp(this.state.escalationCampaign() + delta));
    }

    /** A never-dead-end CONTINUATION op (D-039): AVAILABLE, ANY-gated, parented to the resolved branch so
     *  Flow shows continuity. No seedFamilyHint → GENERATE falls back to the contract missionType. */
    private continuationBranch(parent: MissionBranch): MissionBranch {
        const ac = this.state.acceptedContract();
        const mt = ac ? MISSION_TYPES[ac.missionType as keyof typeof MISSION_TYPES] : undefined;
        // IMPORT-6 Part A — under a live Hot Spots contract no authored track follows this outcome (the chain ran out, or
        // no fork matched the tier) with intensity unmet: name the slot for what it is (the picker's target — "next
        // track"), not a Traditional follow-on tasking. Read via activeChaosContract (HS-only state; Traditional never
        // sets it) — no new mode-branch read (branch-pin). tracksDone was already incremented above.
        const cc = this.state.activeChaosContract();
        if (cc?.status === 'active') {
            return {
                branchId: this.newId('cont'),
                name: `Next track — ${cc.tracksDone + 1} of ${cc.intensity}`,
                parentBranchId: parent.branchId,
                outcomeGate: 'ANY',
                threat: parent.threat,
                state: 'AVAILABLE',
                continuation: true,
                // trigger doubles as the next brief's situation lead (forge.branchLead) — keep it in-fiction; consequence is the board cue.
                forkContext: { trigger: 'No scripted operation follows the last outcome — command tasks the next track under the standing contract.', consequence: 'Pick the next track to play — this hot spot\'s tracks, your Custom Tracks, or the universal §18 library — or advance a month. The contract completes when Intensity is met.' },
            };
        }
        return {
            branchId: this.newId('cont'),
            name: `${mt?.name ?? 'Operations'} — follow-on tasking`,
            parentBranchId: parent.branchId,
            outcomeGate: 'ANY',
            threat: parent.threat,
            state: 'AVAILABLE',
            continuation: true,
            forkContext: { trigger: 'The outcome opened no authored branch — command issues the next tasking so the campaign continues.', consequence: 'A fresh operation under the same contract; generate it to stand up the mission.' },
        };
    }

    /** Contract completion (D-022) → retire every un-resolved branch with a contract-ended note, then
     *  archive the closed tree (D-028) so FLOW can recall it after the next accept overwrites missionTree. */
    closeTree(contract?: ContractOffer): void {
        const tree = this.tree();
        if (!tree.length) return;
        const closed = tree.map((b) =>
            b.state === 'RESOLVED' || b.state === 'RETIRED'
                ? b
                : { ...b, state: 'RETIRED' as BranchState, resolution: b.resolution ?? { outcomeTier: 'ANY' as OutcomeGate, resolvedDate: this.today(), notes: 'contract ended — branch unplayed' } },
        );
        this.setTree(closed);
        if (contract) {
            const archive = this.state.treeArchive() ?? [];
            if (!archive.some((e) => e.contractId === contract.id)) {
                this.state.setTreeArchive([...archive, { contractId: contract.id, label: `${contract.employer.name} · ${contract.missionName}`, completedDate: this.today(), tree: closed }]);
            }
        }
        // missionSpec is cleared by the clock's complete(); the live missionTree is replaced on the next accept.
    }
}
