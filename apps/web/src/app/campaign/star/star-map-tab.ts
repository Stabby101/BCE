/*
 * DIRECTIVE-104 → 107 — Star Map. v1 (D-104) Voronoi facets. v1.1 (D-105) lossy ISCS ring merge. v1.2 (D-106)
 * ISCS canon HEX-FILL. v1.3 (D-107): the ISCS snapshot lumps ALL periphery into one "P" and its planet list
 * dropped 81 unaligned worlds → periphery states showed as a lump/gone, or as territory with no stars. Fix:
 *   (A) ONE complete fixed star set = UNION(ISCS_PLANETS ∪ systems.json) by name (~2164) — the dot layer, click
 *       index, labels, capital + flashpoint anchors; plotted identically EVERY era (positions fixed).
 *   (B) Territory = the systems.json ownerAt(era) hex-fill for ALL 12 eras (the ISCS snapshot lump branch is
 *       GONE) → distinct periphery states (Magistracy / Taurian / Marian / Outworlds / Circinus) in every era.
 *       A coverage safeguard adds a hex under any plotted world the ISCS lattice doesn't reach.
 * systems.json is the ownership truth (D-082); the ISCS layer contributes only the hex geometry + IS dot density.
 *
 * ISOLATION: injects only StarSystemsService + NewCampaignState. Manual era (not the campaign clock). IP: own
 * render from canon facts ("Territory: systems.json ownerByEra" + "Flashpoints: Sarna.net BattleTechWiki, GNU FDL 1.2 — cited facts"); raw local.
 */
import { Component, ChangeDetectionStrategy, ElementRef, effect, inject, signal, computed, viewChild, untracked } from '@angular/core';
import { Delaunay } from 'd3-delaunay';
import { select, pointer, type Selection } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom';
import { StarSystemsService } from './star-systems.service';
import { WorldHistoryService, eventsForEra, sparseEraValue, changeLabel, type WorldEvent, type WorldFacts } from './world-history';
import { NewCampaignState } from '../new-campaign-state';
import { capitalSystemIdFor } from './star-capitals';
import { factionColor } from './faction-colors';
import type { StarSystem } from './star-types';
import ISCS_INDEX from './iscs/iscs-index.json';
import ISCS_3058 from './iscs/iscs-3058.json';
import ISCS_PLANETS from './iscs/iscs-planets.json';
import FLASHPOINTS from './iscs/flashpoints.json';

interface EraDef { id: number; from: number; to: number; name: string; }
const ERAS: readonly EraDef[] = [
    { id: 1, from: 2005, to: 2570, name: 'Age of War' }, { id: 2, from: 2571, to: 2780, name: 'Star League' },
    { id: 3, from: 2781, to: 2900, name: 'Early Succession War' }, { id: 4, from: 2901, to: 3019, name: 'Late Succession War – LosTech' },
    { id: 5, from: 3020, to: 3049, name: 'Late Succession War – Renaissance' }, { id: 6, from: 3050, to: 3061, name: 'Clan Invasion' },
    { id: 7, from: 3062, to: 3067, name: 'Civil War' }, { id: 8, from: 3068, to: 3080, name: 'Jihad' },
    { id: 9, from: 3081, to: 3100, name: 'Early Republic' }, { id: 10, from: 3101, to: 3130, name: 'Late Republic' },
    { id: 11, from: 3131, to: 3150, name: 'Dark Age' }, { id: 12, from: 3151, to: 9999, name: 'ilClan' },
];

interface XZ { x: number; z: number; }
interface Star { n: string; x: number; z: number; }
const EXTENT = ISCS_INDEX.extent as { minx: number; maxx: number; minz: number; maxz: number };
const HEX_SHAPE = ISCS_INDEX.hexShape as [number, number][];
const ISCS_PLANET_LIST = ISCS_PLANETS as { n: string; x: number; z: number }[];
const FALLBACK_HEXES = (ISCS_3058 as { hexes: XZ[] }).hexes; // canon hex geometry (positions) for the tessellation
interface FlashEvent { y: number; w: string[]; t: string; k: string; }
const FLASH_EVENTS: FlashEvent[] = (FLASHPOINTS as { events: FlashEvent[] }).events;
const IN_BOUNDS = (x: number, z: number): boolean => Math.abs(x) < 700 && Math.abs(z) < 700; // exclude the far Clan homeworlds by default

type Sel = Selection<any, any, any, any>;
interface LegendItem { label: string; color: string; }
interface Detail { name: string; x: number; y: number; }
interface ColoredHex { x: number; z: number; color: string; }

