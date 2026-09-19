import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from './warchest.service';
import { NEGOTIATION_HOST } from './negotiation-host';
import { CHAOS_CONTRACT_TYPES, CONTRACT_COLUMNS, COLUMN_LABEL, stepValue, nextValidStep, repCostUp, sacrificeDropTarget, repBudgetFor, canRaiseTerm, type ContractColumn } from './chaos-contract-steps';
import { resolved, syntheticOfferFromChaos, authoredIntensity, isSessionContract, GM_SELF_KEY, type ChaosContract, type VoidedContract } from './chaos-contract';
import { hotspotSeedId, hotspotTypeId, resolveSides, opposingFaction, type CatalogHotSpot, type SideOffer } from './hotspots-catalog';

@Injectable()
export class NegotiationService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);
    private readonly host = inject(NEGOTIATION_HOST);

    readonly types = CHAOS_CONTRACT_TYPES;
    readonly active = computed(() => this.state.contractFor());
    readonly participantRep = signal<number | null>(null);
    readonly lockedCommand = signal<number | null>(null);
    readonly rep = computed(() => this.participantRep() ?? this.state.reputation() ?? 1);

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
    scaleAvailable(n: number): boolean { return this.fieldableBv() >= this.scaleNeedBv(n); }
    readonly maxFieldableScale = computed(() => { const bv = this.fieldableBv(); return bv >= 6000 ? 3 : bv >= 3000 ? 2 : 1; });

    //    contract from the negotiated terms + this hotspot's SCENARIO (world/tracks/OpFor/tree) — never a Forge roll. ──
    readonly negotiating = signal<CatalogHotSpot | null>(null);
    readonly forParticipant = signal<{ key: string; label: string } | null>(null);
    readonly negSide = signal<'a' | 'b'>('a');
    /** The SideOffer + opposing faction open in the negotiation modal (drives the header). */
    readonly negSideOffer = computed<SideOffer | null>(() => { const h = this.negotiating(); return h ? resolveSides(h)[this.negSide()] ?? null : null; });
    readonly negOpposing = computed<string>(() => { const h = this.negotiating(); return h ? opposingFaction(h, this.negSide()) : ''; });
    // to the shared top-level hot spot (so authored packs without per-side fields render byte-identically).
    readonly negTitle = computed<string>(() => this.negSideOffer()?.title ?? this.negotiating()?.title ?? '');
    readonly negType = computed<string>(() => this.negSideOffer()?.type ?? this.negotiating()?.type ?? '');
    readonly negEmployerDesc = computed<string>(() => this.negSideOffer()?.employerDesc ?? this.negotiating()?.employerDesc ?? '');
    readonly negSituation = computed<string>(() => this.negSideOffer()?.situation ?? this.negotiating()?.situation ?? '');
    readonly negDescription = computed<string>(() => this.negotiating()?.systemProfile.description ?? '');
    readonly negSystem = computed<{ label: string; value: string }[]>(() => this.sysRowsFor(this.negotiating()));
    negotiateHotspot(h: CatalogHotSpot, side: 'a' | 'b' = 'a'): void {
        if (this.state.campaignSystem() !== 'hotspots' || this.active()) return;
        const s = resolveSides(h)[side];
        if (!s) return;
        this.forParticipant.set(null); this.participantRep.set(null); this.lockedCommand.set(null);
        this.seedFrom(h, side, s);
    }
    negotiateForParticipant(h: CatalogHotSpot, side: 'a' | 'b', participant: { key: string; label: string }, rep: number | null = null, lockedCommand: number | null = null): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.state.gmSession()) return;
        const sides = resolveSides(h);
        const sd: 'a' | 'b' = sides[side] ? side : 'a';
        const s = sides[sd];
        if (!s) return;
        this.forParticipant.set(participant);
        this.participantRep.set(rep); // P2b — THEIR rep
        this.lockedCommand.set(lockedCommand); // P2b — Command locked to the primary's step
        this.seedFrom(h, sd, s);
    }
    private seedFrom(h: CatalogHotSpot, side: 'a' | 'b', s: SideOffer): void {
        // set the hotspot + side FIRST so resetNegotiation re-seeds from this side's terms
        this.negotiating.set(h); this.negSide.set(side);
        this.typeId.set(hotspotTypeId(h));
        this.scale.set(s.contract.scale);
        // intensityRange is a constraint on the free negotiate (setType/intensityOptions), NOT a cap on authored content:
        // clamping here silently rewrote e.g. a 5-track custom to 3 (expedition) / 2 (raid) so `tracksDone >= intensity`
        // completed the contract at chain end with the author's remaining tracks orphaned. Traditional never enters here.
        this.intensity.set(authoredIntensity(s.contract));
        this.steps.set({ ...s.contract.steps });
        this.applyCommandLock();
        this.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
        this.repUsed.set(0); this.sacrificesUsed.set(0);
    }
    private applyCommandLock(): void {
        const lc = this.lockedCommand();
        if (lc != null && this.forParticipant()) this.steps.update((st) => ({ ...st, command: lc }));
    }
    discardNegotiation(): void { this.negotiating.set(null); this.forParticipant.set(null); this.participantRep.set(null); this.lockedCommand.set(null); this.resetNegotiation(); }

    //    fight for / who opposes). NO tactical/OpFor detail is read into this view. Additive; offer/pick/reroll unchanged. ──
    readonly previewHotspot = signal<CatalogHotSpot | null>(null);
    readonly previewSide = signal<'a' | 'b'>('a');
    viewHotspot(h: CatalogHotSpot, side: 'a' | 'b' = 'a'): void { this.previewHotspot.set(h); this.previewSide.set(side); }
    closePreview(): void { this.previewHotspot.set(null); }
    pickFromPreview(): void { const h = this.previewHotspot(); if (!h) return; const side = this.previewSide(); this.previewHotspot.set(null); this.negotiateHotspot(h, side); }
    readonly previewSideOffer = computed<SideOffer | null>(() => { const h = this.previewHotspot(); return h ? resolveSides(h)[this.previewSide()] ?? null : null; });
    readonly previewOpposing = computed<string>(() => { const h = this.previewHotspot(); return h ? opposingFaction(h, this.previewSide()) : ''; });
    readonly previewTitle = computed<string>(() => this.previewSideOffer()?.title ?? this.previewHotspot()?.title ?? '');
    readonly previewType = computed<string>(() => this.previewSideOffer()?.type ?? this.previewHotspot()?.type ?? '');
    readonly previewEmployerDesc = computed<string>(() => this.previewSideOffer()?.employerDesc ?? this.previewHotspot()?.employerDesc ?? '');
    readonly previewOp = computed<string>(() => { const so = this.previewSideOffer(); const h = this.previewHotspot(); return so?.situation || h?.blurb || h?.situation || ''; });
    readonly previewDescription = computed<string>(() => this.previewHotspot()?.systemProfile.description ?? '');
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

    repCost(col: ContractColumn): number | null { return repCostUp(col, this.steps()[col]); }
    canRaise(col: ContractColumn): boolean {
        if (col === 'command' && this.forParticipant()) return false;
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
    canSacrifice(): boolean {
        const drop = this.sacDrop(), raise = this.sacRaise();
        if (this.sacrificesUsed() >= 2 || drop === raise) return false;
        if (this.forParticipant() && (drop === 'command' || raise === 'command')) return false; // P2b — the lock holds through a sacrifice too
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
    //    button explains itself. NO math change — these MIRROR the canSacrifice sub-checks. dropValid/raiseValid are
    //    the per-term structural checks (the exact predicates inside canSacrifice); canDrop/canRaiseSac add the
    //    cross-term exclusion (a term can't be both the drop and the raise) for the two <select>s. ──
    dropValid(col: ContractColumn): boolean { return sacrificeDropTarget(col, this.steps()[col]) != null; }
    raiseValid(col: ContractColumn): boolean {
        const rt = nextValidStep(col, this.steps()[col], 1);
        return rt != null && this.raises()[col] + (rt - this.steps()[col]) <= this.scale();
    }
    canDrop(col: ContractColumn): boolean { return this.dropValid(col) && col !== this.sacRaise() && !(col === 'command' && this.forParticipant()); } // P2b — never the locked Command
    canRaiseSac(col: ContractColumn): boolean { return this.raiseValid(col) && col !== this.sacDrop() && !(col === 'command' && this.forParticipant()); } // P2b
    /** True iff SOME valid (drop, raise) pair exists — else "no sacrifice available" (every term capped/maxed). */
    readonly sacPossible = computed(() => {
        const drops = CONTRACT_COLUMNS.filter((c) => this.dropValid(c));
        const raises = CONTRACT_COLUMNS.filter((c) => this.raiseValid(c));
        return drops.some((d) => raises.some((r) => r !== d));
    });
    readonly sacDisabledReason = computed<string | null>(() => {
        if (this.canSacrifice()) return null;
        if (this.sacrificesUsed() >= 2) return 'You have used both sacrifices for this contract (2 / 2).';
        if (!this.sacPossible()) return 'No sacrifice available — every term is at its Scale cap.';
        return 'Pick a term you can drop two steps and another you can still raise within the per-Scale cap.';
    });
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
        // PICKED SIDE's terms (matches negotiateHotspot's seed), so Reset on side B doesn't snap back to side A.
        const draw = this.negotiating();
        this.steps.set(draw ? { ...(resolveSides(draw)[this.negSide()]?.contract.steps ?? draw.contract.steps) } : { ...this.type().defaultSteps });
        this.applyCommandLock(); // P2b
        this.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
        this.repUsed.set(0);
        this.sacrificesUsed.set(0);
    }

    accept(): void {
        if (this.state.campaignSystem() !== 'hotspots' || (this.active() && !this.forParticipant())) return;
        const h = this.negotiating();
        if (!h) return; // no card open — nothing to sign
        const side = this.negSide(); const s = resolveSides(h)[side];
        if (!s) return;
        const scale = this.scale(), steps = { ...this.steps() }; // the negotiated terms (raises/sacrifices baked in)
        const contract: ChaosContract = {
            id: 'cc-' + this.state.warchestLedger().length + '-' + h.id, // deterministic id (no Date.now)
            type: hotspotTypeId(h), scale, intensity: this.intensity(), steps, status: 'active',
            acceptedDate: this.state.currentDate() ?? this.state.startDate() ?? null, tracksDone: 0,
            enemyFaction: opposingFaction(h, side), hotspotId: h.id,
            offerSnapshot: [...(this.state.hotSpotOffer() ?? [])],
            lengthMonths: s.contract.lengthMonths ?? Math.max(s.contract.intensity, 1),
            side, sideRole: s.role, employer: s.employer,
        };
        // of the primary's side effects — the singular, the offer hand, the scale copy, the tree mint, the transport post.
        // The track is the primary's; this company merely signs its own terms on it.
        const fp = this.forParticipant();
        if (fp) {
            // P2b — the signing ledger rides the contract: the rep spent here + the net transport (settled on the first slip)
            const { offerSnapshot: _os, ...pcBase } = contract; void _os; // the offer hand is the PRIMARY's back-out restore — a participant contract never carries it (and the wire allowlist refuses it)
            this.host.signParticipant(fp.key, { ...pcBase, id: `pc-${fp.key}-${h.id}`, repSpent: this.repUsed(), transportSp: this.transportPaid() });
            this.forParticipant.set(null); this.participantRep.set(null); this.lockedCommand.set(null); this.negotiating.set(null);
            return;
        }
        this.state.setActiveChaosContract(contract);
        this.state.setContractScale(scale);
        this.state.setHotSpotOffer([]);
        const off = syntheticOfferFromChaos(contract);
        this.state.setAcceptedContract(off);
        // the undefined root: mintRoot tolerates an absent root (mints a generic AVAILABLE root), so accept() no longer
        // throws before minting the tree — the operations-board picker + the contract-card "▶ Play a track" now appear.
        const root = h.tracks.find((t) => t.root) ?? h.tracks[0]; // seed the tree from the hotspot's root track (never Forge)
        this.host.mintRoot(off, root ? { seedId: hotspotSeedId(h.id, root.id), name: root.name, trackType: root.templateId } : undefined);
        const transportCover = Math.round((300 * scale * resolved(steps).transport) / 100);
        this.warchest.post(`Transport — ${h.title}`, 300 * scale, transportCover); // cost gross, cover reimbursed
        this.negotiating.set(null); // signed — close the modal
        void this.store.persistCurrent();
    }

    /** True only while the contract is still pristine (signed, root AVAILABLE, no track generated / no spec). */
    canBackOut(): boolean {
        return this.state.campaignSystem() === 'hotspots' && !!this.active() && !isSessionContract(this.active()) && !this.host.hasGeneratedTrack();
    }
    backOutTitle(): string {
        return this.canBackOut()
            ? 'Abandon this contract and return to the offer board (−1 Reputation; transport refunded).'
            : 'A track has been generated — you’re committed to this contract.';
    }
    backOut(): void {
        if (!this.canBackOut()) return;
        const c = this.active();
        if (!c) return;
        const off = this.state.offerFor();
        const cover = Math.round((300 * c.scale * resolved(c.steps).transport) / 100);
        this.warchest.post('Contract abandoned — transport refund', -(300 * c.scale - cover), 0); // negative cost = income
        this.state.setReputation(Math.max(0, (this.state.reputation() ?? 1) - 1)); // walking a signed deal costs 1 Rep
        this.state.setHotSpotOffer(c.offerSnapshot ?? []); // restore the hand that was on offer at signing (legacy → empty → re-deal)
        this.state.setActiveChaosContract(null);
        this.state.setAcceptedContract(null);
        this.state.clearParticipantContracts();
        this.host.closeTree(off ?? undefined); // discard the minted root
        // DECISION: endContract does NOT reset contractScale (it's re-set on the next accept); backOut mirrors it exactly.
        void this.store.persistCurrent();
    }

    /** Present ▸ on a GM session mints the SESSION CONTRACT from the hot spot's AUTHORED terms for the side the table plays:
     *  Scale · steps · lengthMonths · that side's target — NO party (nobody's warchest or reputation is touched: no transport
     *  post, no hand spent, no offer snapshot), stored as the singular so `contractFor(participant) ?? primary` falls back to
     *  it and every direct read gets a template. The tree starts HERE (hook 1), not at a sign. gmSession-only by guard; a
     *  plain campaign can never reach it (accept() is its sole sign path, byte-untouched). Returns false when refused. */
    presentSession(h: CatalogHotSpot, side: 'a' | 'b' = 'a'): boolean {
        if (!this.state.gmSession() || this.state.campaignSystem() !== 'hotspots' || this.state.activeChaosContract()) return false;
        const sides = resolveSides(h); const s = sides[side] ?? sides.a; if (!s) return false;
        const pickedSide: 'a' | 'b' = sides[side] ? side : 'a';
        const contract: ChaosContract = {
            id: 'sc-' + this.state.warchestLedger().length + '-' + h.id, // deterministic id (no Date.now)
            type: hotspotTypeId(h), scale: s.contract.scale, intensity: authoredIntensity(s.contract), steps: { ...s.contract.steps }, status: 'active',
            acceptedDate: this.state.currentDate() ?? this.state.startDate() ?? null, tracksDone: 0, // presented date = the month window's start (hook 2)
            enemyFaction: opposingFaction(h, pickedSide), hotspotId: h.id, // the chosen side's target (hook 3) — every participant signs this side
            lengthMonths: s.contract.lengthMonths ?? Math.max(s.contract.intensity, 1),
            side: pickedSide, sideRole: s.role, employer: s.employer,
            party: 'session',
        };
        this.state.setActiveChaosContract(contract);
        this.state.setContractScale(contract.scale);
        const off = syntheticOfferFromChaos(contract);
        this.state.setAcceptedContract(off); // "a contract is active" holds for every guard that reads the synthetic offer
        const root = h.tracks.find((t) => t.root) ?? h.tracks[0];
        this.host.mintRoot(off, root ? { seedId: hotspotSeedId(h.id, root.id), name: root.name, trackType: root.templateId } : undefined); // hook 1 — the tree starts at Present
        // voids unpresentSession just recorded must survive into the new session so the voided devices get their notice +
        // refund. They are idempotent by voidId (applyVoidToSnapshot), so a stale one is a harmless no-op; the FRESH-present
        // clear lives in the GM panel's doPresent (only when no session contract was active). // DECISION
        void this.store.persistCurrent();
        return true;
    }
    /** Un-present (hook 5): NO rep dock, no transport refund — nobody was party. Every signed participant is VOIDED WITH A
     *  NOTICE (gmOnly.voidedContracts → the per-recipient `participantVoid` attach) and the rep a slip already settled at
     *  home is REFUNDED on its device (repRefund); the GM's own participant contract (he fielded) refunds his rep directly.
     *  The tree is discarded, the presentation cleared. Refuses on anything but a session contract. */
    unpresentSession(): boolean {
        const c = this.state.activeChaosContract();
        if (!this.state.gmSession() || !c || !isSessionContract(c)) return false;
        const off = this.state.offerFor();
        const at = Date.now();
        const voided: Record<string, VoidedContract> = {};
        for (const [key, pc] of Object.entries(this.state.participantContracts())) {
            const repRefund = pc.repSettled ? Math.max(0, Math.round(pc.repSpent ?? 0)) : 0; // unsettled = never debited at home → nothing to return
            if (key === GM_SELF_KEY) { if (repRefund) this.state.setReputation((this.state.reputation() ?? 0) + repRefund); continue; }
            voided[key] = { voidId: `void-${pc.id}-${at}`, contractId: pc.id, ...(c.hotspotId ? { hotspotId: c.hotspotId } : {}), repRefund, at };
        }
        this.state.setVoidedContracts(voided);
        this.state.setActiveChaosContract(null);
        this.state.setAcceptedContract(null);
        this.state.clearParticipantContracts();
        this.host.closeTree(off ?? undefined);
        this.state.setPresentedHotspot(null);
        void this.store.persistCurrent();
        return true;
    }

    constructor() {
        // change, or a rep raise that caps a term, reselect a workable drop/raise so the control never opens dead.
        effect(() => {
            this.steps(); this.raises(); this.scale(); const open = !!this.negotiating(); // deps: any term/scale change or (re)open
            untracked(() => { if (open) this.healSacrifice(); });
        });
    }
}
