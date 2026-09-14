/*
 * BCE — the Hot Spots NEGOTIATION MODAL (.cng, D-128) + the offer PREVIEW modal (.cpv, D-124e). Markup + styles
 * extracted VERBATIM from the chaos-contracts god file by DIRECTIVE-HARDEN-3; ALL state and logic live in the
 * tab-provided NegotiationService (this child renders and delegates — it owns nothing). Mounted unconditionally
 * at the tab's template root (both overlays were root-level siblings there); each block gates itself on the
 * service's negotiating()/previewHotspot() signals, exactly as before.
 * Styles: the .cng- and .cpv- rules + the modal-only rules live here; the shared .cc-btn/.cc-terms/.ct-row/
 * .cc-econ/.cc-actions chrome is HOISTED to src/styles.scss (the bce-chaos-contracts scoped-global section,
 * DIRECTIVE-HARDEN-4 Part 1) — one source, no per-component duplicate.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CONTRACT_COLUMNS } from './chaos-contract-steps';
import { NegotiationService } from './negotiation.service';

@Component({
    selector: 'bce-negotiate-modal',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <!-- DIRECTIVE-128 — the NEGOTIATION MODAL. Opened from an offer card's Negotiate ▸ (or the Brief modal's
             Negotiate ▸); seeded from that hotspot's authored terms; Accept & sign inside is the SOLE sign path.
             Mirrors the D-124e .cpv preview modal (fixed, viewport-capped, scroll + overscroll-behavior:contain). -->
        @if (neg.negotiating(); as h) {
            <div class="cng-overlay" (click)="neg.discardNegotiation()">
                <div class="cng" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
                    <button type="button" class="cng-x" (click)="neg.discardNegotiation()" aria-label="Close">✕</button>
                    <div class="cng-h">
                        <div class="cng-world">{{ h.world }}</div>
                        <!-- IMPORT-5 Part E — per-side title/type (falls back to the shared top-level for authored packs). -->
                        <div class="cng-title">{{ neg.negTitle() }}</div>
                        @if (neg.forParticipant(); as fp) { <div class="cng-for" data-testid="cng-for">Negotiating for <b>{{ fp.label }}</b> — this company's own terms on the shared track, against its reputation ({{ neg.rep() }}); Command Rights are locked to the session's contract. Nothing here touches the session's contract.</div> }
                        <!-- IMPORT-6 Part A — surface the contract's INTENSITY (the track count it completes at) where it is decided. -->
                        <div class="cng-type">{{ neg.negType() }} &middot; Scale {{ h.contract.scale }} &middot; Intensity {{ neg.intensity() }} <span data-testid="cc-neg-intensity" class="cng-int">({{ h.tracks.length }} authored track{{ h.tracks.length === 1 ? '' : 's' }})</span></div>
                        <!-- DIRECTIVE-133 — the chosen SIDE's employer + role + the opposing faction. -->
                        <div class="cng-who"><span><b>Fighting for</b>{{ neg.negSideOffer()?.employer ?? h.employer }}</span>@if (neg.negSideOffer(); as so) { <span><b>as</b>{{ so.role }}</span> }<span><b>vs</b>{{ neg.negOpposing() }}</span></div>
                        @if (neg.negSideOffer()?.synthesized) { <div class="cng-prov">Provisional side — an authored opposing contract is pending; terms mirror the primary side for now.</div> }
                    </div>

                    <!-- IMPORT-5 Part B — the builder's employer description / situation briefing / planet info on the
                         NEGOTIATION screen (previously only on the optional Brief preview → the tester saw none of it). -->
                    @if (neg.negEmployerDesc() || neg.negSituation() || neg.negSystem().length || neg.negDescription()) {
                        <div class="cng-brief">
                            @if (neg.negEmployerDesc()) { <p class="cng-brief-emp">{{ neg.negEmployerDesc() }}</p> }
                            @if (neg.negSituation()) { <p class="cng-brief-sit">{{ neg.negSituation() }}</p> }
                            @if (neg.negSystem().length) { <div class="cng-brief-sys">@for (r of neg.negSystem(); track r.label) { <span><b>{{ r.label }}</b> {{ r.value }}</span> }</div> }
                            @if (neg.negDescription()) { <p class="cng-brief-desc">{{ neg.negDescription() }}</p> }
                        </div>
                    }

                    <!-- DIRECTIVE-129 — manual Contract Scale chooser (DR p.36: Scale is voluntary). Defaults to the
                         hotspot's authored Scale; changing it re-seeds terms (rep budget = 2×Scale, per-term cap = Scale).
                         IMPORT-8 Ruling A — supersedes the D-136 Part B GATE: buttons are ALWAYS enabled (free choice,
                         default = authored); a Scale above the fieldable-BV line renders an honest INLINE warning
                         (visible text — a hover title is invisible on a tablet). -->
                    <div class="cc-pick cng-scale-pick" data-testid="cc-scale-pick">
                        <label>Contract Scale
                            <span class="cc-scale">
                                @for (s of [1,2,3]; track s) { <button type="button" [class.on]="neg.scale() === s" (click)="neg.setScale(s)" [attr.aria-label]="'Scale ' + s">{{ s }}</button> }
                            </span>
                        </label>
                        <span class="cng-scale-hint">Changing Scale resets negotiated terms.</span>
                        @if (!neg.scaleAvailable(neg.scale())) {
                            <span class="cng-scale-bvwarn" data-testid="cc-scale-bvwarn">your fieldable force is under the Scale-{{ neg.scale() }} line ({{ neg.scaleNeedBv(neg.scale()).toLocaleString() }} BV)</span>
                        }
                        <!-- IMPORT-7 Part D — the authored recommendation at decision time; deviation made visible, never blocked. -->
                        @if (neg.negSideOffer()?.contract?.scale ?? h.contract.scale; as authored) {
                            <span class="cng-scale-auth" [class.dev]="neg.scale() !== authored" data-testid="cc-scale-authored">authored: Scale {{ authored }}@if (neg.scale() !== authored) { &middot; signing at Scale {{ neg.scale() }} — authored requirements assume Scale {{ authored }} }</span>
                        }
                    </div>

                    <div class="cc-budget">
                        <span>Reputation steps <b>{{ neg.repUsed() }}/{{ neg.repBudget() }}</b></span>
                        <span>Sacrifices <b>{{ neg.sacrificesUsed() }}/2</b></span>
                        <span>Per-term raise cap <b>{{ neg.scale() }}</b></span>
                    </div>

                    <div class="cc-terms">
                        @for (col of columns; track col) {
                            <div class="ct-row">
                                <span class="ct-l">{{ neg.colLabel(col) }}</span>
                                <span class="ct-v">{{ neg.displayValue(col) }}</span>
                                <span class="ct-raised" [class.on]="neg.raises()[col] > 0">+{{ neg.raises()[col] }}</span>
                                @if (col === 'command' && neg.forParticipant()) {
                                    <button type="button" class="ct-raise ct-locked" disabled data-testid="cc-raise-command" title="Command Rights are locked to the session's contract for every company on the track">&#128274; locked</button>
                                } @else {
                                    <button type="button" class="ct-raise" [disabled]="!neg.canRaise(col)" (click)="neg.repRaise(col)" [attr.data-testid]="'cc-raise-' + col">&#9650; Rep@if (neg.repCost(col) != null) { ({{ neg.repCost(col) }}) }</button>
                                }
                            </div>
                        }
                    </div>

                    <div class="cc-sac">
                        <span class="l">Sacrifice</span>
                        <!-- DIRECTIVE-136 (Part A) — disable dead options (a term that can't drop 2 steps / can't be raised
                             within the per-Scale cap, or the term chosen on the other side); the control auto-heals to a valid pair. -->
                        <select (change)="neg.sacDrop.set($any($event.target).value)">
                            @for (col of columns; track col) { <option [value]="col" [selected]="col === neg.sacDrop()" [disabled]="!neg.canDrop(col)">drop {{ neg.colLabel(col) }} (−2)</option> }
                        </select>
                        <span class="cc-arrow">&rarr;</span>
                        <select (change)="neg.sacRaise.set($any($event.target).value)">
                            @for (col of columns; track col) { <option [value]="col" [selected]="col === neg.sacRaise()" [disabled]="!neg.canRaiseSac(col)">raise {{ neg.colLabel(col) }} (+1)</option> }
                        </select>
                        <button type="button" class="cc-btn small" [disabled]="!neg.canSacrifice()" (click)="neg.doSacrifice()" [attr.title]="neg.sacDisabledReason()">Sacrifice</button>
                        @if (!neg.sacPossible()) { <span class="cc-sac-none" data-testid="cc-sac-none">No sacrifice available — every term is at its Scale cap.</span> }
                    </div>

                    <div class="cc-econ">
                        <span>Base Pay <b>+{{ neg.money(neg.basePayLive()) }} SP</b>/mo</span>
                        <span>Transport <b>−{{ neg.money(neg.transportPaid()) }} SP</b> (cover {{ neg.money(neg.transportCover()) }})</span>
                    </div>

                    <div class="cc-actions cng-actions">
                        <button type="button" class="cc-btn ghost" (click)="neg.discardNegotiation()">Discard</button>
                        <button type="button" class="cc-btn ghost" (click)="neg.resetNegotiation()">Reset terms</button>
                        <button type="button" class="cc-btn go" (click)="neg.accept()" data-testid="cc-accept-sign">Accept &amp; sign &rsaquo;</button>
                    </div>
                </div>
            </div>
        }

        <!-- DIRECTIVE-124e — offer PREVIEW: a read-only contract-offer summary (system + travel + gist + WHO), never
             any tactical/OpFor detail. Additive; the offer board / pick / reroll are unchanged. -->
        @if (neg.previewHotspot(); as h) {
            <div class="cpv-overlay" (click)="neg.closePreview()">
                <div class="cpv" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
                    <button type="button" class="cpv-x" (click)="neg.closePreview()" aria-label="Close">✕</button>
                    <div class="cpv-h">
                        <div class="cpv-world">{{ h.world }}</div>
                        <!-- IMPORT-5 Part E — per-side title/type (falls back to shared top-level for authored packs). -->
                        <div class="cpv-title">{{ neg.previewTitle() }}</div>
                        <div class="cpv-type">{{ neg.previewType() }} &middot; Scale {{ h.contract.scale }} &middot; {{ h.tracks.length }} track{{ h.tracks.length === 1 ? '' : 's' }}</div>
                    </div>

                    <div class="cpv-sec">
                        <div class="cpv-lbl">Fighting for</div>
                        <!-- DIRECTIVE-133 — the previewed SIDE's employer + role (objectives stay the shared list — role filtering is Phase 2). -->
                        <div class="cpv-employer">{{ neg.previewSideOffer()?.employer ?? h.employer }}@if (neg.previewSideOffer(); as so) { <span class="cpv-role">&middot; {{ so.role }}</span> }@if (neg.previewSideOffer()?.synthesized) { <span class="cpv-prov">provisional</span> }</div>
                        <!-- IMPORT-5 Part B — the employer DESCRIPTION (was captured by the builder but rendered nowhere). -->
                        @if (neg.previewEmployerDesc()) { <div class="cpv-empdesc">{{ neg.previewEmployerDesc() }}</div> }
                        <div class="cpv-rep"><span class="cpv-rep-l">Your standing</span> <span class="cpv-pips">@for (on of neg.repPips(); track $index) { <span class="cpv-pip" [class.on]="on"></span> }</span> <b>{{ neg.rep() }}</b></div>
                    </div>

                    <div class="cpv-sec">
                        <div class="cpv-lbl">Opposing</div>
                        <div class="cpv-enemy">vs {{ neg.previewOpposing() }}</div>
                        <div class="cpv-undisc">Force strength undisclosed.</div>
                    </div>

                    <div class="cpv-sec">
                        <div class="cpv-lbl">System</div>
                        <div class="cpv-kv">@for (r of neg.previewSystem(); track r.label) { <div><span class="k">{{ r.label }}</span><span class="v">{{ r.value }}</span></div> }</div>
                        <!-- IMPORT-5 Part F — the free-text planet description (renders as prose, not a key/value row). -->
                        @if (neg.previewDescription()) { <p class="cpv-planet-desc">{{ neg.previewDescription() }}</p> }
                    </div>

                    <div class="cpv-sec">
                        <div class="cpv-lbl">Transit &amp; transport</div>
                        <div class="cpv-kv">
                            @if (neg.previewTransit().jumpDays != null) { <div><span class="k">Jump-point transit</span><span class="v">~{{ neg.previewTransit().jumpDays }} days</span></div> }
                            @if (neg.previewTransit().rechargeHours != null) { <div><span class="k">Jump-sail recharge</span><span class="v">~{{ neg.previewTransit().rechargeHours }} hours</span></div> }
                            <div><span class="k">Transport</span><span class="v">{{ neg.previewTransit().net > 0 ? '−' + neg.money(neg.previewTransit().net) : '0' }} SP <span class="cpv-dim">(cover {{ neg.money(neg.previewTransit().cover) }})</span></span></div> <!-- HOTSPOT-BRIEF v1 rider: never render −0 -->
                        </div>
                    </div>

                    <div class="cpv-sec">
                        <div class="cpv-lbl">The op</div>
                        <!-- IMPORT-5 Part E/B — the previewed side's situation (else its blurb, else the shared gist). -->
                        <p class="cpv-op">{{ neg.previewOp() }}</p>
                    </div>

                    <p class="cpv-foot">Track objectives and enemy strength unlock at deployment.</p>
                    <div class="cpv-actions">
                        <button type="button" class="cc-btn ghost" (click)="neg.closePreview()">Close</button>
                        <button type="button" class="cc-btn go" (click)="neg.pickFromPreview()" data-testid="cc-pick-from-preview" title="Negotiate the terms of this contract, then sign">Negotiate &#9656;</button>
                    </div>
                </div>
            </div>
        }
    `,
    styles: [`
        /* modal-only rules — moved outright from the parent */
        .ct-raised { font-family:var(--mono); font-size:11px; color:var(--ink2); opacity:.4; }
        .ct-raised.on { color:var(--ok, #3a7d44); opacity:1; }
        .ct-raise { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:11px; text-transform:uppercase; border:1.4px solid var(--stamp); background:transparent; color:var(--stamp); padding:6px 11px; cursor:pointer; min-height:34px; }
        .ct-raise:hover:not(:disabled), .ct-raise:focus-visible:not(:disabled) { background:var(--stamp); color:var(--paper); outline:none; }
        .ct-raise:disabled { opacity:.35; cursor:not-allowed; }
        .cc-pick { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px; }
        .cc-pick label { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); display:flex; align-items:center; gap:8px; }
        .cc-pick select { font-family:var(--type); font-size:13px; padding:6px 8px; border:1.4px solid var(--ink); background:var(--paper); color:var(--ink); min-height:38px; }
        .cc-scale button { font-family:var(--mono); font-weight:700; font-size:13px; border:1.4px solid var(--ink); background:var(--paper); color:var(--ink); width:38px; height:38px; cursor:pointer; }
        .cc-scale button.on { background:var(--ink); color:var(--paper); }
        /* IMPORT-8 Ruling A — the D-136 disable is superseded; the fieldable-BV line renders as an inline WARN instead */
        .cng-scale-bvwarn { display:block; font-family:var(--mono); font-size:10.5px; letter-spacing:.4px; color:var(--stamp); margin-top:4px; }
        .cc-sac-none { font-family:var(--type); font-size:11.5px; color:var(--ink2); font-style:italic; }
        .cc-budget { display:flex; flex-wrap:wrap; gap:16px; font-family:var(--type); font-size:12.5px; color:var(--ink2); border-top:1px dashed var(--ink2); border-bottom:1px dashed var(--ink2); padding:8px 0; margin-bottom:12px; }
        .cc-budget b { font-family:var(--mono); color:var(--ink); }
        .cc-sac { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:14px; }
        .cc-sac .l { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); }
        .cc-sac select { font-family:var(--type); font-size:12px; padding:5px 7px; border:1.3px solid var(--ink2); background:var(--paper); color:var(--ink); min-height:34px; }
        .cc-arrow { color:var(--ink2); }
        .cng-for { font-family:var(--type); font-size:12.5px; color:var(--stamp); margin-top:5px; }
        .ct-locked { opacity:.7; cursor:not-allowed; }
        .cng-prov { font-family:var(--type); font-size:11.5px; font-style:italic; color:var(--warn, #c2622a); margin-top:5px; }
        .cpv-role { font-family:var(--mono); font-size:11px; color:var(--ink2); text-transform:capitalize; }
        .cpv-prov { font-family:var(--mono); font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--warn, #c2622a); border:1px solid var(--warn, #c2622a); padding:0 4px; margin-left:6px; }
        /* DIRECTIVE-128 — the per-card NEGOTIATION MODAL (mirrors the D-124e .cpv preview modal; viewport-capped, scrolls) */
        .cng-overlay { position:fixed; inset:0; background:rgba(20,16,10,.55); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px calc(40px + var(--bce-footer-h, 0px)); overflow-y:auto; overscroll-behavior:contain; z-index:60; } /* IMPORT-7 A — clear the legal footer */
        .cng { position:relative; width:min(680px,100%); max-height:calc(100dvh - 96px); overflow-y:auto; overscroll-behavior:contain; background:var(--paper2, var(--paper)); border:1.8px solid var(--ink); box-shadow:0 8px 30px rgba(0,0,0,.4); padding:20px 22px 18px; font-family:var(--type); color:var(--ink); }
        .cng-x { position:absolute; top:10px; right:12px; border:none; background:transparent; font-size:18px; color:var(--ink2); cursor:pointer; line-height:1; }
        .cng-h { border-bottom:1.5px solid var(--line); padding-bottom:10px; margin-bottom:12px; }
        .cng-world { font-family:var(--label); font-weight:700; letter-spacing:2px; font-size:11px; text-transform:uppercase; color:var(--stamp); }
        .cng-title { font-family:var(--stencil, var(--label)); font-size:22px; margin:1px 0 3px; }
        .cng-type { font-family:var(--mono); font-size:12px; color:var(--ink2); }
        .cng-who { display:flex; flex-wrap:wrap; gap:4px 18px; margin-top:7px; font-family:var(--type); font-size:13.5px; }
        .cng-who b { font-family:var(--label); font-weight:700; letter-spacing:.5px; font-size:10px; text-transform:uppercase; color:var(--ink2); margin-right:6px; }
        /* IMPORT-5 Part B — the negotiate briefing block (employer desc / situation / planet facts) */
        .cng-brief { border-left:2px solid var(--stamp); padding:2px 0 2px 10px; margin-bottom:12px; }
        .cng-brief p { font-family:var(--type); font-size:12.5px; line-height:1.5; margin:0 0 6px; }
        .cng-brief-emp { font-style:italic; color:var(--ink2); }
        .cng-brief-desc { color:var(--ink2); }
        .cng-brief-sys { display:flex; flex-wrap:wrap; gap:2px 14px; font-family:var(--mono); font-size:11px; color:var(--ink2); margin:2px 0 6px; }
        .cng-brief-sys b { color:var(--ink); font-weight:600; }
        .cng-actions { justify-content:flex-end; margin-top:2px; }
        /* DIRECTIVE-129 — the modal Scale chooser */
        .cng-scale-pick { margin-bottom:12px; align-items:center; gap:12px; }
        .cng-scale-hint { font-family:var(--type); font-size:11.5px; font-style:italic; color:var(--ink2); }
        .cng-scale-auth { display:block; font-family:var(--mono); font-size:10.5px; letter-spacing:.4px; color:var(--ink2); margin-top:4px; } /* IMPORT-7 Part D */
        .cng-scale-auth.dev { color:var(--stamp); }
        /* DIRECTIVE-124e — the offer preview modal (parchment offer-board styling) */
        .cpv-overlay { position:fixed; inset:0; background:rgba(20,16,10,.55); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px calc(40px + var(--bce-footer-h, 0px)); overflow-y:auto; z-index:60; } /* IMPORT-7 A — clear the legal footer */
        .cpv { position:relative; width:min(680px,100%); background:var(--paper2, var(--paper)); border:1.8px solid var(--ink); box-shadow:0 8px 30px rgba(0,0,0,.4); padding:20px 22px 18px; font-family:var(--type); color:var(--ink); }
        .cpv-x { position:absolute; top:10px; right:12px; border:none; background:transparent; font-size:18px; color:var(--ink2); cursor:pointer; line-height:1; }
        .cpv-h { border-bottom:1.5px solid var(--line); padding-bottom:10px; margin-bottom:12px; }
        .cpv-world { font-family:var(--label); font-weight:700; letter-spacing:2px; font-size:11px; text-transform:uppercase; color:var(--stamp); }
        .cpv-title { font-family:var(--stencil, var(--label)); font-size:23px; margin:1px 0 3px; }
        .cpv-type { font-family:var(--mono); font-size:12px; color:var(--ink2); }
        .cpv-sec { margin-bottom:13px; }
        .cpv-lbl { font-family:var(--label); font-weight:700; letter-spacing:1.5px; font-size:10px; text-transform:uppercase; color:var(--ink2); border-bottom:1px dashed var(--ink2); padding-bottom:3px; margin-bottom:6px; }
        .cpv-employer { font-family:var(--type); font-size:14px; font-weight:600; }
        /* IMPORT-5 Part B/F — employer description + free-text planet description prose */
        .cpv-empdesc { font-family:var(--type); font-size:12.5px; line-height:1.45; color:var(--ink2); font-style:italic; margin-top:3px; }
        .cpv-planet-desc { font-family:var(--type); font-size:12.5px; line-height:1.5; color:var(--ink2); margin:8px 0 0; }
        .cpv-rep { display:flex; align-items:center; gap:8px; margin-top:4px; font-family:var(--type); font-size:12px; color:var(--ink2); }
        .cpv-rep-l { font-family:var(--label); font-size:10px; letter-spacing:.06em; text-transform:uppercase; }
        .cpv-pips { display:inline-flex; gap:3px; }
        .cpv-pip { width:10px; height:10px; border:1.3px solid var(--ink2); border-radius:50%; display:inline-block; }
        .cpv-pip.on { background:var(--stamp); border-color:var(--stamp); }
        .cpv-rep b { font-family:var(--mono); color:var(--ink); }
        .cpv-enemy { font-family:var(--type); font-size:15px; font-weight:700; }
        .cpv-undisc { font-style:italic; font-size:12.5px; color:var(--ink2); margin-top:2px; }
        .cpv-kv { display:grid; grid-template-columns:1fr 1fr; gap:3px 18px; }
        .cpv-kv > div { display:flex; justify-content:space-between; gap:10px; border-bottom:1px dotted var(--line); padding:2px 0; }
        .cpv-kv .k { font-family:var(--label); font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink2); }
        .cpv-kv .v { font-family:var(--mono); font-size:12px; text-align:right; }
        .cpv-dim { color:var(--ink2); }
        .cpv-op { font-family:var(--type); font-size:13.5px; line-height:1.5; margin:0; white-space:pre-line; } /* HOTSPOT-BRIEF v1 Amendment A — paragraphs render */
        .cng-brief-sit { white-space:pre-line; } /* HOTSPOT-BRIEF v1 Amendment A */
        .cpv-foot { font-style:italic; font-size:11.5px; color:var(--ink2); border-top:1px dashed var(--ink2); padding-top:8px; margin:14px 0 12px; }
        .cpv-actions { display:flex; gap:10px; justify-content:flex-end; }
        @media (max-width:560px) { .cpv-kv { grid-template-columns:1fr; } }
    `],
})
export class NegotiateModalComponent {
    protected readonly neg = inject(NegotiationService);
    protected readonly columns = CONTRACT_COLUMNS;
}
