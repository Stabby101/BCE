import { Injectable, type WritableSignal, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { WarchestService } from '../chaos/warchest.service';
import { MissionTreeService } from '../mission/mission-tree.service';
import { BattleReconcileService, type ReconcileResult } from '../battle/battle-reconcile.service';
import { hsDamaged } from '../battle/hs-damage'; // PD3 P1 — the one HS damage truth (what the reconcile actually hurt)
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { FieldWalkService } from '../walk/field-walk.service';
import { ForgePackService } from '../mission/forge-pack.service';
import { PilotService } from '../barracks/pilot.service';
import { computeTier, twoSidedResolve, singleSidedResolve, resolveModelFor, type ResolveAnswers, type OutcomeGate } from '../mission/mission-tree';
import { deployedSet } from '../force/deployed';
import { readDamage } from '../walk/field-walk-core';
import { CampaignSaveStore } from '../campaign-save-store';
import { newSlipId, type SlipUnitRow } from '../gm/results-slip';
import { filledObjectives } from '../mission/forge-select';
import { resolved, isSessionContract, GM_SELF_KEY, type ChaosContract } from '../chaos/chaos-contract';
import { slipPayFor, participantPay } from '../gm/participant-pay';


@Injectable()
export class ResolveService {
    private readonly state = inject(NewCampaignState);
    private readonly warchest = inject(WarchestService);
    private readonly tree = inject(MissionTreeService);
    private readonly reconcile = inject(BattleReconcileService);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly store = inject(CampaignSaveStore);
    private readonly fieldWalk = inject(FieldWalkService);
    private readonly pilotSvc = inject(PilotService);
    private readonly pack = inject(ForgePackService);

    // ── host-derived computeds — the dashboard's EXACT expressions over the same root signals (value-identical). ──
    readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    private readonly missionSpec = computed(() => {
        const spec = this.state.missionSpec();
        const ac = this.state.offerFor();
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
        this.lossAbandon.set(new Set());
        this.lossFate.set({});
        this.prizeClaim.set(new Set());
        this.dmgTaken.set(null);
        this.dmgGiven.set(null);
        this.resolveOpen.set(true);
        this.reconcileNote.set(null);
        if (this.isHotspots()) { const r = await this.reconcile.reconcileAtResolve(); this.state.setStartingForce([...(this.state.startingForce() ?? [])]); this.surfaceReconcile(r, 'open'); }
    }

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
    setSalvage(v: string): void {
        const n = v.trim() === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0));
        this.rAns.update((a) => ({ ...a, salvageValue: n }));
    }
    /** The active Hot Spots contract's negotiated salvage % (0 if none / not hotspots / Exchange). */
    private readonly activeSalvagePct = computed(() => {
        const c = this.state.contractFor();
        if (!c) return 0;
        const salv = resolved(c.steps).salvage;
        return typeof salv === 'number' ? salv : 0;
    });
    /** Show the resolve-dialog Salvage (SP) input only for a Hot Spots track whose contract has salvage rights. */
    readonly showSalvageInput = computed(() => this.isHotspots() && this.activeSalvagePct() > 0);
    readonly salvageEstimate = computed(() => {
        const spec = this.missionSpec();
        const pct = this.activeSalvagePct();
        if (!this.isHotspots() || !spec || pct <= 0) return 0;
        const tier = this.rOverride() ?? this.computedTier();
        return Math.round(((spec.opforBv ?? 0) * this.warchest.salvageFraction(tier) * 0.5 * pct) / 100);
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
    readonly resolveModel = computed(() => resolveModelFor(this.missionSpec(), this.state.contractFor()));
    readonly twoSided = computed(() => this.resolveModel() === 'two');
    readonly oneSided = computed(() => this.resolveModel() === 'one');
    /** The live two-sided view (role-filtered objectives + VP + tier) — drives the two-column checklist + verdict. */
    readonly twoSidedView = computed(() => {
        const spec = this.missionSpec(); const c = this.state.contractFor();
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
    readonly combatPayPreview = computed(() => this.warchest.combatPay(this.rOverride() ?? this.computedTier(), this.state.scaleFor() ?? 1));
    setObjMet(which: 'our' | 'opp', i: number, v: boolean): void {
        this.rAns.update((a) => { const arr = [...((which === 'our' ? a.ourMet : a.oppMet) ?? [])]; arr[i] = v; return which === 'our' ? { ...a, ourMet: arr } : { ...a, oppMet: arr }; });
    }
    setBroke(v: boolean): void { this.rAns.update((a) => ({ ...a, broke: v })); }
    readonly canResolveWin = computed(() => this.deployedCount() > 0);
    // nobody by design) — the players simply have not deployed. Resolve REFUSES with a reason instead of forfeiting and
    // minting no slip (R0.2 worst-five #5). A plain HS campaign / a GM with a company keeps the forfeit path (deployedCount 0
    // there means the owner fielded nothing → a genuine loss). The modal shows this and withholds the confirm.
    readonly companylessNoDeploy = computed(() => this.state.companylessTable() && this.deployedCount() === 0);
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
        // is here as well as in the modal: no path resolves a table with an empty field.
        if (this.companylessNoDeploy()) return;
        // resolveBranch — so the walk reads the real player end-state EVEN IF the GM never opened MekBay
        // (the active engagement key still matches the players'; resolveBranch flips it to RESOLVED next).
        // PD3 P1 — and SURFACE it: the toast count / the LOUD failure (ledger line) — never a silent 0.
        this.surfaceReconcile(await this.reconcile.reconcileAtResolve(), 'confirm');
        // subtracts claimed prizes — no double-dip) and apply it AFTER (roster + pilots + resolution.losses/prizes).
        const hs = this.isHotspots();
        const branchId = this.activeBranch()?.branchId;
        let plan: { losses: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[]; prizes: { instanceId: string; label: string }[] } | null = null;
        if (hs && this.deployedCount() > 0 && branchId) {
            const losses = this.settleBlufor().filter((u) => this.isLost(u.id, u.destroyed))
                .map((u) => ({ instanceId: u.id, label: u.label, reason: (u.destroyed ? 'destroyed' : 'abandoned') as 'destroyed' | 'abandoned', pilotFate: this.fateOf(u.id, u.destroyed) }));
            const claimed = this.settleOpfor().filter((o) => this.prizeClaim().has(o.id));
            // them (taken = the auto-sum or the GM edit; given = the GM number, undefined when blank → "—").
            this.rAns.update((a) => ({ ...a, claimedPrizeBv: claimed.reduce((s, o) => s + (o.bv || 0), 0), damageTaken: this.dmgTakenShown(), damageGiven: this.dmgGiven() ?? undefined }));
            plan = { losses, prizes: claimed.map((o) => ({ instanceId: o.id, label: o.label })) };
        }
        // DELETES lost units (their damage envelopes with them) and resolveBranch clears the spec. Rows
        // carry no tokens — the player device filters by its own claim rows.
        let slipRows: SlipUnitRow[] | null = null;
        // the hot spot's title off the persisted forge.hotspot brief, the save name off the host record.
        let slipIdentity: { sessionName?: string; hotspotTitle?: string } = {};
        let slipEconomy = { opforBv: 0, claimedPrizeBv: 0 };
        let slipMap: Record<string, ChaosContract> = {};
        let slipPrimary: ChaosContract | null = null;
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
                // Hot Spots loss plan (the `loss` clause still wins for HS — every destroyed HS unit is in the plan via
                // isLost = destroyed || abandoned — so HS stays byte-identical), so a destroyed BLUFOR unit must read its
                // OWN reconciled end-state here, not collapse to 'ok' (which rendered a dead 'Mech as "operational").
                const destroyed = loss ? loss.reason : ((u.damage as { destroyed?: boolean } | null | undefined)?.destroyed ? 'destroyed' : 'ok');
                const prov = u.provenance;
                const originPilotId = this.pilotSvc.pilotFor(u.instanceId)?.originPilotId;
                return {
                    instanceId: u.instanceId,
                    label: `${u.chassis} ${u.model}`,
                    status: destroyed as 'ok' | 'destroyed' | 'abandoned',
                    ...(loss ? { pilotFate: loss.pilotFate } : {}),
                    ...(crew0[0]?.hits ? { crewHits: Math.max(0, Math.min(6, crew0[0].hits)) } : {}),
                    damage: u.damage ? JSON.parse(JSON.stringify(u.damage)) as SlipUnitRow['damage'] : null,
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
        const spBefore = new Map((this.state.pilots() ?? []).filter((p) => p.originPilotId).map((p) => [p.pilotId, p.campaignPilot?.careerSP ?? 0] as const));
        if (this.deployedCount() === 0) {
            // Spots the VP models (two-sided / single-sided) compute PARTIAL for blank marks, so mark the force BROKE too:
            // computed FAILURE === the override → the record isn't mislabeled a GM override. Traditional answers untouched.
            this.tree.resolveBranch({ primary: false, secondary: false, bonus: false, compromised: false, notes: '(no force deployed — operation forfeited)', ...(hs ? { broke: true } : {}) }, 'FAILURE');
        } else {
            this.tree.resolveBranch(this.rAns(), this.rOverride() || undefined);
        }
        if (hs && plan && branchId && (plan.losses.length || plan.prizes.length)) this.tree.applyHsSettlement(branchId, plan);
        // and read the settlement the tree just wrote. GM sessions only; replaced each resolve.
        if (slipRows && branchId) {
            const br = (this.state.missionTree() ?? []).find((b) => b.branchId === branchId);
            const pilotSp: Record<string, number> = {};
            for (const p of this.state.pilots() ?? []) {
                if (!p.originPilotId || !spBefore.has(p.pilotId)) continue;
                const d = (p.campaignPilot?.careerSP ?? 0) - (spBefore.get(p.pilotId) ?? 0);
                if (d > 0) pilotSp[p.originPilotId] = d;
            }
            const slipTier = br?.resolution?.outcomeTier as OutcomeGate | undefined;
            const slipPay = (hs && this.state.gmSession() && slipTier) ? slipPayFor(slipMap, slipRows.map((r) => r.sourceCampaignId).filter((k): k is string => !!k), slipTier, slipEconomy.opforBv, slipEconomy.claimedPrizeBv, !!slipPrimary && !this.state.activeChaosContract()) : undefined; // P2b — completed = the primary closed on this resolve
            this.state.setResultsSlip({
                slipId: newSlipId(),
                ...slipIdentity,
                branchId,
                trackName: br?.name ?? 'the track',
                resolvedAt: Date.now(),
                ...(br?.resolution?.outcomeTier ? { outcome: String(br.resolution.outcomeTier) } : {}),
                // HS always carries it (byte-identical); a Traditional resolve produces none → the fields are ABSENT, never a fabricated 0.
                ...(br?.resolution?.settlement ? { combatPay: br.resolution.settlement.combatPay, salvageSp: br.resolution.settlement.salvageSp } : {}),
                ...(slipPay ? { pay: slipPay } : {}),
                ...(Object.keys(pilotSp).length ? { pilotSp } : {}),
                units: slipRows,
            });
            for (const key of Object.keys(slipPay ?? {})) { const c = this.state.participantContracts()[key]; if (c && !c.repSettled) this.state.setParticipantContract(key, { ...c, repSettled: true }); }
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
        if (this.fieldWalk.pendingBranch() && !this.isHotspots()) this.walkOpen.set(true);
        // just resolved IS the engagement key; the server refuses every later battle write to it, claims untouched.
        const campId = this.store.campaignId();
        if (branchId && campId) this.rt.closeEngagement(campId, branchId);
    }
}