@Component({
    selector: 'bce-star-map-tab',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="sm-wrap">
        <header class="sm-head">
            <h2 class="sm-title">Star <span>Map</span></h2>
            <div class="sm-ctl">
                <label>Era</label>
                <input type="range" min="1" max="12" step="1" [value]="era()" (input)="setEra($any($event.target).value)" aria-label="Era year">
                <span class="sm-yr">{{ eraLabel() }}</span>
            </div>
            <span class="sm-src">Territory: systems.json ownerByEra (canon)</span>
            <div class="sm-ctl">
                <label>Jump to</label>
                <select [value]="facValue()" (change)="frameFaction($any($event.target).value)" aria-label="Zoom to faction">
                    <option value="">— faction —</option>
                    @for (l of legend(); track l.label) { <option [value]="l.label">{{ l.label }}</option> }
                </select>
            </div>
            <button type="button" (click)="resetView()">Reset view</button>
            <label class="sm-chk"><input type="checkbox" [checked]="showFlash()" (change)="showFlash.set($any($event.target).checked)"> Flashpoints</label>
            <label class="sm-chk"><input type="checkbox" [checked]="includeClan()" (change)="includeClan.set($any($event.target).checked)"> Clan homeworlds</label>
            <label class="sm-chk"><input type="checkbox" [checked]="showLabels()" (change)="showLabels.set($any($event.target).checked)"> All labels</label>
            <label class="sm-chk"><input type="checkbox" [checked]="showCapitals()" (change)="showCapitals.set($any($event.target).checked)"> Capitals</label>
        </header>
        <div #stage class="sm-stage">
            <div #host class="sm-host"></div>
            <div class="sm-hint">Drag to pan · scroll / pinch to zoom · slide the year to watch borders shift · click a world</div>

            @if (detail(); as det) {
                <div class="sm-detail" [style.left.px]="det.x" [style.top.px]="det.y" (click)="$event.stopPropagation()">
                    <button type="button" class="sm-x" (click)="closeDetail()" aria-label="Close">×</button>
                    <h3>{{ det.name }}</h3>
                    <div class="row"><span class="k">Owner ({{ eraShort() }})</span><span class="v"><span class="sw" [style.background]="color(ownerAtPlanet(det.name))"></span>{{ ownerAtPlanet(det.name) }}</span></div>
                    @if (sysByName(det.name); as sys) {
                        <div class="row"><span class="k">Coordinates</span><span class="v">{{ sys.x }}, {{ sys.y }}</span></div>
                        <div class="row"><span class="k">Locale</span><span class="v">{{ localeLine(sys) }}</span></div>
                        <div class="row"><span class="k">Terrain</span><span class="v">{{ terrainLine(sys) }}</span></div>
                        <div class="sm-obe">
                            <div class="obe-h">Owner by era</div>
                            <div class="obe-strip">
                                @for (e of eras; track e.id) { <div class="obe-cell" [title]="e.from + ' · ' + ownerAtEra(sys, e.id)"><span class="obe-sw" [style.background]="color(ownerAtEra(sys, e.id))"></span><span class="obe-y">{{ e.from }}</span></div> }
                            </div>
                        </div>
                    } @else {
                        <div class="row"><span class="k">Coordinates</span><span class="v">{{ planetCoord(det.name) }}</span></div>
                    }
                    @if (worldEvents(det.name); as evs) {
                        <div class="sm-flashlist">
                            <div class="obe-h">Notable events <span class="cnt">{{ evs.length }}</span></div>
                            @for (ev of evs; track $index) { <div class="fl-row"><span class="fl-y">{{ ev.y }}</span><span class="fl-t">{{ ev.t }}</span><span class="fl-k">{{ ev.k }}</span></div> }
                        </div>
                    }
                    @if (gazetteer(det.name); as g) {
                        <div class="sm-gaz">
                            @if (g.facts; as f) {
                                <div class="gz-sec">
                                    <div class="obe-h">World profile</div>
                                    @if (starLine(f); as s) { <div class="row"><span class="k">Star</span><span class="v">{{ s }}</span></div> }
                                    @if (surfaceLine(f); as s) { <div class="row"><span class="k">Surface</span><span class="v">{{ s }}</span></div> }
                                    @if (f.capitalCity) { <div class="row"><span class="k">Capital</span><span class="v">{{ f.capitalCity }}</span></div> }
                                    @if (popAt(f); as pop) { <div class="row"><span class="k">Population ({{ eraShort() }})</span><span class="v">{{ pop }}</span></div> }
                                    @if (hpgAt(f); as hpg) { <div class="row"><span class="k">HPG ({{ eraShort() }})</span><span class="v">{{ hpg }}</span></div> }
                                </div>
                            }
                            @if (g.events.length) {
                                <div class="gz-sec">
                                    <div class="obe-h">History — {{ gzAll() ? 'all eras' : eraShort() }} <span class="cnt">{{ gzRows(g.events).length }}</span>
                                        <button type="button" class="gz-tgl" (click)="gzAll.set(!gzAll())">{{ gzAll() ? 'this era' : 'all eras (' + g.events.length + ')' }}</button>
                                    </div>
                                    @for (ev of gzRows(g.events); track $index) {
                                        <div class="gz-row" [class.gz-cur]="ev.eraId === campaignEraId()">
                                            <span class="gz-y">{{ ev.year }}{{ ev.endYear ? '–' + ev.endYear : '' }}</span>
                                            <a class="gz-t" [href]="ev.sarnaUrl" target="_blank" rel="noopener noreferrer">{{ eventLabel(ev) }}</a>
                                            <span class="gz-k">{{ ev.kind === 'change-of-hands' ? 'hands' : ev.kind }}</span>
                                        </div>
                                    }
                                    @if (!gzAll() && !gzRows(g.events).length) { <div class="gz-none">No recorded events in this era — browse with the era slider, or view all eras.</div> }
                                </div>
                            }
                            <div class="gz-credit">Historical data: <a href="https://www.sarna.net/" target="_blank" rel="noopener noreferrer">Sarna.net BattleTechWiki</a> (cited facts)</div>
                        </div>
                    } @else if (!worldEvents(det.name)) {
                        <hr>
                        <div class="row"><span class="k">Environment</span><span class="v stub">gazetteer →</span></div>
                        <div class="row"><span class="k">Notable battles</span><span class="v stub">gazetteer →</span></div>
                        <div class="row"><span class="k">History</span><span class="v stub">gazetteer →</span></div>
                    }
                </div>
            }

            <div class="sm-legend">
                <button type="button" class="sm-leg-h" (click)="legendOpen.set(!legendOpen())" [attr.aria-expanded]="legendOpen()">Factions ({{ legend().length }}) {{ legendOpen() ? '▾' : '▸' }}</button>
                @if (legendOpen()) {
                    @for (l of legend(); track l.label) { <button type="button" class="leg" (click)="frameFaction(l.label)"><span class="sw" [style.background]="l.color"></span><span class="leg-t">{{ l.label }}</span></button> }
                }
            </div>
            <div class="sm-attr">Territory: systems.json ownerByEra (canon) · Flashpoints: Sarna.net BattleTechWiki (GNU FDL 1.2, cited facts) · IS dots: ISCS</div>
            @if (!star.ready()) { <div class="sm-load">Loading star systems…</div> }
        </div>
    </div>
    `,
    styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .sm-wrap { display: flex; flex-direction: column; height: 100%; min-height: 520px; color: #e8e6df; background: #0c0f14; }
    .sm-head { display: flex; align-items: center; gap: 13px; flex-wrap: wrap; padding: 9px 14px; border-bottom: 1px solid #26303c; background: #0e131a; }
    .sm-title { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: .03em; color: #fff; }
    .sm-title span { color: #c79a3a; }
    .sm-ctl { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #93a0ad; }
    .sm-ctl input[type=range] { width: 190px; max-width: 44vw; }
    .sm-yr { color: #fff; font-weight: 600; min-width: 208px; display: inline-block; font-size: 12.5px; }
    .sm-src { font-size: 11px; color: #7c8794; border: 1px solid #2a3542; border-radius: 6px; padding: 2px 7px; }
    select, button { background: #141a22; color: #e8e6df; border: 1px solid #26303c; border-radius: 7px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
    button:hover, select:hover { border-color: #3d6ea5; }
    .sm-chk { display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 12.5px; color: #93a0ad; }
    .sm-stage { position: relative; flex: 1; overflow: hidden; }
    .sm-host { width: 100%; height: 100%; }
    .sm-host svg { display: block; width: 100%; height: 100%; background: radial-gradient(120% 120% at 50% 25%, #101722 0, #090c11 72%); cursor: grab; touch-action: none; }
    .sm-host svg:active { cursor: grabbing; }
    .sm-terr { stroke-linejoin: round; }
    .sm-lbl { fill: #efe9d8; paint-order: stroke; stroke: #0a0d12; stroke-width: 2.4px; pointer-events: none; font-family: 'Segoe UI', system-ui, sans-serif; }
    .sm-cur { animation: smpulse 1.8s ease-in-out infinite; }
    .sm-flash { animation: smflash 1.5s ease-in-out infinite; }
    @keyframes smpulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @keyframes smflash { 0% { opacity: .25; } 50% { opacity: .95; } 100% { opacity: .25; } }
    .sm-hint { position: absolute; left: 12px; top: 12px; font-size: 12px; color: #93a0ad; background: rgba(14,19,26,.72); padding: 5px 9px; border-radius: 7px; pointer-events: none; }
    .sm-detail { position: absolute; width: 250px; max-width: 72vw; background: rgba(18,24,32,.97); border: 1px solid #34465a; border-radius: 12px; padding: 13px 15px 12px; font-size: 13px; line-height: 1.5; box-shadow: 0 14px 44px rgba(0,0,0,.6); transform-origin: top left; animation: smexpand .22s cubic-bezier(.2,.9,.25,1.1); z-index: 5; max-height: calc(100% - 48px); overflow: auto; overscroll-behavior: contain; }
    @keyframes smexpand { from { opacity: 0; transform: scale(.55); } to { opacity: 1; transform: scale(1); } }
    .sm-detail h3 { margin: 0 0 8px; font-size: 15px; color: #fff; font-weight: 600; padding-right: 16px; }
    .sm-detail .row { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
    .sm-detail .k { color: #8b98a5; flex: 0 0 auto; } .sm-detail .v { text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .sm-detail .stub { color: #6f7c89; font-style: italic; font-size: 12px; }
    .sm-detail hr { border: none; border-top: 1px solid #2c3948; margin: 9px 0; }
    .sm-x { position: absolute; top: 7px; right: 8px; padding: 0 6px; font-size: 17px; line-height: 1; border: none; background: none; color: #8b98a5; }
    .sm-x:hover { color: #fff; }
    .sm-obe { margin-top: 9px; }
    .obe-h { color: #8b98a5; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .obe-h .cnt { color: #ff8a5d; margin-left: 4px; }
    .obe-strip { display: flex; gap: 2px; flex-wrap: wrap; }
    .obe-cell { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .obe-sw { width: 13px; height: 10px; border-radius: 2px; border: 1px solid rgba(0,0,0,.4); }
    .obe-y { font-size: 8.5px; color: #6f7c89; }
    .sm-flashlist { margin-top: 9px; border-top: 1px solid #2c3948; padding-top: 7px; }
    .fl-row { display: flex; gap: 7px; align-items: baseline; font-size: 11.5px; margin: 2px 0; }
    .fl-y { color: #ff8a5d; min-width: 30px; font-weight: 600; }
    .fl-t { flex: 1; color: #d8d4c8; } .fl-k { color: #6f7c89; font-size: 10px; }
    .sm-gaz { margin-top: 9px; border-top: 1px solid #2c3948; padding-top: 7px; }
    .gz-sec { margin-bottom: 8px; }
    .gz-tgl { border: 1px solid #2a3542; background: #141a22; color: #9db0c2; border-radius: 5px; padding: 0 6px; font-size: 10px; margin-left: 6px; cursor: pointer; text-transform: none; letter-spacing: 0; }
    .gz-tgl:hover { border-color: #3d6ea5; color: #fff; }
    .gz-row { display: flex; gap: 7px; align-items: baseline; font-size: 11.5px; margin: 2px 0; padding-left: 4px; border-left: 2px solid transparent; }
    .gz-row.gz-cur { border-left-color: #c79a3a; background: rgba(199,154,58,.07); }
    .gz-y { color: #7fb2e0; min-width: 34px; font-weight: 600; flex: 0 0 auto; }
    .gz-t { flex: 1; color: #d8d4c8; text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
    .gz-t:hover { color: #fff; text-decoration: underline; }
    .gz-k { color: #6f7c89; font-size: 10px; flex: 0 0 auto; }
    .gz-none { color: #6f7c89; font-style: italic; font-size: 11px; }
    .gz-credit { margin-top: 4px; font-size: 9.5px; color: #5a6570; }
    .gz-credit a { color: #7c8794; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; border: 1px solid rgba(0,0,0,.4); }
    .sm-legend { position: absolute; left: 12px; bottom: 28px; max-width: 340px; max-height: 42%; overflow: auto; background: rgba(14,19,26,.9); border: 1px solid #26303c; border-radius: 10px; padding: 8px 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 14px; overscroll-behavior: contain; }
    .sm-leg-h { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #b8c4d0; background: none; border: none; padding: 1px 2px 3px; cursor: pointer; text-align: left; }
    .sm-leg-h:hover { color: #fff; }
    .leg { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #93a0ad; cursor: pointer; background: none; border: none; padding: 1px 2px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .leg .leg-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .leg:hover { color: #fff; } .leg .sw { width: 11px; height: 11px; }
    .sm-attr { position: absolute; left: 12px; bottom: 8px; font-size: 10px; color: #5a6570; pointer-events: none; }
    .sm-load { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #93a0ad; }
    @media (max-width: 720px) { .sm-detail { width: 200px; } .sm-legend { max-height: 32%; } .sm-yr { min-width: 0; } }
    `],
})
export class StarMapTabComponent {
    protected readonly star = inject(StarSystemsService);
    protected readonly wh = inject(WorldHistoryService); // GAZETTEER-1 P2 — lazy history + world-facts packs
    private readonly state = inject(NewCampaignState);
    private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
    private readonly stageRef = viewChild.required<ElementRef<HTMLDivElement>>('stage');

