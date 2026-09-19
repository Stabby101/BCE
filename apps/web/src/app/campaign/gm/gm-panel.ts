import { Component, ChangeDetectionStrategy, computed, effect, inject, output, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ContractWindowService } from '../chaos/contract-window.service';
import { HotSpotsCatalogService, resolveSides, type CatalogHotSpot } from '../chaos/hotspots-catalog';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { eraTag } from '../mission/forge-select';
import { TableModeService } from './table-mode.service';
import { buildPresentedBrief } from './presented-hotspot';
import { anonIdWeb } from './side-labels';
import type { ProtoInstance } from '../force/force-generator';
import { TrackPickerComponent } from '../chaos/track-picker';
import { JoinLinkComponent } from '../claims/join-link';
import { NegotiationService } from '../chaos/negotiation.service';
import { GM_NEGOTIATION_HOST_PROVIDER } from '../chaos/negotiation-host-gm';
import { NegotiateModalComponent } from '../chaos/negotiate-modal';
import { resolved, isSessionContract, participantSideFor, GM_SELF_KEY, type ChaosContract } from '../chaos/chaos-contract';

@Component({
    selector: 'bce-gm-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TrackPickerComponent, JoinLinkComponent, NegotiateModalComponent],
    providers: [NegotiationService, GM_NEGOTIATION_HOST_PROVIDER],
    template: `
        <div class="gmp">
            <section class="gmp-sec" data-testid="gm-join">
                <div class="gmp-h">Session join &middot; before any track</div>
                <bce-join-link [gated]="false" door="session" />
                <p class="gmp-note">Players scan this to join the <b>session</b> now — no track needed. They see nothing until you Present a hot spot, then the brief and a side pick; when a track deploys they land on their assigned side. The Lobby tab's QR is the same link, gated until a track is deployed.</p>
            </section>

            <!-- ── TABLE MODE — the projection lock ── -->
            <section class="gmp-sec">
                <div class="gmp-h">Table mode</div>
                <button type="button" class="gmp-toggle" [class.on]="table.raw()" (click)="table.toggle()" data-testid="gm-table-mode"
                        title="Blank the GM-only surfaces (offer board, OpFor builder, resolve) from this screen so it can be projected">
                    {{ table.raw() ? '■ TABLE MODE ON — GM surfaces hidden on this screen' : '□ Table mode off — full GM view' }}
                </button>
                <p class="gmp-note">Device-local: it blanks the offer board, the OpFor builder, and resolve on <b>this screen only</b> — project it without leaking. Your other devices keep the full view.</p>
            </section>

            <!-- ── P2 · PRESENT — publish ONE hotspot's player-safe brief to every joined device ── -->
            <section class="gmp-sec">
                <div class="gmp-h">Present a hot spot</div>
                @if (presented(); as p) {
                    <div class="gmp-presented" data-testid="gm-presented">
                        <span class="gmp-tag on">PRESENTED</span> <b>{{ p.title }}</b> &middot; {{ p.world }}
                        <button type="button" class="gmp-btn" (click)="retract()" data-testid="gm-retract">{{ sessionContract() ? 'Retract (un-present)' : 'Retract' }}</button>
                    </div>
                    @if (sessionContract(); as sc) {
                        <div class="gmp-session" data-testid="gm-session-contract">
                            <span class="gmp-tag on">SESSION CONTRACT</span> Scale {{ sc.scale }} &middot; {{ sc.intensity }} track{{ sc.intensity === 1 ? '' : 's' }} &middot; {{ sc.lengthMonths ?? sc.intensity }} month window &middot; side {{ (sc.side ?? 'a').toUpperCase() }} for {{ sc.employer }} vs {{ sc.enemyFaction }} &middot; {{ sc.tracksDone }} resolved
                        </div>
                        <p class="gmp-note">The table's contract — the hot spot's authored terms, nobody's signature. Every joined company negotiates its own terms against it and is paid by them; you are not a party (field your own company to sign one like anyone). Retract un-presents: every signed company is told and any rep a slip settled comes back to it.</p>
                    } @else {
                        <p class="gmp-note">Every joined player device shows this brief (both sides, name-only enemy). Presenting another replaces it; Retract clears it.</p>
                    }
                } @else {
                    <p class="gmp-note">Nothing presented — the players' devices show no contract. Present one to put its player-safe brief on every joined device and mint the session contract from its authored terms.</p>
                }
                @if (pendingReplace(); as ph) {
                    <div class="gmp-confirm" data-testid="gm-replace-confirm">
                        <p class="gmp-note">Replace the session contract with <b>{{ ph.title }}</b>? {{ signerCount() }} signed compan{{ signerCount() === 1 ? 'y' : 'ies' }} will be voided — each is told and its spent rep refunded.</p>
                        <button type="button" class="gmp-btn go" (click)="confirmReplace()" data-testid="gm-replace-confirm-yes">Replace &amp; void</button>
                        <button type="button" class="gmp-btn" (click)="cancelReplace()" data-testid="gm-replace-confirm-no">Keep the current</button>
                    </div>
                }
                @if (offerList().length) {
                    <div class="gmp-offers">
                        @for (h of offerList(); track h.id) {
                            <div class="gmp-offer" [class.live]="presented()?.id === h.id">
                                <span class="gmp-ow">{{ h.world }}</span>
                                <span class="gmp-ot">{{ h.title }}</span>
                                <span class="gmp-om">{{ h.type }} &middot; Scale {{ h.contract.scale }}</span>
                                @if (presented()?.id === h.id) {
                                    <span class="gmp-tag on">✓ live</span>
                                } @else {
                                    @if (hasSideB(h)) {
                                        <span class="gmp-side-pick" data-testid="gm-present-side">
                                            <button type="button" class="gmp-btn sm" [class.on]="presentSide() === 'a'" (click)="presentSide.set('a')" data-testid="gm-present-side-a">A</button>
                                            <button type="button" class="gmp-btn sm" [class.on]="presentSide() === 'b'" (click)="presentSide.set('b')" data-testid="gm-present-side-b">B</button>
                                        </span>
                                    }
                                    <button type="button" class="gmp-btn go" (click)="present(h)" data-testid="gm-present">Present &#9656;</button>
                                }
                            </div>
                        }
                    </div>
                } @else {
                    <p class="gmp-note">The offer hand is empty — deal or Show-all on the Contracts board first.</p>
                }
            </section>

            <!-- ── P2 · SIDE PREFERENCES — advisory picks fanned live from the joined players ── -->
            <section class="gmp-sec">
                <div class="gmp-h">Side preferences</div>
                @if (players().length) {
                    <div class="gmp-players" data-testid="gm-side-prefs">
                        @for (p of players(); track p.token) {
                            <div class="gmp-player">
                                <span class="gmp-dot" [class.on]="p.connected">●</span>
                                <span class="gmp-pn">{{ p.name || 'Player' }}</span>
                                <span class="gmp-pref" [attr.data-pref]="p.sidePref ?? ''">{{ prefLabel(p.sidePref) }}</span>
                                <!-- panel finding: assigning a DISCONNECTED device is silently undone by its
                                     reconnect re-announce (join-lobby carries the stale local side) — so the
                                     buttons disable on a red dot; assign when the player is actually there. -->
                                <span class="gmp-assign">
                                    <button type="button" class="gmp-btn sm" [class.on]="p.side === 'BLUFOR'" [disabled]="!p.connected" (click)="assign(p.token, 'BLUFOR')" data-testid="gm-assign-a" [title]="p.connected ? 'Assign to side A (BLUFOR)' : 'Player disconnected — a reconnect would undo the assignment'">A</button>
                                    <button type="button" class="gmp-btn sm" [class.on]="p.side === 'OPFOR'" [disabled]="!p.connected" (click)="assign(p.token, 'OPFOR')" data-testid="gm-assign-b" [title]="p.connected ? 'Assign to side B (OPFOR)' : 'Player disconnected — a reconnect would undo the assignment'">B</button>
                                </span>
                            </div>
                        }
                    </div>
                    <p class="gmp-note">Preferences are advisory; A/B assigns the side (defaults from preference are yours to apply). Players land on their assigned side automatically.</p>
                } @else {
                    <p class="gmp-note">No players joined yet — they scan the session QR at the top of this tab.</p>
                }
            </section>

            <!-- ── P3 · PLAYER COMPANIES — the join-with-force cap + who brought what ── -->
            <section class="gmp-sec">
                <div class="gmp-h">Player companies</div>
                <div class="gmp-cap">
                    <span>Units per player</span>
                    <button type="button" class="gmp-btn" (click)="bumpCap(-1)" data-testid="gm-cap-down" [disabled]="cap() <= 1">−</button>
                    <span class="gmp-tag" data-testid="gm-cap-value">{{ cap() }}</span>
                    <button type="button" class="gmp-btn" (click)="bumpCap(1)" data-testid="gm-cap-up" [disabled]="cap() >= 24">+</button>
                </div>
                <p class="gmp-note">Players bring up to this many of their own machines at join (default lance of 4). Enforced server-side at import.</p>
                @if (referee(); as r) {
                    <div class="gmp-referee" data-testid="gm-referee">Fielding OpFor only &middot; {{ r.companies }} compan{{ r.companies === 1 ? 'y' : 'ies' }} on side A</div>
                    <p class="gmp-note">You have fielded nothing of your own — side A is the joined companies, and the OpFor is sized to what they deployed. Field your own company on the dashboard to play alongside them.</p>
                }
                @if (importedUnits().length) {
                    <div class="gmp-imports" data-testid="gm-imports">
                        @for (u of importedUnits(); track u.instanceId) {
                            <div class="gmp-import"><span class="gmp-bn">{{ u.chassis }} {{ u.model }}</span> <span class="gmp-om">{{ u.tons }}t &middot; {{ u.bv }} BV &middot; brought by a player</span></div>
                        }
                    </div>
                }
            </section>

            @if (companies().length || ownFielded()) {
            <section class="gmp-sec" data-testid="gm-contracts">
                <div class="gmp-h">Player contracts</div>
                @if (!state.activeChaosContract()) {
                    <p class="gmp-note">Present a hot spot first — the session contract is minted from its authored terms, and each company then negotiates its own terms against it.</p>
                }
                @if (ownFielded()) {
                    <div class="gmp-company" [attr.data-key]="selfKey" data-testid="gm-company">
                        <div class="gmp-co-head"><span class="gmp-bn">Your company</span> <span class="gmp-om">fielded &middot; Rep {{ state.reputation() ?? 1 }}</span></div>
                        @if (state.participantContracts()[selfKey]; as pc) {
                            <div class="gmp-co-terms" data-testid="gm-company-terms"><span data-testid="gm-company-signed">Your own contract</span> &middot; {{ termsLine(pc) }}</div>
                            <div class="gmp-co-actions">
                                <button type="button" class="gmp-btn" (click)="negotiateSelf()" [disabled]="!primaryHotspot()" data-testid="gm-negotiate">Renegotiate &#9656;</button>
                                <button type="button" class="gmp-btn" (click)="release(selfKey)" data-testid="gm-release">Release</button>
                            </div>
                        } @else {
                            <div class="gmp-co-terms muted" data-testid="gm-company-terms">&mdash; no contract of your own: your fielded units are paid nothing until you sign one</div>
                            <div class="gmp-co-actions">
                                <button type="button" class="gmp-btn go" (click)="negotiateSelf()" [disabled]="!primaryHotspot() || !sessionContract()" data-testid="gm-negotiate">Negotiate &#9656;</button>
                            </div>
                        }
                    </div>
                }
                @for (co of companies(); track co.key) {
                    <div class="gmp-company" [attr.data-key]="co.key" data-testid="gm-company">
                        <div class="gmp-co-head"><span class="gmp-bn">{{ co.label }}</span> <span class="gmp-om">{{ co.units.length }} machine{{ co.units.length === 1 ? '' : 's' }} &middot; {{ co.side === 'OPFOR' ? 'side B' : 'side A' }}@if (co.rep !== null) { &middot; Rep {{ co.rep }} }</span></div>
                        @if (state.participantContracts()[co.key]; as pc) {
                            <div class="gmp-co-terms" data-testid="gm-company-terms"><span data-testid="gm-company-signed">{{ pc.signedBy === 'player' ? 'Signed by the player' : 'Brokered by the GM' }}</span> &middot; {{ termsLine(pc) }}</div>
                            <div class="gmp-co-actions">
                                <button type="button" class="gmp-btn" (click)="negotiateFor(co)" [disabled]="!primaryHotspot()" data-testid="gm-negotiate">Renegotiate &#9656;</button>
                                <button type="button" class="gmp-btn" (click)="release(co.key)" data-testid="gm-release">Release</button>
                            </div>
                        } @else {
                            <div class="gmp-co-terms muted" data-testid="gm-company-terms">{{ unsignedCopy() }}</div>
                            <div class="gmp-co-actions">
                                <button type="button" class="gmp-btn go" (click)="negotiateFor(co)" [disabled]="!primaryHotspot()" data-testid="gm-negotiate">Negotiate &#9656;</button>
                            </div>
                        }
                    </div>
                }
                <p class="gmp-note">A company with its own contract is paid by ITS terms at resolve (its Scale &times; the tier, its salvage %) and its slip carries that figure; the others take the team share. A company's terms never reach another device.</p>
            </section>
            }
            <div class="cc-scope"><bce-negotiate-modal /></div>

            <section class="gmp-sec">
                <div class="gmp-h">The clock</div>
                @if (active(); as c) {
                    <span class="gmp-tag" [class.warn]="mw.windowElapsed()" data-testid="gm-month-tag">Month {{ mw.monthX() }} / {{ mw.windowMonths(c) }}@if (mw.windowElapsed()) { &middot; window elapsed }</span>
                    <button type="button" class="gmp-btn" (click)="mw.advanceMonth()" data-testid="gm-advance-month"
                            title="Advance the campaign one month — pays maintenance, collects base pay">&#9656; Advance a month</button>
                    @if (mw.sessionClockNotice(); as n) { <p class="gmp-note gmp-clock-notice" role="status" data-testid="gm-clock-notice">{{ n }}</p> }
                } @else {
                    <p class="gmp-note">No active contract — the month window starts when a contract is signed.</p>
                }
            </section>

            <section class="gmp-sec">
                <div class="gmp-h">Tracks</div>
                @if (availableBranches().length) {
                    @for (br of availableBranches(); track br.branchId) {
                        <div class="gmp-branch">
                            <span class="gmp-bn">{{ br.name }}</span>
                            <bce-track-picker [branchId]="br.branchId" />
                        </div>
                    }
                } @else {
                    <p class="gmp-note">No open operation — sign a contract, then pick or generate its track here.</p>
                }
            </section>

            <section class="gmp-sec">
                <div class="gmp-h">OpFor / Side B</div>
                <button type="button" class="gmp-btn" (click)="jump.emit({ tab: 'lobby' })" data-testid="gm-opfor-entry"
                        title="The manual OpFor builder sits on the Lobby claim board ">&#9876; Build / Edit OpFor &mdash; on the Lobby board &rsaquo;</button>
                <button type="button" class="gmp-btn" [disabled]="!canSeedSideB()" (click)="seedSideBFromPlayers()" data-testid="gm-seed-side-b"
                        [title]="canSeedSideB() ? 'Replace the OpFor with the side-B imported units (A-vs-B)' : 'Needs a generated track + side-B players with imported units'">
                    &#8646; Side B = the side-B players&rsquo; units
                </button>
                @if (sideBSeeded()) { <span class="gmp-tag on" data-testid="gm-side-b-seeded">✓ side B is player-seeded</span> }
                @if (seedNote(); as n) { <span class="gmp-note" data-testid="gm-seed-note">{{ n }}</span> }
                <p class="gmp-note">Default = GM OpFor (Generate / the builder — "still have the option"). The swap moves the side-B players' machines across (they leave side A's roster as RESERVE); revert via the OpFor builder or a re-generate — then re-deploy the reserved units on the roster.</p>
            </section>
        </div>
    `,
    styles: [`
        .gmp { display:flex; flex-direction:column; gap:16px; }
        .gmp-sec { border:1px solid var(--rule, #b9b09b); padding:12px 14px; background:var(--paper2, #f4efe2); }
        .gmp-h { font-weight:700; font-size:12px; letter-spacing:1.4px; text-transform:uppercase; margin-bottom:8px; color:var(--ink2, #4a4436); }
        .gmp-toggle { font:inherit; font-weight:700; padding:9px 13px; border:1.6px solid #8a6410; background:transparent; cursor:pointer; }
        .gmp-toggle.on { background:#8a6410; color:#fff; }
        .gmp-btn { font:inherit; padding:7px 12px; border:1px solid var(--rule, #b9b09b); background:transparent; cursor:pointer; }
        .gmp-btn.go { border-color:#3a6f3a; color:#3a6f3a; font-weight:700; }
        .gmp-btn.sm { padding:3px 9px; font-size:12px; }
        .gmp-btn.sm.on { background:#3a6f3a; color:#fff; border-color:#3a6f3a; }
        .gmp-assign { display:inline-flex; gap:4px; margin-left:auto; }
        .gmp-btn:hover, .gmp-toggle:hover { filter:brightness(.95); }
        .gmp-tag { display:inline-block; font-size:12px; border:1px solid var(--rule, #b9b09b); padding:2px 8px; margin-right:10px; }
        .gmp-tag.warn { border-color:#a33; color:#a33; }
        .gmp-tag.on { border-color:#3a6f3a; color:#3a6f3a; font-weight:700; }
        .gmp-note { font-size:12px; color:var(--ink2, #4a4436); margin:6px 0 0; line-height:1.5; }
        .gmp-clock-notice { color:var(--ink, #2b2720); font-weight:700; }
        .gmp-branch { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:6px 0; }
        .gmp-bn { font-weight:600; }
        .gmp-presented { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
        .gmp-session { font-size:12.5px; margin:4px 0 6px; line-height:1.5; }
        .gmp-side-pick { display:inline-flex; gap:4px; margin-right:6px; }
        .gmp-offers { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
        .gmp-offer { display:flex; flex-wrap:wrap; align-items:center; gap:10px; border:1px solid var(--rule, #b9b09b); padding:7px 10px; }
        .gmp-offer.live { border-color:#3a6f3a; }
        .gmp-ow { font-weight:700; }
        .gmp-om { font-size:12px; color:var(--ink2, #4a4436); }
        .gmp-cap { display:flex; align-items:center; gap:10px; }
        .gmp-imports { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
        .gmp-import { font-size:13px; }
        .gmp-referee { font-family:var(--label); font-weight:600; letter-spacing:1.2px; text-transform:uppercase; font-size:11.5px; color:var(--stamp); margin:6px 0 2px; }
        .gmp-company { border:1.3px solid var(--rule, #b9ab8f); border-radius:6px; padding:8px 10px; margin-top:8px; }
        .gmp-co-head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
        .gmp-co-terms { font-family:var(--mono); font-size:12px; margin:6px 0; }
        .gmp-co-terms.muted { color:var(--ink2, #6b6252); font-family:var(--type); font-style:italic; }
        .gmp-co-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .gmp-players { display:flex; flex-direction:column; gap:4px; }
        .gmp-player { display:flex; align-items:center; gap:10px; }
        .gmp-dot { color:#a33; } .gmp-dot.on { color:#3a6f3a; }
        .gmp-pn { font-weight:600; min-width:120px; }
        .gmp-pref { font-size:12px; border:1px solid var(--rule, #b9b09b); padding:1px 8px; }
        .gmp-pref[data-pref='a'], .gmp-pref[data-pref='b'] { border-color:#3a6f3a; color:#3a6f3a; font-weight:700; }
    `],
})
export class GmPanelComponent {
    protected readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly catalog = inject(HotSpotsCatalogService);
    protected readonly rt = inject(ClaimRealtimeService);
    protected readonly mw = inject(ContractWindowService);
    protected readonly table = inject(TableModeService);

