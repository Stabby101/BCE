/*
 * BCE PLAYER — the SINGLE-SCREEN battle surface (DIRECTIVE-048 phases B+C). The claimed sheet IS the
 * screen: a player edits its OWN claimed 'Mech (armor/internal/crit/ammo/heat) on MekBay's editable
 * Classic sheet, and every edit fans live to the GM + every tablet over the D-042 spine (extended to
 * battle state). ALL depth is exploding overlays (D-010 pattern, no tabs/nav — T-030):
 *   · TEAMMATES — read-only explode of another unit ON YOUR SIDE (side-gated; live via the fan),
 *   · DOCTRINE  — OPFOR only: the seed's opforSketch (how your OpFor fights),
 *   · BRIEFING  — the read-only mission brief + player-side print,
 *   · ★ FAVORITE — star a unit (campaign-persistent, host-synced; auto-selects it on return).
 * Player mode: the force service fans edits but NEVER writes the campaign snapshot (the GM is
 * authoritative, DATA-001). Side gates which units appear (ROLE-002). Campaign-layer only; the live
 * sync wires AROUND MekBay's sheet (MERGE-002 one-way).
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
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

type OverlayKind = 'teammates' | 'doctrine' | 'briefing';

@Component({
    selector: 'bce-player-sheet',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [BattleForceService],
    imports: [BattleSheetComponent, SheetViewComponent, PlayerOverlayComponent, PlayerBriefingComponent, BceUnitSpriteComponent, SwipeDirective, ZoomPanDirective],
    template: `
        <div class="ps" [class.blu]="side() === 'BLUFOR'" [class.opf]="side() === 'OPFOR'">
            <header class="pshead">
                <button type="button" class="psback" (click)="toRoster()">‹ Roster</button>
                @if (mine().length > 0) {
                    <!-- D-051: MekBay-style collapsible unit column — opens a left drawer of CLAIMED units (side-gated) -->
                    <button type="button" class="psunits" (click)="toggleNav()" aria-label="Switch unit">☰ Units <span class="psunits-n">{{ mine().length }}</span></button>
                }
                <div class="pswho"><span class="psside">{{ side() }}</span> · {{ name() || 'Player' }}</div>
                <div class="psconn" [class.on]="connected()">{{ connected() ? '● live' : '○ offline' }}</div>
            </header>

            @if (mine().length === 0) {
                <div class="psempty">
                    <p>No 'Mech claimed yet.</p>
                    <button type="button" class="psbtn" (click)="toRoster()">Go to the roster →</button>
                </div>
            } @else {
                <div class="ps-main">
                    <!-- D-052/054: the unit-cycle band. On-sheet swipe is architecturally blocked — MekBay's
                         svg-interaction.service captures pointerdown (preventDefault/stopPropagation/setPointerCapture)
                         for the radial picker, so a sheet-body swipe never reaches us, and we do NOT edit its core
                         (MERGE-002, intentionally unsupported). So the ‹ › ARROWS are the prominent PRIMARY cycle
                         (+ the persistent drawer); the band-swipe is a bonus where it works (a no-picker zone). -->
                    @if (mine().length > 1) {
                        <div class="psswipe" swipe direction="horizontal" [threshold]="28" [successRatio]="0.12" (swipeend)="onSwipe($event)">
                            <button type="button" class="psswipe-arr" (click)="cycle(-1)" aria-label="Previous unit">‹</button>
                            <span class="psswipe-hint"><b>{{ active()?.name }} {{ active()?.model }}</b><small>{{ activeIndex() + 1 }} / {{ mine().length }} · tap ‹ › or swipe</small></span>
                            <button type="button" class="psswipe-arr" (click)="cycle(1)" aria-label="Next unit">›</button>
                        </div>
                    }
                    @if (active(); as e) {
                        <!-- HOTFIX-034: pinch to zoom + two-finger drag to pan the sheet (landscape too). Single
                             finger still taps through to the SVG for damage. -->
                        <div class="ps-zoom" bceZoomPan #zp="zoomPan">
                            @switch (e.status) {
                                @case ('ok') { <bce-battle-sheet [fu]="e.fu ?? null" [phaseOverlay]="true" /> }
                                @case ('missing') { <div class="psnote">Unit not in the catalog — sheet unavailable.</div> }
                                @case ('error') { <div class="psnote">Sheet failed to load: {{ e.error }}</div> }
                                @default { <div class="psnote">Loading sheet…</div> }
                            }
                        </div>
                        <!-- HOTFIX-035: explicit zoom controls (reliable, like MekBay's). Pinch + two-finger drag
                             also work; single-finger taps still commit damage. -->
                        <div class="ps-zoomctl">
                            <button type="button" (click)="zp.zoomIn()" aria-label="Zoom in">+</button>
                            <button type="button" (click)="zp.zoomOut()" aria-label="Zoom out">−</button>
                            @if (zp.zoomed()) { <button type="button" class="fit" (click)="zp.reset()" aria-label="Fit to screen">⊙</button> }
                        </div>
                        @if (!connected()) { <div class="psoffline">Host offline — edits are local until the connection returns.</div> }
                    }

                    <!-- D-049: zero-gap minimal-touch bar (flush to the sheet footer). Depth explodes from here (T-030). -->
                    <nav class="psbar">
                        <button type="button" (click)="open('teammates')">Teammates</button>
                        @if (side() === 'OPFOR') { <button type="button" (click)="open('doctrine')">Doctrine</button> }
                        <button type="button" (click)="open('briefing')">Briefing</button>
                        @if (active(); as e) {
                            <button type="button" class="psfav" [class.on]="isFav()" (click)="toggleFav(e.instanceId)"
                                    [attr.aria-label]="isFav() ? 'Unfavorite' : 'Favorite'">{{ isFav() ? '★' : '☆' }}</button>
                        }
                    </nav>
                </div>

                <!-- D-051: the collapsible left column (claimed units only, side-gated, COLLAPSED by default on tablet) -->
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
                        @case ('briefing') { <bce-player-briefing [spec]="missionSpec()" /> }
                    }
                </bce-player-overlay>
            }
        </div>
    `,
    styles: [`
        /* HOTFIX-035 — fixed-viewport layout so the whole sheet FITS the screen (portrait or landscape), then
           zoom from there. :host fills the screen; the sheet gets the flex-fill middle; header + bar are fixed. */
        /* HOTFIX-036 — use svh (SMALL viewport height: the visible area WITH the browser UI showing) so the
           bar + sheet bottom are never pushed under a tablet's toolbar/tab strip (the OnePlus Pad "cut off at
           heatscale" case). Fallbacks: vh (old browsers) → dvh → svh (the last supported wins). */
        :host { display:flex; flex-direction:column; height:100vh; height:calc(100dvh - var(--bce-footer-h, 0px)); overflow:hidden; /* IMPORT-7 A — minus the reserved legal-footer space */ background:#0c0f13; color:#e7edf3; font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; }
        .ps { flex:1; min-height:0; display:flex; flex-direction:column; max-width:900px; width:100%; margin:0 auto; padding:6px 8px 8px; box-sizing:border-box; }
        .pshead { flex:0 0 auto; display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:10px; background:#141a21; border:1px solid #232c37; margin-bottom:8px; z-index:5; }
        .psback { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; }
        .pswho { flex:1; font-weight:600; color:#cdd8e3; }
        .ps.blu .psside { color:#bcd6f2; } .ps.opf .psside { color:#f2c4bc; }
        .psside { font-weight:800; letter-spacing:.08em; }
        .psconn { font-size:12px; color:#7f8a96; } .psconn.on { color:#7fe3a0; }
        .psempty { text-align:center; color:#8b96a2; padding:48px 16px; }
        .psbtn { margin-top:10px; background:#2f5a6b; color:#fff; border:none; border-radius:9px; padding:12px 18px; font-size:15px; font-weight:700; cursor:pointer; }
        /* D-051: the unit-column burger (header) + the swipe surface — the top chip row is gone. */
        .psunits { background:#0c0f13; border:1px solid #2a3340; color:#cdd8e3; border-radius:8px; padding:6px 10px; font-size:13px; font-weight:600; cursor:pointer; }
        .psunits-n { color:#7f8a96; margin-left:2px; }
        .ps-main { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
        /* HOTFIX-034/035 — the sheet viewport fills the remaining space; the SVG fits ENTIRELY inside it (both
           dimensions), so the whole sheet is visible at rest. The [bceZoomPan] transform zooms from that fit. */
        .ps-zoom { position:relative; flex:1; min-height:0; width:100%; overflow:hidden; touch-action:none; }
        /* the sheet content fills the viewport WIDTH at natural aspect; the [bceZoomPan] directive measures it
           and scales+centres it to FIT (both dimensions), then zooms from there. */
        .ps-zoom ::ng-deep bce-battle-sheet { display:block; width:100%; }
        /* the zoom control cluster (bottom-right, above the bar) */
        .ps-zoomctl { position:absolute; right:8px; bottom:8px; z-index:40; display:flex; flex-direction:column; gap:6px; }
        .ps-zoomctl button { width:44px; height:44px; border:none; border-radius:22px; font-size:22px; font-weight:700;
                             background:rgba(47,90,107,.92); color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.45); cursor:pointer; }
        .ps-zoomctl button.fit { font-size:18px; background:rgba(35,44,55,.92); }
        /* D-052/054: the unit-cycle band. The ‹ › arrows are the PROMINENT primary control (bordered, accent,
           big tap target); the band also accepts a bonus swipe (a no-picker zone). */
        .psswipe { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:8px; touch-action:pan-y; user-select:none;
                   background:#10161c; border:1px solid #232c37; border-radius:8px; margin-bottom:6px; padding:4px 6px; min-height:48px; }
        .psswipe-hint { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:1px; text-align:center; }
        .psswipe-hint b { font-size:13px; font-weight:700; color:#cdd8e3; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .psswipe-hint small { font-size:10px; letter-spacing:.04em; color:#7f8a96; }
        .psswipe-arr { flex:0 0 auto; background:#1b2733; border:1px solid #3d6ea5; color:#dce8f5; font-size:24px; line-height:1; font-weight:700; min-width:56px; min-height:40px; border-radius:8px; cursor:pointer; }
        .psswipe-arr:hover, .psswipe-arr:focus-visible { background:#26405c; border-color:#5b8fc7; outline:none; }
        .psswipe-arr:active { background:#3d6ea5; }
        .psnote { color:#8b96a2; font-style:italic; padding:32px 8px; text-align:center; }
        /* D-051/052/054: MekBay-style collapsible left drawer of claimed units (collapsed by default). MORE
           transparent now (~.45 — the sheet clearly shows through) + blurred for legibility; the backdrop
           doesn't dim (just catches tap-out-to-close). D-054: it PERSISTS OPEN on select (cycle in place). */
        .psnav-backdrop { position:fixed; inset:0; background:transparent; z-index:40; }
        .psnav { position:fixed; top:0; left:0; bottom:0; width:248px; max-width:82vw; background:rgba(11,15,19,.45); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); border-right:1px solid #2a3340; box-shadow:2px 0 16px rgba(0,0,0,.4); z-index:41; display:flex; flex-direction:column; padding:10px; overflow:auto; }
        .psnav-head { display:flex; align-items:center; justify-content:space-between; font-weight:700; letter-spacing:.06em; color:#cdd8e3; padding:4px 4px 10px; border-bottom:1px solid #232c37; margin-bottom:8px; }
        .psnav-hint { font-size:10px; letter-spacing:.04em; color:#7f8a96; padding:0 4px 8px; } /* D-054: persist-open discoverability */
        .psnav-x { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; min-width:40px; min-height:40px; cursor:pointer; }
        .psnav-list { display:flex; flex-direction:column; gap:6px; }
        .psnav-item { display:flex; align-items:center; gap:10px; text-align:left; background:rgba(18,24,30,.66); border:1px solid #2a3340; color:#e7edf3; border-radius:10px; padding:8px 10px; cursor:pointer; min-height:48px; }
        .psnav-item.sel { border-color:#3d6ea5; background:rgba(19,36,58,.8); }
        .psnav-name { font-weight:600; } .psnav-name small { color:#7f8a96; font-weight:400; margin-left:4px; }
        .psoffline { margin-top:6px; font-size:12px; color:#e7a86b; text-align:center; }
        /* D-049: ZERO gap above the bar (flush to the sheet footer); buttons minimal-touch (44px tap target, no extra height). */
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
    `],
})
export class PlayerSheetComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly svc = inject(BattleForceService);
    private readonly pack = inject(ForgePackService);
    private readonly router = inject(Router);

    protected readonly side = this.rt.side;
    protected readonly name = this.rt.playerName;
    protected readonly connected = this.rt.connected;
    protected readonly missionSpec = this.state.missionSpec;
    protected readonly activeId = signal<string | null>(null);
    protected readonly overlay = signal<OverlayKind | null>(null);
    protected readonly teammateId = signal<string | null>(null);
    private readonly packReady = signal(this.pack.isLoaded() ? 1 : 0);
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    private readonly sideKey = computed<Side>(() => (this.rt.side() === 'OPFOR' ? 'opfor' : 'blufor'));
    private readonly sideEntries = computed<BattleEntry[]>(() => (this.sideKey() === 'opfor' ? this.svc.opforEntries() : this.svc.bluforEntries()));

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
    }

    // ── D-051/052: the collapsible unit column (claimed units, side-gated) + swipe/tap to cycle ──
    protected readonly navOpen = signal(false); // collapsed by default (maximize the sheet on tablet)
    /** index of the active unit within the claimed list (for the "N / M" swipe-band readout). */
    protected readonly activeIndex = computed(() => { const a = this.active(); return a ? this.mine().findIndex((e) => e.instanceId === a.instanceId) : 0; });
    protected toggleNav(): void { this.navOpen.update((v) => !v); }
    protected pick(instanceId: string): void { this.activeId.set(instanceId); } // D-054: stay OPEN — cycle in place; close only via ✕/tap-out
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
            default: return '';
        }
    }
    protected heldName(instanceId: string): string | null { return this.rt.claims()[instanceId]?.holderName || null; }
}
