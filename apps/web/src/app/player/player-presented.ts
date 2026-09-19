import { Component, ChangeDetectionStrategy, computed, effect, inject, signal, untracked } from '@angular/core';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { applyVoidToSnapshot } from '../campaign/gm/apply-slip';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { NegotiationService } from '../campaign/chaos/negotiation.service';
import { NegotiateModalComponent } from '../campaign/chaos/negotiate-modal';
import { PLAYER_NEGOTIATION_HOST_PROVIDER } from './player-negotiation-host';
import { HotSpotsCatalogService } from '../campaign/chaos/hotspots-catalog';
import { resolved, participantSideFor, type ChaosContract, sessionPhase } from '../campaign/chaos/chaos-contract';
import { anonIdWeb } from '../campaign/gm/side-labels';

@Component({
    selector: 'bce-presented-brief',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NegotiateModalComponent],
    providers: [NegotiationService, PLAYER_NEGOTIATION_HOST_PROVIDER],
    template: `
        @if (brief(); as p) {
            <div class="pp" data-testid="pp-brief">
                <div class="pp-head">
                    <span class="pp-world">{{ p.world }}</span>
                    <span class="pp-title">{{ p.title }}</span>
                    <span class="pp-meta">{{ p.type }} &middot; Scale {{ p.scale }}</span>
                </div>
                @if (p.op) { <p class="pp-op">{{ p.op }}</p> }
                @if (p.employerDesc) { <p class="pp-empdesc">{{ p.employerDesc }}</p> }
                @if (p.systemRows.length) {
                    <div class="pp-sys">
                        @for (r of p.systemRows; track r.label) { <span class="pp-row"><b>{{ r.label }}</b> {{ r.value }}</span> }
                    </div>
                }
                @if (p.transit.jumpDays !== null || p.transit.rechargeHours !== null) {
                    <div class="pp-transit">
                        @if (p.transit.jumpDays !== null) { <span>Jump-point transit {{ p.transit.jumpDays }} d</span> }
                        @if (p.transit.rechargeHours !== null) { <span>&middot; recharge {{ p.transit.rechargeHours }} h</span> }
                    </div>
                }
                @if (phase() === 'lobby') {
                <div class="pp-sides">
                    @for (s of p.sides; track s.key) {
                        <div class="pp-side" [class.mine]="rt.mySidePref() === s.key" [attr.data-testid]="'pp-side-' + s.key">
                            @if (s.title) { <div class="pp-stitle">{{ s.title }}</div> }
                            <div class="pp-semp">{{ s.employer }}</div>
                            <div class="pp-smeta">{{ s.role }} &middot; vs {{ s.vs }} <span class="pp-und">&middot; force strength undisclosed</span></div>
                            @if (s.blurb) { <div class="pp-sblurb">{{ s.blurb }}</div> }
                            <button type="button" class="pp-btn" [class.on]="rt.mySidePref() === s.key" (click)="pick(s.key)" [attr.data-testid]="'pp-pref-' + s.key">
                                {{ rt.mySidePref() === s.key ? '✓ Preferred' : 'Prefer this side' }}
                            </button>
                        </div>
                    }
                </div>
                <p class="pp-note">Your preference goes to the GM — sides are assigned at the table. This screen updates automatically.</p>
                } @else if (phase() === 'committed') {
                    <div class="pp-assigned" data-testid="pp-assigned">Your side: <b>{{ mySideLabel() }}</b> — assigned</div>
                } @else if (phase() === 'complete') {
                    <div class="pp-assigned pp-done" data-testid="pp-complete">Contract complete — {{ lastOutcome() }}. Waiting for the GM's next contract.</div>
                }
            </div>
        }
        @if (contractBlock(); as cb) {
            <div class="pp-contract" data-testid="pp-contract">
                @if (cb.signed; as sc) {
                    <div class="pp-ctitle">Your contract &mdash; {{ sc.signedBy === 'player' ? 'signed on this device' : 'brokered by the GM' }}</div>
                    <div class="pp-cterms" data-testid="pp-contract-terms">{{ termsLine(sc) }}</div>
                    <div class="pp-cnote">Paid by these terms at resolve: your Scale &times; the tier, your salvage %, one month's base pay per track. Transport {{ sc.transportSp ?? 0 }} SP and {{ sc.repSpent ?? 0 }} Rep settle at home on your first Apply.</div>
                } @else {
                    <div class="pp-ctitle">Your company's contract</div>
                    <div class="pp-cnote">{{ contractNote(cb.primary) }} Negotiate your own terms on it against your reputation ({{ cb.rep }}) &mdash; Command Rights are locked to the session's. Paid by your terms at resolve{{ cb.primary.party === 'session' ? '; without a contract of your own you are paid nothing' : '' }}.</div>
                    <button type="button" class="pp-btn go" (click)="negotiate()" [disabled]="!cb.hotspot" data-testid="pp-negotiate">Negotiate my contract &#9656;</button>
                    @if (rt.lastSignResult(); as r) { @if (!r.ok) { <div class="pp-cnote warn" data-testid="pp-sign-msg">Not signed &mdash; {{ r.reason }}</div> } }
                }
            </div>
        }
        @if (voidBlock(); as vb) {
            <div class="pp-contract pp-void" data-testid="pp-void" [attr.data-void-id]="vb.v.voidId" [attr.data-state]="vb.state">
                <div class="pp-ctitle">Session contract withdrawn</div>
                <div class="pp-cnote">The GM un-presented the hot spot &mdash; your signed terms are void; no track will pay them.
                    @if (vb.v.repRefund > 0) { <b>{{ vb.v.repRefund }} Rep</b> you spent signing (already settled at home) is returned to your company. } @else { Nothing was settled at home yet, so there is nothing to return. }</div>
                @switch (vb.state) {
                    @case ('busy') { <div class="pp-cnote" data-testid="pp-void-msg">Returning your rep…</div> }
                    @case ('applied') { <div class="pp-cnote" data-testid="pp-void-msg">{{ voidMsg() }}</div> }
                    @case ('error') { <div class="pp-cnote warn" data-testid="pp-void-msg">{{ voidMsg() }}</div><button type="button" class="pp-btn go" (click)="refund()" data-testid="pp-void-retry">Retry the refund</button> }
                    @case ('foreign') { <div class="pp-cnote warn" data-testid="pp-void-msg">Not this device's home campaign — sign in as the company's owner to receive the refund.</div> }
                    @default { <div class="pp-cnote" data-testid="pp-void-msg">Noted.</div> }
                }
            </div>
        }
        <div class="cc-scope theme-dossier"><bce-negotiate-modal /></div>
    `,
    styles: [`
        :host { display:block; }
        /* P4 — the modal's INHERITED BASELINE, pinned to what the GM app's dashboard host hands it: \`color: var(--ink);
           font-family: var(--type)\` (dashboard.scss :host) over a body that sets neither font-size nor line-height (the UA's
           16px / normal). Here the wrapper sits inside the roster's \`font: 15px/1.4 system-ui\` + light text, which reached the
           overlay (its color) and every block that does not set its own line-height (their heights). The GM app is untouched. */
        .cc-scope { color:var(--ink); font-family:var(--type); font-size:16px; line-height:normal; }
        .pp { border:1px solid var(--bce-line,#2a3340); border-radius:12px; background:var(--bce-panel,#141a21); padding:14px 16px; margin:12px 0; color:var(--bce-ink,#dfe7f0); }
        .pp-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; }
        .pp-world { font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
        .pp-title { font-weight:700; }
        .pp-meta { font-size:12px; opacity:.75; }
        .pp-op, .pp-empdesc { font-size:13px; line-height:1.5; margin:8px 0 0; }
        .pp-sys { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; font-size:12px; opacity:.85; }
        .pp-row b { font-weight:700; opacity:.7; margin-right:4px; }
        .pp-transit { font-size:12px; opacity:.85; margin-top:6px; display:flex; gap:6px; }
        .pp-sides { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
        .pp-side { flex:1 1 240px; border:1px solid var(--bce-line,#2a3340); border-radius:8px; padding:10px 12px; }
        .pp-side.mine { border-color:#4caf7d; }
        .pp-stitle { font-weight:700; margin-bottom:2px; }
        .pp-semp { font-weight:700; }
        .pp-smeta { font-size:12px; opacity:.85; margin-top:2px; }
        .pp-und { opacity:.6; }
        .pp-sblurb { font-size:12px; line-height:1.45; opacity:.9; margin-top:6px; }
        .pp-btn { margin-top:10px; font:inherit; font-size:13px; padding:7px 12px; border-radius:6px; border:1px solid var(--bce-line,#2a3340); background:transparent; color:inherit; cursor:pointer; }
        .pp-btn.on { border-color:#4caf7d; color:#4caf7d; font-weight:700; }
        .pp-note { font-size:11.5px; opacity:.65; margin:10px 0 0; }
        .pp-contract { border:1px solid var(--bce-line,#2a3340); border-radius:12px; background:var(--bce-panel,#141a21); padding:12px 16px; margin:12px 0; color:var(--bce-ink,#dfe7f0); }
        .pp-ctitle { font-weight:800; letter-spacing:.04em; }
        .pp-cterms { font-family:var(--mono, monospace); font-size:12px; margin-top:4px; }
        .pp-cnote { font-size:12px; opacity:.8; margin-top:6px; line-height:1.45; }
        .pp-cnote.warn { color:#e0a15a; opacity:1; }
        .pp-void { border-color:#e0a15a; }
        .pp-btn.go { border-color:#4caf7d; color:#4caf7d; font-weight:700; }
        .pp-assigned { margin-top:10px; padding:10px 12px; border:1px solid #2f5a6b; border-radius:8px; background:#141a22; color:#cdd8e3; font-size:14px; } /* PD3 P2 */
        .pp-assigned b { color:#8fb0cf; }
        .pp-assigned.pp-done { border-color:#4caf7d; }
    `],
})
export class PresentedBriefComponent {
    private readonly state = inject(NewCampaignState);
    protected readonly rt = inject(ClaimRealtimeService);
    protected readonly brief = this.state.presentedHotspot;
    // PD3 P2 — the session phase over the fanned fields (the ONE decider — chaos-contract.ts sessionPhase)
    protected readonly phase = computed(() => sessionPhase({ presented: this.state.presentedHotspot(), contract: this.state.contractSummary() ?? this.state.activeChaosContract(), completed: this.state.completedChaosContract(), tree: this.state.missionTree(), spec: this.state.missionSpec() }));
    /** "Your side: X" once committed — the side THIS device signs (participantSideFor over its lobby row), named by the brief's side card. */
    protected readonly mySideLabel = computed(() => {
        const p = this.brief(); const primary = this.state.contractSummary() ?? this.state.activeChaosContract();
        const me = this.rt.lobby().find((x) => x.token === this.rt.token());
        const key = participantSideFor(primary, me?.side);
        const s = p?.sides.find((x) => x.key === key);
        return s ? `${s.employer}${s.role ? ` (${s.role})` : ''}` : (me?.side ?? 'assigned at the table');
    });
    protected readonly lastOutcome = computed(() => (this.state.resultsSlip()?.outcome ?? 'resolved').replace(/_/g, ' '));

