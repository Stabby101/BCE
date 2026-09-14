/*
 * GM-1 P3 — the RESULTS SLIP on the player device: the take-home record from the last resolve. MY units = my own
 * claim rows (holderToken match — the same identity the sheet uses; other players' claims arrive anonymized, mine
 * keeps my token). Salvage is honestly the TEAM share — no per-player split exists in the book model, and the copy says so.
 *
 * DIRECTIVE-GM-2 P1 — APPLY TO MY CAMPAIGN (supersedes the v1 "results go home by EXPORT" ruling): the device already
 * holds the slip AND the player's own auth, so the write is not cross-account — the player applies the slip to their
 * OWN home campaign, on their OWN token, through the existing campaign store (GET the record, transform it with the
 * pure apply-slip.ts, PUT it back). No server-side cross-tenant write, no new trust boundary.
 *   · the home campaign is the `sourceCampaignId` the mint preserved on MY rows (the identity cut);
 *   · Apply is offered only when that campaign LOADS on this device's token (owner-scoped) — a slip from someone
 *     else's company, or a stale latch, reads "not this device's home campaign" and the control is disabled;
 *   · idempotent by the home campaign's appliedSlips[] (the GM-minted slipId): a second tap is a no-op with a message;
 *   · a pre-P1 slip (no slipId / no origin ids) says so instead of pretending.
 * Honest copy: pay lands by your own terms when you signed a contract (P2), else the team share; your pilots' career SP lands on them (P3).
 */
