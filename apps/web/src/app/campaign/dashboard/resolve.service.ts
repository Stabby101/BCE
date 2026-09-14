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
import { BattleReconcileService, type ReconcileResult } from '../battle/battle-reconcile.service';
import { hsDamaged } from '../battle/hs-damage'; // PD3 P1 — the one HS damage truth (what the reconcile actually hurt)
import { ClaimRealtimeService } from '../claims/claim-realtime.service'; // ORDER-4 H18 — the engagement-close sender
import { FieldWalkService } from '../walk/field-walk.service';
import { ForgePackService } from '../mission/forge-pack.service';
import { PilotService } from '../barracks/pilot.service';
import { computeTier, twoSidedResolve, singleSidedResolve, resolveModelFor, type ResolveAnswers, type OutcomeGate } from '../mission/mission-tree'; // D-134 — two-sided VP resolve · IMPORT-6 — single-sided
import { deployedSet } from '../force/deployed';
import { readDamage } from '../walk/field-walk-core';
import { CampaignSaveStore } from '../campaign-save-store'; // GM-1 P3 — the slip persists with the resolve
import { newSlipId, type SlipUnitRow } from '../gm/results-slip'; // GM-1 P3 · ORDER-3 H16 — newSlipId moved to the shared shape (pure move)
import { filledObjectives } from '../mission/forge-select';
import { resolved, isSessionContract, GM_SELF_KEY, type ChaosContract } from '../chaos/chaos-contract'; // D-110c — the contract salvage % for the resolve estimate · GM-3 P1
import { slipPayFor, participantPay } from '../gm/participant-pay'; // GM-2 P2a — per-player pay for the companies that signed their own contract · GM-3 P1 — the GM's own


@Injectable()
export class ResolveService {
    private readonly state = inject(NewCampaignState);
    private readonly warchest = inject(WarchestService);
    private readonly tree = inject(MissionTreeService);
    private readonly reconcile = inject(BattleReconcileService); // D-048 phase D — battle_state -> inst.damage at resolve
    private readonly rt = inject(ClaimRealtimeService); // ORDER-4 H18 — the engagement-close sender
    private readonly store = inject(CampaignSaveStore); // GM-1 P3 — the results slip persists with the resolve
    private readonly fieldWalk = inject(FieldWalkService);
    private readonly pilotSvc = inject(PilotService);
    private readonly pack = inject(ForgePackService);