    protected readonly era = signal<number>(this.state.era()?.id ?? 5);
    protected readonly includeClan = signal(false);
    protected readonly showLabels = signal(false);
    protected readonly showCapitals = signal(true);
    protected readonly showFlash = signal(false);
    protected readonly detail = signal<Detail | null>(null);
    protected readonly facValue = signal<string>('');
    private readonly zoomK = signal(1);
    private readonly selName = signal<string | null>(null);
    protected readonly legend = signal<LegendItem[]>([]);
    protected readonly legendOpen = signal(true); // HOTFIX-039 — the faction legend is collapsible (default open)

    protected readonly eras = ERAS;
    protected readonly eraLabel = computed(() => { const e = ERAS.find((x) => x.id === this.era()); return e ? `${e.from}–${e.to >= 9999 ? 'present' : e.to} · ${e.name}` : ''; });
    protected readonly eraShort = computed(() => { const e = ERAS.find((x) => x.id === this.era()); return e ? String(e.from) : ''; });

    private readonly evByWorld = new Map<string, FlashEvent[]>();
    private readonly sysByNameMap = new Map<string, StarSystem>();

    // ── render state ──
    private readonly W = 1000; private readonly H = 680; private readonly PAD = 30;
    private prj = { sc: 1, ox: 0, oy: 0, minx: 0, minz: 0 };
    private S: Star[] = [];               // the UNION star set (plotted, in-bounds)
    private P: [number, number][] = [];
    private idxByName = new Map<string, number>();
    private del: Delaunay<Delaunay.Point> | null = null;
    private sysDel: Delaunay<Delaunay.Point> | null = null;
    private sysList: StarSystem[] = [];
    private grid: XZ[] = [];
    private readonly hexColorCache = new Map<string, ColoredHex[]>();
    private readonly legendMap = new Map<string, LegendItem[]>();
    private svgSel!: Sel; private root!: Sel;
    private gTerr!: Sel; private gFlash!: Sel; private gCur!: Sel; private gDot!: Sel; private gCap!: Sel; private gLbl!: Sel;
    private zoomB!: ZoomBehavior<SVGSVGElement, unknown>;
    private built = false;