import { Component, ChangeDetectionStrategy, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { applySlipToSnapshot } from '../campaign/gm/apply-slip';
import type { SlipUnitRow } from '../campaign/gm/results-slip';
import { anonIdWeb } from '../campaign/gm/side-labels'; // GM-3 P1 (S27) — my company's home key off the imports I own

// GM-1 P3 (panel finding) — the LATCH: live claims reset when the GM generates the NEXT track, which
// would empty "my units" on a slip the player hasn't copied yet (the whole point is apply-at-home-later).
// So the device LATCHES its matched instanceIds per slip (localStorage) the moment they match, and mine()
// is latched ∪ live — the take-home record survives the claims context moving on.
const LATCH_KEY = 'bce.player.slip.mine';

type ApplyState = 'idle' | 'checking' | 'ready' | 'busy' | 'applied' | 'legacy' | 'foreign' | 'not-hotspots' | 'error';

@Component({
    selector: 'bce-results-slip',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (slip(); as s) {
            <div class="prs" data-testid="prs-slip">
                <div class="prs-head">
                    <span class="prs-t">RESULTS SLIP</span>
                    <span class="prs-track">{{ s.trackName }}</span>
                    @if (s.outcome) { <span class="prs-out">{{ s.outcome.replace('_', ' ') }}</span> }
                </div>
                @if (s.sessionName || s.hotspotTitle) { <div class="prs-sess">{{ s.sessionName ?? 'GM session' }}@if (s.hotspotTitle) { &middot; {{ s.hotspotTitle }} }</div> }
                @if (odm()) {
                    <!-- ORDER-3 H16 — an ODM table: the slip carries NO pay fields (absent, not 0) and no home to apply to — the company IS the record -->
                    <div class="prs-team" data-testid="prs-odm-note">ODM &mdash; the company record holds the outcome; this is your unit's end-state.</div>
                } @else if (traditional()) {
                    <!-- ORDER-7 H21 — a plain Traditional lobby: the settlement is C-bills (not the Hot Spots SP economy), so no SP pay line and no Apply — your unit's end-state is below -->
                    <div class="prs-team" data-testid="prs-trad-note">Team result &mdash; the C-bill settlement happens at the table; this is your unit's end-state.</div>
                } @else if (ownPay(); as op) {
                    <div class="prs-team" data-testid="prs-pay-own">Your contract: {{ op.combatPay }} SP combat pay &middot; {{ op.salvageSp }} SP salvage@if (op.basePaySp) { &middot; {{ op.basePaySp }} SP base pay <span class="prs-dim">(one month, paid per track)</span> }@if (op.transportSp) { &middot; &minus;{{ op.transportSp }} SP transport }@if (op.repDelta) { &middot; Rep {{ op.repDelta > 0 ? '+' : '' }}{{ op.repDelta }} } <span class="prs-dim">(paid by your own terms — the team share was {{ s.combatPay }} + {{ s.salvageSp }})</span></div>
                } @else {
                    <div class="prs-team" data-testid="prs-pay-team">Team: {{ s.combatPay }} SP combat pay &middot; {{ s.salvageSp }} SP salvage <span class="prs-dim">(team share — splits happen at the table)</span></div>
                }
                @if (mine().length) {
                    <div class="prs-units" data-testid="prs-mine">
                        @for (u of mine(); track u.instanceId) {
                            <div class="prs-unit" [attr.data-status]="u.status">
                                <span class="prs-name">{{ u.label }}</span>
                                <span class="prs-status">{{ u.status === 'ok' ? 'operational' : u.status }}</span>
                                @if (u.pilotFate) { <span class="prs-fate">pilot {{ u.pilotFate }}</span> }
                                @else if (u.crewHits) { <span class="prs-fate">pilot {{ u.crewHits }} hit{{ u.crewHits === 1 ? '' : 's' }}</span> }
                                @if (u.originPilotId && s.pilotSp?.[u.originPilotId]; as psp) { <span class="prs-sp" data-testid="prs-pilot-sp">+{{ psp }} SP career</span> }
                            </div>
                        }
                    </div>
                }
                <!-- GM-3 P1 (S27) — a COMPLETION-ONLY entry (signed, no rows on the last track): the +1 still comes home -->
                @if (!mine().length && ownPay()) { <p class="prs-note" data-testid="prs-completion-only">No units of yours on this track &mdash; your contract completed with it: the entry above is the completion settlement.</p> }
                @if (odm()) {
                    <!-- ORDER-3 H16 — no Apply on an ODM slip: absent, not disabled -->
                } @else if (traditional()) {
                    <!-- ORDER-7 H21 — no Apply on a plain Traditional slip: absent, not disabled (the apply-at-home model is Hot Spots' SP Warchest) -->
                } @else if (mine().length || ownPay()) {
                    <!-- GM-2 P1 — APPLY TO MY CAMPAIGN -->
                    <div class="prs-apply" [attr.data-state]="applyState()" data-testid="prs-apply-state">
                        @switch (applyState()) {
                            @case ('checking') { <div class="prs-note">Checking your home campaign…</div> }
                            @case ('ready') {
                                <button type="button" class="prs-btn" (click)="apply()" data-testid="prs-apply">Apply to {{ homeName() }}</button>
                                <div class="prs-note">Lands the end-state of your units, your pilots' fates, and the pay as the <b>team share</b> in <b>{{ homeName() }}</b> — one ledger line naming this session, and your pilots' career SP on their cards.</div>
                            }
                            @case ('busy') { <button type="button" class="prs-btn" disabled data-testid="prs-apply">Applying…</button> }
                            @case ('applied') {
                                <button type="button" class="prs-btn done" disabled data-testid="prs-apply">Applied to {{ homeName() }} ✓</button>
                                <div class="prs-note" data-testid="prs-apply-msg">{{ applyMsg() }}</div>
                            }
                            @case ('legacy') { <button type="button" class="prs-btn" disabled data-testid="prs-apply">Apply</button><div class="prs-note" data-testid="prs-apply-msg">This slip predates Apply — it carries no home-campaign ids. Apply the end-state by hand.</div> }
                            @case ('foreign') { <button type="button" class="prs-btn" disabled data-testid="prs-apply">Apply</button><div class="prs-note" data-testid="prs-apply-msg">Not this device's home campaign — sign in as the company's owner to apply this slip.</div> }
                            @case ('not-hotspots') { <button type="button" class="prs-btn" disabled data-testid="prs-apply">Apply</button><div class="prs-note" data-testid="prs-apply-msg">{{ homeName() }} is not a Hot Spots campaign — there is no Warchest to post to. Apply the end-state by hand.</div> }
                            @case ('error') { <button type="button" class="prs-btn" (click)="apply()" data-testid="prs-apply">Retry apply</button><div class="prs-note prs-err" data-testid="prs-apply-msg">{{ applyMsg() }}</div> }
                            @default { <div class="prs-note">Apply this end-state to your home campaign by hand — nothing writes back automatically.</div> }
                        }
                    </div>
                } @else {
                    <p class="prs-note">No units of yours on this slip — the team result is above.</p>
                }
            </div>
        }
    `,
    styles: [`
        :host { display:block; }
        .prs { border:1px solid #3d6ea5; border-radius:12px; background:#101720; padding:14px 16px; margin:12px 0; color:#dfe7f0; }
        .prs-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; }
        .prs-t { font-weight:800; letter-spacing:.12em; font-size:12px; color:#7fb0e6; }
        .prs-track { font-weight:700; }
        .prs-out { font-size:12px; border:1px solid #3d6ea5; border-radius:999px; padding:1px 10px; color:#9fc4ea; }
        .prs-sess { font-size:12px; color:#9fb2c4; margin-top:4px; }
        .prs-team { font-size:13px; margin-top:8px; }
        .prs-dim { opacity:.6; font-size:12px; }
        .prs-units { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
        .prs-unit { display:flex; flex-wrap:wrap; gap:10px; align-items:baseline; border:1px solid #232c37; border-radius:8px; padding:8px 10px; }
        .prs-name { font-weight:700; }
        .prs-status { font-size:12px; color:#7fe3a0; }
        .prs-unit[data-status='destroyed'] .prs-status, .prs-unit[data-status='abandoned'] .prs-status { color:#e7a86b; }
        .prs-fate { font-size:12px; color:#9fb2c4; }
        .prs-note { font-size:11.5px; opacity:.7; margin:10px 0 0; line-height:1.5; }
        .prs-err { color:#e7a86b; opacity:1; }
        /* GM-2 P1 — the Apply control */
        .prs-apply { margin-top:12px; }
        .prs-btn { width:100%; padding:12px 14px; border-radius:9px; border:1px solid #3d6ea5; background:#13243a; color:#bcd6f2; font-size:15px; font-weight:700; letter-spacing:.03em; cursor:pointer; }
        .prs-btn:disabled { opacity:.55; cursor:not-allowed; }
        .prs-btn.done { background:#123a2a; border-color:#2f6b46; color:#9fe3b8; opacity:1; }
    `],
})
export class ResultsSlipComponent {
    private readonly state = inject(NewCampaignState);
    protected readonly rt = inject(ClaimRealtimeService);
    private readonly store = inject(CampaignSaveStore); // GM-2 P1 — the home campaign, on this device's own token
    protected readonly slip = this.state.resultsSlip;
    /** ORDER-3 H16 — packId-gated: an ODM table's slip (no pay, no Apply, the honest one-liner). */
    protected readonly odm = computed(() => this.state.packId() === 'odm');
    /** ORDER-7 H21 — a plain TRADITIONAL slip: the settlement is C-bills, so the slip carries NO team SP figures (and never a
     *  per-participant `pay`). Keyed off the slip's own shape (no SP pay of any kind, and not an ODM table) so it never
     *  depends on campaignSystem hydration timing. Its render is the end-state + an honest team line, with NO Apply (the
     *  apply-at-home model is Hot Spots' SP Warchest — there is nowhere for a C-bill settlement to land). */
    protected readonly traditional = computed(() => { const s = this.slip(); return !this.odm() && !!s && s.combatPay == null && s.salvageSp == null && !s.pay; });

    private readonly latched = signal<{ branchId: string; ids: string[] }>((() => {
        try { const raw = localStorage.getItem(LATCH_KEY); const v = raw ? JSON.parse(raw) as { branchId?: string; ids?: string[] } : null; return { branchId: v?.branchId ?? '', ids: Array.isArray(v?.ids) ? v.ids : [] }; } catch { return { branchId: '', ids: [] }; }
    })());

    // ── GM-2 P1 — Apply to my campaign ──
    protected readonly applyState = signal<ApplyState>('idle');
    /** GM-2 P2a — this company's OWN figure on the slip (present only when it signed its own contract this session). */
    protected readonly ownPay = computed(() => { const s = this.slip(); const key = this.homeKey(); return key && s?.pay ? s.pay[key] ?? null : null; });
    // GM-3 P1 (S27) — the home campaign this device's COMPANY came from, read off the imports it owns (provenance.owner ↔ my
    // token's anonId): the key for a COMPLETION-ONLY slip entry (signed, no rows on the last track — the +1 still lands).
    private readonly myAnon = signal<string | null>(null);
    private readonly anonFill = effect(() => { const t = this.rt.token(); void anonIdWeb(t).then((a) => this.myAnon.set(a)); });
    private readonly myHomeKey = computed(() => { const anon = this.myAnon(); if (!anon) return null; return (this.state.startingForce() ?? []).find((u) => u.provenance?.origin === 'player-import' && u.provenance.owner === anon && !!u.provenance.sourceCampaignId)?.provenance?.sourceCampaignId ?? null; });
    /** The home key: my rows' (P1), else my company's (a completion-only entry). */
    private readonly homeKey = computed(() => this.homeIdOf(this.mine()) ?? this.myHomeKey());
    protected readonly homeName = signal<string>('');
    protected readonly applyMsg = signal<string>('');
    private checkedKey = ''; // `${slipId}|${sourceCampaignId}` — one check per slip per home

    constructor() {
        // latch my live matches per slip; a NEW slip (different branch) replaces the latch
        effect(() => {
            const s = this.slip();
            if (!s) return;
            const live = s.units.filter((u) => this.rt.heldByMe(u.instanceId)).map((u) => u.instanceId);
            if (!live.length) return;
            const cur = this.latched();
            const same = cur.branchId === s.branchId;
            const ids = same ? [...new Set([...cur.ids, ...live])] : live;
            if (same && ids.length === cur.ids.length) return;
            this.latched.set({ branchId: s.branchId, ids });
            try { localStorage.setItem(LATCH_KEY, JSON.stringify({ branchId: s.branchId, ids })); } catch { /* session-only latch */ }
        });
        // GM-2 P1 — decide whether Apply is offered: the home campaign my rows point at must load on MY token
        effect(() => {
            const s = this.slip(); const rows = this.mine();
            if (!s || this.odm() || this.traditional() || (!rows.length && !this.ownPay())) { this.checkedKey = ''; this.applyState.set('idle'); return; } // GM-3 P1 — a completion-only entry offers Apply with no rows · ORDER-3 H16 — never on an ODM table · ORDER-7 H21 — never on a plain Traditional slip
            const src = this.homeKey();
            const key = `${s.slipId ?? ''}|${src ?? ''}`;
            if (key === this.checkedKey) return;
            this.checkedKey = key;
            if (!s.slipId || !src) { this.applyState.set('legacy'); return; }
            void this.check(src, s.slipId);
        });
    }

    /** My rows: the slip's units whose claim row I hold (own claims keep my real token — HARDEN-5b),
     *  UNION the latched set (survives the claims reset when the next track generates). */
    protected readonly mine = computed(() => {
        const s = this.slip();
        if (!s) return [];
        const l = this.latched();
        const latchedIds = l.branchId === s.branchId ? new Set(l.ids) : new Set<string>();
        return s.units.filter((u) => latchedIds.has(u.instanceId) || this.rt.heldByMe(u.instanceId));
    });

    /** The home campaign my rows came from (the mint's sourceCampaignId) — the first row that carries one. */
    private homeIdOf(rows: SlipUnitRow[]): string | null {
        return rows.find((r) => !!r.sourceCampaignId)?.sourceCampaignId ?? null;
    }

    private async check(src: string, slipId: string): Promise<void> {
        this.applyState.set('checking');
        const rec = await this.store.get(src); // owner-scoped on the server: someone else's campaign is a 404 → null
        if (!rec) { this.applyState.set('foreign'); return; }
        this.homeName.set(rec.name || src);
        const snap = rec.snapshot as { appliedSlips?: string[] | null; hotSpotCampaign?: string | null; warchestSP?: number | null } | undefined;
        if (Array.isArray(snap?.appliedSlips) && snap.appliedSlips.includes(slipId)) { this.applyMsg.set('Already applied — nothing more to do.'); this.applyState.set('applied'); return; }
        if (!snap?.hotSpotCampaign || typeof snap.warchestSP !== 'number') { this.applyState.set('not-hotspots'); return; }
        this.applyState.set('ready');
    }

    protected async apply(): Promise<void> {
        const s = this.slip(); const rows = this.mine(); const src = this.homeKey();
        if (!s || !s.slipId || !src || (this.applyState() !== 'ready' && this.applyState() !== 'error')) return;
        this.applyState.set('busy');
        try {
            const rec = await this.store.get(src); // a FRESH read — the home campaign may have moved since the check
            if (!rec) { this.applyState.set('foreign'); return; }
            const r = applySlipToSnapshot(rec.snapshot as never, s, rows, src); // GM-3 P1 — the hint carries a completion-only entry home
            if (!r.ok) {
                if (r.reason === 'already-applied') { this.applyMsg.set('Already applied — nothing more to do.'); this.applyState.set('applied'); return; }
                if (r.reason === 'not-hotspots') { this.applyState.set('not-hotspots'); return; }
                this.applyMsg.set(r.reason === 'no-match' ? `None of these units are in ${rec.name || src} any more (${r.detail ?? ''}).` : `Could not apply (${r.reason}).`);
                this.applyState.set('error'); return;
            }
            await this.store.put({ ...rec, snapshot: r.snapshot as never, savedAt: Date.now() });
            // PD3 P1 (PD3-12) — say how many came home HURT ("N damaged — record or repair"), never a silent "updated"
            this.applyMsg.set(`${r.matched.length} unit${r.matched.length === 1 ? '' : 's'} updated${r.damaged.length ? ` (${r.damaged.length} damaged — record or repair at home)` : ''}${r.removed.length ? `, ${r.removed.length} struck off` : ''}${r.unmatched.length ? `, ${r.unmatched.length} not found` : ''} · ${r.sp >= 0 ? '+' : ''}${r.sp} SP (${r.byTerms ? "by your contract's terms" : 'team share'})${r.repDelta ? ` · Rep ${r.repDelta > 0 ? '+' : ''}${r.repDelta}` : ''}${r.pilotSp ? ` · ${r.pilotSp} SP to your pilots' careers` : ''} · ledger: ${r.ledgerEvent}`);
            this.applyState.set('applied');
        } catch (e) {
            this.applyMsg.set(`Could not reach the host to apply — ${(e as { message?: string })?.message ?? 'try again'}.`);
            this.applyState.set('error');
        }
    }
}
