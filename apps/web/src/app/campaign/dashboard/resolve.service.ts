/*
 * BCE — the mission RESOLVE subsystem (the resolve dialog's form state + objectives, the D-134 two-sided VP
 * view, the D-121 field settlement, the D-122 damage capture, and the confirmResolve orchestration). Extracted
 * VERBATIM from the dashboard god file by DIRECTIVE-HARDEN-4 (pure move — every member body unchanged; the
 * guarded math keeps delegating to mission-tree.ts twoSidedResolve/computeTier and the warchest pay/salvage
 * seams, which the HARDEN-1 specs pin).
 *
 * PROVIDED ON THE DASHBOARD COMPONENT (the HARDEN-3 pattern): the form state gets exactly the original
 * component-field lifetime, and the dashboard's __d134 test seam drives it from the constructor. The host
 * computeds this subsystem read (isHotspots/missionSpec/activeBranch/branches/deployedCount) are re-derived
 * here with the dashboard's EXACT expressions over the same root signals — value-identical. The two
 * dashboard-owned UI signals confirmResolve writes (packageOpen/walkOpen) are BOUND IN by the dashboard at
 * construction (bindHostUi) — the same signal instances, the same writes, byte-identical behavior.
 */
import { Injectable, type WritableSignal, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { WarchestService } from '../chaos/warchest.service';
import { MissionTreeService } from '../mission/mission-tree.service';
import { BattleReconcileService } from '../battle/battle-reconcile.service';
import { FieldWalkService } from '../walk/field-walk.service';
import { ForgePackService } from '../mission/forge-pack.service';
import { PilotService } from '../barracks/pilot.service';
import { computeTier, twoSidedResolve, singleSidedResolve, resolveModelFor, type ResolveAnswers, type OutcomeGate } from '../mission/mission-tree'; // D-134 — two-sided VP resolve · IMPORT-6 — single-sided
import { deployedSet } from '../force/deployed';
import { readDamage } from '../walk/field-walk-core';
import { filledObjectives } from '../mission/forge-select';
import { resolved } from '../chaos/chaos-contract'; // D-110c — the contract salvage % for the resolve estimate

@Injectable()
export class ResolveService {
    private readonly state = inject(NewCampaignState);
    private readonly warchest = inject(WarchestService);
    private readonly tree = inject(MissionTreeService);
    private readonly reconcile = inject(BattleReconcileService); // D-048 phase D — battle_state -> inst.damage at resolve
    private readonly fieldWalk = inject(FieldWalkService);
    private readonly pilotSvc = inject(PilotService);
    private readonly pack = inject(ForgePackService);

    // ── host-derived computeds — the dashboard's EXACT expressions over the same root signals (value-identical). ──
    readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots'); // D-110b (public — the modal template gates the Compromised row on it)
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
    readonly rAns = signal<ResolveAnswers>({ primary: true, secondary: true, bonus: false, compromised: false, notes: '' });
    private readonly rOverride = signal<OutcomeGate | null>(null);
    async askResolve(): Promise<void> {
        this.rAns.set({ primary: true, secondary: true, bonus: false, compromised: false, notes: '' });
        this.rOverride.set(null);
        // D-121 — reset the HS field-settlement state (losses + prizes) each time the dialog opens.
        this.lossAbandon.set(new Set());
        this.lossFate.set({});
        this.prizeClaim.set(new Set());
        // D-122 — clear the GM damage edits so the Damage-taken input shows the fresh auto-sum for this mission.
        this.dmgTaken.set(null);
        this.dmgGiven.set(null);
        this.resolveOpen.set(true);
        // D-121 — pull the battle end-state up-front so YOUR LOSSES can auto-flag destroyed units. reconcile mutates
        // inst.damage IN PLACE (D-030 mirror), so nudge the force signal to re-read the settlement computeds.
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
    /** D-110c — GM-entered Hot Spots salvage (SP). Empty → undefined (revert to the estimate); a number → stored on
     *  ResolveAnswers.salvageValue so resolveBranch posts it as 'Salvage —' instead of the 'Salvage (est.) —' estimate. */
    setSalvage(v: string): void {
        const n = v.trim() === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0));
        this.rAns.update((a) => ({ ...a, salvageValue: n }));
    }
    /** The active Hot Spots contract's negotiated salvage % (0 if none / not hotspots / Exchange). */
    private readonly activeSalvagePct = computed(() => {
        const c = this.state.activeChaosContract();
        if (!c) return 0;
        const salv = resolved(c.steps).salvage;
        return typeof salv === 'number' ? salv : 0;
    });
    /** Show the resolve-dialog Salvage (SP) input only for a Hot Spots track whose contract has salvage rights. */
    readonly showSalvageInput = computed(() => this.isHotspots() && this.activeSalvagePct() > 0);
    /** The D-110b salvage estimate (opforBv × tier fraction × 0.5 sell × salvage%) for the EFFECTIVE tier — the
     *  pre-filled suggestion in the dialog. Uses rOverride ?? computedTier, mirroring resolveBranch's
     *  `tier = override ?? computed` (mission-tree.service.ts), so an untouched dialog's pre-fill matches the posted estimate. */
    readonly salvageEstimate = computed(() => {
        const spec = this.missionSpec();
        const pct = this.activeSalvagePct();
        if (!this.isHotspots() || !spec || pct <= 0) return 0;
        const tier = this.rOverride() ?? this.computedTier(); // D-110c review — honor the GM override like the service does
        return Math.round(((spec.opforBv ?? 0) * this.warchest.salvageFraction(tier) * 0.5 * pct) / 100);
    });
    setOverride(g: string): void {
        this.rOverride.set(g ? (g as OutcomeGate) : null);
    }
    /** The active mission's objectives (forge seed, slot-filled; else the D-023 template) — the shared
     *  D-034 helper; the tree service snapshots the SAME texts onto the resolution for the AAR. */
    readonly resolveObjectives = computed(() => {
        const spec = this.missionSpec();
        if (!spec) return null;
        const npcNames: Record<string, string> = {};
        for (const flag of spec.forge?.npcFlags ?? []) { const npc = this.pack.npcById(this.state.npcAssignments()[flag]); if (npc) npcNames[flag] = npc.name; }
        return filledObjectives(this.pack.seedById(spec.forge?.seedId), spec.forge, npcNames, spec.objectives ?? []);
    });
    // ── DIRECTIVE-134 — two-sided (DR VP) resolve: gated on the contract's Phase-1 `side` + an authored hotspot brief.
    //    IMPORT-6 Part B — the ONE dispatch rule (mission-tree.ts resolveModelFor) now also yields the SINGLE-SIDED
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
    /** IMPORT-6 — the live single-sided view (every authored objective, one column; VP-share tier). */
    readonly oneSidedView = computed(() => { const spec = this.missionSpec(); return spec ? singleSidedResolve(spec, this.rAns()) : null; });
    readonly computedTier = computed(() => {
        if (this.twoSided()) { const v = this.twoSidedView(); if (v) return v.tier; } // D-134 — the DR VP tier
        if (this.oneSided()) { const v = this.oneSidedView(); if (v) return v.tier; } // IMPORT-6 — the single-sided VP-share tier
        const active = this.activeBranch();
        const childGates = active ? this.branches().filter((b) => b.parentBranchId === active.branchId).map((b) => b.outcomeGate) : [];
        return computeTier(this.rAns(), childGates);
    });
    /** D-134 — the verdict badge label (a broke force overrides). IMPORT-6 — reads the ACTIVE model's view (value-identical when two-sided). */
    readonly verdictLabel = computed(() => {
        if (this.rAns().broke) return 'BROKE';
        const t = this.oneSided() ? this.oneSidedView()?.tier : this.twoSidedView()?.tier;
        return t === 'FULL_SUCCESS' ? 'ALL OBJECTIVES' : t === 'SUCCESS' ? 'SUCCESS' : 'UNSUCCESSFUL';
    });
    /** D-134 — the combat pay the effective tier (override ?? computed) would post — a live preview (the actual post is unchanged). */
    readonly combatPayPreview = computed(() => this.warchest.combatPay(this.rOverride() ?? this.computedTier(), this.state.contractScale() ?? 1));
    /** D-134 — mark a two-sided objective MET/NOT (writes rAns.ourMet[i] / rAns.oppMet[i]). */
    setObjMet(which: 'our' | 'opp', i: number, v: boolean): void {
        this.rAns.update((a) => { const arr = [...((which === 'our' ? a.ourMet : a.oppMet) ?? [])]; arr[i] = v; return which === 'our' ? { ...a, ourMet: arr } : { ...a, oppMet: arr }; });
    }
    setBroke(v: boolean): void { this.rAns.update((a) => ({ ...a, broke: v })); }
    /** HOTFIX-022 A — resolve requires a deployed force. Zero deployed can NEVER be a win: the only outcome is a
     *  forfeit/FAILURE (even a GM override cannot win with nothing on the field), breaking the no-deploy-win →
     *  escalation-balloon chain. `deployedCount` previously gated only prepareDeploy, never resolve. */
    readonly canResolveWin = computed(() => this.deployedCount() > 0);
    // ── DIRECTIVE-121 — Hot Spots FIELD SETTLEMENT at resolve (losses + prize claims). HS-only; it replaces the C-bill
    //    field walk (killed under HS). Reuses field-walk-core destroyed-detection + the CLAIM_PRIZE shape via the tree
    //    service's applyHsSettlement. Salvage economy stays abstract SP; a claimed prize is physical + slot-limited. ──
    readonly lossAbandon = signal<Set<string>>(new Set()); // non-destroyed units the GM marks abandoned
    readonly lossFate = signal<Record<string, 'ok' | 'injured' | 'kia'>>({});
    readonly prizeClaim = signal<Set<string>>(new Set());   // claimed defeated-OpFor instanceIds
    /** The deployed BLUFOR units for YOUR LOSSES. destroyed = the battle-sheet destroyed flag OR the D-110d level. */
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

    // ── DIRECTIVE-122 — the two battle-damage totals captured at settlement (feed the iteration ledger). Damage TAKEN
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
        // D-048 phase D: pull player-entered damage from the host battle_state into inst.damage BEFORE
        // resolveBranch — so the walk reads the real player end-state EVEN IF the GM never opened MekBay
        // (the active engagement key still matches the players'; resolveBranch flips it to RESOLVED next).
        await this.reconcile.reconcileAtResolve();
        // D-121 — build the HS field-settlement plan from the dialog BEFORE resolveBranch (so the salvage estimate
        // subtracts claimed prizes — no double-dip) and apply it AFTER (roster + pilots + resolution.losses/prizes).
        const hs = this.isHotspots();
        const branchId = this.activeBranch()?.branchId;
        let plan: { losses: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[]; prizes: { instanceId: string; label: string }[] } | null = null;
        if (hs && this.deployedCount() > 0 && branchId) {
            const losses = this.settleBlufor().filter((u) => this.isLost(u.id, u.destroyed))
                .map((u) => ({ instanceId: u.id, label: u.label, reason: (u.destroyed ? 'destroyed' : 'abandoned') as 'destroyed' | 'abandoned', pilotFate: this.fateOf(u.id, u.destroyed) }));
            const claimed = this.settleOpfor().filter((o) => this.prizeClaim().has(o.id));
            // D-122 — capture the two damage totals onto the answers so resolveBranch's iteration-ledger snapshot reads
            // them (taken = the auto-sum or the GM edit; given = the GM number, undefined when blank → "—").
            this.rAns.update((a) => ({ ...a, claimedPrizeBv: claimed.reduce((s, o) => s + (o.bv || 0), 0), damageTaken: this.dmgTakenShown(), damageGiven: this.dmgGiven() ?? undefined }));
            plan = { losses, prizes: claimed.map((o) => ({ instanceId: o.id, label: o.label })) };
        }
        if (this.deployedCount() === 0) {
            // No force deployed → a forfeit/loss, never a default SUCCESS (GM override included). IMPORT-6 — under Hot
            // Spots the VP models (two-sided / single-sided) compute PARTIAL for blank marks, so mark the force BROKE too:
            // computed FAILURE === the override → the record isn't mislabeled a GM override. Traditional answers untouched.
            this.tree.resolveBranch({ primary: false, secondary: false, bonus: false, compromised: false, notes: '(no force deployed — operation forfeited)', ...(hs ? { broke: true } : {}) }, 'FAILURE');
        } else {
            this.tree.resolveBranch(this.rAns(), this.rOverride() || undefined);
        }
        // D-121 — apply the settlement only when there's something to record (a clean resolve records nothing extra).
        if (hs && plan && branchId && (plan.losses.length || plan.prizes.length)) this.tree.applyHsSettlement(branchId, plan);
        this.resolveOpen.set(false);
        this.packageOpen.set(false);
        // D-031: a resolved mission whose battle had engaged units → walk the field (skippable + resumable).
        // D-110b: the field walk credits C-bills (salvage/strip) — a Traditional mechanic. Hot Spots salvage is the
        // SP economy (estimated at resolve; the SP walk is D-110c), so never auto-open the C-bill walk under hotspots.
        if (this.fieldWalk.pendingBranch() && !this.isHotspots()) this.walkOpen.set(true);
    }
}
