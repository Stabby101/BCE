/*
 * BCE — the mission RESOLVE modal (the 3-toggle legacy form, the D-134 two-sided VP checklist, the D-110c
 * salvage input, the D-121 field settlement, the D-122 damage capture). Markup extracted VERBATIM from
 * dashboard.html by DIRECTIVE-HARDEN-4; ALL state and logic live in the dashboard-provided ResolveService
 * (this child renders and delegates — it owns nothing). Mounted unconditionally at the dashboard template
 * root; gates itself on res.resolveOpen(), exactly as the old root-level @if did.
 * Styles: the resolve-only rules (.rq, .ynb, .rq2*, .rnotes, .rtier, .rovr, .t-*, .fs-*) moved here; the
 * shared modal chrome (.cmodal/.cbox/.cbtn/.cbtns/.ph/.cmsg/.gate-note) is DUPLICATED from dashboard.scss
 * (keep in lockstep) — a scoped-global hoist of these generic class names leaks into the dozen nested
 * dashboard components that reuse them (HARDEN-4 adversarial-panel catch), so the copies stay per-component.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ResolveService } from './resolve.service';

@Component({
    selector: 'bce-resolve-modal',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @if (res.resolveOpen()) {
        <div class="cmodal" role="dialog" aria-modal="true" (click)="res.cancelResolve()">
            <div class="cbox wide" (click)="$event.stopPropagation()">
                <div class="ph flat">Resolve mission — {{ res.activeBranch()?.name }}</div>
                @if (res.deployedCount()) {
                    <p class="cmsg">Answer the objective facts; the engine computes the outcome tier (you may override). The result gates which branches unlock.</p>
                    <!-- DIRECTIVE-134 — two-sided (DR VP) resolve: two objective columns + a broke toggle + a live verdict.
                         Gated on the contract's Phase-1 \`side\`; legacy/single-sided contracts keep the three primary/
                         secondary/bonus toggles below (byte-identical). Both paths feed computedTier() → the same tier map. -->
                    @if (res.twoSided()) {
                        @if (res.twoSidedView(); as tv) {
                            <div class="rq2cols">
                                <div class="rq2col">
                                    <div class="rq2h">Your objectives</div>
                                    @for (o of tv.ourObjs; track $index) {
                                        <div class="rq2row"><div class="rq2t">{{ o.text }} <span class="rq2vp">&middot; {{ o.vp }} VP</span></div><div class="rqb"><button type="button" class="ynb" [class.yes]="o.met" (click)="res.setObjMet('our', $index, true)" data-testid="cc-our-obj">MET</button><button type="button" class="ynb" [class.no]="!o.met" (click)="res.setObjMet('our', $index, false)">NOT</button></div></div>
                                    }
                                    @if (!tv.ourObjs.length) { <div class="rq2none">No authored objectives for your side.</div> }
                                </div>
                                <div class="rq2col">
                                    <div class="rq2h">Opponent objectives</div>
                                    @for (o of tv.oppObjs; track $index) {
                                        <div class="rq2row"><div class="rq2t">{{ o.text }} <span class="rq2vp">&middot; {{ o.vp }} VP</span></div><div class="rqb"><button type="button" class="ynb" [class.yes]="o.met" (click)="res.setObjMet('opp', $index, true)" data-testid="cc-opp-obj">MET</button><button type="button" class="ynb" [class.no]="!o.met" (click)="res.setObjMet('opp', $index, false)">NOT</button></div></div>
                                    }
                                    @if (!tv.oppObjs.length) { <div class="rq2none">No authored opponent objectives yet (Phase 3 authors per-side objectives).</div> }
                                </div>
                            </div>
                            <div class="rq"><div class="rqt"><b>Force broke / withdrew?</b> your force quit the field</div><div class="rqb"><button type="button" class="ynb" [class.no]="!res.rAns().broke" (click)="res.setBroke(false)">NO</button><button type="button" class="ynb" [class.yes]="res.rAns().broke" (click)="res.setBroke(true)" data-testid="cc-broke">YES</button></div></div>
                            <div class="rq2verdict" data-testid="cc-vp-verdict">
                                <span class="rq2tally">Your VP <b>{{ tv.ourVp }}</b> &middot; Opponent VP <b>{{ tv.oppVp }}</b> &middot; You met <b>{{ tv.ourMetCount }}/{{ tv.ourTotal }}</b></span>
                                <span class="rq2badge t-{{ res.computedTier() }}" data-testid="cc-vp-badge">{{ res.verdictLabel() }}</span>
                                <span class="rq2pay">Combat pay <b>{{ res.combatPayPreview() }} SP</b></span>
                            </div>
                        }
                    } @else if (res.oneSided()) {
                        <!-- DIRECTIVE-IMPORT-6 Part B — SINGLE-SIDED authored objectives (a single-sided custom hot spot, or a
                             D-116 preset track played via the picker): ONE column listing EVERY authored objective + VP, the
                             broke toggle, and a live verdict — tier = the VP share (singleSidedResolve). Sibling of the D-134
                             two-sided block above (untouched) and the legacy 3-toggle block below (untouched). -->
                        @if (res.oneSidedView(); as sv) {
                            <div class="rq2cols one" data-testid="cc-ss-cols">
                                <div class="rq2col">
                                    <div class="rq2h">Objectives</div>
                                    @for (o of sv.ourObjs; track $index) {
                                        <div class="rq2row"><div class="rq2t">{{ o.text }} <span class="rq2vp">&middot; {{ o.vp }} VP</span></div><div class="rqb"><button type="button" class="ynb" [class.yes]="o.met" (click)="res.setObjMet('our', $index, true)" data-testid="cc-our-obj">MET</button><button type="button" class="ynb" [class.no]="!o.met" (click)="res.setObjMet('our', $index, false)">NOT</button></div></div>
                                    }
                                </div>
                            </div>
                            <div class="rq"><div class="rqt"><b>Force broke / withdrew?</b> your force quit the field</div><div class="rqb"><button type="button" class="ynb" [class.no]="!res.rAns().broke" (click)="res.setBroke(false)">NO</button><button type="button" class="ynb" [class.yes]="res.rAns().broke" (click)="res.setBroke(true)" data-testid="cc-broke">YES</button></div></div>
                            <div class="rq2verdict" data-testid="cc-ss-verdict">
                                <span class="rq2tally">Your VP <b>{{ sv.ourVp }}</b> of <b>{{ sv.totalVp }}</b> &middot; You met <b>{{ sv.ourMetCount }}/{{ sv.ourTotal }}</b></span>
                                <span class="rq2badge t-{{ res.computedTier() }}" data-testid="cc-ss-badge">{{ res.verdictLabel() }}</span>
                                <span class="rq2pay">Combat pay <b>{{ res.combatPayPreview() }} SP</b></span>
                            </div>
                        }
                    } @else if (res.resolveObjectives(); as ro) {
                        <div class="rq"><div class="rqt"><b>Primary:</b> {{ ro.primary }}</div><div class="rqb"><button type="button" class="ynb" [class.yes]="res.rAns().primary" (click)="res.setAns('primary', true)">MET</button><button type="button" class="ynb" [class.no]="!res.rAns().primary" (click)="res.setAns('primary', false)">NOT MET</button></div></div>
                        <div class="rq"><div class="rqt"><b>Secondary:</b> {{ ro.secondary }}</div><div class="rqb"><button type="button" class="ynb" [class.yes]="res.rAns().secondary" (click)="res.setAns('secondary', true)">MET</button><button type="button" class="ynb" [class.no]="!res.rAns().secondary" (click)="res.setAns('secondary', false)">NOT MET</button></div></div>
                        <div class="rq"><div class="rqt"><b>Bonus:</b> {{ ro.bonus }}</div><div class="rqb"><button type="button" class="ynb" [class.yes]="res.rAns().bonus" (click)="res.setAns('bonus', true)">MET</button><button type="button" class="ynb" [class.no]="!res.rAns().bonus" (click)="res.setAns('bonus', false)">NOT MET</button></div></div>
                    }
                    <!-- DIRECTIVE-129 — "Compromised?" is a shared tier absent from the DR two-sided (objectives + VP)
                         resolve model + no HS hotspot authors a COMPROMISED fork, so it's inert in HS. Hide it in Hot Spots;
                         Traditional keeps it (computeTier + the COMPROMISED gate unchanged; rAns.compromised defaults false). -->
                    @if (!res.isHotspots()) {
                    <div class="rq"><div class="rqt"><b>Compromised?</b> the enemy learned something material</div><div class="rqb"><button type="button" class="ynb" [class.no]="!res.rAns().compromised" (click)="res.setAns('compromised', false)">NO</button><button type="button" class="ynb" [class.yes]="res.rAns().compromised" (click)="res.setAns('compromised', true)">YES</button></div></div>
                    }
                    <label class="rnotes"><span>Notes</span><input type="text" [value]="res.rAns().notes" (input)="res.setNotes($any($event.target).value)" placeholder="GM notes for the log (optional)" /></label>
                    @if (res.showSalvageInput()) {
                        <!-- D-110c — Hot Spots salvage: pre-filled with the D-110b estimate; edit for the actual SP (posts 'Salvage —'), leave it to post the estimate ('Salvage (est.) —'). -->
                        <label class="rnotes"><span>Salvage (SP)</span><input type="number" min="0" step="10" [value]="res.rAns().salvageValue ?? res.salvageEstimate()" (input)="res.setSalvage($any($event.target).value)" placeholder="salvage SP" /></label>
                        <div class="gate-note">Estimated {{ res.salvageEstimate() }} SP (OpFor BV × outcome × salvage %). Edit for the actual salvage; left untouched, the estimate is posted.</div>
                    }
                    <!-- DIRECTIVE-121 — Hot Spots FIELD SETTLEMENT: record own-unit losses + claim prize 'Mechs. Salvage
                         stays abstract SP; prizes are physical (Cold Storage) + slot-limited + reduce the salvage SP. -->
                    @if (res.isHotspots()) {
                        @if (res.settleBlufor().length) {
                            <div class="fs-head">Your losses</div>
                            <div class="fs-list">
                                @for (u of res.settleBlufor(); track u.id) {
                                    <div class="fs-row" [class.lost]="res.isLost(u.id, u.destroyed)">
                                        @if (u.destroyed) {
                                            <span class="fs-chk on ro" title="Destroyed in action — automatically lost">✕</span>
                                        } @else {
                                            <button type="button" class="fs-chk" [class.on]="res.lossAbandon().has(u.id)" (click)="res.toggleAbandon(u.id)" [attr.aria-label]="'Abandon ' + u.label">{{ res.lossAbandon().has(u.id) ? '✓' : '' }}</button>
                                        }
                                        <span class="fs-name">{{ u.label }}</span>
                                        <span class="fs-tag">{{ u.destroyed ? 'LOST — destroyed' : (res.lossAbandon().has(u.id) ? 'LOST — abandoned' : 'returns') }}</span>
                                        @if (res.isLost(u.id, u.destroyed) && u.pilotName) {
                                            <span class="fs-pilot">{{ u.pilotName }}</span>
                                            <select class="fs-fate" (change)="res.setLossFate(u.id, $any($event.target).value)" [attr.aria-label]="u.pilotName + ' fate'">
                                                <option value="ok" [selected]="res.fateOf(u.id, u.destroyed) === 'ok'">walked out</option>
                                                <option value="injured" [selected]="res.fateOf(u.id, u.destroyed) === 'injured'">injured</option>
                                                <option value="kia" [selected]="res.fateOf(u.id, u.destroyed) === 'kia'">KIA</option>
                                            </select>
                                        }
                                    </div>
                                }
                            </div>
                        }
                        @if (res.settleOpfor().length && res.prizeSlots() > 0) {
                            <div class="fs-head">Prizes <span class="fs-cap">{{ res.prizeCount() }} / {{ res.prizeSlots() }} claimed</span></div>
                            <div class="fs-list">
                                @for (o of res.settleOpfor(); track o.id) {
                                    <label class="fs-row" [class.on]="res.prizeClaim().has(o.id)">
                                        <input type="checkbox" [checked]="res.prizeClaim().has(o.id)" [disabled]="!res.prizeClaim().has(o.id) && res.prizeCount() >= res.prizeSlots()" (change)="res.togglePrize(o.id)" />
                                        <span class="fs-name">{{ o.label }}</span>
                                        <span class="fs-tag">{{ res.prizeClaim().has(o.id) ? 'CLAIM → cold storage' : 'defeated' }}</span>
                                    </label>
                                }
                            </div>
                            <div class="gate-note">Claimed prizes are captured to Cold Storage; each reduces the abstract salvage SP by its BV (take the 'Mech or its SP value, not both).</div>
                        } @else if (res.settleOpfor().length) {
                            <div class="gate-note">No prize slots — this contract's salvage term grants no captured 'Mechs.</div>
                        }
                        <!-- DIRECTIVE-122 — the two battle-damage totals for the iteration ledger. Taken auto-sums the
                             digital sheets (GM-editable); given is a plain GM number (OpFor damage isn't stored). -->
                        <div class="fs-head">Battle damage</div>
                        <div class="fs-dmg">
                            <label class="rnotes"><span>Damage taken</span><input type="number" min="0" step="1" [value]="res.dmgTakenShown()" (input)="res.setDmgTaken($any($event.target).value)" placeholder="own damage points" /></label>
                            <label class="rnotes"><span>Damage given</span><input type="number" min="0" step="1" [value]="res.dmgGiven() ?? ''" (input)="res.setDmgGiven($any($event.target).value)" placeholder="enemy damage (GM)" /></label>
                        </div>
                        <div class="gate-note">Damage taken is auto-summed from the digital sheets ({{ res.dmgTakenAuto() }} pts) — edit if needed. Damage given is GM-entered (the OpFor's post-battle state isn't recorded); leave it blank for “—”.</div>
                    }
                    <div class="rtier">Computed outcome: <b class="t-{{ res.computedTier() }}">{{ res.computedTier() }}</b>
                        <select class="rovr" (change)="res.setOverride($any($event.target).value)">
                            <option value="">— GM override: none —</option>
                            @for (g of res.gates; track g) { <option [value]="g">override → {{ g }}</option> }
                        </select>
                    </div>
                } @else {
                    <!-- HOTFIX-022 A — no deployed force: resolve cannot be a win, only a forfeit/loss -->
                    <p class="cmsg gate">No force deployed — deploy before resolving, or mark this operation a forfeit/loss. A mission resolved with nothing on the field can only be a <b class="t-FAILURE">FAILURE</b> (no default win, GM override included).</p>
                }
                <div class="cbtns">
                    <button type="button" class="cbtn" (click)="res.cancelResolve()">Cancel</button>
                    @if (res.deployedCount()) {
                        <button type="button" class="cbtn go" (click)="res.confirmResolve()">Resolve &raquo;</button>
                    } @else {
                        <button type="button" class="cbtn go" (click)="res.confirmResolve()">Mark forfeit / loss &raquo;</button>
                    }
                </div>
            </div>
        </div>
    }
    `,
    styles: [`
        /* dashboard.scss applies \`* { box-sizing: border-box; }\` component-wide; the child must replicate it
           or every moved element falls back to content-box (caught by the verify-h4-styles computed-style diff). */
        * { box-sizing: border-box; }
        /* the shared modal chrome, DUPLICATED from dashboard.scss — keep in lockstep */
        .ph { font-family: var(--label); font-weight: 600; letter-spacing: 2.5px; font-size: 13px; text-transform: uppercase; border-bottom: 1.5px solid var(--ink); padding-bottom: 6px; margin: 0 0 12px; }
        .ph.flat { border: none; margin: 0 0 6px; padding: 0; }
        .gate-note { font-family: var(--mono); font-size: 10px; letter-spacing: .4px; color: var(--ink2); font-style: italic; margin-top: 6px; }
        .cmodal { position: fixed; inset: 0; background: rgba(10, 8, 4, .55); display: flex; align-items: center; justify-content: center; padding: 20px 20px calc(20px + var(--bce-footer-h, 0px)); z-index: 50; } /* IMPORT-7 A — clear the legal footer */
        /* HOTFIX-038 — cap the box to the viewport + scroll internally so a tall resolve form's confirm stays reachable. */
        .cbox { background: var(--paper); border: 2px solid var(--ink); max-width: 480px; width: 100%; padding: 18px 20px; max-height: calc(100dvh - 40px); overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        .cbox.wide { max-width: 560px; }
        .cmsg { font-family: var(--type); font-size: 13.5px; line-height: 1.55; color: var(--ink); margin: 10px 0 16px; }
        .cbtns { display: flex; justify-content: flex-end; gap: 10px; }
        .cbtn { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 12px; text-transform: uppercase; border: 1.6px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 10px 16px; cursor: pointer; min-height: 44px; }
        .cbtn:hover, .cbtn:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .cbtn.go { border-color: var(--stamp); color: var(--stamp); }
        .cbtn.go:hover, .cbtn.go:focus-visible { background: var(--stamp); color: var(--paper); }
        /* resolve-only rules, moved verbatim from dashboard.scss + the .fs-* block from dashboard.ts styles */
        .rq { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1.2px solid var(--ink2); background: var(--paper2); padding: 8px 11px; margin-bottom: 8px; flex-wrap: wrap; }
        .rqt { flex: 1 1 200px; font-family: var(--type); font-size: 12.5px; line-height: 1.4; color: var(--ink); }
        .rqt b { font-family: var(--label); letter-spacing: .5px; text-transform: uppercase; font-size: 11px; }
        .rqb { display: flex; gap: 6px; flex: 0 0 auto; }
        .ynb { font-family: var(--mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; border: 1.4px solid var(--ink2); background: var(--paper); color: var(--ink2); padding: 6px 10px; cursor: pointer; min-height: 36px; }
        .ynb.yes { border-color: var(--ok); background: var(--ok); color: var(--paper); }
        .ynb.no { border-color: var(--stamp); background: var(--stamp); color: var(--paper); }
        .rnotes { display: flex; flex-direction: column; gap: 3px; margin: 4px 0 10px; }
        .rnotes span { font-family: var(--label); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ink2); }
        .rnotes input { font-family: var(--mono); font-size: 12px; padding: 8px 10px; border: 1.3px solid var(--ink2); background: var(--paper); color: var(--ink); }
        .rtier { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-family: var(--label); font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink2); border-top: 1px solid var(--line); padding-top: 10px; margin-bottom: 4px; }
        .rtier b { font-family: var(--stencil); font-size: 16px; letter-spacing: 1px; }
        .t-FULL_SUCCESS { color: var(--ok); }
        .t-SUCCESS { color: #3f7d4f; }
        .t-PARTIAL { color: var(--warn); }
        .t-FAILURE { color: var(--stamp); }
        .t-COMPROMISED { color: var(--cold, #5a6b7a); }
        .rovr { margin-left: auto; font-family: var(--mono); font-size: 11px; padding: 6px 8px; border: 1.3px solid var(--ink2); background: var(--paper); color: var(--ink); }
        .rq2cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
        .rq2col { border: 1.2px solid var(--ink2); background: var(--paper2); padding: 8px 10px; }
        .rq2h { font-family: var(--label); font-weight: 600; letter-spacing: 1px; font-size: 10.5px; text-transform: uppercase; color: var(--ink2); border-bottom: 1px dashed var(--ink2); padding-bottom: 5px; margin-bottom: 7px; }
        .rq2role { color: var(--stamp); }
        .rq2row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px dotted var(--line); flex-wrap: wrap; }
        .rq2t { flex: 1 1 140px; font-family: var(--type); font-size: 12px; line-height: 1.35; color: var(--ink); }
        .rq2vp { font-family: var(--mono); font-size: 10.5px; color: var(--stamp); white-space: nowrap; }
        .rq2none { font-family: var(--type); font-size: 11.5px; font-style: italic; color: var(--ink2); padding: 4px 0; }
        .rq2verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; font-family: var(--mono); font-size: 12px; color: var(--ink2); border-top: 1px solid var(--line); padding-top: 9px; margin-bottom: 4px; }
        .rq2verdict b { color: var(--ink); }
        .rq2badge { font-family: var(--stencil, var(--label)); font-size: 15px; letter-spacing: 1px; }
        .rq2pay { margin-left: auto; }
        .rq2cols.one { grid-template-columns: 1fr; } /* IMPORT-6 — the single-sided list is one column at every width */
        @media (max-width: 640px) { .rq2cols { grid-template-columns: 1fr; } }
        .fs-head { font-family:var(--label); font-weight:700; letter-spacing:.08em; text-transform:uppercase; font-size:11px;
            color:var(--ink2); margin:12px 0 5px; display:flex; align-items:baseline; gap:8px; }
        .fs-head .fs-cap { font-family:var(--mono); font-weight:400; letter-spacing:.02em; text-transform:none; font-size:11px; color:var(--stamp); }
        .fs-list { display:flex; flex-direction:column; gap:3px; max-height:190px; overflow-y:auto; }
        .fs-row { display:flex; align-items:center; gap:9px; padding:5px 8px; border:1.2px solid var(--line); background:var(--paper); border-radius:5px; cursor:pointer; }
        .fs-row.lost, .fs-row.on { border-color:var(--stamp); background:color-mix(in srgb, var(--stamp) 8%, var(--paper)); }
        .fs-row input[type=checkbox] { width:15px; height:15px; margin:0; }
        .fs-chk { width:20px; height:20px; flex:0 0 auto; border:1.3px solid var(--ink2); background:var(--paper); color:var(--stamp); font-size:12px;
            line-height:1; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; border-radius:4px; }
        .fs-chk.on { border-color:var(--stamp); }
        .fs-chk.ro { cursor:default; opacity:.85; }
        .fs-name { flex:1 1 auto; font-family:var(--type); font-size:13px; font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .fs-tag { font-family:var(--label); font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink2); white-space:nowrap; }
        .fs-row.lost .fs-tag, .fs-row.on .fs-tag { color:var(--stamp); }
        .fs-pilot { font-family:var(--type); font-size:12px; color:var(--ink2); white-space:nowrap; }
        .fs-fate { font-family:var(--type); font-size:12px; padding:3px 6px; border:1.2px solid var(--line); background:var(--paper); color:var(--ink); }
        /* DIRECTIVE-122 — the two damage inputs, side by side */
        .fs-dmg { display:flex; gap:10px; flex-wrap:wrap; }
        .fs-dmg .rnotes { flex:1 1 140px; }
    `],
})
export class ResolveModalComponent {
    protected readonly res = inject(ResolveService);
}
