import { Component, ChangeDetectionStrategy, computed, inject, effect, untracked, viewChild, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from './warchest.service';
import { contractSummaryOf } from './chaos-contract'; // PD3 P2 — the terminal contract record at End Contract
import { CONTRACT_COLUMNS, repCostUp, sacrificeDropTarget, type ContractColumn } from './chaos-contract-steps';
import { MissionTreeService } from '../mission/mission-tree.service';
import { HotSpotsCatalogService, resolveSides, type CatalogHotSpot, type SideOffer, hirableSides } from './hotspots-catalog';
import { HotspotIoComponent, HotspotIoState } from './hotspot-io';
import { ContractWindowService } from './contract-window.service';
import { NegotiationService } from './negotiation.service';
import { GM_NEGOTIATION_HOST_PROVIDER } from './negotiation-host-gm';
import { NegotiateModalComponent } from './negotiate-modal';
import { TrackPickerComponent } from './track-picker';
import { eraTag } from '../mission/forge-select';
import { HsForgeService, HSFORGE_TOPUP_FLOOR } from './forge/hs-forge.service'; // HSFORGE-1 — the Forge; P2 wires the deal-time top-up (ruling D10)
import { ensureForgeData, type ForgeRegion } from './forge/hs-forge-data'; // HSFORGE-1 P2 — the region table (the theater header line)
import { TableModeService } from '../gm/table-mode.service';

const HOTSPOT_OFFER_SIZE = 5;
const HOTSPOT_REROLL_SP = 250;
/** Fisher-Yates shuffle (fresh copy). */
function shuffle<T>(arr: readonly T[]): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

@Component({
    selector: 'bce-chaos-contracts',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [HotspotIoComponent, NegotiateModalComponent, TrackPickerComponent],
    providers: [HotspotIoState, NegotiationService, GM_NEGOTIATION_HOST_PROVIDER],
    template: `
        @if (mw.tableBound(); as tb) {
            <div class="cc-tablebound" data-testid="cc-tablebound">
                <span>At <b>{{ tb.sessionName || 'a GM session' }}</b>'s table &mdash; month advance withheld while you're bound to it.</span>
                <button type="button" class="cc-btn small" (click)="leaveTable()" data-testid="cc-leave-table">Leave the table</button>
            </div>
        }
        @if (active(); as c) {
            <!-- ACTIVE CONTRACT -->
            <div class="cc-head">
                <div>
                    <span class="l">{{ c.party === 'session' ? 'Session contract' : 'Active contract' }}</span><span class="v">{{ neg.typeLabel(c.type) }}</span>
                    @if (c.employer) { <div class="cc-emp-line">{{ c.sideRole }} &middot; for {{ c.employer }}</div> }
                </div>
                <div class="cc-tags">
                    <span class="cc-tag">Scale {{ c.scale }}</span>
                    <span class="cc-tag">Intensity {{ c.intensity }}</span>
                    <span class="cc-tag" [class.warn]="mw.windowElapsed()" data-testid="cc-month-tag">Month {{ mw.monthX() }} / {{ mw.windowMonths(c) }}@if (mw.windowElapsed()) { &middot; window elapsed }</span>
                    <span class="cc-tag">Rep {{ neg.rep() }}</span>
                    @if (c.enemyFaction) { <span class="cc-tag">vs {{ c.enemyFaction }}</span> }
                </div>
            </div>
            <div class="cc-terms">
                @for (col of columns; track col) {
                    <div class="ct-row"><span class="ct-l">{{ neg.colLabel(col) }}</span><span class="ct-v">{{ neg.resolvedValue(c.steps, col) }}</span></div>
                }
            </div>
            <div class="cc-econ">
                <span>Base Pay <b>+{{ neg.money(neg.basePayFor(c)) }} SP</b>/mo</span>
                <span>Support Cover <b>{{ neg.coverPctFor(c) }}</b></span>
            </div>
            <div class="cc-diff">
                <label>GM Difficulty
                    <input type="range" min="0.8" max="1.6" step="0.1" [value]="mw.gmDifficulty()" (input)="mw.setDifficulty(+$any($event.target).value)" aria-label="GM difficulty" />
                </label>
                <span class="cc-diff-lbl">{{ mw.difficultyLabel(mw.gmDifficulty()) }} &middot; &times;{{ mw.gmDifficulty().toFixed(1) }} OpFor BV</span>
            </div>
            <div class="cc-actions cc-active-actions">
                @if (canPlayTrack()) {
                    <button type="button" class="cc-btn go" (click)="playOpen.set(!playOpen())" data-testid="cc-play-track" title="Pick and play a track: this hot spot's tracks, your Custom Tracks, or the universal §18 library">&#9654; Play a track</button>
                }
                <button type="button" class="cc-btn ghost" [disabled]="!!mw.tableBound()" (click)="mw.advanceMonth()" data-testid="cc-advance-month" [title]="advanceTitle()">&#9656; Advance a month</button>
                @if (c.party === 'session') {
                    <span class="cc-tag" data-testid="cc-session-note">Session contract &middot; no party &middot; Retract it on the GM tab</span>
                } @else {
                    <button type="button" class="cc-btn ghost" [disabled]="!neg.canBackOut()" (click)="neg.backOut()" data-testid="cc-back-to-contracts" [title]="neg.backOutTitle()">&#9668; Back to contracts</button>
                    <button type="button" class="cc-btn danger" (click)="endContract()">End Contract (Reputation +1)</button>
                }
            </div>
            @if (canPlayTrack() && playOpen()) {
                <div class="cc-play-picker" data-testid="cc-play-picker">
                    <bce-track-picker [branchId]="firstAvailBranchId()" />
                    <div class="cc-play-note">Pick from this hot spot's tracks, your Custom Tracks, or the universal §18 library — or roll one with 🎲 Random. No embedded track is required.</div>
                </div>
            }
            <p class="cc-month-hint">Advancing pays maintenance and collects base pay for the month.</p>
            @if (mw.sessionClockNotice(); as n) { <p class="cc-month-hint" role="status" data-testid="cc-clock-notice"><b>{{ n }}</b></p> }
            @if (mw.windowElapsed()) {
                <p class="cc-window-warn" data-testid="cc-window-warn">Contract window elapsed (Month {{ mw.monthsElapsed() + 1 }} of {{ mw.windowMonths(c) }}) — finish the remaining tracks or End Contract.</p>
            }
        } @else if (table.on()) {
            <p class="cc-tablemode" data-testid="cc-table-mode">Table mode &mdash; contracts are on the GM screen.</p>
        } @else {
            @if (hotSpots().length) {
                <div class="cc-hs">
                    <div class="cc-head">
                        <div><span class="l">Hot Spots — negotiate a contract</span></div>
                        <div class="cc-tags">
                            @if (reckoningBegun()) {
                                <span class="cc-tag cc-reckoning-banner" data-testid="cc-reckoning-banner">⚔ THE RECKONING — the campaign's final contract</span>
                            } @else {
                                @if (showAll()) {
                                    <span class="cc-tag">Showing all {{ offerHotspots().length }}</span>
                                } @else {
                                    <span class="cc-tag">{{ offerHotspots().length }} of {{ offerPool().length }} on offer</span>
                                    <button type="button" class="cc-btn small ghost" [disabled]="!canReroll()" (click)="rerollOffer()" [title]="rerollTitle()">↻ Reroll ({{ rerollSp }} SP)</button>
                                }
                                <button type="button" class="cc-btn small ghost" [class.on]="showAll()" (click)="toggleShowAll()" data-testid="cc-show-all" title="GM: show the whole era chamber instead of the dealt 5">{{ showAll() ? '☑' : '☐' }} Show all contracts (GM)</button>
                            }
                            <!-- HSFORGE-1 P2 — the merc command's theater (set at setup; filters the chamber per ruling D11). -->
                            @if (theaterName(); as tn) { <span class="cc-tag" data-testid="cc-theater" title="The command's theater of operations — offers are drawn from this region.">Theater: {{ tn }}</span> }
                        </div>
                    </div>
                    @if (!reckoningBegun() && hasCapstones()) {
                        <div class="cc-reckoning-gate">
                            <button type="button" class="cc-btn danger cc-begin-reckoning" (click)="beginReckoning()" data-testid="cc-begin-reckoning">⚔ Begin the Reckoning</button>
                            <span class="cc-reckoning-note">The campaign's final contract — recommended after several contracts / Reputation 5+.</span>
                        </div>
                    }
                    <div class="cc-hs-list">
                        @for (h of offerHotspots(); track h.id) {
                            <div class="cc-hs-row two-sided" [attr.data-hs]="h.id">
                                <div class="cc-hs-hdr">
                                    <span class="cc-hs-world">{{ h.world }}@if (h.custom) { <span class="cc-hs-cust">custom</span> }</span>
                                    <span class="cc-hs-title">{{ h.title }}</span>
                                    <span class="cc-hs-meta">{{ h.type }} &middot; Scale {{ h.contract.scale }} &middot; {{ h.contract.intensity }} track{{ h.contract.intensity === 1 ? '' : 's' }}</span>
                                    <button type="button" class="cc-btn small cc-hs-export" (click)="io()?.exportHotspot(h)" title="Export as JSON to edit">Export</button>
                                </div>
                                <div class="cc-sides">
                                    @for (r of sideRows(h); track r.side.key) {
                                        <div class="cc-side" [class.prov]="r.side.synthesized">
                                            @if (r.side.title) { <div class="cc-side-title">{{ r.side.title }}</div> }
                                            <div class="cc-side-emp">{{ r.side.employer }}@if (r.side.synthesized) { <span class="cc-prov" title="A provisional opposing side — an authored contract is pending">provisional</span> }</div>
                                            <div class="cc-side-meta"><span class="cc-side-role">{{ r.side.role }}</span> &middot; vs {{ r.opposing }}</div>
                                            @if (r.side.blurb && !r.side.synthesized) { <div class="cc-side-blurb">{{ r.side.blurb }}</div> } <!-- HOTSPOT-BRIEF v1 Amendment B — teasers un-gated (was custom-only); re-gate = restore h.custom && -->
                                            <div class="cc-side-acts">
                                                <button type="button" class="cc-btn small" (click)="neg.viewHotspot(h, r.side.key)" data-testid="cc-view-hotspot" title="Preview this side's contract offer">Brief &#9656;</button>
                                                <button type="button" class="cc-btn small go" (click)="neg.negotiateHotspot(h, r.side.key)" data-testid="cc-negotiate-hotspot" title="Negotiate the terms of this side, then sign">Negotiate &#9656;</button>
                                            </div>
                                        </div>
                                    }
                                </div>
                            </div>
                        }
                    </div>
                    <bce-hotspot-io />
                </div>
            } @else {
                <!-- ERA-1 (ruling 3) — the EMPTY CHAMBER says so. Reached only when no authored pack covers the era + theater
                     AND the Forge could not fill it (an unsupported era, or a theater that resolves no worlds) — the
                     top-up masks it everywhere else, and without this branch the board was a blank screen. -->
                <div class="cc-hs cc-hs-empty" data-testid="cc-hs-empty">
                    <div class="cc-head"><div><span class="l">Hot Spots — no contracts on offer</span></div></div>
                    <p class="cc-hs-empty-msg">No hot spots cover the <strong>{{ eraDisplayName() }}</strong> era@if (theaterName()) { in the <strong>{{ theaterName() }}</strong> theater}. No authored pack covers it and the Forge could not fill the chamber. Pick a different era or theater at setup, or import a custom hot spot below.</p>
                    <bce-hotspot-io />
                </div>
            }
            <div class="cc-diff">
                <label>GM Difficulty
                    <input type="range" min="0.8" max="1.6" step="0.1" [value]="mw.gmDifficulty()" (input)="mw.setDifficulty(+$any($event.target).value)" aria-label="GM difficulty" />
                </label>
                <span class="cc-diff-lbl">{{ mw.difficultyLabel(mw.gmDifficulty()) }} &middot; &times;{{ mw.gmDifficulty().toFixed(1) }} OpFor BV</span>
            </div>

        }

        <bce-negotiate-modal />
    `,
    styles: [`
        :host { display:block; }
        .cc-tablemode { font-family:var(--label); font-weight:600; letter-spacing:1.2px; font-size:11px; text-transform:uppercase; color:var(--ink2); border:1.5px dashed var(--rule, var(--ink2)); padding:14px 16px; }
        .cc-head { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px; border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:10px 14px; margin-bottom:14px; }
        .cc-head .l { font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); margin-right:8px; }
        .cc-head .v { font-family:var(--stencil); font-size:20px; }
        .cc-tags { display:flex; gap:6px; flex-wrap:wrap; }
        .cc-tag { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10.5px; text-transform:uppercase; border:1.2px solid var(--stamp); color:var(--stamp); padding:2px 8px; }
        .cc-tag.warn { border-color:var(--warn, #c2622a); color:var(--warn, #c2622a); }
        .cc-tag.cc-reckoning-banner { border-color:var(--stamp); background:var(--stamp); color:var(--paper); letter-spacing:1.5px; }
        .cc-reckoning-gate { display:flex; flex-wrap:wrap; align-items:center; gap:12px; border:1.5px dashed var(--stamp); background:var(--paper2, var(--paper)); padding:10px 14px; margin-bottom:14px; }
        .cc-begin-reckoning { margin-top:0; }
        .cc-reckoning-note { font-family:var(--type); font-size:12px; color:var(--ink2); }
        .cc-month-hint { font-family:var(--type); font-size:11.5px; color:var(--ink2); margin:6px 0 0; }
        .cc-play-picker { border:1.4px solid var(--stamp); background:var(--paper2, var(--paper)); padding:8px 12px; margin:8px 0 0; }
        .cc-play-note { font-family:var(--type); font-size:11.5px; color:var(--ink2); margin-top:6px; }
        .cc-window-warn { font-family:var(--type); font-size:12.5px; color:var(--warn, #c2622a); border-left:2px solid var(--warn, #c2622a); padding-left:10px; margin:8px 0 0; }
        .cc-hs { margin-bottom:14px; }
        .cc-hs-empty-msg { font-size:13px; line-height:1.45; color:var(--ink2); border:1.5px dashed var(--rule, var(--ink2)); padding:12px 14px; margin:0 0 10px; } /* ERA-1 — the honest empty chamber */
        .cc-hs-list { display:flex; flex-direction:column; gap:6px; }
        .cc-hs-row { text-align:left; border:1.4px solid var(--ink); background:var(--paper2, var(--paper)); color:var(--ink); padding:9px 13px; }
        .cc-hs-hdr { display:flex; flex-wrap:wrap; align-items:baseline; gap:1px 10px; }
        .cc-hs-world { flex:0 0 100%; font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10px; text-transform:uppercase; color:var(--stamp); }
        .cc-hs-cust { font-family:var(--mono); font-size:9px; letter-spacing:1px; color:var(--ink2); border:1px solid var(--ink2); padding:0 4px; margin-left:6px; }
        .cc-hs-title { font-family:var(--stencil, var(--label)); font-size:16px; }
        .cc-hs-meta { font-family:var(--mono); font-size:10.5px; color:var(--ink2); }
        .cc-hs-export { margin-left:auto; }
        .cc-sides { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
        .cc-side { display:flex; flex-direction:column; gap:4px; border:1.2px solid var(--ink2); background:var(--paper); padding:8px 10px; }
        .cc-side.prov { border-style:dashed; }
        .cc-side-title { font-family:var(--stencil, var(--label)); font-size:13px; line-height:1.15; overflow-wrap:anywhere; }
        .cc-side-emp { font-family:var(--type); font-size:13px; font-weight:600; overflow-wrap:anywhere; }
        .cc-prov { font-family:var(--mono); font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--warn, #c2622a); border:1px solid var(--warn, #c2622a); padding:0 4px; margin-left:6px; white-space:nowrap; }
        .cc-side-meta { font-family:var(--mono); font-size:10.5px; color:var(--ink2); }
        .cc-side-blurb { font-family:var(--type); font-size:11.5px; line-height:1.4; color:var(--ink2); }
        .cc-side-role { text-transform:uppercase; letter-spacing:.5px; color:var(--stamp); }
        .cc-side-acts { display:flex; gap:6px; margin-top:2px; flex-wrap:wrap; }
        .cc-emp-line { font-family:var(--type); font-size:12px; color:var(--ink2); text-transform:capitalize; margin-top:2px; }
        @media (max-width:640px) { .cc-sides { grid-template-columns:1fr; } }
        .cc-diff { display:flex; flex-wrap:wrap; align-items:center; gap:12px; border-top:1px dashed var(--ink2); border-bottom:1px dashed var(--ink2); padding:9px 0; margin-bottom:12px; }
        .cc-diff label { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); display:flex; align-items:center; gap:10px; flex:1 1 240px; }
        .cc-diff input[type=range] { flex:1 1 auto; accent-color:var(--stamp); min-height:34px; }
        .cc-diff-lbl { font-family:var(--mono); font-size:12px; font-weight:700; color:var(--ink); }
    `],
})
export class ChaosContractsComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);
    private readonly missionTree = inject(MissionTreeService);
    private readonly catalog = inject(HotSpotsCatalogService);
    // HSFORGE-1 — instantiate the Forge with the tab (its constructor installs the opt-in __hsforge dev
    // seam; NOTHING else here reads it — the board consumes forged content through the catalog merge only).
    private readonly hsForge = inject(HsForgeService);
    protected readonly neg = inject(NegotiationService);
    protected readonly table = inject(TableModeService);

    /** The campaign's hotspot-era tag. eraTag()'s terminal bucket is 'dark-age' (year>3080) and never returns
     *  'ilclan', so ilClan (year≥3151) is resolved explicitly to match the ilClan packs. // DECISION */
    private readonly campaignEra = computed(() => {
        const y = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3151;
        return y >= 3151 ? 'ilclan' : eraTag(y);
    });
    protected readonly hotSpots = computed(() => this.catalog.hotSpotCatalog(this.campaignEra(), this.state.hsRegion())); // the eligible CHAMBER
    /** ERA-1 — the era's display name for the empty-chamber state (the wizard card's name; the chamber tag as a fallback). */
    protected readonly eraDisplayName = computed(() => this.state.era()?.name ?? this.campaignEra());
    /** HSFORGE-1 P2 — the theater's display name for the board header (null theater → no line). */
    protected readonly theaterName = computed(() => {
        const id = this.state.hsRegion();
        if (!id) return null;
        return this.forgeRegions().find((r) => r.id === id)?.name ?? id;
    });
    private readonly forgeRegions = signal<ForgeRegion[]>([]);

    protected readonly rerollSp = HOTSPOT_REROLL_SP;
    protected readonly offerHotspots = computed(() => {
        const all = this.offerPool();
        if (this.state.hotSpotShowAll()) return all;
        const ids = this.state.hotSpotOffer() ?? [];
        return ids.map((id) => all.find((h) => h.id === id)).filter((h): h is (typeof all)[number] => !!h);
    });
    protected readonly showAll = this.state.hotSpotShowAll;
    //    deals / show-all / reroll draw from the NON-capstone chamber; once begun, the board deals ONLY the capstone(s)
    //    (and reroll is off). This is the single filter that keeps the authored capstones out of normal play. HS-only.
    protected readonly reckoningBegun = this.state.reckoningBegun;
    protected readonly offerPool = computed(() => {
        const pool = this.reckoningBegun() ? this.hotSpots().filter((h) => h.capstone) : this.hotSpots().filter((h) => !h.capstone);
        // ORDER-15 (a) — a House-affiliated command is dealt only hot spots with a side that HIRES it; a mercenary command (the
        // default, and every older save) sees the pool verbatim (hirableSides === resolveSides for it).
        const aff = this.state.commandFaction();
        return aff && aff !== 'Mercenary' ? pool.filter((h) => hirableSides(h, aff).length > 0) : pool;
    });
    /** P2 review BLOCKER fix — the endgame only exists where a capstone is REACHABLE in this chamber
     *  (capstones are authored ilClan/draconis-march only; a forge-served era or another theater has
     *  none — offering the Reckoning there dealt an empty board). */
    protected readonly hasCapstones = computed(() => this.hotSpots().some((h) => h.capstone));
    protected toggleShowAll(): void { this.state.setHotSpotShowAll(!this.state.hotSpotShowAll()); void this.store.persistCurrent(); }
    protected canReroll(): boolean { return !this.reckoningBegun() && !this.state.hotSpotShowAll() && (this.state.warchestSP() ?? 0) >= HOTSPOT_REROLL_SP && this.offerPool().length > HOTSPOT_OFFER_SIZE; }
    protected rerollTitle(): string {
        if (this.offerPool().length <= HOTSPOT_OFFER_SIZE) return 'The whole chamber is on offer — nothing to reroll.';
        if ((this.state.warchestSP() ?? 0) < HOTSPOT_REROLL_SP) return `Need ${HOTSPOT_REROLL_SP} SP to reroll the offer.`;
        return `Deal a fresh hand of ${HOTSPOT_OFFER_SIZE} for ${HOTSPOT_REROLL_SP} SP.`;
    }
    /** Deal a hand of ≤5 ids from the chamber, preferring to EXCLUDE `exclude` (backfill from the full set if <5 remain). */
    private dealOffer(exclude: readonly string[] = []): string[] {
        const ids = this.offerPool().map((h) => h.id);
        const ex = new Set(exclude);
        const fresh = shuffle(ids.filter((id) => !ex.has(id)));
        const hand = fresh.slice(0, HOTSPOT_OFFER_SIZE);
        if (hand.length < HOTSPOT_OFFER_SIZE) { for (const id of shuffle(ids)) { if (hand.length >= HOTSPOT_OFFER_SIZE) break; if (!hand.includes(id)) hand.push(id); } } // backfill
        return hand;
    }
    /** ↻ Reroll for SP — a normal ledger-visible Warchest debit + a fresh hand excluding the current one. */
    protected rerollOffer(): void {
        if (!this.canReroll()) return;
        this.warchest.post('Contract reroll — Hot Spots', HOTSPOT_REROLL_SP, 0);
        this.state.setHotSpotOffer(this.dealOffer(this.state.hotSpotOffer() ?? []));
        void this.store.persistCurrent();
    }
    protected beginReckoning(): void {
        if (this.reckoningBegun() || !this.hasCapstones()) return; // P2 — defense in depth: never begin an endgame with no reachable capstone
        if (typeof confirm === 'function' && !confirm("Begin the Reckoning — deal the campaign's FINAL contract? This replaces the normal contract offers with the endgame capstone.")) return;
        this.state.setReckoningBegun(true);
        this.state.setHotSpotOffer(this.dealOffer()); // now the capstone pool (reckoningBegun → offerPool = capstones)
        void this.store.persistCurrent();
    }

    // HSFORGE-1 P2 (ruling D10) — the deal-time top-up latch: tried once per empty-hand boundary; the
    // settled signal re-fires the deal effect when the attempt lands (forged records also re-fire it
    // reactively through the chamber computed). An era the forge can't serve settles at 0 and the board
    // honestly deals whatever authored content exists (possibly nothing — today's behavior).
    private topUpTried = false;
    private readonly topUpSettled = signal(false);

    constructor() {
        void ensureForgeData().then((c) => this.forgeRegions.set(c.regions.regions)).catch(() => { /* header line degrades to the raw id */ });
        // once the chamber has loaded. Stable otherwise: dealt ids persist; re-rolls only on the paid button. HS-only.
        // HSFORGE-1 P2 (ruling D10): when the non-capstone chamber sits BELOW the floor, the Forge tops it up
        // BEFORE the deal (forged content joins authored in the same chamber — internal flag only). A chamber
        // already at/over the floor (e.g. ilClan's authored packs) never triggers the Forge: byte-identical.
        effect(() => {
            const active = this.state.activeChaosContract();
            const offer = this.state.hotSpotOffer() ?? [];
            const showAll = this.state.hotSpotShowAll();
            const chamber = this.hotSpots(); // reactive on the catalog load + era + theater (+ forged records landing)
            const settled = this.topUpSettled(); // reactive: deal once an unsuccessful/partial top-up settles
            untracked(() => {
                if (this.state.campaignSystem() !== 'hotspots' || active || showAll || offer.length > 0) return;
                if (!this.reckoningBegun()) { // the Reckoning deals authored capstones — the Forge never tops it up
                    const pool = chamber.filter((h) => !h.capstone);
                    if (pool.length < HSFORGE_TOPUP_FLOOR) {
                        if (!this.topUpTried) {
                            this.topUpTried = true;
                            void this.hsForge.topUpChamber().finally(() => this.topUpSettled.set(true));
                            return; // deal AFTER the top-up lands/settles (the effect re-fires)
                        }
                        if (!settled) return; // in flight
                    }
                }
                // P2 review BLOCKER fix: gate on the actual HAND, never the chamber — dealing [] from an
                // empty pool (e.g. the Reckoning with zero reachable capstones) wrote a fresh empty array
                // every pass and re-dirtied this effect into an infinite persist loop.
                const hand = this.dealOffer();
                if (hand.length > 0) {
                    this.state.setHotSpotOffer(hand);
                    void this.store.persistCurrent();
                    // Re-arm the top-up latch: it is genuinely once per EMPTY-HAND BOUNDARY (the next
                    // boundary — contract completes, era/theater shifted the chamber — gets a fresh try).
                    this.topUpTried = false;
                    this.topUpSettled.set(false);
                }
            });
        });
        // contract's hotspotId so a headless render proves the draw is an authored hotspot (never Forge), repeated
        // draws differ, capstones are excluded, and the offer board is unaffected.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d124c')) {
            (window as unknown as Record<string, unknown>)['__d124c'] = {
                offer: (): unknown => this.state.hotSpotOffer() ?? [],
                drawn: (): unknown => { const d = this.neg.negotiating(); return d ? { id: d.id, title: d.title, capstone: !!d.capstone, tracks: d.tracks.length, enemy: d.contract.enemyFaction ?? null } : null; },
                activeHotspotId: (): unknown => this.state.activeChaosContract()?.hotspotId ?? null,
                chamberSize: (): unknown => this.hotSpots().length,
                chamberCapstones: (): unknown => this.hotSpots().filter((h) => h.capstone).length,
            };
        }
        // headless render proves capstones are wired into the chamber but excluded from normal deals/reroll, and surface
        // ONLY once the Reckoning is begun. begin() runs the real gate (bypassing the confirm dialog in the harness).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d135')) {
            (window as unknown as Record<string, unknown>)['__d135'] = {
                reckoning: (): unknown => this.reckoningBegun(),
                offer: (): unknown => this.state.hotSpotOffer() ?? [],
                offerCapstones: (): unknown => this.offerHotspots().filter((h) => h.capstone).length,
                offerCount: (): unknown => this.offerHotspots().length,
                poolSize: (): unknown => this.offerPool().length,
                poolCapstones: (): unknown => this.offerPool().filter((h) => h.capstone).length,
                chamberSize: (): unknown => this.hotSpots().length,
                chamberCapstones: (): unknown => this.hotSpots().filter((h) => h.capstone).length,
                canReroll: (): unknown => this.canReroll(),
                begin: (): void => { this.state.setReckoningBegun(true); this.state.setHotSpotOffer(this.dealOffer()); void this.store.persistCurrent(); },
            };
        }
        // in the modal) + its TACTICAL/OpFor values (must be ABSENT) — so a headless render proves the summary shows
        // only who/where/gist and never a track/objective/salvage/fork/complication/victory/behindScenes/named/opfor.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d124e')) {
            (window as unknown as Record<string, unknown>)['__d124e'] = {
                shownId: (): unknown => this.neg.previewHotspot()?.id ?? null,
                shown: (): unknown => { const h = this.neg.previewHotspot(); return h ? { world: h.world, employer: h.employer, enemy: h.contract.enemyFaction, type: h.type, op: h.blurb ?? h.situation } : null; },
                tactical: (): unknown => { const h = this.neg.previewHotspot(); if (!h) return null; return {
                    trackNames: h.tracks.map((t) => t.name),
                    objectives: h.tracks.flatMap((t) => t.objectives.map((o) => o.text)),
                    salvage: h.tracks.map((t) => t.salvagePolicy),
                    forks: h.tracks.flatMap((t) => t.forks.map((f) => f.consequence)),
                    complications: (h.missionBrief.complications || []).map((c) => c.effect),
                    contractVictory: h.missionBrief.contractVictory ?? null,
                    behindScenes: h.missionBrief.behindScenes ?? null,
                    namedChars: (h.missionBrief.namedCharacters || []).map((n) => n.name),
                    opforArms: h.tracks.map((t) => t.opfor.armsMix),
                    opforFactions: h.tracks.map((t) => t.opfor.faction ?? null),
                }; },
            };
        }
        // step math + expose the Back-to-contracts gating, so a headless render proves the three Arthur acceptance
        // tests (Part C), the offer-hand snapshot/restore + Rep/transport effects (Part B), against the live component.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d128')) {
            (window as unknown as Record<string, unknown>)['__d128'] = {
                // C1 helpers (pure book math)
                repCostUp: (col: ContractColumn, from: number): number | null => repCostUp(col, from),
                sacrificeDropTarget: (col: ContractColumn, from: number): number | null => sacrificeDropTarget(col, from),
                // drive the real reducer over an isolated negotiation (bypasses a real hotspot; sets scale + explicit steps)
                begin: (scale: number, steps: Record<ContractColumn, number>): void => {
                    this.neg.scale.set(scale); this.neg.steps.set({ ...steps });
                    this.neg.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 });
                    this.neg.repUsed.set(0); this.neg.sacrificesUsed.set(0);
                },
                setRep: (n: number): void => this.state.setReputation(n),
                setSac: (drop: ContractColumn, raise: ContractColumn): void => { this.neg.sacDrop.set(drop); this.neg.sacRaise.set(raise); },
                canRaise: (col: ContractColumn): boolean => this.neg.canRaise(col),
                repRaise: (col: ContractColumn): void => this.neg.repRaise(col),
                repCost: (col: ContractColumn): number | null => this.neg.repCost(col),
                canSacrifice: (): boolean => this.neg.canSacrifice(),
                doSacrifice: (): void => this.neg.doSacrifice(),
                state: (): unknown => ({ steps: this.neg.steps(), raises: this.neg.raises(), repUsed: this.neg.repUsed(), repBudget: this.neg.repBudget(), scale: this.neg.scale(), sacUsed: this.neg.sacrificesUsed() }),
                // Part A/B — the offer-hand + contract lifecycle (drives the live component methods)
                negotiateHotspot: (id: string): void => { const h = this.hotSpots().find((x) => x.id === id); if (h) this.neg.negotiateHotspot(h); },
                negotiatingId: (): unknown => this.neg.negotiating()?.id ?? null,
                accept: (): void => this.neg.accept(),
                backOut: (): void => this.neg.backOut(),
                canBackOut: (): boolean => this.neg.canBackOut(),
                hasGeneratedTrack: (): boolean => this.missionTree.hasGeneratedTrack(),
                activeSnapshot: (): unknown => this.active()?.offerSnapshot ?? null,
                offer: (): unknown => this.state.hotSpotOffer() ?? [],
                rep: (): number => this.neg.rep(),
                ledgerEvents: (): unknown => (this.state.warchestLedger() ?? []).map((e) => e.event),
            };
        }
        // headless render proves Month X/Y, the advance-month tick (Maintenance + Base Pay per boundary), and the window warning.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d131')) {
            (window as unknown as Record<string, unknown>)['__d131'] = {
                lengthMonths: (): unknown => this.active()?.lengthMonths ?? null,
                monthsElapsed: (): unknown => this.mw.monthsElapsed(),
                monthX: (): unknown => this.mw.monthX(),
                windowMonths: (): unknown => { const c = this.active(); return c ? this.mw.windowMonths(c) : 0; },
                windowElapsed: (): unknown => this.mw.windowElapsed(),
                tracksDone: (): unknown => this.active()?.tracksDone ?? null,
                ledger: (): unknown => (this.state.warchestLedger() ?? []).map((e) => ({ event: e.event, paid: e.paid })),
                advanceMonth: (): void => this.mw.advanceMonth(),
            };
        }
        // accept, and read the active contract's side/employer/enemy + the generated OpFor mulIds — so a headless render
        // proves the two-sided offer pair, the modal header, and OpFor-from-the-opposing-side.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d133')) {
            (window as unknown as Record<string, unknown>)['__d133'] = {
                offerIds: (): unknown => this.offerHotspots().map((h) => h.id),
                sidesFor: (id: string): unknown => { const h = this.hotSpots().find((x) => x.id === id); return h ? this.sideRows(h).map((r) => ({ key: r.side.key, role: r.side.role, employer: r.side.employer, faction: r.side.faction, opposing: r.opposing, synthesized: !!r.side.synthesized })) : null; },
                negotiate: (id: string, side: 'a' | 'b'): void => { const h = this.hotSpots().find((x) => x.id === id); if (h) this.neg.negotiateHotspot(h, side); },
                negSide: (): unknown => this.neg.negSide(),
                negEmployer: (): unknown => this.neg.negSideOffer()?.employer ?? null,
                negOpposing: (): unknown => this.neg.negOpposing(),
                negProvisional: (): unknown => !!this.neg.negSideOffer()?.synthesized,
                accept: (): void => this.neg.accept(),
                activeSide: (): unknown => { const c = this.active(); return c ? { side: c.side ?? null, role: c.sideRole ?? null, employer: c.employer ?? null, enemy: c.enemyFaction ?? null } : null; },
                opforMulIds: (): unknown => (this.state.missionSpec()?.opforForce ?? []).map((u) => u.mulId),
            };
        }
        // (Part A: dropValid/raiseValid/canDrop/canRaiseSac/sacPossible mirror the canSacrifice sub-checks) and the
        // now drives the inline warning), so a headless render proves the sacrifice auto-heal + the warn mechanism.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d136')) {
            (window as unknown as Record<string, unknown>)['__d136'] = {
                // Part B — the fieldable-force Scale gate
                fieldableBv: (): unknown => this.neg.fieldableBv(),
                scaleAvailable: (n: number): unknown => this.neg.scaleAvailable(n),
                scaleNeedBv: (n: number): unknown => this.neg.scaleNeedBv(n),
                maxFieldableScale: (): unknown => this.neg.maxFieldableScale(),
                scale: (): unknown => this.neg.scale(),
                // set a controllable fieldable BV: put it all on the first roster unit (Active), zero the rest (keeps ProtoInstance shape)
                setForceBv: (bv: number): void => { const f = this.state.startingForce() ?? []; if (f.length) this.state.setStartingForce(f.map((u, i) => ({ ...u, bv: i === 0 ? bv : 0, condition: 'Active' }))); },
                negotiate: (id: string): void => { const h = this.hotSpots().find((x) => x.id === id); if (h) this.neg.negotiateHotspot(h); },
                highScaleId: (min: number): unknown => this.hotSpots().find((h) => (h.contract.scale ?? 1) >= min)?.id ?? null,
                hotspotScale: (id: string): unknown => this.hotSpots().find((h) => h.id === id)?.contract.scale ?? null,
                // Part A — the sacrifice control (drives the real signals + reads the mirrored predicates)
                begin: (scale: number, steps: Record<ContractColumn, number>): void => { this.neg.scale.set(scale); this.neg.steps.set({ ...steps }); this.neg.raises.set({ basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 }); this.neg.repUsed.set(0); this.neg.sacrificesUsed.set(0); },
                setSac: (drop: ContractColumn, raise: ContractColumn): void => { this.neg.sacDrop.set(drop); this.neg.sacRaise.set(raise); },
                dropValid: (c: ContractColumn): unknown => this.neg.dropValid(c),
                raiseValid: (c: ContractColumn): unknown => this.neg.raiseValid(c),
                canDrop: (c: ContractColumn): unknown => this.neg.canDrop(c),
                canRaiseSac: (c: ContractColumn): unknown => this.neg.canRaiseSac(c),
                canSacrifice: (): unknown => this.neg.canSacrifice(),
                sacPossible: (): unknown => this.neg.sacPossible(),
                sacReason: (): unknown => this.neg.sacDisabledReason(),
                sacUsed: (): unknown => this.neg.sacrificesUsed(),
                sac: (): unknown => ({ drop: this.neg.sacDrop(), raise: this.neg.sacRaise() }),
                doSacrifice: (): void => this.neg.doSacrifice(),
                stateSteps: (): unknown => ({ steps: this.neg.steps(), raises: this.neg.raises(), scale: this.neg.scale() }),
            };
        }
    }
    protected readonly mw = inject(ContractWindowService);

    protected readonly columns = CONTRACT_COLUMNS;
    protected readonly active = this.state.activeChaosContract;
    // the tree signal, so these computeds re-run as the tree changes (button hides once a track is ACTIVE).
    protected readonly playOpen = signal(false);
    protected readonly firstAvailBranchId = computed(() => this.missionTree.firstAvailableBranch()?.branchId);
    protected readonly canPlayTrack = computed(() => !!this.missionTree.firstAvailableBranch() && !this.missionTree.activeBranch());
    protected sideRows(h: CatalogHotSpot): { side: SideOffer; opposing: string }[] {
        const s = resolveSides(h);
        const rows = [{ side: s.a, opposing: s.b?.faction ?? s.a.contract.enemyFaction }];
        if (s.b) rows.push({ side: s.b, opposing: s.a.faction });
        // ORDER-15 (a) — a House-affiliated command is offered only the sides that hire it (a merc command: both, as today)
        const aff = this.state.commandFaction();
        if (!aff || aff === 'Mercenary') return rows;
        const keys = new Set(hirableSides(h, aff).map((x) => x.key));
        return rows.filter((r) => keys.has(r.side.key));
    }
    /** The I/O panel child — the per-card Export button drives its exportHotspot() through this ref. */
    protected readonly io = viewChild(HotspotIoComponent);

    protected advanceTitle(): string {
        return this.mw.tableBound()
            ? "At a GM's table — the table advances the month; leave the table to advance your own."
            : 'Advance the campaign one month — pays maintenance, collects base pay';
    }
    protected leaveTable(): void {
        if (!this.state.tableBound()) return;
        this.state.setTableBound(null);
        void this.store.persistCurrent();
    }

    protected endContract(): void {
        if (!this.active()) return;
        const off = this.state.acceptedContract();
        this.state.setReputation((this.state.reputation() ?? 1) + 1);
        const cc = this.state.activeChaosContract();
        if (cc) this.state.setCompletedChaosContract(contractSummaryOf({ ...cc, status: 'completed' })); // PD3 P2 — the terminal record, BEFORE the null
        this.state.setActiveChaosContract(null);
        this.state.setAcceptedContract(null);
        this.state.clearParticipantContracts();
        this.missionTree.closeTree(off ?? undefined);
        void this.store.persistCurrent();
    }
}
