/*
 * BCE — the Hot Spots contract NEGOTIATION subsystem (D-128 negotiate/sign/back-out · D-133 pick-a-side ·
 * D-136 sacrifice surface + fieldable-Scale gate · D-124e offer preview · D-129 Scale chooser). Extracted
 * VERBATIM from the chaos-contracts god file by DIRECTIVE-HARDEN-3 (pure move — every member body unchanged;
 * the book arithmetic keeps delegating to chaos-contract-steps.ts, which chaos-contract-steps.spec.ts pins).
 *
 * PROVIDED ON THE TAB COMPONENT (not root) — the HARDEN-2 HotspotIoState pattern: the form state
 * (typeId/scale/steps/raises/repUsed/sacrifices/negotiating/preview) gets EXACTLY the original component-field
 * lifetime (constructed with the tab, dies with the tab, survives internal branch flips), and the tab's test
 * seams (__d128/__d133/__d136/__d124c/__d124e) can drive it from the tab constructor with no modal open —
 * a child-owned form state could not satisfy either. The <bce-negotiate-modal> child renders the markup and
 * injects THIS tab-provided instance.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from './warchest.service';
import { MissionTreeService } from '../mission/mission-tree.service'; // D-110b — start the tree on accept
import { CHAOS_CONTRACT_TYPES, CONTRACT_COLUMNS, COLUMN_LABEL, stepValue, nextValidStep, repCostUp, sacrificeDropTarget, repBudgetFor, canRaiseTerm, type ContractColumn } from './chaos-contract-steps';
import { resolved, syntheticOfferFromChaos, authoredIntensity, type ChaosContract } from './chaos-contract'; // IMPORT-6 Part A — authored intensity, never clamped
import { hotspotSeedId, hotspotTypeId, resolveSides, opposingFaction, type CatalogHotSpot, type SideOffer } from './hotspots-catalog';

@Injectable()
export class NegotiationService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);
    private readonly missionTree = inject(MissionTreeService); // D-110b

    readonly types = CHAOS_CONTRACT_TYPES;
    readonly active = this.state.activeChaosContract;
    readonly rep = computed(() => this.state.reputation() ?? 1);

    // ── negotiation state ──
    readonly typeId = signal<string>(CHAOS_CONTRACT_TYPES[0].id);
    readonly scale = signal<number>(1);
    readonly intensity = signal<number>(CHAOS_CONTRACT_TYPES[0].intensityRange[0]);
    readonly steps = signal<Record<ContractColumn, number>>({ ...CHAOS_CONTRACT_TYPES[0].defaultSteps });
    readonly raises = signal<Record<ContractColumn, number>>({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
    readonly repUsed = signal<number>(0);
    readonly sacrificesUsed = signal<number>(0);
    readonly sacDrop = signal<ContractColumn>('support');
    readonly sacRaise = signal<ContractColumn>('basePay');

    // ── DIRECTIVE-136 (Part B) — gate the Contract Scale chooser by the player's FIELDABLE force (book: you need the
    //    'Mechs/BV to field a Scale). fieldableBv MIRRORS mission-generator playerBv() EXACTLY — the SAME
    //    state.startingForce() signal, the SAME 'In repair' exclusion, the SAME instance .bv sum — so the gate matches
    //    what the OpFor sizing + deploy actually use (the hard constraint).
    //    DECISION (source): replicate the pure expression rather than inject MissionGeneratorService — playerBv() is
    //    private and the data IS this shared state signal, so the result is identical with no new dependency (keep in
    //    sync with mission-generator.service.ts playerBv()).
    //    DECISION (threshold, ALL game systems): (n-1)*3000 BV — Scale 1 always · Scale 2 ≥3000 · Scale 3 ≥6000. The
    //    instance stores BV (not PV) even under Alpha Strike (force-generator sets bv:u.bv) and the deploy centers on
    //    that BV, so there is NO PV-based deploy value to match — BV keeps the gate == what deploys (this overrides the
    //    directive's optional PV-for-AS note, which the "must match what deploys" constraint outranks).
    readonly fieldableBv = computed(() =>
        (this.state.startingForce() ?? []).filter((u) => u.condition !== 'In repair').reduce((a, b) => a + (b.bv ?? 0), 0),
    );
    scaleNeedBv(n: number): number { return (n - 1) * 3000; }
    /** IMPORT-8 Ruling A (James, 2026-08-21) — supersedes D-136 Part B's GATE: the fieldable-BV line is now WARN-ONLY
     *  (house pattern: D-130 advisory BV · D-131 warn-only · IMPORT-7 honesty). Buttons never disable; the default is
     *  the AUTHORED Scale; scaleAvailable() now drives the honest INLINE warning (visible text — no hover on a tablet). */
    scaleAvailable(n: number): boolean { return this.fieldableBv() >= this.scaleNeedBv(n); }
    /** The largest Scale the fieldable force can meet (advisory since IMPORT-8 Ruling A — no longer clamps the default). */
    readonly maxFieldableScale = computed(() => { const bv = this.fieldableBv(); return bv >= 6000 ? 3 : bv >= 3000 ? 2 : 1; });

    // ── D-128 — per-card NEGOTIATE: every contract is negotiated from its offer card. `negotiating` holds the hotspot
    //    whose terms are open in the modal (repurposes the retired D-124c `negotiateDraw` signal). accept() builds the
    //    contract from the negotiated terms + this hotspot's SCENARIO (world/tracks/OpFor/tree) — never a Forge roll. ──
    readonly negotiating = signal<CatalogHotSpot | null>(null);
    // D-133 — the chosen SIDE ('a' authored / 'b' opposing) open in the negotiation modal.
    readonly negSide = signal<'a' | 'b'>('a');
    /** The SideOffer + opposing faction open in the negotiation modal (drives the header). */
    readonly negSideOffer = computed<SideOffer | null>(() => { const h = this.negotiating(); return h ? resolveSides(h)[this.negSide()] ?? null : null; });
    readonly negOpposing = computed<string>(() => { const h = this.negotiating(); return h ? opposingFaction(h, this.negSide()) : ''; });
    // IMPORT-5 Parts B+E — the negotiate header/briefing prefers the picked SIDE's identity + narrative, falling back
    // to the shared top-level hot spot (so authored packs without per-side fields render byte-identically).
    readonly negTitle = computed<string>(() => this.negSideOffer()?.title ?? this.negotiating()?.title ?? '');
    readonly negType = computed<string>(() => this.negSideOffer()?.type ?? this.negotiating()?.type ?? '');
    readonly negEmployerDesc = computed<string>(() => this.negSideOffer()?.employerDesc ?? this.negotiating()?.employerDesc ?? '');
    readonly negSituation = computed<string>(() => this.negSideOffer()?.situation ?? this.negotiating()?.situation ?? '');
    readonly negDescription = computed<string>(() => this.negotiating()?.systemProfile.description ?? '');
    readonly negSystem = computed<{ label: string; value: string }[]>(() => this.sysRowsFor(this.negotiating()));
    /** D-128/D-133 — open the negotiation modal for a specific offer card + SIDE. Seeds the negotiation from THAT side's
     *  contract (steps/scale/intensity); the modal header shows that side's employer + `vs {opposingFaction}`. */
    negotiateHotspot(h: CatalogHotSpot, side: 'a' | 'b' = 'a'): void {
        if (this.state.campaignSystem() !== 'hotspots' || this.active()) return;
        const s = resolveSides(h)[side];
        if (!s) return; // IMPORT-5 Part C — a single-sided hot spot has no side B; the board only offers side 'a' for it
        // set the hotspot + side FIRST so resetNegotiation re-seeds from this side's terms
        this.negotiating.set(h); this.negSide.set(side);
        this.typeId.set(hotspotTypeId(h));
        this.scale.set(s.contract.scale); // IMPORT-8 Ruling A — open at the AUTHORED Scale, always (the D-136 clamp is superseded: the fieldable-BV line is now a WARN, not a gate)
        // IMPORT-6 Part A — the AUTHORED intensity is the contract's track count, verbatim. The mapped contract type's
        // intensityRange is a constraint on the free negotiate (setType/intensityOptions), NOT a cap on authored content:
        // clamping here silently rewrote e.g. a 5-track custom to 3 (expedition) / 2 (raid) so `tracksDone >= intensity`
        // completed the contract at chain end with the author's remaining tracks orphaned. Traditional never enters here.
        this.intensity.set(authoredIntensity(s.contract));
        this.steps.set({ ...s.contract.steps });
        this.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
        this.repUsed.set(0); this.sacrificesUsed.set(0);
    }
    /** D-128 — close the modal without signing (✕ / overlay-click / Discard); clears the negotiating hotspot + resets terms. */
    discardNegotiation(): void { this.negotiating.set(null); this.resetNegotiation(); }

    // ── D-124e — offer-board hotspot PREVIEW: a read-only contract-offer summary (system + travel + gist + WHO you
    //    fight for / who opposes). NO tactical/OpFor detail is read into this view. Additive; offer/pick/reroll unchanged. ──
    readonly previewHotspot = signal<CatalogHotSpot | null>(null);
    readonly previewSide = signal<'a' | 'b'>('a'); // D-133 — the previewed side
    viewHotspot(h: CatalogHotSpot, side: 'a' | 'b' = 'a'): void { this.previewHotspot.set(h); this.previewSide.set(side); }
    closePreview(): void { this.previewHotspot.set(null); }
    /** D-128/D-133 — from the Brief modal, close it and open the negotiation modal for this hotspot + the previewed side. */
    pickFromPreview(): void { const h = this.previewHotspot(); if (!h) return; const side = this.previewSide(); this.previewHotspot.set(null); this.negotiateHotspot(h, side); }
    /** D-133 — the previewed side's employer + the opposing faction (for the .cpv Fighting-for / Opposing blocks). */
    readonly previewSideOffer = computed<SideOffer | null>(() => { const h = this.previewHotspot(); return h ? resolveSides(h)[this.previewSide()] ?? null : null; });
    readonly previewOpposing = computed<string>(() => { const h = this.previewHotspot(); return h ? opposingFaction(h, this.previewSide()) : ''; });
    // IMPORT-5 Parts B+E — the Brief prefers the previewed SIDE's identity/narrative, falling back to the shared top-level.
    readonly previewTitle = computed<string>(() => this.previewSideOffer()?.title ?? this.previewHotspot()?.title ?? '');
    readonly previewType = computed<string>(() => this.previewSideOffer()?.type ?? this.previewHotspot()?.type ?? '');
    readonly previewEmployerDesc = computed<string>(() => this.previewSideOffer()?.employerDesc ?? this.previewHotspot()?.employerDesc ?? '');
    /** The op gist: the picked side's OWN situation when authored (IMPORT-5 custom two-sided), else the shared gist
     *  `blurb ?? situation` EXACTLY as before — so the authored packs (no per-side situation) render byte-identically. */
    readonly previewOp = computed<string>(() => { const so = this.previewSideOffer(); const h = this.previewHotspot(); return so?.situation || h?.blurb || h?.situation || ''; });
    readonly previewDescription = computed<string>(() => this.previewHotspot()?.systemProfile.description ?? '');
    /** systemProfile → compact label/value pairs, nulls omitted (facts only — no tactical fields). Shared by the .cpv
     *  Brief (previewSystem) and the .cng negotiate briefing (negSystem). IMPORT-5 Part B. */
    private sysRowsFor(h: CatalogHotSpot | null): { label: string; value: string }[] {
        if (!h) return [];
        const s = h.systemProfile; const out: { label: string; value: string }[] = [];
        const add = (label: string, v: unknown, suffix = ''): void => { if (v != null && v !== '') out.push({ label, value: `${v}${suffix}` }); };
        add('Star', s.starType); add('Position', s.positionInSystem); add('Gravity', s.surfaceGravity, ' g');
        add('Atmosphere', s.atmPressure); add('Mean temp', s.equatorialTempC, ' °C'); add('Climate', s.climate);
        add('Surface water', s.surfaceWaterPct, '%'); add('Satellites', s.satellites); add('Native life', s.highestNativeLife);
        add('HPG', s.hpgClass); add('Recharge station', s.rechargeStation);
        add('Population', s.population != null ? s.population.toLocaleString('en-US') : null, s.populationYear ? ` (${s.populationYear})` : '');
        add('Socio-industrial', s.socioIndustrial); add('Capital', s.capitalCity);
        add('Landmasses', s.landmasses && s.landmasses.length ? s.landmasses.join(', ') : null);
        return out;
    }
    readonly previewSystem = computed<{ label: string; value: string }[]>(() => this.sysRowsFor(this.previewHotspot()));
    /** Transit + transport cost: jump-point transit + jump-sail recharge from the profile + the transport SP (the
     *  contract travel model — gross 300×scale, cover = steps.transport %, mirrors pickHotspot's transport post). */
    readonly previewTransit = computed(() => {
        const h = this.previewHotspot();
        if (!h) return { jumpDays: null as number | null, rechargeHours: null as number | null, net: 0, cover: 0 };
        const s = h.systemProfile; const gross = 300 * h.contract.scale;
        const cover = Math.round((gross * resolved(h.contract.steps).transport) / 100);
        return { jumpDays: s.timeToJumpPointDays ?? null, rechargeHours: s.rechargeHours ?? null, net: gross - cover, cover };
    });
    /** Global campaign reputation as 0-5 pips + value. (Per-employer reputation isn't tracked yet — see hand-back.) */
    readonly repPips = computed<boolean[]>(() => { const r = Math.max(0, Math.min(5, this.rep())); return Array.from({ length: 5 }, (_, i) => i < r); });

    readonly type = computed(() => this.types.find((t) => t.id === this.typeId()) ?? this.types[0]);
    readonly repBudget = computed(() => repBudgetFor(this.rep(), this.scale()));
    readonly intensityOptions = computed(() => { const [lo, hi] = this.type().intensityRange; return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i); });
    readonly terms = computed(() => resolved(this.steps()));
    readonly basePayLive = computed(() => Math.round((500 * this.scale() * this.terms().basePay) / 100));
    readonly transportCover = computed(() => Math.round((300 * this.scale() * this.terms().transport) / 100));
    readonly transportPaid = computed(() => 300 * this.scale() - this.transportCover());

    colLabel(col: ContractColumn): string { return COLUMN_LABEL[col]; }
    typeLabel(id: string): string { return this.types.find((t) => t.id === id)?.label ?? id; }
    money(n: number): string { return Math.round(n).toLocaleString('en-US'); }

    private fmt(col: ContractColumn, v: number | string | null): string {
        if (v == null) return '—';
        if (col === 'basePay' || col === 'transport' || (col === 'salvage' && typeof v === 'number')) return `${v}%`;
        return String(v);
    }
    displayValue(col: ContractColumn): string { return this.fmt(col, stepValue(col, this.steps()[col])); }
    resolvedValue(steps: Record<ContractColumn, number>, col: ContractColumn): string { return this.fmt(col, stepValue(col, steps[col])); }
    basePayFor(c: ChaosContract): number { return Math.round((500 * c.scale * resolved(c.steps).basePay) / 100); }
    coverPctFor(c: ChaosContract): string { return resolved(c.steps).support; }

    // ── negotiation rules (deterministic; DIRECTIVE-128 book-exact — raises count step-ROWS, `—` rows paid-but-wasted) ──
    /** D-128 — the Rep cost (rows) to raise this term one increment, for the ▲ Rep (N) button label; null if capped out. */
    repCost(col: ContractColumn): number | null { return repCostUp(col, this.steps()[col]); }
    /** D-128 — a term can be Rep-raised iff its row-cost is payable within the Rep budget AND the per-Scale row cap. */
    canRaise(col: ContractColumn): boolean {
        return canRaiseTerm(repCostUp(col, this.steps()[col]), this.repUsed(), this.repBudget(), this.raises()[col], this.scale());
    }
    repRaise(col: ContractColumn): void {
        if (!this.canRaise(col)) return;
        const to = nextValidStep(col, this.steps()[col], 1);
        if (to == null) return;
        const c = to - this.steps()[col]; // rows crossed (em-dash rows are paid-but-wasted)
        this.steps.update((s) => ({ ...s, [col]: to }));
        this.raises.update((r) => ({ ...r, [col]: r[col] + c }));
        this.repUsed.update((n) => n + c);
    }
    /** D-128 — a sacrifice is legal iff a drop target exists (drop 2 rows, floor to a valid step at/below), a valid
     *  raise step is up, and the raise's ROW cost still fits the raised term's per-Scale cap. The drop consumes no Rep. */
    canSacrifice(): boolean {
        const drop = this.sacDrop(), raise = this.sacRaise();
        if (this.sacrificesUsed() >= 2 || drop === raise) return false;
        if (sacrificeDropTarget(drop, this.steps()[drop]) == null) return false;
        const rt = nextValidStep(raise, this.steps()[raise], 1);
        if (rt == null) return false;
        return this.raises()[raise] + (rt - this.steps()[raise]) <= this.scale();
    }
    doSacrifice(): void {
        if (!this.canSacrifice()) return;
        const drop = this.sacDrop(), raise = this.sacRaise();
        const dropTo = sacrificeDropTarget(drop, this.steps()[drop]);
        const rt = nextValidStep(raise, this.steps()[raise], 1);
        if (dropTo == null || rt == null) return;
        const rc = rt - this.steps()[raise]; // the raise's row cost counts toward the per-term cap
        this.steps.update((s) => ({ ...s, [drop]: dropTo, [raise]: rt }));
        this.raises.update((r) => ({ ...r, [raise]: r[raise] + rc }));
        this.sacrificesUsed.update((n) => n + 1);
    }
    // ── DIRECTIVE-136 (Part A) — surface the sacrifice control's state so the dropdowns disable dead options and the
    //    button explains itself. NO math change — these MIRROR the canSacrifice sub-checks. dropValid/raiseValid are
    //    the per-term structural checks (the exact predicates inside canSacrifice); canDrop/canRaiseSac add the
    //    cross-term exclusion (a term can't be both the drop and the raise) for the two <select>s. ──
    dropValid(col: ContractColumn): boolean { return sacrificeDropTarget(col, this.steps()[col]) != null; }
    raiseValid(col: ContractColumn): boolean {
        const rt = nextValidStep(col, this.steps()[col], 1);
        return rt != null && this.raises()[col] + (rt - this.steps()[col]) <= this.scale();
    }
    canDrop(col: ContractColumn): boolean { return this.dropValid(col) && col !== this.sacRaise(); }
    canRaiseSac(col: ContractColumn): boolean { return this.raiseValid(col) && col !== this.sacDrop(); }
    /** True iff SOME valid (drop, raise) pair exists — else "no sacrifice available" (every term capped/maxed). */
    readonly sacPossible = computed(() => {
        const drops = CONTRACT_COLUMNS.filter((c) => this.dropValid(c));
        const raises = CONTRACT_COLUMNS.filter((c) => this.raiseValid(c));
        return drops.some((d) => raises.some((r) => r !== d));
    });
    /** D-136 — the reason the SACRIFICE button is disabled (null when enabled). Covers ALL three canSacrifice blockers:
     *  the 2-sacrifice cap (which sacPossible ignores — the auto-heal keeps a valid pair selected, so the cap is the only
     *  reachable !canSacrifice state while a pair still exists), the no-valid-pair case, else the pick-a-workable-pair hint. */
    readonly sacDisabledReason = computed<string | null>(() => {
        if (this.canSacrifice()) return null;
        if (this.sacrificesUsed() >= 2) return 'You have used both sacrifices for this contract (2 / 2).';
        if (!this.sacPossible()) return 'No sacrifice available — every term is at its Scale cap.';
        return 'Pick a term you can drop two steps and another you can still raise within the per-Scale cap.';
    });
    /** D-136 — keep the sacrifice selects on a WORKABLE pair: reselect the first valid drop + first valid raise (≠drop)
     *  whenever the current pair falls invalid (modal open, a Scale change, a rep raise that caps a term). No-op if no
     *  valid drop/raise remains (the "no sacrifice available" case). Purely a selection heal — no math change. */
    private healSacrifice(): void {
        let drop = this.sacDrop(), raise = this.sacRaise();
        if (!this.dropValid(drop)) { const d = CONTRACT_COLUMNS.find((c) => this.dropValid(c)); if (d) drop = d; }
        if (raise === drop || !this.raiseValid(raise)) { const r = CONTRACT_COLUMNS.find((c) => c !== drop && this.raiseValid(c)); if (r) raise = r; }
        if (drop !== this.sacDrop()) this.sacDrop.set(drop);
        if (raise !== this.sacRaise()) this.sacRaise.set(raise);
    }

    setType(id: string): void { this.typeId.set(id); this.resetNegotiation(); const [lo, hi] = this.type().intensityRange; this.intensity.set(Math.min(hi, Math.max(lo, this.intensity()))); }
    setScale(n: number): void { this.scale.set(n); this.resetNegotiation(); } // caps depend on scale → renegotiate
    resetNegotiation(): void {
        // D-128 — with a hotspot open, Reset returns to THAT job's AUTHORED terms (the negotiation baseline), not the
        // generic type defaults; with none open (after Discard), the type defaults. IMPORT-5 Part E — revert to the
        // PICKED SIDE's terms (matches negotiateHotspot's seed), so Reset on side B doesn't snap back to side A.
        const draw = this.negotiating();
        this.steps.set(draw ? { ...(resolveSides(draw)[this.negSide()]?.contract.steps ?? draw.contract.steps) } : { ...this.type().defaultSteps });
        this.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
        this.repUsed.set(0);
        this.sacrificesUsed.set(0);
    }

    /** D-128 — Accept & sign: the SOLE sign path (from the negotiation modal). Builds the ChaosContract from the
     *  NEGOTIATED terms + the negotiating hotspot's SCENARIO (world/tracks/OpFor/tree; never a Forge roll), snapshots
     *  the offer hand for Back-to-contracts, then clears the hand (a fresh 5 re-deals after this contract completes).
     *  Unifies the retired accept()/pickHotspot. */
    accept(): void {
        if (this.state.campaignSystem() !== 'hotspots' || this.active()) return;
        const h = this.negotiating();
        if (!h) return; // no card open — nothing to sign
        const side = this.negSide(); const s = resolveSides(h)[side]; // D-133 — the picked side
        if (!s) return; // IMPORT-5 Part C — a single-sided hot spot has no side B; negSide is always 'a' for it, so this only guards the impossible
        const scale = this.scale(), steps = { ...this.steps() }; // the negotiated terms (raises/sacrifices baked in)
        const contract: ChaosContract = {
            id: 'cc-' + this.state.warchestLedger().length + '-' + h.id, // deterministic id (no Date.now)
            type: hotspotTypeId(h), scale, intensity: this.intensity(), steps, status: 'active',
            acceptedDate: this.state.currentDate() ?? this.state.startDate() ?? null, tracksDone: 0,
            enemyFaction: opposingFaction(h, side), hotspotId: h.id, // D-133 — the OPPOSING side's faction (the OpFor); side A = today's enemy
            offerSnapshot: [...(this.state.hotSpotOffer() ?? [])], // D-128 — the hand at signing; Back-to-contracts restores it
            lengthMonths: s.contract.lengthMonths ?? Math.max(s.contract.intensity, 1), // D-131 — the month WINDOW (authored, else intensity)
            side, sideRole: s.role, employer: s.employer, // D-133 — the picked side (role + who you signed with)
        };
        this.state.setActiveChaosContract(contract);
        this.state.setContractScale(scale);
        this.state.setHotSpotOffer([]); // D-128 — the hand is spent at signing; a fresh 5 re-deals after completion
        const off = syntheticOfferFromChaos(contract);
        this.state.setAcceptedContract(off);
        // IMPORT-5 Part A (the BLOCKER) — a custom hot spot may have ZERO embedded tracks (universal-library play). Guard
        // the undefined root: mintRoot tolerates an absent root (mints a generic AVAILABLE root), so accept() no longer
        // throws before minting the tree — the operations-board picker + the contract-card "▶ Play a track" now appear.
        const root = h.tracks.find((t) => t.root) ?? h.tracks[0]; // seed the tree from the hotspot's root track (never Forge)
        this.missionTree.mintRoot(off, root ? { seedId: hotspotSeedId(h.id, root.id), name: root.name, trackType: root.templateId } : undefined); // D-129 — carry the root track type to the flow node (0-track → generic root)
        const transportCover = Math.round((300 * scale * resolved(steps).transport) / 100);
        this.warchest.post(`Transport — ${h.title}`, 300 * scale, transportCover); // cost gross, cover reimbursed
        this.negotiating.set(null); // signed — close the modal
        void this.store.persistCurrent();
    }

    // ── D-128 — Back out of a freshly-signed contract (pre-deployment only) ──
    /** True only while the contract is still pristine (signed, root AVAILABLE, no track generated / no spec). */
    canBackOut(): boolean {
        return this.state.campaignSystem() === 'hotspots' && !!this.active() && !this.missionTree.hasGeneratedTrack();
    }
    backOutTitle(): string {
        return this.canBackOut()
            ? 'Abandon this contract and return to the offer board (−1 Reputation; transport refunded).'
            : 'A track has been generated — you’re committed to this contract.';
    }
    /** D-128 — abandon a freshly-signed contract: refund the net transport (negative cost = ledger income), −1
     *  Reputation, restore the exact offer hand from signing, discard the minted root + clear the contract, persist.
     *  Distinct from End Contract (a COMPLETED deal, Rep +1); this is an ABANDONED pre-deployment contract, Rep −1.
     *  Touches no salvage/repair/pilots — the track was never generated (canBackOut guards it). */
    backOut(): void {
        if (!this.canBackOut()) return;
        const c = this.active();
        if (!c) return;
        const off = this.state.acceptedContract(); // the synthetic offer, to archive its (empty) tree
        const cover = Math.round((300 * c.scale * resolved(c.steps).transport) / 100);
        this.warchest.post('Contract abandoned — transport refund', -(300 * c.scale - cover), 0); // negative cost = income
        this.state.setReputation(Math.max(0, (this.state.reputation() ?? 1) - 1)); // walking a signed deal costs 1 Rep
        this.state.setHotSpotOffer(c.offerSnapshot ?? []); // restore the hand that was on offer at signing (legacy → empty → re-deal)
        this.state.setActiveChaosContract(null);
        this.state.setAcceptedContract(null);
        this.missionTree.closeTree(off ?? undefined); // discard the minted root
        // DECISION: endContract does NOT reset contractScale (it's re-set on the next accept); backOut mirrors it exactly.
        void this.store.persistCurrent();
    }

    constructor() {
        // DIRECTIVE-136 (Part A) — auto-heal the sacrifice pair while the negotiate modal is open: on open, a Scale
        // change, or a rep raise that caps a term, reselect a workable drop/raise so the control never opens dead.
        effect(() => {
            this.steps(); this.raises(); this.scale(); const open = !!this.negotiating(); // deps: any term/scale change or (re)open
            untracked(() => { if (open) this.healSacrifice(); });
        });
    }
}
