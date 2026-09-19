import { type Signal, Injectable, type WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { CampaignClockService } from '../clock/campaign-clock.service';
import { MissionTreeService } from '../mission/mission-tree.service';
import { BattleReconcileService } from '../battle/battle-reconcile.service';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { appendLedger } from './odm-ledger';
import { engagementKeyOf } from '../claims/engagement-key'; // TABLE-2 T2-3 — the GM observes the lobby so the resolve gate reads a fresh pendingPhase roster
import { OdmFieldWalkService } from './odm-field-walk.service';
import { ForgePackService } from '../mission/forge-pack.service';
import { PilotService } from '../barracks/pilot.service';
import { computeTier, twoSidedResolve, singleSidedResolve, resolveModelFor, type ResolveAnswers, type OutcomeGate } from '../mission/mission-tree';
import { deployedSet } from '../force/deployed';
import { readDamage } from '../walk/field-walk-core';
import { filledObjectives } from '../mission/forge-select';
import { odmTierToGate, reconcileOdmTree, type OdmTier, type OdmTreeData } from './odm-tree';
import { newSlipId, type SlipUnitRow } from '../gm/results-slip';

@Injectable()
export class OdmResolveService {
    private readonly state = inject(NewCampaignState);
    private readonly tree = inject(MissionTreeService);
    private readonly reconcile = inject(BattleReconcileService);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly fieldWalk = inject(OdmFieldWalkService);
    private readonly pilotSvc = inject(PilotService);
    private readonly pack = inject(ForgePackService);
    private readonly store = inject(CampaignSaveStore);
    private readonly clock = inject(CampaignClockService);

    constructor() {
        // TABLE-2 T2-3 — the GM OBSERVES the lobby for the whole ODM session (not only while the Lobby tab is open),
        // so the resolve gate (askResolve) reads a FRESH pendingPhase roster even when resolving straight from the
        // Missions tab or after a reload — the same ensure+observeLobby the claims/lobby panels do (odm-claims-panel).
        effect(() => {
            const id = this.store.campaignId();
            if (!id) return;
            this.rt.ensure(id, engagementKeyOf(this.state.missionTree()));
            this.rt.observeLobby();
        });
    }

    // ── host-derived computeds — the dashboard's EXACT expressions over the same root signals (value-identical). ──
    readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    private readonly missionSpec = computed(() => {
        const spec = this.state.missionSpec();
        const ac = this.state.acceptedContract();
        return spec && ac && spec.contractId === ac.id ? spec : null;
    });
    private readonly branches = computed(() => this.state.missionTree() ?? []);
    readonly activeBranch = computed(() => this.branches().find((b) => b.state === 'ACTIVE'));
    readonly deployedCount = computed(() => deployedSet(this.state.startingForce(), this.state.quickMission()).length); // HF-020: quick one-shot counts the whole force

    // ── the two dashboard-owned UI signals confirmResolve writes — bound in by the dashboard at construction. ──
    private packageOpen!: WritableSignal<boolean>;
    private walkOpen!: WritableSignal<boolean>;
    /** Called once from the dashboard constructor — hands this service the SAME signal instances the dashboard
     *  template renders, so confirmResolve's writes are byte-identical to the pre-extraction code. */
    bindHostUi(ui: { packageOpen: WritableSignal<boolean>; walkOpen: WritableSignal<boolean> }): void {
        this.packageOpen = ui.packageOpen;
        this.walkOpen = ui.walkOpen;
    }

    readonly gates: OutcomeGate[] = ['FULL_SUCCESS', 'SUCCESS', 'PARTIAL', 'FAILURE', 'COMPROMISED'];
    readonly resolveOpen = signal(false);
    /** TABLE-2 T2-3 — set when Resolve is BLOCKED because deployed devices still have un-ended (unshared) picks;
     *  the GM waits for END PHASE or takes the logged resolveAnyway() override. Null = no block. */
    readonly pendingResolveWarn = signal<{ count: number; names: string[] } | null>(null);
    readonly rAns = signal<ResolveAnswers>({ primary: true, secondary: true, bonus: false, compromised: false, notes: '' });
    private readonly rOverride = signal<OutcomeGate | null>(null);
    private odmTreeRef: Signal<OdmTreeData | null> = signal(null);
    /** Bound by the dashboard at construction (the bindHostUi pattern) — node defs for the checklist + reconcile. */
    bindOdmTree(tree: Signal<OdmTreeData | null>): void { this.odmTreeRef = tree; }
    readonly odmTier = signal<OdmTier | null>(null);
    readonly odmFlags = signal<Set<string>>(new Set());
    /** The authored node the ACTIVE mission is bound to (null on a legacy/non-authored mission — the ODM block self-hides). */
    readonly odmNodeDef = computed(() => {
        const id = this.state.odmActiveNodeId();
        return id ? (this.odmTreeRef()?.nodes.find((n) => n.id === id) ?? null) : null;
    });
    readonly ODM_TIERS: { id: OdmTier; label: string }[] = [
        { id: 'FULL_SUCCESS', label: 'FULL SUCCESS' }, { id: 'SUCCESS', label: 'SUCCESS' },
        { id: 'MISSION_FAILURE', label: 'MISSION FAILURE' }, { id: 'CRITICAL_FAILURE', label: 'CRITICAL FAILURE' },
    ];
    /** Choosing the ODM tier ALSO sets the shared override so resolveBranch grades identically (both failure
     *  grades → FAILURE — the true 4-tier literal is recorded in odmOutcomes, not the ledger). */
    setOdmTier(t: OdmTier): void { this.odmTier.set(t); this.rOverride.set(odmTierToGate(t)); }
    toggleOdmFlag(id: string): void {
        this.odmFlags.update((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }

    /** TABLE-2 T2-3 — deployed devices with un-ended picks this phase. The pin fans damage only at END PHASE, so
     *  resolving now would read a stale end-state and lose their damage/pilot hits. Resolve is gated on this = 0. */
    private pendingPickPlayers(): { count: number; names: string[] } {
        const p = (this.rt.lobby() ?? []).filter((x) => (x.pendingPhase ?? 0) > 0);
        return { count: p.length, names: p.map((x) => x.name) };
    }

    async askResolve(): Promise<void> {
        // TABLE-2 T2-3 — BLOCK while any deployed device still has unshared (un-ended) picks; the GM must wait for
        // END PHASE or take the logged "Resolve anyway" override (resolveAnyway). The ⏳ was display-only before this.
        const pending = this.pendingPickPlayers();
        if (pending.count > 0) { this.pendingResolveWarn.set(pending); return; }
        this.pendingResolveWarn.set(null);
        await this.openResolve();
    }

    /** TABLE-2 T2-3 — the logged override: resolve despite N unshared picks, naming the participants in the ledger. */
    async resolveAnyway(): Promise<void> {
        const pending = this.pendingPickPlayers();
        if (pending.count > 0) {
            this.state.logNotice(`Resolve anyway — ${pending.count} pick(s) unshared: ${pending.names.join(', ')} had not ended their phase (GM override; their damage may be missing).`, null, 'admin');
            this.state.setOdmLedger(appendLedger(this.state.odmLedger(), { ts: Date.now(), actor: 'GM', actorKey: 'gm', seat: null, seatLabel: null, field: 'resolve gate', was: `${pending.count} pick(s) unshared — ${pending.names.join(', ')}`, now: 'resolved anyway', verb: 'resolve-anyway', outcome: 'override' }));
            void this.store.persistCurrent();
        }
        this.pendingResolveWarn.set(null);
        await this.openResolve();
    }

    /** TABLE-2 T2-3 — dismiss the "picks unshared" block without resolving. */
    cancelResolveWarn(): void { this.pendingResolveWarn.set(null); }

    private async openResolve(): Promise<void> {
        this.rAns.set({ primary: true, secondary: true, bonus: false, compromised: false, notes: '' });
        this.rOverride.set(null);
        this.odmFlags.set(new Set());
        if (this.odmNodeDef()) this.setOdmTier('SUCCESS'); else this.odmTier.set(null);
        this.lossAbandon.set(new Set());
        this.lossFate.set({});
        this.prizeClaim.set(new Set());
        this.dmgTaken.set(null);
        this.dmgGiven.set(null);
        this.resolveOpen.set(true);
        if (this.isHotspots()) { await this.reconcile.reconcileAtResolve(); this.state.setStartingForce([...(this.state.startingForce() ?? [])]); }
    }
    cancelResolve(): void {
        this.resolveOpen.set(false);
    }
    setAns(k: 'primary' | 'secondary' | 'bonus' | 'compromised', v: boolean): void {
        this.rAns.update((a) => ({ ...a, [k]: v }));
    }
    setNotes(v: string): void {
        this.rAns.update((a) => ({ ...a, notes: v }));
    }
    setSalvage(v: string): void {
        const n = v.trim() === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0));
        this.rAns.update((a) => ({ ...a, salvageValue: n }));
    }
    /** The active Hot Spots contract's negotiated salvage % (0 if none / not hotspots / Exchange). */
    private readonly activeSalvagePct = computed(() => 0);
    /** Show the resolve-dialog Salvage (SP) input only for a Hot Spots track whose contract has salvage rights. */
    readonly showSalvageInput = computed(() => this.isHotspots() && this.activeSalvagePct() > 0);
    readonly salvageEstimate = computed(() => {
        const spec = this.missionSpec();
        const pct = this.activeSalvagePct();
        if (!this.isHotspots() || !spec || pct <= 0) return 0;
        const tier = this.rOverride() ?? this.computedTier();
        void tier; return 0;
    });
    setOverride(g: string): void {
        this.rOverride.set(g ? (g as OutcomeGate) : null);
    }
    readonly resolveObjectives = computed(() => {
        const spec = this.missionSpec();
        if (!spec) return null;
        const npcNames: Record<string, string> = {};
        for (const flag of spec.forge?.npcFlags ?? []) { const npc = this.pack.npcById(this.state.npcAssignments()[flag]); if (npc) npcNames[flag] = npc.name; }
        return filledObjectives(this.pack.seedById(spec.forge?.seedId), spec.forge, npcNames, spec.objectives ?? []);
    });
    //    model ('one': a single-sided custom's brief, or a preset track's authored list) — resolveBranch reads the same
    //    rule, so the live verdict and the posted tier can't drift. Two-sided + legacy branches are byte-identical. ──
    readonly resolveModel = computed(() => resolveModelFor(this.missionSpec(), this.state.activeChaosContract()));
    readonly twoSided = computed(() => this.resolveModel() === 'two');
    readonly oneSided = computed(() => this.resolveModel() === 'one');
    /** The live two-sided view (role-filtered objectives + VP + tier) — drives the two-column checklist + verdict. */
    readonly twoSidedView = computed(() => {
        const spec = this.missionSpec(); const c = this.state.activeChaosContract();
        return spec && c ? twoSidedResolve(spec, c, this.rAns()) : null;
    });
    readonly oneSidedView = computed(() => { const spec = this.missionSpec(); return spec ? singleSidedResolve(spec, this.rAns()) : null; });
    readonly computedTier = computed(() => {
        if (this.twoSided()) { const v = this.twoSidedView(); if (v) return v.tier; }
        if (this.oneSided()) { const v = this.oneSidedView(); if (v) return v.tier; }
        const active = this.activeBranch();
        const childGates = active ? this.branches().filter((b) => b.parentBranchId === active.branchId).map((b) => b.outcomeGate) : [];
        return computeTier(this.rAns(), childGates);
    });
    readonly verdictLabel = computed(() => {
        if (this.rAns().broke) return 'BROKE';
        const t = this.oneSided() ? this.oneSidedView()?.tier : this.twoSidedView()?.tier;
        return t === 'FULL_SUCCESS' ? 'ALL OBJECTIVES' : t === 'SUCCESS' ? 'SUCCESS' : 'UNSUCCESSFUL';
    });
    readonly combatPayPreview = computed(() => 0);
    setObjMet(which: 'our' | 'opp', i: number, v: boolean): void {
        this.rAns.update((a) => { const arr = [...((which === 'our' ? a.ourMet : a.oppMet) ?? [])]; arr[i] = v; return which === 'our' ? { ...a, ourMet: arr } : { ...a, oppMet: arr }; });
    }
    setBroke(v: boolean): void { this.rAns.update((a) => ({ ...a, broke: v })); }
    readonly canResolveWin = computed(() => this.deployedCount() > 0);
    //    field walk (killed under HS). Reuses field-walk-core destroyed-detection + the CLAIM_PRIZE shape via the tree
    //    service's applyHsSettlement. Salvage economy stays abstract SP; a claimed prize is physical + slot-limited. ──
    readonly lossAbandon = signal<Set<string>>(new Set()); // non-destroyed units the GM marks abandoned
    readonly lossFate = signal<Record<string, 'ok' | 'injured' | 'kia'>>({});
    readonly prizeClaim = signal<Set<string>>(new Set());   // claimed defeated-OpFor instanceIds
    readonly settleBlufor = computed(() => {
        if (!this.isHotspots()) return [] as { id: string; label: string; destroyed: boolean; pilotName: string; pilotId?: string }[];
        return deployedSet(this.state.startingForce()).map((i) => {
            const pilot = this.pilotSvc.pilotFor(i.instanceId);
            return { id: i.instanceId, label: `${i.chassis} ${i.model}`.trim(), destroyed: !!i.damage?.destroyed || i.chaosDamage === 'destroyed', pilotName: pilot?.name ?? '', pilotId: pilot?.pilotId };
        });
    });
    /** The defeated OpFor for the PRIZES claim list. */
    readonly settleOpfor = computed(() => {
        if (!this.isHotspots()) return [] as { id: string; label: string; bv: number }[];
        return (this.state.missionSpec()?.opforForce ?? []).map((o) => ({ id: o.instanceId, label: `${o.chassis} ${o.model}`.trim(), bv: o.bv }));
    });
    /** Prize slots derived from the negotiated salvage term + Contract Scale ('None'/'Exchange' → 0). */
    readonly prizeSlots = computed(() => {
        const pct = this.activeSalvagePct();
        if (pct <= 0) return 0;
        return Math.min(this.settleOpfor().length, Math.max(1, Math.round((pct / 100) * (this.state.contractScale() ?? 1) * 2)));
    });
    readonly prizeCount = computed(() => this.prizeClaim().size);
    fateOf(id: string, destroyed: boolean): 'ok' | 'injured' | 'kia' { return this.lossFate()[id] ?? (destroyed ? 'injured' : 'ok'); }
    isLost(id: string, destroyed: boolean): boolean { return destroyed || this.lossAbandon().has(id); }
    toggleAbandon(id: string): void {
        this.lossAbandon.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }
    setLossFate(id: string, fate: string): void { this.lossFate.update((f) => ({ ...f, [id]: (fate as 'ok' | 'injured' | 'kia') })); }
    togglePrize(id: string): void {
        this.prizeClaim.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < this.prizeSlots()) n.add(id); return n; });
    }

    //    auto-fills by summing readDamage().armorHits over the deployed BLUFOR digital sheets (maxArmor is irrelevant to
    //    the point count, so pass 0); it stays GM-editable. Damage GIVEN is a plain GM number (OpFor post-battle state
    //    isn't stored). Both null → the ledger shows "—". HS-only. ──
    readonly dmgTakenAuto = computed(() => {
        if (!this.isHotspots()) return 0;
        return deployedSet(this.state.startingForce()).reduce((s, i) => s + readDamage(i.damage, 0).armorHits, 0);
    });
    readonly dmgTaken = signal<number | null>(null); // GM value; null → use dmgTakenAuto()
    readonly dmgGiven = signal<number | null>(null); // GM-entered OpFor damage; null → "—"
    /** The value shown in the Damage-taken input: the GM edit if present, else the auto-sum. */
    readonly dmgTakenShown = computed(() => this.dmgTaken() ?? this.dmgTakenAuto());
    setDmgTaken(v: string): void { this.dmgTaken.set(v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0))); }
    setDmgGiven(v: string): void { this.dmgGiven.set(v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0))); }

    async confirmResolve(): Promise<void> {
        // resolveBranch — so the walk reads the real player end-state EVEN IF the GM never opened MekBay
        // (the active engagement key still matches the players'; resolveBranch flips it to RESOLVED next).
        await this.reconcile.reconcileAtResolve();
        // subtracts claimed prizes — no double-dip) and apply it AFTER (roster + pilots + resolution.losses/prizes).
        const hs = this.isHotspots();
        const branchId = this.activeBranch()?.branchId;
        // Classic/HS shape, `resolve.service.ts`), stamped AFTER the tree is reconciled. Rows = the deployed company AND every
        // OpFor unit: at an ODM table the OpFor is player-flown (the 4-player session's side B), so its end-state is a take-home
        // too — the reconcile above already wrote the battle_state onto both copies. NO combatPay / salvageSp (absent, not 0):
        // where a unit has them (a brought unit); the company's own hulls carry none — there is no home to apply to.
        // DECISION: packId-gated (this fork only ever runs on an ODM campaign; the gate keeps the mint honest if that changes).
        let odmSlipRows: SlipUnitRow[] | null = null;
        if (this.state.packId() === 'odm' && this.deployedCount() > 0 && branchId) {
            const row = (u: { instanceId: string; chassis: string; model: string; damage?: SlipUnitRow['damage']; provenance?: { sourceCampaignId?: string; originInstanceId?: string } }): SlipUnitRow => {
                const crew0 = (u.damage?.crew ?? []) as Array<{ hits?: number }>;
                const destroyed = !!(u.damage as { destroyed?: boolean } | null | undefined)?.destroyed;
                const prov = u.provenance;
                const originPilotId = this.pilotSvc.pilotFor(u.instanceId)?.originPilotId;
                return {
                    instanceId: u.instanceId,
                    label: `${u.chassis} ${u.model}`,
                    status: destroyed ? 'destroyed' : 'ok',
                    ...(crew0[0]?.hits ? { crewHits: Math.max(0, Math.min(6, crew0[0].hits)) } : {}),
                    damage: u.damage ? JSON.parse(JSON.stringify(u.damage)) as SlipUnitRow['damage'] : null,
                    ...(prov?.sourceCampaignId ? { sourceCampaignId: prov.sourceCampaignId } : {}),
                    ...(prov?.originInstanceId ? { originInstanceId: prov.originInstanceId } : {}),
                    ...(originPilotId ? { originPilotId } : {}),
                };
            };
            odmSlipRows = [
                ...deployedSet(this.state.startingForce(), this.state.quickMission()).map(row),
                ...(this.state.missionSpec()?.opforForce ?? []).map(row),
            ];
        }
        let plan: { losses: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[]; prizes: { instanceId: string; label: string }[] } | null = null;
        if (hs && this.deployedCount() > 0 && branchId) {
            const losses = this.settleBlufor().filter((u) => this.isLost(u.id, u.destroyed))
                .map((u) => ({ instanceId: u.id, label: u.label, reason: (u.destroyed ? 'destroyed' : 'abandoned') as 'destroyed' | 'abandoned', pilotFate: this.fateOf(u.id, u.destroyed) }));
            const claimed = this.settleOpfor().filter((o) => this.prizeClaim().has(o.id));
            // them (taken = the auto-sum or the GM edit; given = the GM number, undefined when blank → "—").
            this.rAns.update((a) => ({ ...a, claimedPrizeBv: claimed.reduce((s, o) => s + (o.bv || 0), 0), damageTaken: this.dmgTakenShown(), damageGiven: this.dmgGiven() ?? undefined }));
            plan = { losses, prizes: claimed.map((o) => ({ instanceId: o.id, label: o.label })) };
        }
        if (this.deployedCount() === 0) {
            // Spots the VP models (two-sided / single-sided) compute PARTIAL for blank marks, so mark the force BROKE too:
            // computed FAILURE === the override → the record isn't mislabeled a GM override. Traditional answers untouched.
            this.tree.resolveBranch({ primary: false, secondary: false, bonus: false, compromised: false, notes: '(no force deployed — operation forfeited)', ...(hs ? { broke: true } : {}) }, 'FAILURE');
        } else {
            this.tree.resolveBranch(this.rAns(), this.rOverride() || undefined);
        }
        if (hs && plan && branchId && (plan.losses.length || plan.prizes.length)) this.tree.applyHsSettlement(branchId, plan);
        // strip the never-dead-end continuation branch resolveBranch may have minted + open gated nodes. ──
        const node = this.odmNodeDef();
        const treeData = this.odmTreeRef();
        if (node && treeData) {
            const tier: OdmTier = this.deployedCount() === 0 ? 'MISSION_FAILURE' : (this.odmTier() ?? 'SUCCESS');
            this.state.odmOutcomes.update((m) => ({ ...m, [node.id]: { tier, flags: [...this.odmFlags()] } }));
            this.state.odmActiveNodeId.set(null);
            // clock advance retriggers the dashboard's reconcile effect; the explicit pass below is the belt.
            this.clock.advanceDays(node.opDays ?? 12);
            const now = this.state.currentDate() ?? undefined;
            // AAR dated every operation to the day it BEGAN. The operation ran its opDays and ended here.
            if (now) {
                this.state.missionTree.update((t) => (t ?? []).map((b) => (b.branchId === node.id && b.resolution
                    ? { ...b, resolution: { ...b.resolution, resolvedDate: now } } : b)));
            }
            this.state.missionTree.update((t) => reconcileOdmTree(t ?? [], treeData, this.state.odmOutcomes(), now));
            void this.store.persistCurrent();
        }
        // Classic/HS slip: slipId · branchId · trackName · resolvedAt · outcome (the TRUE 4-tier literal when the node is
        // authored, else the gate) · sessionName (the company record's name). Replaced each resolve. Persisted so a device
        // joining late still receives it (the store is the fan's source).
        if (odmSlipRows && branchId) {
            const br = (this.state.missionTree() ?? []).find((b) => b.branchId === branchId);
            const outcome = (node ? this.state.odmOutcomes()[node.id]?.tier : undefined) ?? (br?.resolution?.outcomeTier ? String(br.resolution.outcomeTier) : undefined);
            const campId = this.store.campaignId();
            let sessionName: string | undefined;
            try { sessionName = campId ? (await this.store.get(campId))?.name : undefined; } catch { sessionName = undefined; }
            this.state.setResultsSlip({
                slipId: newSlipId(),
                ...(sessionName ? { sessionName } : {}),
                branchId,
                trackName: br?.name ?? node?.title ?? 'the operation',
                resolvedAt: Date.now(),
                ...(outcome ? { outcome } : {}),
                units: odmSlipRows,
            });
            void this.store.persistCurrent();
        }
        this.resolveOpen.set(false);
        this.packageOpen.set(false);
        // TABLE-2 T2-1: target THE JUST-RESOLVED branch (not the first-pending .find()), so resolving a second mission
        // opens ITS walk rather than an earlier still-pending one; clear the selection if it did not become pending.
        if (branchId && !this.isHotspots()) {
            this.fieldWalk.selectedWalkBranchId.set(branchId);
            if (this.fieldWalk.pendingBranch()?.branchId === branchId) this.walkOpen.set(true);
            else this.fieldWalk.selectedWalkBranchId.set(null);
        }
        const campId = this.store.campaignId();
        if (branchId && campId) this.rt.closeEngagement(campId, branchId);
    }
}