    constructor() {
        void this.star.ensureLoaded();
        void this.wh.ensureLoaded(); // fires on first Star Map render — the packs stay out of the initial bundle
        for (const ev of FLASH_EVENTS) for (const w of ev.w) { const a = this.evByWorld.get(w); if (a) a.push(ev); else this.evByWorld.set(w, [ev]); }
        effect(() => { const ready = this.star.ready(); this.includeClan(); if (!ready) return; untracked(() => this.buildOrRebuild()); });
        effect(() => { const e = this.era(); if (!this.built) return; untracked(() => { this.drawEra(e); this.drawDots(); this.drawFlashpoints(); this.drawCurrent(); }); });
        effect(() => { this.showLabels(); if (this.built) untracked(() => this.applyLabelVis()); });
        effect(() => { this.showCapitals(); if (this.built) untracked(() => this.drawCapitals()); });
        effect(() => { this.showFlash(); if (this.built) untracked(() => this.drawFlashpoints()); });
        effect(() => { this.state.currentLocation(); if (this.built) untracked(() => this.drawCurrent()); });
    }

    // ── template helpers ──
    protected color(tag: string | null | undefined): string { return factionColor(tag); }
    protected sysByName(name: string): StarSystem | undefined { return this.sysByNameMap.get(name); }
    protected ownerAtEra(s: StarSystem, eraId: number): string { return this.star.ownerAt(s, eraId); }
    protected ownerAtPlanet(name: string): string {
        const sys = this.sysByNameMap.get(name);
        if (sys) return this.star.ownerAt(sys, this.era());
        const i = this.idxByName.get(name); // else nearest systems.json system's owner
        if (i != null && this.sysDel) { const f = this.sysDel.find(this.S[i].x, this.S[i].z); return this.star.ownerAt(this.sysList[f], this.era()); }
        return '—';
    }
    protected planetCoord(name: string): string { const i = this.idxByName.get(name); return i != null ? `${this.S[i].x}, ${this.S[i].z}` : '—'; }
    protected localeLine(s: StarSystem): string { return [s.localeAttrs?.settlement, s.localeAttrs?.regionRole].filter(Boolean).join(' · ') || '—'; }
    protected terrainLine(s: StarSystem): string { const t = s.localeAttrs?.terrain; return t && t.length ? t.join(', ') : '—'; }
    protected worldEvents(name: string): FlashEvent[] | null { const e = this.evByWorld.get(name); return e && e.length ? [...e].sort((a, b) => a.y - b.y).slice(0, 14) : null; }
    protected setEra(v: string): void { this.era.set(+v); }
    protected closeDetail(): void { this.detail.set(null); this.selName.set(null); this.drawDots(); }

