import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { sessionPhase } from '../campaign/chaos/chaos-contract'; // PD3 P2 — the session phase
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { PlayerSessionService } from './player-session.service';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { unendedPickUnits } from './pending-phase';
import { engagementKeyOf } from '../campaign/claims/engagement-key';
import { BattleForceService, type Side, type BattleEntry } from '../campaign/battle/battle-force.service';
import { BattleSheetComponent } from '../campaign/battle/battle-sheet';
import { SheetViewComponent } from '../campaign/dashboard/roster/sheet-view';
import { ForgePackService } from '../campaign/mission/forge-pack.service';
import { PlayerOverlayComponent } from './player-overlay';
import { PlayerBriefingComponent } from './player-briefing';
import { BceUnitSpriteComponent } from '../campaign/sprite/unit-sprite';
import { SwipeDirective, type SwipeEndEvent } from '../directives/swipe.directive';
import { ZoomPanDirective } from '../directives/zoom-pan.directive';
import { CBTPhaseResolutionService } from '../services/cbt-phase-resolution.service'; // REBASE-1 P3 item 1 — the pin's per-unit END PHASE (fans the consolidated damage)
import { SessionNoticeComponent } from './session-notice';
import { OptionsService } from '../services/options.service';
import type { Options } from '../models/options.model';

type OverlayKind = 'teammates' | 'doctrine' | 'briefing' | 'settings';

