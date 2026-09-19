import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { StarSystemsService } from '../star/star-systems.service';
import { WarchestService } from './warchest.service';
import { CampaignSaveStore } from '../campaign-save-store';

@Component({
    selector: 'bce-warchest-ledger',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="wc-summary">
            <span class="ws-name">{{ commandName() ?? 'Mercenary Command' }}</span>
            @if (eraName(); as e) { <span class="ws-tag">{{ e }}</span> }
            @if (faction(); as f) { <span class="ws-tag">{{ f }}</span> }
            @if (location(); as l) { <span class="ws-tag loc">{{ l }}</span> }
        </div>
        <div class="wc-head">
            <div class="wc-stat"><span class="l">Warchest</span><span class="v">{{ money(sp() ?? 0) }} <small>SP</small></span></div>
            <div class="wc-stat"><span class="l">Reputation</span><span class="v">{{ rep() ?? 0 }}</span></div>
            <div class="wc-stat"><span class="l">Contract Scale</span><span class="v">{{ scale() }}</span></div>
        </div>

        <div class="wc-adjust">
            <span class="wca-l">GM adjust SP</span>
            <input class="wca-in amt" type="number" min="1" [value]="adjAmt() || ''" (input)="adjAmt.set(+$any($event.target).value || 0)" placeholder="amount" aria-label="SP amount">
            <input class="wca-in reason" [value]="adjReason()" (input)="adjReason.set($any($event.target).value)" placeholder="reason (required — logged)" aria-label="Reason for the adjustment">
            <button type="button" class="wca-btn add" [disabled]="!canAdjust()" (click)="manualAdjust(-1)" data-testid="cc-sp-add">＋ Add</button>
            <button type="button" class="wca-btn ded" [disabled]="!canAdjust()" (click)="manualAdjust(1)" data-testid="cc-sp-deduct">－ Deduct</button>
            @if (adjMsg()) { <span class="wca-msg">{{ adjMsg() }}</span> }
        </div>
        <div class="wc-adjust wc-adjust-rep">
            <span class="wca-l">GM adjust Rep</span>
            <input class="wca-in amt" type="number" min="0" max="20" [value]="adjRep() ?? ''" (input)="adjRep.set($any($event.target).value === '' ? null : +$any($event.target).value)" placeholder="reputation" aria-label="Reputation value" data-testid="cc-rep-value">
            <input class="wca-in reason" [value]="adjRepReason()" (input)="adjRepReason.set($any($event.target).value)" placeholder="reason (required — logged)" aria-label="Reason for the reputation change" data-testid="cc-rep-reason">
            <button type="button" class="wca-btn add" [disabled]="!canSetRep()" (click)="setRep()" data-testid="cc-rep-set">Set Rep</button>
            @if (repMsg()) { <span class="wca-msg">{{ repMsg() }}</span> }
        </div>

        <div class="crs" role="table" aria-label="Contract Record Sheet">
            <div class="crs-h" role="row">
                <span role="columnheader">Month</span>
                <span role="columnheader">Event</span>
                <span role="columnheader" class="num">Cost</span>
                <span role="columnheader" class="num">Cover</span>
                <span role="columnheader" class="num">Paid</span>
                <span role="columnheader" class="num">Balance</span>
                <span role="columnheader" class="num">Rep</span>
            </div>
            <div class="crs-scroll">
                @for (e of ledger(); track $index) {
                    <div class="crs-r" role="row" [class.pos]="e.cost < 0" [class.neg]="e.cost > 0">
                        <span class="crs-m">M{{ e.month }}</span>
                        <span class="crs-e">{{ e.event }}</span>
                        <span class="num">{{ delta(e.cost) }}</span>
                        <span class="num sub">{{ e.cover === 0 ? '—' : money(e.cover) }}</span>
                        <span class="num">{{ delta(e.paid) }}</span>
                        <span class="num bal">{{ money(e.balance) }}</span>
                        <span class="num sub">{{ e.rep }}</span>
                    </div>
                } @empty {
                    <p class="crs-empty">No Warchest activity yet — repairs, purchases, hiring, monthly maintenance, and combat pay post here as they happen.</p>
                }
            </div>
        </div>
    `,
    styles: [`
        :host { display:block; }
        .wc-summary { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; margin-bottom:12px; }
        .ws-name { font-family:var(--stencil); font-size:19px; line-height:1; }
        .ws-tag { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); border:1.2px solid var(--ink2); padding:2px 8px; }
        .ws-tag.loc { color:var(--stamp); border-color:var(--stamp); }
        .wc-head { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
        .wc-stat { border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:8px 14px; min-width:120px; }
        .wc-stat .l { display:block; font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); }
        .wc-stat .v { display:block; font-family:var(--stencil); font-size:22px; line-height:1.1; margin-top:3px; }
        .wc-stat .v small { font-family:var(--mono); font-size:11px; letter-spacing:1px; }

        .crs { border:1.5px solid var(--ink); background:var(--paper); }
        .crs-h, .crs-r { display:grid; grid-template-columns:52px 1fr 84px 64px 84px 104px 46px; gap:10px; align-items:baseline; padding:7px 12px; }
        .crs-h { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10px; text-transform:uppercase; color:var(--ink2); border-bottom:1.5px solid var(--ink); background:var(--paper2, var(--paper)); }
        .crs-scroll { max-height:420px; overflow-y:auto; }
        .crs-r { font-family:var(--type); font-size:12.5px; border-bottom:1px solid color-mix(in srgb, var(--ink2) 20%, transparent); }
        .crs-r:last-child { border-bottom:none; }
        .crs-m { font-family:var(--mono); font-size:11px; color:var(--ink2); }
        .crs-e { min-width:0; overflow-wrap:anywhere; }
        .num { font-family:var(--mono); font-size:12px; text-align:right; }
        .num.sub { color:var(--ink2); font-size:11px; }
        .num.bal { font-weight:700; }
        .crs-r.neg .num { color:var(--warn, #c2622a); }
        .crs-r.pos .num { color:var(--ok, #3a7d44); }
        .crs-r.neg .num.bal, .crs-r.pos .num.bal { color:var(--ink); }
        .crs-empty { font-family:var(--type); font-size:13px; color:var(--ink2); line-height:1.6; padding:14px 12px; margin:0; }
        .wc-adjust { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0 14px; padding:8px 0; border-top:1px dotted var(--ink2); }
        .wca-l { font-family:var(--label); font-weight:600; letter-spacing:.06em; font-size:10.5px; text-transform:uppercase; color:var(--ink2); }
        .wca-in { font:inherit; font-size:12px; padding:5px 8px; border:1.2px solid var(--ink); background:var(--paper); color:var(--ink); }
        .wca-in.amt { width:88px; } .wca-in.reason { flex:1 1 180px; min-width:140px; }
        .wca-btn { font-family:var(--label); font-weight:600; letter-spacing:.05em; font-size:10.5px; text-transform:uppercase; padding:5px 10px; border:1.2px solid var(--ink); background:transparent; color:var(--ink); cursor:pointer; }
        .wca-btn.add:hover:not(:disabled) { background:var(--ok,#3a7d44); color:#fff; border-color:var(--ok,#3a7d44); }
        .wca-btn.ded:hover:not(:disabled) { background:var(--warn,#c2622a); color:#fff; border-color:var(--warn,#c2622a); }
        .wca-btn:disabled { opacity:.45; cursor:not-allowed; }
        .wca-msg { font-family:var(--type); font-size:12px; color:var(--ink); }

        @media (max-width:720px) {
            .crs-h { display:none; }
            .crs-r { grid-template-columns:1fr auto; gap:4px 10px; }
            .crs-m { grid-column:1; } .crs-e { grid-column:1; } .num { grid-column:2; text-align:right; }
        }
    `],
})
export class WarchestLedgerComponent {
    private readonly state = inject(NewCampaignState);
    private readonly star = inject(StarSystemsService);
    protected readonly sp = this.state.warchestSP;
    protected readonly rep = this.state.reputation;
    protected readonly scale = this.state.contractScale;
    protected readonly ledger = this.state.warchestLedger;
    // Campaign summary header (§7) — read from the existing campaign state (name / era / faction / location).
    protected readonly commandName = this.state.commandName;
    protected readonly faction = this.state.faction;
    protected readonly eraName = computed(() => this.state.era()?.name ?? null);
    // Resolve the location SLUG (e.g. 'st-ives') → display name ('St. Ives'); the dashboard already ensureLoaded()s
    // the systems set. Falls back to the raw id if the systems haven't resolved.
    protected readonly location = computed(() => {
        this.star.ready();
        const id = this.state.currentLocation();
        return id ? (this.star.byId(id)?.name ?? id) : null;
    });

    private readonly warchest = inject(WarchestService);
    private readonly store = inject(CampaignSaveStore);
    protected readonly adjAmt = signal(0);
    protected readonly adjReason = signal('');
    protected readonly adjMsg = signal('');
    protected canAdjust(): boolean { return this.adjAmt() > 0 && this.adjReason().trim().length > 0; }
    protected manualAdjust(sign: -1 | 1): void {
        if (!this.canAdjust()) { this.adjMsg.set('Enter an SP amount and a reason.'); return; }
        const amt = Math.round(this.adjAmt());
        const reason = this.adjReason().trim();
        this.warchest.post(`GM adjustment — ${reason}`, sign * amt, 0); // +cost = deduct/spend, −cost = add/income
        this.adjMsg.set(`${sign < 0 ? 'Added' : 'Deducted'} ${amt} SP — ${reason}`);
        this.adjAmt.set(0); this.adjReason.set('');
        void this.store.persistCurrent();
    }

    protected readonly adjRep = signal<number | null>(null);
    protected readonly adjRepReason = signal('');
    protected readonly repMsg = signal('');
    protected canSetRep(): boolean { const n = this.adjRep(); return n !== null && Number.isFinite(n) && n >= 0 && this.adjRepReason().trim().length > 0; }
    protected setRep(): void {
        if (!this.canSetRep()) { this.repMsg.set('Enter a reputation value and a reason.'); return; }
        const n = Math.max(0, Math.round(this.adjRep() ?? 0)); const reason = this.adjRepReason().trim();
        this.state.setReputation(n);                                                              // FIRST — post() snapshots s.reputation() onto the line
        this.warchest.post(`Reputation set to ${n} by GM — ${reason}`, 0, 0);                    // cost 0: no SP moves; toasted like any player action
        this.repMsg.set(`Reputation set to ${n} — ${reason}`);
        this.adjRep.set(null); this.adjRepReason.set('');
        void this.store.persistCurrent();
    }

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    /** Show a cost/paid value from the balance's perspective: spend (>0) as −N, income (<0) as +N, zero as —. */
    protected delta(n: number): string {
        if (n === 0) return '—';
        return n > 0 ? `−${this.money(n)}` : `+${this.money(-n)}`;
    }
}