    // ── GAZETTEER-1 P2 — the gazetteer section (sparse-legal: null → the pre-P2 card renders byte-unchanged) ──
    protected readonly gzAll = signal(false); // history scope: the viewed era (default) vs all 12
    protected readonly campaignEraId = computed(() => this.state.era()?.id ?? -1);
    protected gazetteer(name: string): { facts: WorldFacts | null; events: WorldEvent[] } | null {
        if (!this.wh.ready()) return null;
        const sys = this.sysByNameMap.get(name); if (!sys) return null;
        const facts = this.wh.factsFor(sys.id), events = this.wh.eventsFor(sys.id);
        return facts || events.length ? { facts, events } : null;
    }
    /** The history rows in scope: the map's VIEWED era (the slider — defaults to the campaign era) or all. */
    protected gzRows(events: WorldEvent[]): WorldEvent[] { return this.gzAll() ? events : eventsForEra(events, this.era()); }
    protected eventLabel(ev: WorldEvent): string { return changeLabel(ev); }
    protected starLine(f: WorldFacts): string | null { if (!f.starType && f.rechargeHours === undefined) return null; return (f.starType ?? '—') + (f.rechargeHours !== undefined ? ` · recharge ${f.rechargeHours} h` : ''); }
    protected surfaceLine(f: WorldFacts): string | null {
        const parts = [f.gravity !== undefined ? `${f.gravity} g` : null, f.tempC !== undefined ? `${f.tempC} °C` : null, f.waterPct !== undefined ? `${f.waterPct}% water` : null].filter((x): x is string => x !== null);
        return parts.length ? parts.join(' · ') : null;
    }
    protected popAt(f: WorldFacts): string | null { const v = sparseEraValue(f.popByEra, this.era()); return v == null ? null : v >= 1e9 ? (v / 1e9).toFixed(2) + ' B' : v >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : String(v); }
    protected hpgAt(f: WorldFacts): string | null { const v = sparseEraValue(f.hpgByEra, this.era()); return v == null || v === 'X' ? null : String(v); }