    /** Navigation home — the dashboard owns tab routing (goToStep). */
    readonly jump = output<{ tab: string; sub?: string }>();

    constructor() {
        // claim room like lobby-panel does — the GM may never open the Lobby tab. Idempotent (same socket,
        // same room as the panels; observeLobby brings in the roster/presence fan).
        effect(() => {
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) { this.rt.ensure(id, key); this.rt.observeLobby(); }
        });
    }

    protected readonly active = this.state.activeChaosContract;
    protected readonly availableBranches = computed(() => (this.state.missionTree() ?? []).filter((b) => b.state === 'AVAILABLE'));
    protected readonly presented = this.state.presentedHotspot;
    protected readonly players = this.rt.lobby;

    // P2 — the offer list, mirrored from ROOT state/catalog (the tab's computeds are tab-provided; this panel
    // must not depend on the Contracts tab being mounted). Same chamber, same capstone gate, same dealt-hand
    // resolution as chaos-contracts-tab (stale ids silently drop).
    private readonly campaignEra = computed(() => {
        const y = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3151;
        return y >= 3151 ? 'ilclan' : eraTag(y);
    });
    private readonly chamber = computed(() => this.catalog.hotSpotCatalog(this.campaignEra(), this.state.hsRegion()));
    private readonly pool = computed(() => this.state.reckoningBegun() ? this.chamber().filter((h) => h.capstone) : this.chamber().filter((h) => !h.capstone));
    protected readonly offerList = computed<CatalogHotSpot[]>(() => {
        const all = this.pool();
        if (this.state.hotSpotShowAll()) return all;
        const ids = this.state.hotSpotOffer() ?? [];
        return ids.map((id) => all.find((h) => h.id === id)).filter((h): h is CatalogHotSpot => !!h);
    });

    // ── P3 — the join-with-force cap + the imported roster readout ──
    protected readonly cap = computed(() => this.state.playerUnitCap() ?? 4);

    //    by the lobby player whose device brought them (provenance.owner ↔ anonIdWeb(lobby token), the P4 mapping). ──
    protected readonly neg = inject(NegotiationService);
    private readonly anonByToken = signal<Record<string, string>>({});
    private readonly anonFill = effect(() => {
        const lobby = this.rt.lobby();
        void Promise.all(lobby.map(async (p) => [p.token, await anonIdWeb(p.token)] as const)).then((pairs) => this.anonByToken.set(Object.fromEntries(pairs)));
    });
    protected readonly companies = computed(() => {
        const byKey = new Map<string, { key: string; units: ProtoInstance[]; owner: string | null; rep: number | null }>();
        for (const u of this.importedUnits()) {
            const key = u.provenance?.sourceCampaignId;
            if (!key) continue; // a pre-P1 import carries no home id → it has no contract of its own (the team share)
            const e = byKey.get(key) ?? { key, units: [], owner: u.provenance?.owner ?? null, rep: u.provenance?.homeReputation ?? null };
            e.units.push(u); byKey.set(key, e);
        }
        const anon = this.anonByToken(); const lobby = this.rt.lobby();
        return [...byKey.values()].map((e) => {
            const p = lobby.find((l) => anon[l.token] === e.owner);
            return { ...e, label: p ? `${p.name}'s company` : `Company ${e.key}`, side: p?.side ?? 'BLUFOR' };
        });
    });
    protected readonly referee = computed(() => {
        if (!this.state.gmSession()) return null;
        const own = (this.state.startingForce() ?? []).filter((u) => u.provenance?.origin !== 'player-import');
        if (own.some((u) => u.condition === 'Deployed')) return null;
        const n = this.companies().length;
        return n ? { companies: n } : null;
    });
    /** The primary's hot spot (the shared track's) — every participant contract is negotiated on it. */
    protected readonly primaryHotspot = computed(() => {
        const id = this.state.activeChaosContract()?.hotspotId;
        return id ? this.chamber().find((h) => h.id === id) ?? null : null;
    });
    protected negotiateFor(co: { key: string; label: string; side: string; rep: number | null }): void {
        const h = this.primaryHotspot(); const c = this.state.activeChaosContract();
        if (!h || !c) return;
        const side = participantSideFor(c, co.side);
        this.neg.negotiateForParticipant(h, side, { key: co.key, label: co.label }, co.rep, c.steps.command); // P2b — THEIR rep; Command locked to the primary's
    }
    protected readonly selfKey = GM_SELF_KEY;
    protected readonly presentSide = signal<'a' | 'b'>('a');
    protected readonly sessionContract = computed(() => { const c = this.state.activeChaosContract(); return c && isSessionContract(c) ? c : null; });
    protected hasSideB(h: CatalogHotSpot): boolean { return !!resolveSides(h).b; }
    /** A company with no contract of its own: on a session contract it is paid NOTHING (the table's rule); on a GM-signed primary the team share (P1). */
    protected unsignedCopy(): string {
        return this.sessionContract() ? '— no contract signed: paid nothing until it signs its own terms on the session contract' : "— pays by the session's primary terms (the team share)";
    }
    /** The GM fielded units of his own (deployed, not player-imports) — the referee state's inverse: he is one more participant. */
    protected readonly ownFielded = computed(() => !!this.sessionContract() && (this.state.startingForce() ?? []).some((u) => u.provenance?.origin !== 'player-import' && u.condition === 'Deployed'));
    protected negotiateSelf(): void {
        const h = this.primaryHotspot(); const c = this.state.activeChaosContract();
        if (!h || !c || !isSessionContract(c)) return;
        this.neg.negotiateForParticipant(h, c.side ?? 'a', { key: GM_SELF_KEY, label: 'Your company' }, this.state.reputation() ?? 1, c.steps.command);
    }
    protected release(key: string): void { this.state.setParticipantContract(key, null); void this.store.persistCurrent(); }
    protected termsLine(c: ChaosContract): string {
        const t = resolved(c.steps);
        return `Scale ${c.scale} · Base pay ${t.basePay}% · Salvage ${typeof t.salvage === 'number' ? `${t.salvage}%` : t.salvage} · Support ${t.support} · Transport ${t.transport}% · Command ${t.command}`;
    }
    protected readonly importedUnits = computed(() => (this.state.startingForce() ?? []).filter((u) => u.provenance?.origin === 'player-import'));
    protected bumpCap(d: number): void {
        this.state.setPlayerUnitCap(Math.max(1, Math.min(24, this.cap() + d)));
        void this.store.persistCurrent(); // top-level field → the fan carries it to every player device
    }

    protected readonly pendingReplace = signal<CatalogHotSpot | null>(null);
    protected readonly signerCount = computed(() => Object.keys(this.state.participantContracts()).length);
    protected present(h: CatalogHotSpot): void {
        const cur = this.sessionContract();
        if (cur?.hotspotId === h.id) return; // already the presented session contract
        if (cur && this.signerCount() > 0) { this.pendingReplace.set(h); return; }
        this.doPresent(h);
    }
    protected confirmReplace(): void { const h = this.pendingReplace(); this.pendingReplace.set(null); if (h) this.doPresent(h); }
    protected cancelReplace(): void { this.pendingReplace.set(null); }
    private doPresent(h: CatalogHotSpot): void {
        const cur = this.sessionContract();
        // consumed by the devices); a REPLACE (cur exists) keeps unpresentSession's new voids so the voided devices are told.
        if (!cur) this.state.setVoidedContracts({});
        // tree closed (hook 5) — then the new one is minted. A GM-signed primary (pre-P1) is left alone (presentSession refuses).
        if (cur) this.neg.unpresentSession();
        this.state.setPresentedHotspot(buildPresentedBrief(h, Date.now()));
        // and starts the tree (hook 1).
        this.neg.presentSession(h, this.presentSide());
        void this.store.persistCurrent(); // → the debounced PUT → changes$ → the per-recipient campaign fan
    }
    protected retract(): void {
        // and refunded its settled rep; no rep dock, no transport, the tree discarded. A plain presentation just clears.
        if (this.sessionContract()) { this.neg.unpresentSession(); return; }
        this.state.setPresentedHotspot(null);
        void this.store.persistCurrent();
    }
    protected prefLabel(p: string | null | undefined): string {
        return p === 'a' ? 'Side A' : p === 'b' ? 'Side B' : '— no pick yet';
    }

    protected assign(token: string, side: 'BLUFOR' | 'OPFOR'): void { this.rt.reassign(token, side); } // GM-only server-side; the fan lands it
    /** Side-B players' IMPORTED units (provenance.owner ↔ lobby token via the web anonId). */
    private async sideBUnits(): Promise<ProtoInstance[]> {
        const sideB = this.rt.lobby().filter((p) => p.side === 'OPFOR');
        const anons = new Set(await Promise.all(sideB.map((p) => anonIdWeb(p.token))));
        return (this.state.startingForce() ?? []).filter((u) => u.provenance?.origin === 'player-import' && !!u.provenance.owner && anons.has(u.provenance.owner));
    }
    protected readonly canSeedSideB = computed(() =>
        !!this.state.missionSpec() && this.rt.lobby().some((p) => p.side === 'OPFOR') && (this.state.startingForce() ?? []).some((u) => u.provenance?.origin === 'player-import'));
    protected readonly sideBSeeded = computed(() => (this.state.missionSpec()?.opforForce ?? []).some((u) => u.provenance?.origin === 'player-import'));
    protected readonly seedNote = signal<string | null>(null); // panel finding: the enabled button must never silently no-op
    protected async seedSideBFromPlayers(): Promise<void> {
        const spec = this.state.missionSpec();
        if (!spec || !this.canSeedSideB()) return;
        this.seedNote.set(null);
        const units = await this.sideBUnits();
        if (!units.length) { this.seedNote.set('The side-B players have no imported units — assign an importer to side B first.'); return; }
        const ids = new Set(units.map((u) => u.instanceId));
        const opforForce = units.map((u) => ({ ...u }));
        const opforBv = opforForce.reduce((a, b) => a + (b.bv ?? 0), 0);
        this.state.setMissionSpec({ ...spec, opforForce, opforBv, opforManual: true }); // P3-fold — a hand-chosen OpFor clears the empty-field witness
        this.state.setStartingForce((this.state.startingForce() ?? []).map((u) => ids.has(u.instanceId) ? { ...u, condition: 'Reserve' } : u));
        void this.store.persistCurrent();
    }
}