@Component({
    selector: 'bce-player-sheet',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [BattleForceService],
    imports: [BattleSheetComponent, SheetViewComponent, PlayerOverlayComponent, PlayerBriefingComponent, BceUnitSpriteComponent, SwipeDirective, ZoomPanDirective, SessionNoticeComponent],
    template: `
        <div class="ps" [class.blu]="side() === 'BLUFOR'" [class.opf]="side() === 'OPFOR'">
            <header class="pshead">
                <button type="button" class="psback" (click)="toRoster()">‹ Roster</button>
                @if (mine().length > 0) {
                    <button type="button" class="psunits" (click)="toggleNav()" aria-label="Switch unit">☰ Units <span class="psunits-n">{{ mine().length }}</span></button>
                }
                <div class="pswho"><span class="psside">{{ side() }}</span> · {{ name() || 'Player' }}</div>
                <div class="psconn" [class.on]="connected()">{{ connected() ? '● live' : '○ offline' }}</div>
            </header>
            <bce-session-notice />

            @if (mine().length === 0) {
                <div class="psempty">
                    <p>No 'Mech claimed yet.</p>
                    <button type="button" class="psbtn" (click)="toRoster()">Go to the roster →</button>
                </div>
            } @else {
                @if (session.resolvedView()) { <div class="psresolved" data-testid="ps-resolved" [attr.data-server-closed]="session.serverClosed()">{{ session.serverClosed() ? 'Resolved — the GM closed this engagement' : 'Resolved — awaiting the next deploy' }} · this sheet is read-only</div> }
                <div class="ps-main" [class.resolved]="session.resolvedView()">
                    @if (mine().length > 1) {
                        <div class="psswipe" swipe direction="horizontal" [threshold]="28" [successRatio]="0.12" (swipeend)="onSwipe($event)">
                            <button type="button" class="psswipe-arr" (click)="cycle(-1)" aria-label="Previous unit">‹</button>
                            <span class="psswipe-hint"><b>{{ active()?.name }} {{ active()?.model }}</b><small>{{ activeIndex() + 1 }} / {{ mine().length }} · tap ‹ › or swipe</small></span>
                            <button type="button" class="psswipe-arr" (click)="cycle(1)" aria-label="Next unit">›</button>
                        </div>
                    }
                    @if (active(); as e) {
                        <div class="ps-zoom" bceZoomPan #zp="zoomPan">
                            @switch (e.status) {
                                @case ('ok') { <bce-battle-sheet [fu]="e.fu ?? null" [phaseOverlay]="true" /> }
                                @case ('missing') { <div class="psnote" data-testid="ps-broken">Unit not in the catalog — sheet unavailable. <button type="button" class="psretry" data-testid="ps-retry" (click)="retry(e)">Retry</button></div> }
                                @case ('error') { <div class="psnote" data-testid="ps-broken">Sheet failed to load: {{ e.error }} <button type="button" class="psretry" data-testid="ps-retry" (click)="retry(e)">Retry</button></div> }
                                @default { <div class="psnote">Loading sheet…</div> }
                            }
                        </div>
                        <!-- S58 (2026-09-12): ⊙ is DOM-FIRST. The cluster is a bottom-anchored column, so a button appended at the END pushed + and −
                             UP by 50 px the moment the sheet zoomed — a double-tap on + landed on − and un-zoomed (the P5 harness measured it).
                             Appended at the TOP, ⊙ grows the cluster upward and + / − never move; the P5 harness asserts the + centre. -->
                        <div class="ps-zoomctl">
                            @if (zp.zoomed()) { <button type="button" class="fit" (click)="zp.reset()" aria-label="Fit to screen">⊙</button> }
                            <button type="button" (click)="zp.zoomIn()" aria-label="Zoom in">+</button>
                            <button type="button" (click)="zp.zoomOut()" aria-label="Zoom out">−</button>
                        </div>
                        @if (!connected()) { <div class="psoffline">Host offline — edits are local until the connection returns.</div> }
                        <!-- REBASE-1 P3 item 1: the pin fans damage ONLY at END PHASE, but the sheet's own END PHASE button
                             rides the zoom/pan transform and slides off-screen after a pick. This viewport-PINNED banner (like
                             .ps-zoomctl, outside the transform) makes ending the phase reachable at 375×812 and names the stake. -->
                        @if (pendingPhaseCount() > 0) {
                            <div class="ps-endphase" data-testid="ps-endphase">
                                <span class="pe-hint">{{ pendingPhaseCount() }} unit{{ pendingPhaseCount() === 1 ? '' : 's' }} with unshared damage — not sent to the table until you end the phase.</span>
                                <button type="button" class="pe-btn" data-testid="ps-endphase-btn" (click)="endPlayerPhase()">END PHASE</button>
                            </div>
                        }
                        <!-- REBASE-1 P3 item 2: the to-hit (weapon Targets) button lives inside the overlay, which rides the
                             .ps-zoom transform and slides off-screen after a pick. This viewport-PINNED trigger (left-centre,
                             clear of the heat column at right, the zoom cluster and the END PHASE banner at the bottom) reaches
                             the pin's openTargets; the TN calculator opens as a document-root CDK overlay, viewport-fixed. -->
                        @if (battleSheet()?.toHitReady()) {
                            <button type="button" class="ps-tohit" data-testid="ps-tohit" aria-label="Targets — to-hit calculator" title="Targets — to-hit" (click)="openToHit($event)">
                                <svg aria-hidden="true" stroke="currentColor" stroke-width="1.5" fill="none" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 1v5M12 18v5M1 12h5M18 12h5"></path></svg>
                            </button>
                        }
                    }

                    <nav class="psbar">
                        <button type="button" (click)="open('teammates')">Teammates</button>
                        @if (side() === 'OPFOR') { <button type="button" (click)="open('doctrine')">Doctrine</button> }
                        <button type="button" (click)="open('briefing')">Briefing</button>
                        <button type="button" data-testid="ps-settings-btn" (click)="open('settings')">Settings</button>
                        @if (active(); as e) {
                            <button type="button" class="psfav" [class.on]="isFav()" (click)="toggleFav(e.instanceId)"
                                    [attr.aria-label]="isFav() ? 'Unfavorite' : 'Favorite'">{{ isFav() ? '★' : '☆' }}</button>
                        }
                    </nav>
                </div>

                @if (navOpen()) {
                    <div class="psnav-backdrop" (click)="navOpen.set(false)"></div>
                    <aside class="psnav">
                        <div class="psnav-head"><span>Your units</span><button type="button" class="psnav-x" (click)="navOpen.set(false)" aria-label="Close">✕</button></div>
                        <div class="psnav-hint">tap to switch · stays open · ✕ or tap-out to close</div>
                        <div class="psnav-list">
                            @for (e of mine(); track e.instanceId) {
                                <button type="button" class="psnav-item" [class.sel]="e.instanceId === active()?.instanceId" (click)="pick(e.instanceId)">
                                    <bce-unit-sprite [unit]="e" [size]="32" />
                                    <span class="psnav-name">{{ e.name }} {{ e.model }} <small>{{ e.tons }}t</small></span>
                                </button>
                            }
                        </div>
                    </aside>
                }
            }

            @if (overlay(); as ov) {
                <bce-player-overlay [title]="overlayTitle()" (close)="closeOverlay()">
                    @switch (ov) {
                        @case ('teammates') {
                            @if (teammateId(); as tid) {
                                <button type="button" class="ov-back" (click)="teammateId.set(null)">‹ All teammates</button>
                                <div class="ov-stitle">{{ teammateLabel() }} <span class="ro">read-only</span></div>
                                @if (teammate()?.fu) { <bce-sheet-view [fu]="teammate()!.fu ?? null" [rev]="teammateRev()" /> }
                                @else if (teammate() && (teammate()!.status === 'error' || teammate()!.status === 'missing')) {
                                    <!-- ORDER-9 Commit 1 — a teammate whose load terminated (error/missing) renders the broken-sheet state with the reason (not a perpetual "Loading…"), + Retry (the only path back to pending) -->
                                    <p class="ov-empty" data-testid="tm-broken">{{ teammate()!.status === 'missing' ? 'Unit not in the catalog — sheet unavailable.' : 'Sheet failed to load: ' + teammate()!.error }} <button type="button" class="psretry" data-testid="tm-retry" (click)="retry(teammate()!)">Retry</button></p>
                                }
                                @else { <p class="ov-empty">Loading the teammate sheet…</p> }
                            } @else if (teammates().length === 0) {
                                <p class="ov-empty">No teammate sheets on your side yet.</p>
                            } @else {
                                <ul class="ov-list">
                                    @for (t of teammates(); track t.instanceId) {
                                        <li><button type="button" (click)="openTeammate(t.instanceId)">
                                            {{ t.name }} {{ t.model }} <span class="dim">{{ t.tons }}t</span>
                                            @if (heldName(t.instanceId); as h) { · <span class="held">{{ h }}</span> }
                                        </button></li>
                                    }
                                </ul>
                            }
                        }
                        @case ('doctrine') {
                            @if (doctrine(); as d) {
                                <div class="ov-doc">
                                    <h4>Composition</h4><p>{{ d.composition }}</p>
                                    <h4>Behaviour</h4><p>{{ d.behavior }}</p>
                                </div>
                            } @else { <p class="ov-empty">No doctrine sketch recorded for this mission.</p> }
                        }
                        @case ('briefing') { <bce-player-briefing [spec]="missionSpec()" [phase]="phase()" [result]="lastOutcome()" /> }
                        @case ('settings') {
                            <div class="ov-settings" data-testid="ps-settings">
                                <div class="ovs-row">
                                    <label for="ps-opt-picker">Damage entry — picker style</label>
                                    <select id="ps-opt-picker" data-testid="ps-opt-pickerStyle" class="ovs-select"
                                        [value]="options.options().pickerStyle" (change)="setOpt('pickerStyle', $event)">
                                        <option value="default">Automatic (default)</option>
                                        <option value="radial">Always Dial</option>
                                        <option value="linear">Always Linear</option>
                                    </select>
                                </div>
                                <div class="ovs-row">
                                    <label for="ps-opt-colour">Colour scheme</label>
                                    <select id="ps-opt-colour" data-testid="ps-opt-colorScheme" class="ovs-select"
                                        [value]="options.options().colorScheme" (change)="setOpt('colorScheme', $event)">
                                        <option value="default">Default</option>
                                        <option value="night">Night</option>
                                    </select>
                                </div>
                                <div class="ovs-row">
                                    <label for="ps-opt-zoomreset">Double-tap zoom reset</label>
                                    <select id="ps-opt-zoomreset" data-testid="ps-opt-zoomReset" class="ovs-select"
                                        [value]="options.options().recordSheetDoubleTapZoomReset" (change)="setOpt('recordSheetDoubleTapZoomReset', $event)">
                                        <option value="contextual">Contextual</option>
                                        <option value="fit-to-screen">Fit to screen</option>
                                        <option value="full-width">Full width</option>
                                        <option value="disabled">Disabled</option>
                                    </select>
                                </div>
                                <label class="ovs-check"><input type="checkbox" data-testid="ps-opt-syncZoom"
                                    [checked]="options.options().syncZoomBetweenSheets" (change)="setSync($event)"> Sync zoom between sheets</label>
                                <p class="ovs-note">Your device's MekBay viewer options — saved on this device (shared with the GM's Options dialog).</p>
                            </div>
                        }
                    }
                </bce-player-overlay>
            }
        </div>
    `,
    styles: [`
        :host { display:flex; flex-direction:column; height:100vh; height:calc(100dvh - var(--bce-footer-h, 0px)); overflow:hidden;background:#0c0f13; color:#e7edf3; font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; }
        .ps { flex:1; min-height:0; display:flex; flex-direction:column; max-width:900px; width:100%; margin:0 auto; padding:6px 8px 8px; box-sizing:border-box; }
        .pshead { flex:0 0 auto; display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:10px; background:#141a21; border:1px solid #232c37; margin-bottom:8px; z-index:5; }
        .psback { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; }
        .pswho { flex:1; font-weight:600; color:#cdd8e3; }
        .ps.blu .psside { color:#bcd6f2; } .ps.opf .psside { color:#f2c4bc; }
        .psside { font-weight:800; letter-spacing:.08em; }
        .psconn { font-size:12px; color:#7f8a96; } .psconn.on { color:#7fe3a0; }
        .psempty { text-align:center; color:#8b96a2; padding:48px 16px; }
        .psresolved { flex:0 0 auto; background:#3a2a14; color:#f2d6a6; border-bottom:1px solid #6b4a2f; padding:8px 12px; font-size:13px; text-align:center; }
        /* the pointer-events rule lives in styles.scss (scoped-global — a component star selector never reaches the record sheet's SVG children) */
        .psbtn { margin-top:10px; background:#2f5a6b; color:#fff; border:none; border-radius:9px; padding:12px 18px; font-size:15px; font-weight:700; cursor:pointer; }
        .psunits { background:#0c0f13; border:1px solid #2a3340; color:#cdd8e3; border-radius:8px; padding:6px 10px; font-size:13px; font-weight:600; cursor:pointer; }
        .psunits-n { color:#7f8a96; margin-left:2px; }
        .ps-main { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
        .ps-zoom { position:relative; flex:1; min-height:0; width:100%; overflow:hidden; touch-action:none; }
        /* the sheet content fills the viewport WIDTH at natural aspect; the [bceZoomPan] directive measures it
           and scales+centres it to FIT (both dimensions), then zooms from there. */
        .ps-zoom ::ng-deep bce-battle-sheet { display:block; width:100%; }
        /* the zoom control cluster (bottom-right, above the bar) */
        .ps-zoomctl { position:absolute; right:8px; bottom:8px; z-index:40; display:flex; flex-direction:column; gap:6px; }
        .ps-zoomctl button { width:44px; height:44px; border:none; border-radius:22px; font-size:22px; font-weight:700;
                             background:rgba(47,90,107,.92); color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.45); cursor:pointer; }
        .ps-zoomctl button.fit { font-size:18px; background:rgba(35,44,55,.92); }
        /* REBASE-1 P3 item 1 — the viewport-pinned END PHASE banner (sits beside the zoom controls, clear of them at right:60px). */
        .ps-endphase { position:absolute; left:8px; right:60px; bottom:8px; z-index:45; display:flex; align-items:center; gap:8px;
                       background:rgba(20,26,33,.96); border:1px solid #a5843d; border-radius:10px; padding:8px 10px; box-shadow:0 4px 14px rgba(0,0,0,.4); }
        .ps-endphase .pe-hint { flex:1; min-width:0; font-size:12px; line-height:1.3; color:#e8c98a; }
        .ps-endphase .pe-btn { flex:0 0 auto; min-height:44px; padding:0 16px; background:#2f6b46; color:#fff; border:none;
                               border-radius:8px; font-size:15px; font-weight:700; letter-spacing:.04em; cursor:pointer; }
        .ps-endphase .pe-btn:hover { background:#377d52; }
        /* REBASE-1 P3 item 2 — the viewport-pinned to-hit (Targets) trigger. Left edge, vertically centred: clear of
           the top swipe bar, the bottom zoom cluster + END PHASE banner, and the right-strip heat column. */
        .ps-tohit { position:absolute; left:8px; top:50%; transform:translateY(-50%); z-index:44; width:44px; height:44px;
                    display:flex; align-items:center; justify-content:center; border:none; border-radius:22px;
                    background:rgba(35,44,55,.92); color:#dce8f5; box-shadow:0 4px 14px rgba(0,0,0,.45); cursor:pointer; }
        .ps-tohit svg { width:24px; height:24px; }
        .ps-tohit:hover, .ps-tohit:focus-visible { background:rgba(52,66,82,.96); outline:none; }
        @media (max-width: 600px) { .ps-zoomctl { right:auto; left:8px; }
            .psbar { padding-left: 56px; } }
        .psswipe { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:8px; touch-action:pan-y; user-select:none;
                   background:#10161c; border:1px solid #232c37; border-radius:8px; margin-bottom:6px; padding:4px 6px; min-height:48px; }
        .psswipe-hint { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:1px; text-align:center; }
        .psswipe-hint b { font-size:13px; font-weight:700; color:#cdd8e3; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .psswipe-hint small { font-size:10px; letter-spacing:.04em; color:#7f8a96; }
        .psswipe-arr { flex:0 0 auto; background:#1b2733; border:1px solid #3d6ea5; color:#dce8f5; font-size:24px; line-height:1; font-weight:700; min-width:56px; min-height:40px; border-radius:8px; cursor:pointer; }
        .psswipe-arr:hover, .psswipe-arr:focus-visible { background:#26405c; border-color:#5b8fc7; outline:none; }
        .psswipe-arr:active { background:#3d6ea5; }
        .psnote { color:#8b96a2; font-style:italic; padding:32px 8px; text-align:center; }
        .psretry { margin-left:10px; padding:6px 14px; border:1px solid #3d6ea5; border-radius:8px; background:#13243a; color:#bcd6f2; font-style:normal; font-weight:700; cursor:pointer; }
        .psnav-backdrop { position:fixed; inset:0; background:transparent; z-index:40; }
        .psnav { position:fixed; top:0; left:0; bottom:0; width:248px; max-width:82vw; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain;background:rgba(11,15,19,.45); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); border-right:1px solid #2a3340; box-shadow:2px 0 16px rgba(0,0,0,.4); z-index:41; display:flex; flex-direction:column; padding:10px; overflow:auto; }
        .psnav-head { display:flex; align-items:center; justify-content:space-between; font-weight:700; letter-spacing:.06em; color:#cdd8e3; padding:4px 4px 10px; border-bottom:1px solid #232c37; margin-bottom:8px; }
        .psnav-hint { font-size:10px; letter-spacing:.04em; color:#7f8a96; padding:0 4px 8px; }
        .psnav-x { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; min-width:40px; min-height:40px; cursor:pointer; }
        .psnav-list { display:flex; flex-direction:column; gap:6px; }
        .psnav-item { display:flex; align-items:center; gap:10px; text-align:left; background:rgba(18,24,30,.66); border:1px solid #2a3340; color:#e7edf3; border-radius:10px; padding:8px 10px; cursor:pointer; min-height:48px; }
        .psnav-item.sel { border-color:#3d6ea5; background:rgba(19,36,58,.8); }
        .psnav-name { font-weight:600; } .psnav-name small { color:#7f8a96; font-weight:400; margin-left:4px; }
        .psoffline { margin-top:6px; font-size:12px; color:#e7a86b; text-align:center; }
        .psbar { flex:0 0 auto; display:flex; gap:4px; margin-top:6px; }
        .psbar button { flex:1; min-width:0; min-height:44px; background:#141a21; border:1px solid #2a3340; color:#cdd8e3; border-radius:8px; padding:0 6px; font-size:14px; font-weight:600; cursor:pointer; }
        .psbar button:hover { border-color:#3d6ea5; }
        .psbar .psfav { flex:0 0 44px; min-width:44px; font-size:20px; line-height:1; color:#7f8a96; padding:0; }
        .psbar .psfav.on { color:#e8c14a; }
        .ov-back { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin-bottom:10px; }
        .ov-stitle { font-weight:700; color:#fff; margin-bottom:8px; } .ov-stitle .ro { font-size:11px; color:#7f8a96; font-weight:400; }
        .ov-empty { color:#7f8a96; font-style:italic; padding:24px 4px; }
        .ov-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .ov-list button { width:100%; text-align:left; background:#0c0f13; border:1px solid #2a3340; color:#e7edf3; border-radius:10px; padding:12px 14px; font-size:14px; cursor:pointer; }
        .ov-list .dim { color:#7f8a96; } .ov-list .held { color:#e7a86b; font-style:italic; }
        .ov-doc h4 { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#7f8a96; margin:12px 0 4px; }
        .ov-doc p { margin:0; color:#cdd8e3; }
        /* REBASE-1 P3 item 4 — the player-scoped viewer options (inside the bce-player-overlay drawer). */
        .ov-settings { display:flex; flex-direction:column; gap:14px; }
        .ovs-row { display:flex; flex-direction:column; gap:6px; }
        .ovs-row label { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#9fb2c4; }
        .ovs-select { min-height:44px; background:#0c0f13; border:1px solid #2a3340; color:#e7edf3; border-radius:10px; padding:0 12px; font-size:15px; }
        .ovs-check { display:flex; align-items:center; gap:10px; min-height:44px; color:#e7edf3; font-size:14px; cursor:pointer; }
        .ovs-check input { width:22px; height:22px; }
        .ovs-note { margin:4px 0 0; color:#7f8a96; font-size:11px; line-height:1.4; }
    `],
})
export class PlayerSheetComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly svc = inject(BattleForceService);
    protected readonly session = inject(PlayerSessionService);
    private readonly pack = inject(ForgePackService);
    private readonly router = inject(Router);

    protected readonly side = this.rt.side;
    protected readonly name = this.rt.playerName;
    protected readonly connected = this.rt.connected;
    protected readonly missionSpec = this.state.missionSpec;
    protected readonly phase = computed(() => sessionPhase({ presented: this.state.presentedHotspot(), contract: this.state.contractSummary() ?? this.state.activeChaosContract(), completed: this.state.completedChaosContract(), tree: this.state.missionTree(), spec: this.state.missionSpec() }));
    protected readonly lastOutcome = computed(() => (this.state.resultsSlip()?.outcome ?? 'resolved').replace(/_/g, ' '));
    protected readonly activeId = signal<string | null>(null);
    protected readonly overlay = signal<OverlayKind | null>(null);
    protected readonly teammateId = signal<string | null>(null);
    private readonly packReady = signal(this.pack.isLoaded() ? 1 : 0);
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    private readonly sideKey = computed<Side>(() => (this.rt.side() === 'OPFOR' ? 'opfor' : 'blufor'));
    private readonly sideEntries = computed<BattleEntry[]>(() => (this.sideKey() === 'opfor' ? this.svc.opforEntries() : this.svc.bluforEntries()));

    // REBASE-1 P3 item 1 — the player's LOADED units with UN-ENDED picks this phase. The pin fans the CONSOLIDATED
    // damage only at END PHASE (battle-force registerMirror re-fires on phaseTrigger, which endPhase() bumps); until
    // then the picks are LOCAL. phaseTrigger() bumps on every pick + on endPhase, so this recomputes reactively.
    private readonly phaseResolution = inject(CBTPhaseResolutionService);
    // VIEWER whose Teammates view had loaded a picked unit (the fanned state carries the holder's turn state) reported un-ended
    // picks of its own: TABLE-2 T2-3 named it in the GM's "picks unshared" block, and its END PHASE ended a phase on a unit it
    // does not hold. A device can only PICK on what it holds (teammates are read-only), so that is what it counts + ends.
    private readonly dirtyLoadedUnits = computed(() => unendedPickUnits(this.sideEntries(), (id) => this.rt.heldByMe(id), (fu) => { fu.phaseTrigger(); return fu.turnState().dirtyPhase(); }));
    protected readonly pendingPhaseCount = computed(() => this.dirtyLoadedUnits().length);
    /** End the phase for every LOADED unit with un-ended picks — the pin's resolve + per-unit endPhase(), which bumps
     *  phaseTrigger so the mirror fans the consolidated state to the GM + the table. The SAME service the on-sheet button calls. */
    protected async endPlayerPhase(): Promise<void> {
        const units = this.dirtyLoadedUnits();
        if (units.length) await this.phaseResolution.endPhase(units);
    }

    // REBASE-1 P3 item 2 — the active sheet (one at a time; `active()` is the shown entry). The pinned to-hit trigger
    // delegates to it: the overlay's own Targets button rides the .ps-zoom transform, this one does not.
    protected readonly battleSheet = viewChild(BattleSheetComponent);
    protected openToHit(ev: Event): void {
        this.battleSheet()?.openTargetsAt(ev.currentTarget as HTMLElement);
    }

    // MY claimed units (side-gated, ROLE-002) — editable on the main screen.
    protected readonly mine = computed<BattleEntry[]>(() => this.sideEntries().filter((e) => this.rt.heldByMe(e.instanceId)));
    // Teammates — other units on MY side I do NOT hold (read-only explode; no cross-side, side-gated).
    protected readonly teammates = computed<BattleEntry[]>(() => this.sideEntries().filter((e) => !this.rt.heldByMe(e.instanceId)));
    protected readonly active = computed<BattleEntry | null>(() => {
        const list = this.mine();
        const fav = this.rt.favorite().instanceId;
        return list.find((e) => e.instanceId === this.activeId())
            ?? (fav ? list.find((e) => e.instanceId === fav) : undefined)
            ?? list[0] ?? null;
    });
    protected readonly isFav = computed(() => !!this.active() && this.rt.favorite().instanceId === this.active()!.instanceId);

    protected readonly teammate = computed<BattleEntry | null>(() => this.sideEntries().find((e) => e.instanceId === this.teammateId()) ?? null);
    protected readonly teammateLabel = computed(() => { const t = this.teammate(); return t ? `${t.name} ${t.model}` : ''; });
    // re-clone trigger for the read-only teammate view: bumps when that instance's live state changes.
    protected readonly teammateRev = computed(() => { const id = this.teammateId(); return id ? (this.rt.battleStates()[id]?.at ?? 0) : 0; });

    // OPFOR doctrine — the seed's opforSketch (lazy: load the forge pack on demand).
    protected readonly doctrine = computed<{ composition: string; behavior: string } | null>(() => {
        this.packReady();
        const seedId = this.state.missionSpec()?.forge?.seedId;
        const sk = seedId ? this.pack.seedById(seedId)?.opforSketch : undefined;
        return sk && (sk.composition || sk.behavior) ? sk : null;
    });

    constructor() {
        this.svc.configurePlayer(); // fan edits, but never persist the campaign snapshot (GM authoritative)
        effect(() => this.svc.readOnly.set(this.session.resolvedView()));
        void this.svc.build();
        // Keep the room joined (a reload may land straight here) + re-announce to the lobby.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.joinLobby(); }
        });
        // Lazily load the active OWN sheet (it IS the screen — eager, not viewport-gated).
        effect(() => { const e = this.active(); if (e && e.status === 'pending') void this.svc.ensureSheet(this.sideKey(), e.instanceId); });
        // Lazily load a teammate sheet when one is opened (read-only).
        effect(() => { const id = this.teammateId(); const e = this.teammate(); if (id && e && e.status === 'pending') void this.svc.ensureSheet(this.sideKey(), id); });
        // REBASE-1 P3 item 1b — report this device's un-ended-pick count to the host so the GM's lobby/claims shows who
        // still has unshared damage before Resolve (the pin fans damage only at END PHASE). rt dedups the emit.
        effect(() => this.rt.setPhasePending(this.pendingPhaseCount()));
    }

    protected readonly navOpen = signal(false); // collapsed by default (maximize the sheet on tablet)
    /** index of the active unit within the claimed list (for the "N / M" swipe-band readout). */
    protected readonly activeIndex = computed(() => { const a = this.active(); return a ? this.mine().findIndex((e) => e.instanceId === a.instanceId) : 0; });
    protected toggleNav(): void { this.navOpen.update((v) => !v); }
    protected pick(instanceId: string): void { this.activeId.set(instanceId); }
    /** cycle the active claimed unit (dir +1 next / -1 prev) — used by the swipe band + its ‹ › arrows. */
    protected cycle(dir: 1 | -1): void {
        const list = this.mine();
        if (list.length < 2) return;
        const cur = this.active();
        const idx = cur ? list.findIndex((e) => e.instanceId === cur.instanceId) : 0;
        this.activeId.set(list[(idx + dir + list.length) % list.length].instanceId);
    }
    protected onSwipe(e: SwipeEndEvent): void {
        if (!e.success) return;
        if (e.direction === 'left') this.cycle(1);        // swipe left → next claimed unit
        else if (e.direction === 'right') this.cycle(-1); // swipe right → previous
    }
    protected toRoster(): void { this.router.navigate(['/roster']); }
    /** ORDER-9 Commit 1 — the explicit path back to 'pending' for a broken (error/missing) sheet. */
    protected retry(e: BattleEntry): void { this.svc.retrySheet(this.sideKey(), e.instanceId); }
    protected toggleFav(instanceId: string): void { this.rt.setFavorite(this.isFav() ? null : instanceId, null); }

    protected open(kind: OverlayKind): void {
        this.teammateId.set(null);
        this.overlay.set(kind);
        if (kind === 'doctrine' && !this.pack.isLoaded()) void this.pack.ensureLoaded().then(() => this.packReady.update((v) => v + 1));
    }
    protected openTeammate(instanceId: string): void { this.teammateId.set(instanceId); }
    protected closeOverlay(): void { this.overlay.set(null); this.teammateId.set(null); }
    protected overlayTitle(): string {
        switch (this.overlay()) {
            case 'teammates': return this.teammateId() ? 'Teammate · read-only' : 'Teammates';
            case 'doctrine': return 'OpFor doctrine';
            case 'briefing': return 'Mission briefing';
            case 'settings': return 'Settings';
            default: return '';
        }
    }
    // REBASE-1 P3 item 4 — write a single viewer option through MekBay's OptionsService (self-inits + persists to IndexedDB).
    protected readonly options = inject(OptionsService);
    protected setOpt<K extends 'pickerStyle' | 'colorScheme' | 'recordSheetDoubleTapZoomReset'>(key: K, ev: Event): void {
        void this.options.setOption(key, (ev.target as HTMLSelectElement).value as Options[K]);
    }
    protected setSync(ev: Event): void {
        void this.options.setOption('syncZoomBetweenSheets', (ev.target as HTMLInputElement).checked);
    }
    protected heldName(instanceId: string): string | null { return this.rt.claims()[instanceId]?.holderName || null; }
}