    private projectPoint(x: number, z: number): [number, number] { return [this.prj.ox + (x - this.prj.minx) * this.prj.sc, this.H - this.prj.oy - (z - this.prj.minz) * this.prj.sc]; }
    private static readonly HEX_FILL = 1.18;
    private hexPath(x: number, z: number): string { const f = StarMapTabComponent.HEX_FILL; return 'M' + HEX_SHAPE.map(([vx, vz]) => { const p = this.projectPoint(x + vx * f, z + vz * f); return `${p[0].toFixed(1)},${p[1].toFixed(1)}`; }).join('L') + 'Z'; }

    // (A) the complete fixed star set — UNION(ISCS_PLANETS ∪ systems.json) by name; in-bounds unless the toggle is on
    private buildUnion(): Star[] {
        const seen = new Set<string>(), out: Star[] = [];
        for (const p of ISCS_PLANET_LIST) if (!seen.has(p.n)) { seen.add(p.n); out.push({ n: p.n, x: p.x, z: p.z }); }
        for (const s of this.sysList) if (!seen.has(s.name)) { seen.add(s.name); out.push({ n: s.name, x: s.x, z: s.y }); } // frames align — systems.json (x,y) as (x,z)
        return this.includeClan() ? out : out.filter((s) => IN_BOUNDS(s.x, s.z));
    }

    private buildOrRebuild(): void {
        if (!this.svgSel) this.initSvg();
        this.sysList = this.star.systems();
        this.sysByNameMap.clear(); for (const s of this.sysList) this.sysByNameMap.set(s.name, s);
        this.sysDel = this.sysList.length ? Delaunay.from(this.sysList.map((s) => [s.x, s.y])) : null;
        this.S = this.buildUnion();
        this.idxByName = new Map(this.S.map((s, i) => [s.n, i]));
        const xs = this.S.map((s) => s.x), zs = this.S.map((s) => s.z);
        const minx = Math.min(EXTENT.minx, ...xs), maxx = Math.max(EXTENT.maxx, ...xs), minz = Math.min(EXTENT.minz, ...zs), maxz = Math.max(EXTENT.maxz, ...zs);
        const sc = Math.min((this.W - 2 * this.PAD) / (maxx - minx), (this.H - 2 * this.PAD) / (maxz - minz));
        this.prj = { sc, ox: (this.W - sc * (maxx - minx)) / 2, oy: (this.H - sc * (maxz - minz)) / 2, minx, minz };
        this.P = this.S.map((s) => this.projectPoint(s.x, s.z));
        this.del = Delaunay.from(this.P);
        this.buildGrid();
        this.hexColorCache.clear();
        this.built = true;
        this.drawEra(this.era());
        this.drawDots();
        this.drawFlashpoints();
        this.drawCurrent();
        this.svgSel.call(this.zoomB.transform, zoomIdentity);
        this.zoomK.set(1);
    }

    // coverage safeguard: keep the canon FALLBACK_HEXES + add a hex under any plotted world the ISCS lattice
    // doesn't reach (deep-rimward periphery beyond the 3058 coverage), so every territory with stars has fill.
    private buildGrid(): void {
        const fbDel = Delaunay.from(FALLBACK_HEXES.map((h) => [h.x, h.z]));
        const grid: XZ[] = FALLBACK_HEXES.map((h) => ({ x: h.x, z: h.z }));
        let f = 0;
        for (const s of this.S) { f = fbDel.find(s.x, s.z, f); const h = FALLBACK_HEXES[f]; if (Math.hypot(s.x - h.x, s.z - h.z) > 20) grid.push({ x: s.x, z: s.z }); }
        this.grid = grid;
    }

    private initSvg(): void {
        const host = this.hostRef().nativeElement;
        host.replaceChildren();
        const svg = select(host).append('svg').attr('viewBox', `0 0 ${this.W} ${this.H}`).attr('preserveAspectRatio', 'xMidYMid meet') as Sel;
        const root = svg.append('g');
        this.gTerr = root.append('g'); this.gFlash = root.append('g'); this.gCur = root.append('g'); this.gDot = root.append('g'); this.gCap = root.append('g'); this.gLbl = root.append('g');
        this.zoomB = zoom<SVGSVGElement, unknown>().scaleExtent([0.6, 24]).on('zoom', (ev) => { root.attr('transform', ev.transform.toString()); this.zoomK.set(ev.transform.k); this.applyScaleInvariant(ev.transform.k); });
        svg.call(this.zoomB);
        svg.on('click', (ev: MouseEvent) => {
            if ((ev.target as Element).tagName === 'circle') return;
            const node = svg.node() as SVGSVGElement; const t = zoomTransform(node); const [mx, my] = t.invert(pointer(ev, node));
            const i = this.del?.find(mx, my); if (i != null && i >= 0 && this.S[i]) this.openDetail(this.S[i].n, ev);
        });
        this.svgSel = svg; this.root = root;
    }