    // ── host-derived computeds — the dashboard's EXACT expressions over the same root signals (value-identical). ──
    readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots'); // D-110b (public — the modal template gates the Compromised row on it)
    private readonly missionSpec = computed(() => {
        const spec = this.state.missionSpec();
        const ac = this.state.offerFor(); // GM-2 P2a — through the ONE accessor
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
        this.reconcileNote.set(null);
        // D-121 — pull the battle end-state up-front so YOUR LOSSES can auto-flag destroyed units. reconcile mutates
        // inst.damage IN PLACE (D-030 mirror), so nudge the force signal to re-read the settlement computeds.
        // PD3 P1 (PD3-12) — and SAY what it did: the count on the modal, a failure out loud (never a silent 0).
        if (this.isHotspots()) { const r = await this.reconcile.reconcileAtResolve(); this.state.setStartingForce([...(this.state.startingForce() ?? [])]); this.surfaceReconcile(r, 'open'); }
    }

    // ── DIRECTIVE-PD3 P1 (PD3-12) — THE RECONCILE'S WITNESS. Both call sites used to discard the applied count, and a thrown
    //    error or the 3 s socket timeout read exactly like "nobody took damage" (Pendragon's "REPAIR 0 · No damaged units"
    //    after a played track). Now: the modal shows the count at open; the confirm toasts "N units damaged — record or
    //    repair" (a Repair ▸ jump); a sync FAILURE toasts AND posts a ledger line under Hot Spots (a campaign-log notice under
    //    Traditional) — loud in the record, never a 0. ──
    readonly reconcileNote = signal<{ text: string; failed: boolean; damaged: number } | null>(null);
    private surfaceReconcile(r: ReconcileResult, at: 'open' | 'confirm'): void {
        const hs = this.isHotspots();
        const force = this.state.startingForce() ?? [];
        const opfor = this.state.missionSpec()?.opforForce ?? [];
        const hurt = (r.applications ?? []).filter((id) => hsDamaged(force.find((u) => u.instanceId === id) ?? opfor.find((u) => u.instanceId === id))).length;
        const plural = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`;
        if (!r.ok) {
            const why = r.reason === 'timeout' ? 'the host did not answer in 3 s' : r.reason === 'no-socket' ? 'no live connection' : r.reason === 'no-campaign' ? 'no host campaign' : 'an error';
            const text = `Battle-state sync FAILED (${why}) — digital sheet damage was NOT pulled. Record it on the tabletop in Repair & Refit.`;
            this.reconcileNote.set({ text, failed: true, damaged: 0 });
            if (hs) { this.warchest.announceNote(text, 'repair'); if (at === 'confirm') this.warchest.post('Battle-state sync failed — sheet damage not pulled (record it in Repair & Refit)', 0, 0, null, { silent: true }); }
            else if (at === 'confirm') this.state.logNotice(text);
            return;
        }
        const text = hurt > 0
            ? `${plural(hurt)} damaged — record or repair (battle state synced: ${plural(r.applied)})`
            : r.applied > 0 ? `Battle state synced (${plural(r.applied)}) — no repairable damage. Played on the table? Record it in Repair & Refit.`
            : 'Battle state synced — no digital damage recorded. Played on the table? Record it in Repair & Refit.';
        this.reconcileNote.set({ text, failed: false, damaged: hurt });
        if (hs && at === 'confirm') this.warchest.announceNote(text, 'repair');
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
        const c = this.state.contractFor(); // GM-2 P2a — through the ONE accessor
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
    readonly resolveModel = computed(() => resolveModelFor(this.missionSpec(), this.state.contractFor()));
    readonly twoSided = computed(() => this.resolveModel() === 'two');
    readonly oneSided = computed(() => this.resolveModel() === 'one');
    /** The live two-sided view (role-filtered objectives + VP + tier) — drives the two-column checklist + verdict. */
    readonly twoSidedView = computed(() => {
        const spec = this.missionSpec(); const c = this.state.contractFor();
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
    readonly combatPayPreview = computed(() => this.warchest.combatPay(this.rOverride() ?? this.computedTier(), this.state.scaleFor() ?? 1));
    /** D-134 — mark a two-sided objective MET/NOT (writes rAns.ourMet[i] / rAns.oppMet[i]). */
    setObjMet(which: 'our' | 'opp', i: number, v: boolean): void {
        this.rAns.update((a) => { const arr = [...((which === 'our' ? a.ourMet : a.oppMet) ?? [])]; arr[i] = v; return which === 'our' ? { ...a, ourMet: arr } : { ...a, oppMet: arr }; });
    }
    setBroke(v: boolean): void { this.rAns.update((a) => ({ ...a, broke: v })); }
    /** HOTFIX-022 A — resolve requires a deployed force. Zero deployed can NEVER be a win: the only outcome is a
     *  forfeit/FAILURE (even a GM override cannot win with nothing on the field), breaking the no-deploy-win →
     *  escalation-balloon chain. `deployedCount` previously gated only prepareDeploy, never resolve. */
    readonly canResolveWin = computed(() => this.deployedCount() > 0);
    // GM-3 P2 — a TABLE WITH NO COMPANY with NOTHING deployed cannot be resolved: it is not the GM's forfeit (he fields
    // nobody by design) — the players simply have not deployed. Resolve REFUSES with a reason instead of forfeiting and
    // minting no slip (R0.2 worst-five #5). A plain HS campaign / a GM with a company keeps the forfeit path (deployedCount 0
    // there means the owner fielded nothing → a genuine loss). The modal shows this and withholds the confirm.
    readonly companylessNoDeploy = computed(() => this.state.companylessTable() && this.deployedCount() === 0);
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
    /** The defeated OpFor for the PRIZES claim list. GM-1 P4 (panel finding): PLAYER-IMPORT units riding
     *  opforForce in an A-vs-B track are NEVER prizes — a player's own machine goes home on the results
     *  slip; claiming it would double-mint the instanceId ('captured' into the GM roster + slipped home). */
    readonly settleOpfor = computed(() => {
        if (!this.isHotspots()) return [] as { id: string; label: string; bv: number }[];
        return (this.state.missionSpec()?.opforForce ?? [])
            .filter((o) => o.provenance?.origin !== 'player-import')
            .map((o) => ({ id: o.instanceId, label: `${o.chassis} ${o.model}`.trim(), bv: o.bv }));
    });
    /** Prize slots derived from the negotiated salvage term + Contract Scale ('None'/'Exchange' → 0). */
    readonly prizeSlots = computed(() => {
        const pct = this.activeSalvagePct();
        if (pct <= 0) return 0;
        return Math.min(this.settleOpfor().length, Math.max(1, Math.round((pct / 100) * (this.state.scaleFor() ?? 1) * 2)));
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
        // GM-3 P2 — a company-less table with nothing deployed REFUSES (never forfeits, never mints an empty slip). The guard
        // is here as well as in the modal: no path resolves a table with an empty field.
        if (this.companylessNoDeploy()) return;
        // D-048 phase D: pull player-entered damage from the host battle_state into inst.damage BEFORE
        // resolveBranch — so the walk reads the real player end-state EVEN IF the GM never opened MekBay
        // (the active engagement key still matches the players'; resolveBranch flips it to RESOLVED next).
        // PD3 P1 — and SURFACE it: the toast count / the LOUD failure (ledger line) — never a silent 0.
        this.surfaceReconcile(await this.reconcile.reconcileAtResolve(), 'confirm');
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
        // GM-1 P3 — capture the RESULTS-SLIP rows BEFORE resolveBranch/applyHsSettlement: the settlement
        // DELETES lost units (their damage envelopes with them) and resolveBranch clears the spec. Rows
        // carry no tokens — the player device filters by its own claim rows.
        let slipRows: SlipUnitRow[] | null = null;
        // GM-2 P1 — the session's identity for the home campaign's ledger line, read BEFORE resolveBranch clears the spec:
        // the hot spot's title off the persisted forge.hotspot brief, the save name off the host record.
        let slipIdentity: { sessionName?: string; hotspotTitle?: string } = {};
        let slipEconomy = { opforBv: 0, claimedPrizeBv: 0 }; // GM-2 P2a — the salvage pool the participants' estimates read (before the spec clears)
        let slipMap: Record<string, ChaosContract> = {}; // GM-2 P2a — the participant map, read BEFORE resolveBranch: the contract's LAST track completes it and clears the map
        let slipPrimary: ChaosContract | null = null; // GM-2 P2b — to tell a completing resolve (the primary gone after) for the participants' Rep +1
        // ORDER-7 H21 — mint the RESULTS SLIP for ANY resolve with a deployed force, in EVERY mode. The `hs && gmSession`
        // condition selected the per-participant pay path (GM-2 P2a), NOT whether a slip exists — a plain Traditional
        // lobby's players must see their unit's end-state too. The participant economy below stays Hot-Spots-session only.
        if (this.deployedCount() > 0 && branchId) {
            const hotspotTitle = this.state.missionSpec()?.forge?.hotspot?.title;
            if (hs && this.state.gmSession()) {
                slipEconomy = { opforBv: this.state.missionSpec()?.opforBv ?? 0, claimedPrizeBv: this.rAns().claimedPrizeBv ?? 0 };
                slipMap = this.state.participantContracts();
                slipPrimary = this.state.activeChaosContract();
            }
            const campId = this.store.campaignId();
            let sessionName: string | undefined;
            try { sessionName = campId ? (await this.store.get(campId))?.name : undefined; } catch { sessionName = undefined; }
            slipIdentity = { ...(sessionName ? { sessionName } : {}), ...(hotspotTitle ? { hotspotTitle } : {}) };
            const lossOf = new Map((plan?.losses ?? []).map((l) => [l.instanceId, l]));
            const row = (u: { instanceId: string; chassis: string; model: string; damage?: SlipUnitRow['damage']; chaosDamage?: SlipUnitRow['chaosDamage']; triage?: SlipUnitRow['triage']; provenance?: { sourceCampaignId?: string; originInstanceId?: string } }): SlipUnitRow => {
                const loss = lossOf.get(u.instanceId);
                const crew0 = (u.damage?.crew ?? []) as Array<{ hits?: number }>;
                // ORDER-7 H21 — read damage.destroyed on BOTH sides in the fallback. A Traditional resolve builds no
                // Hot Spots loss plan (the `loss` clause still wins for HS — every destroyed HS unit is in the plan via
                // isLost = destroyed || abandoned — so HS stays byte-identical), so a destroyed BLUFOR unit must read its
                // OWN reconciled end-state here, not collapse to 'ok' (which rendered a dead 'Mech as "operational").
                const destroyed = loss ? loss.reason : ((u.damage as { destroyed?: boolean } | null | undefined)?.destroyed ? 'destroyed' : 'ok');
                // GM-2 P1 — echo the identity cut: the mint's provenance (home campaign + home unit) and the cockpit pilot's home id
                const prov = u.provenance;
                const originPilotId = this.pilotSvc.pilotFor(u.instanceId)?.originPilotId;
                return {
                    instanceId: u.instanceId,
                    label: `${u.chassis} ${u.model}`,
                    status: destroyed as 'ok' | 'destroyed' | 'abandoned',
                    ...(loss ? { pilotFate: loss.pilotFate } : {}),
                    ...(crew0[0]?.hits ? { crewHits: Math.max(0, Math.min(6, crew0[0].hits)) } : {}),
                    damage: u.damage ? JSON.parse(JSON.stringify(u.damage)) as SlipUnitRow['damage'] : null,
                    // PD3 P1 (PD3-12) — the tabletop level / triage the GM recorded go home too (HS rows only; a Traditional slip is byte-identical)
                    ...(hs && u.chaosDamage ? { chaosDamage: u.chaosDamage } : {}),
                    ...(hs && u.triage ? { triage: u.triage } : {}),
                    ...(prov?.sourceCampaignId ? { sourceCampaignId: prov.sourceCampaignId } : {}),
                    ...(prov?.originInstanceId ? { originInstanceId: prov.originInstanceId } : {}),
                    ...(originPilotId ? { originPilotId } : {}),
                };
            };
            // P4 — BOTH sides go home: side A = the deployed roster; side B = the PLAYER-owned units riding
            // opforForce in an A-vs-B track. GM-OpFor units (no player-import provenance) never slip.
            // PANEL FINDING: the reconcile writes battle-state damage onto the STARTINGFORCE copy first
            // (blufor-searched-first, same instanceId — the seeded units' Reserve rows live there), so the
            // opfor slip row must read THAT copy's end-state, never opforForce's stale shallow copy.
            const sf = this.state.startingForce() ?? [];
            slipRows = [
                ...deployedSet(this.state.startingForce(), this.state.quickMission()).map((u) => row(u)),
                ...(this.state.missionSpec()?.opforForce ?? [])
                    .filter((u) => u.provenance?.origin === 'player-import')
                    .map((u) => row(sf.find((f) => f.instanceId === u.instanceId) ?? u)),
            ];
        }
        // GM-2 P3 — the career SP the earn side credits THIS resolve, per brought pilot (read around resolveBranch)
        const spBefore = new Map((this.state.pilots() ?? []).filter((p) => p.originPilotId).map((p) => [p.pilotId, p.campaignPilot?.careerSP ?? 0] as const));
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
        // GM-1 P3 — stamp the slip AFTER settlement (fan-2 timing: the fanned snapshot is the final record)
        // and read the settlement the tree just wrote. GM sessions only; replaced each resolve.
        if (slipRows && branchId) {
            const br = (this.state.missionTree() ?? []).find((b) => b.branchId === branchId);
            // GM-2 P2a — each company that signed its OWN contract is paid by ITS terms; absent when the map is empty (P1's slip)
            const pilotSp: Record<string, number> = {};
            for (const p of this.state.pilots() ?? []) {
                if (!p.originPilotId || !spBefore.has(p.pilotId)) continue;
                const d = (p.campaignPilot?.careerSP ?? 0) - (spBefore.get(p.pilotId) ?? 0);
                if (d > 0) pilotSp[p.originPilotId] = d;
            }
            const slipTier = br?.resolution?.outcomeTier as OutcomeGate | undefined;
            // GM-2 P2a — per-participant pay is a Hot-Spots-session concept; a Traditional slip never computes one (ORDER-7 H21)
            const slipPay = (hs && this.state.gmSession() && slipTier) ? slipPayFor(slipMap, slipRows.map((r) => r.sourceCampaignId).filter((k): k is string => !!k), slipTier, slipEconomy.opforBv, slipEconomy.claimedPrizeBv, !!slipPrimary && !this.state.activeChaosContract()) : undefined; // P2b — completed = the primary closed on this resolve
            this.state.setResultsSlip({
                slipId: newSlipId(), // GM-2 P1 — minted here, a uuid, never derived: the home campaign's idempotency key
                ...slipIdentity,
                branchId,
                trackName: br?.name ?? 'the track',
                resolvedAt: Date.now(),
                ...(br?.resolution?.outcomeTier ? { outcome: String(br.resolution.outcomeTier) } : {}),
                // ORDER-7 H21 — the team SP settlement is Hot Spots' (resolveBranch writes it under campaignSystem==='hotspots').
                // HS always carries it (byte-identical); a Traditional resolve produces none → the fields are ABSENT, never a fabricated 0.
                ...(br?.resolution?.settlement ? { combatPay: br.resolution.settlement.combatPay, salvageSp: br.resolution.settlement.salvageSp } : {}),
                ...(slipPay ? { pay: slipPay } : {}), // GM-2 P2a — per-player pay, keyed by home campaign id
                ...(Object.keys(pilotSp).length ? { pilotSp } : {}), // GM-2 P3 — career SP per brought pilot, keyed by the home pilot id
                units: slipRows,
            });
            // GM-2 P2b — the signing settlement (transport + rep spent) rides ONE slip: mark each paid company settled
            for (const key of Object.keys(slipPay ?? {})) { const c = this.state.participantContracts()[key]; if (c && !c.repSettled) this.state.setParticipantContract(key, { ...c, repSettled: true }); }
            // GM-3 P1 — the GM's OWN participant contract (he fielded on a session contract): paid by ITS terms into THIS campaign's
            // warchest as ONE line (the slip's shape — combat + salvage + one month's base pay − the net transport, the rep delta on
            // the record), the way Apply lands a participant's at home. Nothing else pays the GM on a session (mission-tree).
            const self = slipMap[GM_SELF_KEY];
            if (self && slipTier && isSessionContract(slipPrimary)) {
                const pay = participantPay(self, slipTier, slipEconomy.opforBv, slipEconomy.claimedPrizeBv, { settleSigning: !self.repSettled, completed: !this.state.activeChaosContract() });
                const sp = Math.round(pay.combatPay + pay.salvageSp + pay.basePaySp - (pay.transportSp ?? 0));
                this.warchest.post(`Your contract — ${br?.name ?? 'the track'}`, -sp, 0, null, { silent: true });
                if (pay.repDelta) this.state.setReputation(Math.max(0, (this.state.reputation() ?? 0) + pay.repDelta));
                const still = this.state.participantContracts()[GM_SELF_KEY]; if (still && !still.repSettled) this.state.setParticipantContract(GM_SELF_KEY, { ...still, repSettled: true });
            }
            void this.store.persistCurrent(); // coalesces with the settlement's debounced persist
        }
        this.resolveOpen.set(false);
        this.packageOpen.set(false);
        // D-031: a resolved mission whose battle had engaged units → walk the field (skippable + resumable).
        // D-110b: the field walk credits C-bills (salvage/strip) — a Traditional mechanic. Hot Spots salvage is the
        // SP economy (estimated at resolve; the SP walk is D-110c), so never auto-open the C-bill walk under hotspots.
        if (this.fieldWalk.pendingBranch() && !this.isHotspots()) this.walkOpen.set(true);
        // ORDER-4 H18 — LAST: tell the server the fight is over (Traditional AND Hot Spots ride this one path). The branch
        // just resolved IS the engagement key; the server refuses every later battle write to it, claims untouched.
        const campId = this.store.campaignId();
        if (branchId && campId) this.rt.closeEngagement(campId, branchId);
    }
}