    private readonly catalog = inject(HotSpotsCatalogService);
    protected readonly neg = inject(NegotiationService);
    private readonly myAnon = signal<string | null>(null);
    private readonly anonFill = effect(() => { const t = this.rt.token(); void anonIdWeb(t).then((a) => this.myAnon.set(a)); });
    /** My company: the imports THIS device brought (provenance.owner ↔ my token's anonId), its home id + home reputation. */
    protected readonly myCompany = computed(() => {
        const anon = this.myAnon(); if (!anon) return null;
        const mine = (this.state.startingForce() ?? []).filter((u) => u.provenance?.origin === 'player-import' && u.provenance.owner === anon && !!u.provenance.sourceCampaignId);
        if (!mine.length) return null;
        return { key: mine[0].provenance?.sourceCampaignId as string, rep: mine[0].provenance?.homeReputation ?? null, units: mine.length };
    });
    /** The block renders only in a GM session with the primary signed (the player-safe summary) and a company of my own. The
     *  signed contract comes from participantContract — the device's OWN, attached by the fan — never from the summary. */
    protected readonly contractBlock = computed(() => {
        if (!this.state.gmSession()) return null;
        const primary = this.state.contractSummary(); const co = this.myCompany();
        if (!primary || !co) return null;
        const hotspot = primary.hotspotId ? this.catalog.hotSpotById(primary.hotspotId) ?? null : null;
        return { signed: this.state.participantContract(), rep: co.rep ?? 1, hotspot, key: co.key, primary };
    });
    protected contractNote(primary: { party?: 'session' }): string {
        return primary.party === 'session' ? "The session contract is presented — the hot spot's own terms, nobody's signature." : "The session's contract is signed.";
    }
    protected termsLine(c: ChaosContract): string {
        const t = resolved(c.steps);
        return `Scale ${c.scale} · Base pay ${t.basePay}% · Salvage ${typeof t.salvage === 'number' ? `${t.salvage}%` : t.salvage} · Support ${t.support} · Transport ${t.transport}% · Command ${t.command}`;
    }
    private readonly seam = effect(() => {
        try {
            if (typeof localStorage === 'undefined' || localStorage.getItem('bce.test.neg') !== '1') return;
            (window as unknown as { __bcePlayerNeg?: unknown }).__bcePlayerNeg = {
                raise: (col: 'basePay' | 'command' | 'salvage' | 'support' | 'transport') => { this.neg.repRaise(col); return this.neg.steps()[col]; },
                steps: () => this.neg.steps(), repUsed: () => this.neg.repUsed(), canRaise: (col: 'basePay' | 'command' | 'salvage' | 'support' | 'transport') => this.neg.canRaise(col),
            };
        } catch { /* no storage */ }
    });
    protected negotiate(): void {
        const cb = this.contractBlock(); if (!cb?.hotspot) return;
        const me = this.rt.lobby().find((p) => p.token === this.rt.token());
        const side = participantSideFor(cb.primary, me?.side);
        this.neg.negotiateForParticipant(cb.hotspot, side, { key: cb.key, label: `${me?.name ?? 'Your'}'s company` }, cb.rep, cb.primary.lockedCommand ?? null);
    }