    // (B) territory = systems.json ownerAt(era) hex-fill for ALL eras (the ISCS-snapshot lump branch is GONE)
    private coloredHexes(e: number): ColoredHex[] {
        const key = String(e);
        const hit = this.hexColorCache.get(key); if (hit) return hit;
        const out: ColoredHex[] = []; const present = new Map<string, string>();
        let f = 0;
        for (const h of this.grid) {
            let tag = 'Unknown';
            if (this.sysDel) { f = this.sysDel.find(h.x, h.z, f); tag = this.star.ownerAt(this.sysList[f], e); }
            if (tag === 'Unknown') continue;
            const color = factionColor(tag); present.set(tag, color);
            out.push({ x: h.x, z: h.z, color });
        }
        this.legendMap.set(key, [...present].map(([label, color]) => ({ label, color })).sort((a, b) => a.label.localeCompare(b.label)));
        this.hexColorCache.set(key, out);
        return out;
    }

    private drawEra(e: number): void {
        const hexes = this.coloredHexes(e);
        this.legend.set(this.legendMap.get(String(e)) ?? []);
        const byColor = new Map<string, string[]>();
        for (const h of hexes) { let arr = byColor.get(h.color); if (!arr) { arr = []; byColor.set(h.color, arr); } arr.push(this.hexPath(h.x, h.z)); }
        const data = [...byColor].map(([color, paths]) => ({ color, d: paths.join('') }));
        const k = this.zoomK();
        this.gTerr.selectAll('path').data(data, (d: any) => d.color).join('path').attr('class', 'sm-terr').attr('d', (d: any) => d.d)
            .attr('fill', (d: any) => d.color).attr('stroke', (d: any) => d.color).attr('stroke-width', 0.5 / k);
    }

    private capitalNames(): Set<string> {
        const names = new Set<string>();
        for (const l of this.legend()) { const sys = this.star.byId(capitalSystemIdFor(l.label)); if (sys && this.idxByName.has(sys.name)) names.add(sys.name); }
        return names;
    }

    private drawDots(): void {
        const k = this.zoomK();
        const cap = this.capitalNames();
        this.gDot.selectAll('circle').data(this.S, (d: any) => d.n).join('circle')
            .attr('cx', (_d: any, i: number) => this.P[i][0]).attr('cy', (_d: any, i: number) => this.P[i][1])
            .attr('r', (d: any) => (this.selName() === d.n ? 3.4 : 1.3) / Math.sqrt(k))
            .attr('fill', (d: any) => (cap.has(d.n) ? '#ffe79a' : '#e9e4d6')).attr('stroke', '#0a0d12').attr('stroke-width', 0.4 / k)
            .style('cursor', 'pointer').on('click', (ev: MouseEvent, d: any) => this.openDetail(d.n, ev));
        this.drawLabels();
        this.drawCapitals(cap);
    }

    private drawLabels(): void {
        const k = this.zoomK();
        this.gLbl.selectAll('text').data(this.S, (d: any) => d.n).join('text').attr('class', 'sm-lbl').text((d: any) => d.n)
            .attr('x', (_d: any, i: number) => this.P[i][0] + 3).attr('y', (_d: any, i: number) => this.P[i][1] - 2.5).attr('font-size', 6.5 / k).attr('opacity', (d: any) => this.labelVis(d.n));
    }

    private drawCapitals(cap?: Set<string>): void {
        const k = this.zoomK();
        const names = cap ?? this.capitalNames();
        const capData = this.showCapitals() ? this.S.filter((p) => names.has(p.n)) : [];
        this.gCap.selectAll('text').data(capData, (d: any) => d.n).join('text').text('★')
            .attr('x', (d: any) => this.P[this.idxByName.get(d.n)!][0]).attr('y', (d: any) => this.P[this.idxByName.get(d.n)!][1] + 3.2)
            .attr('text-anchor', 'middle').attr('font-size', 10 / k).attr('fill', '#ffdf6e').style('pointer-events', 'none');
    }