    protected pick(key: 'a' | 'b'): void {
        // Toggle: picking the same side again clears the preference (an honest "no pick").
        this.rt.setSidePref(this.rt.mySidePref() === key ? null : key);
    }

    private readonly store = inject(CampaignSaveStore);
    protected readonly voidState = signal<'idle' | 'busy' | 'applied' | 'error' | 'foreign'>('idle');
    protected readonly voidMsg = signal<string>('');
    private refundedFor = ''; // the voidId this device has already tried (one automatic attempt per void; Retry is manual)
    // gmOnly.voidedContracts after refund) does not re-show "Already returned" on a reload / re-join.
    private static readonly VOIDS_DONE_KEY = 'bce.player.voids.done';
    private voidsDone(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(PresentedBriefComponent.VOIDS_DONE_KEY) ?? '[]')); } catch { return new Set(); } }
    private markVoidDone(id: string): void { try { const s = this.voidsDone(); s.add(id); localStorage.setItem(PresentedBriefComponent.VOIDS_DONE_KEY, JSON.stringify([...s].slice(-200))); } catch { /* no storage — the in-memory refundedFor still guards this session */ } }
    protected readonly voidBlock = computed(() => {
        const v = this.state.participantVoid(); const co = this.myCompany();
        if (!this.state.gmSession() || !v || !co) return null;
        // S40 — suppress a void this device consumed in a PRIOR session (reload / re-join: refundedFor is reset, the void is
        // still in the GM's voidedContracts) so it never re-shows "Already returned". NOT the void just applied THIS session
        // (refundedFor === voidId): that must stay visible showing the "N Rep returned" confirmation the player acted on.
        if (this.voidsDone().has(v.voidId) && this.refundedFor !== v.voidId) return null;
        return { v, key: co.key, state: this.voidState() };
    });
    /** The refund runs on RECEIPT, once per void (idempotent at home by voidId); a failure leaves a Retry. A void with nothing to
     *  return still records its voidId at home so it is never re-tried. */
    private readonly autoRefund = effect(() => {
        const vb = this.voidBlock();
        if (!vb || vb.v.voidId === this.refundedFor) return;
        this.refundedFor = vb.v.voidId;
        void this.refund();
    });
    protected async refund(): Promise<void> {
        const vb = untracked(() => this.voidBlock()); if (!vb) return;
        this.voidState.set('busy');
        try {
            const rec = await this.store.get(vb.key); // owner-scoped on the server: someone else's campaign is a 404 → null
            if (!rec) { this.voidState.set('foreign'); return; }
            const r = applyVoidToSnapshot(rec.snapshot as never, vb.v);
            if (!r.ok) {
                if (r.reason === 'already-applied') { this.markVoidDone(vb.v.voidId); this.voidMsg.set(`Already returned to ${rec.name || vb.key}.`); this.voidState.set('applied'); return; }
                this.markVoidDone(vb.v.voidId); this.voidMsg.set(`${rec.name || vb.key} is not a Hot Spots campaign — nothing to return to.`); this.voidState.set('applied'); return;
            }
            await this.store.put({ ...rec, snapshot: r.snapshot as never, savedAt: Date.now() });
            this.markVoidDone(vb.v.voidId); // S40 — consumed; never re-show this void on a reload / re-join
            this.voidMsg.set(r.repRefund > 0 ? `${r.repRefund} Rep returned to ${rec.name || vb.key} — reputation ${r.reputation}.` : `Nothing owed — ${rec.name || vb.key} unchanged.`);
            this.voidState.set('applied');
        } catch (e) {
            this.voidMsg.set(`Could not reach the host to return your rep — ${(e as { message?: string })?.message ?? 'try again'}.`);
            this.voidState.set('error');
        }
    }
}