    private drawFlashpoints(): void {
        if (!this.showFlash()) { this.gFlash.selectAll('circle').remove(); return; }
        const era = ERAS.find((x) => x.id === this.era())!;
        const to = era.to >= 9999 ? 4000 : era.to;
        const counts = new Map<string, number>();
        for (const ev of FLASH_EVENTS) if (ev.y >= era.from && ev.y <= to) for (const w of ev.w) counts.set(w, (counts.get(w) ?? 0) + 1);
        const data: { n: string; c: number }[] = [];
        for (const [w, c] of counts) if (this.idxByName.has(w)) data.push({ n: w, c });
        const maxC = Math.max(1, ...data.map((d) => d.c));
        const k = this.zoomK();
        this.gFlash.selectAll('circle').data(data, (d: any) => d.n).join('circle').attr('class', 'sm-flash')
            .attr('cx', (d: any) => this.P[this.idxByName.get(d.n)!][0]).attr('cy', (d: any) => this.P[this.idxByName.get(d.n)!][1])
            .attr('r', (d: any) => (3 + 6 * Math.sqrt(d.c / maxC)) / Math.sqrt(k)).attr('fill', 'rgba(255,106,61,0.12)').attr('stroke', '#ff6a3d').attr('stroke-width', 1.4 / k)
            .style('cursor', 'pointer').on('click', (ev: MouseEvent, d: any) => { ev.stopPropagation(); this.openDetail(d.n, ev); });
    }

    private drawCurrent(): void {
        const cl = this.state.currentLocation();
        const sys = cl ? this.star.byId(cl) : undefined;
        const idx = sys ? this.idxByName.get(sys.name) : undefined;
        const data: [number, number][] = idx != null ? [this.P[idx]] : [];
        const k = this.zoomK();
        this.gCur.selectAll('circle').data(data).join('circle').attr('class', 'sm-cur').attr('cx', (d: any) => d[0]).attr('cy', (d: any) => d[1]).attr('r', 7 / Math.sqrt(k))
            .attr('fill', 'none').attr('stroke', '#7fe0ff').attr('stroke-width', 1.6 / k).style('pointer-events', 'none');
    }

    private labelVis(name: string): number { return this.selName() === name || this.showLabels() || this.zoomK() > 3 ? 1 : 0; }
    private applyLabelVis(): void { this.gLbl.selectAll('text').attr('opacity', (d: any) => this.labelVis(d.n)); }

    private applyScaleInvariant(k: number): void {
        this.gLbl.selectAll('text').attr('font-size', 6.5 / k).attr('opacity', (d: any) => this.labelVis(d.n));
        this.gCap.selectAll('text').attr('font-size', 10 / k);
        this.gDot.selectAll('circle').attr('r', (d: any) => (this.selName() === d.n ? 3.4 : 1.3) / Math.sqrt(k)).attr('stroke-width', 0.4 / k);
        this.gTerr.selectAll('path').attr('stroke-width', 0.5 / k);
        this.gFlash.selectAll('circle').attr('stroke-width', 1.4 / k);
        this.gCur.selectAll('circle').attr('r', 7 / Math.sqrt(k)).attr('stroke-width', 1.6 / k);
    }

    private openDetail(name: string, ev: MouseEvent): void {
        const stage = this.stageRef().nativeElement.getBoundingClientRect();
        // provisional position (hardcoded fallback) — re-clamped below with the card's REAL rendered size.
        const x = Math.min(Math.max(ev.clientX - stage.left, 8), Math.max(8, stage.width - 262));
        const y = Math.min(Math.max(ev.clientY - stage.top, 8), Math.max(8, stage.height - 220));
        this.selName.set(name); this.detail.set({ name, x, y }); this.drawDots();
        // HOTFIX-039 — re-clamp with the rendered card's REAL box so it is ALWAYS fully on-stage (the 262/220 guesses
        // underestimate the ~350px card; .sm-stage is overflow:hidden so an off-stage card is clipped + unreachable).
        // max-height (calc(100% - 48px), padding/border-aware) keeps the card box below the stage, so the clamp
        // range is always valid → fully on-stage on both axes, even on a short phone stage.
        requestAnimationFrame(() => {
            const el = this.stageRef().nativeElement.querySelector('.sm-detail') as HTMLElement | null;
            if (!el) return;
            const st = this.stageRef().nativeElement.getBoundingClientRect();
            const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
            const nx = clamp(x, 8, st.width - el.offsetWidth - 8);
            const ny = clamp(y, 8, st.height - el.offsetHeight - 8);
            if (nx !== x || ny !== y) this.detail.set({ name, x: nx, y: ny });
        });
    }

    protected frameFaction(label: string): void {
        this.facValue.set(label);
        if (!label || !this.built) return;
        const targetColor = (this.legend().find((l) => l.label === label) || {}).color;
        const pts: [number, number][] = [];
        for (const h of this.coloredHexes(this.era())) if (h.color === targetColor) pts.push(this.projectPoint(h.x, h.z));
        if (!pts.length) return;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.min(...xs) - 24, x1 = Math.max(...xs) + 24, y0 = Math.min(...ys) - 24, y1 = Math.max(...ys) + 24;
        const k = Math.max(1, Math.min(24, 0.9 * Math.min(this.W / (x1 - x0), this.H / (y1 - y0))));
        this.svgSel.transition().duration(750).call(this.zoomB.transform, zoomIdentity.translate(this.W / 2 - k * (x0 + x1) / 2, this.H / 2 - k * (y0 + y1) / 2).scale(k));
    }

    protected resetView(): void { this.facValue.set(''); if (this.built) this.svgSel.transition().duration(600).call(this.zoomB.transform, zoomIdentity); }
}
