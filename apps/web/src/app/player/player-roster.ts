/*
 * BCE PLAYER — SIDE ROSTER (DIRECTIVE-048, phase A). After JOIN: the force for YOUR side, and only
 * yours (ROLE-002 — side gates visibility). BLUFOR sees the deployed company (deployedSet, D-027);
 * OPFOR sees the mission's OpFor (missionSpec.opforForce, D-046). Tap a unit to CLAIM it; the host
 * fans the claim to every device (D-042) so two players never grab the same 'Mech, and the GM watches
 * it fill in. Claim/release lock when no engagement is ACTIVE (frozen — mirrors the GM panel). This is
 * the Phase A surface; Phase B explodes a claimed unit into its live battle sheet. Campaign-layer only.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { PlayerSessionService } from './player-session.service'; // ORDER-3 H17 — the retained-view flag
import { deployedSet } from '../campaign/force/deployed';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { engagementKeyOf, engagementFrozen } from '../campaign/claims/engagement-key';
import { evictAndReload } from '../shared/app-reset';
import type { ProtoInstance } from '../campaign/force/force-generator';
import { PresentedBriefComponent } from './player-presented'; // GM-1 P2 — the GM-presented brief + side preference
import { ResultsSlipComponent } from './player-results'; // GM-1 P3 — the take-home resolve record
import { sideLabelsOf, anonIdWeb } from '../campaign/gm/side-labels'; // GM-1 P4 — SIDE A/B display names · GM-3 P3 — my token → provenance.owner
import { formatDate } from '../campaign/clock/campaign-clock'; // GM-3 P1 (S36) — the session date field
import { SessionNoticeComponent } from './session-notice'; // GM-3 P0 — the session-clock notice

@Component({
    selector: 'bce-player-roster',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [PresentedBriefComponent, ResultsSlipComponent, SessionNoticeComponent], // GM-1 P2 · P3 · GM-3 P0
    template: `
        <div class="ros" [class.blu]="side() === 'BLUFOR'" [class.opf]="side() === 'OPFOR'">
            <header class="rhead">
                <!-- GM-1 P4 — the SIDE A/B name in a gmSession; plain campaigns keep BLUFOR/OPFOR -->
                <div class="rside">{{ sideHeader() }}</div>
                <div class="rwho">{{ name() || 'Player' }}</div>
                <div class="rconn" [class.on]="registered()">{{ registered() ? '● live' : connected() ? '● registering…' : '○ offline' }}</div>
                @if (heldCount() > 0) {
                    <button type="button" class="rsheet" (click)="toSheet()">My Sheet ({{ heldCount() }}) ›</button>
                }
                <!-- ODM-18 P1 — the company console (ODM campaigns only) -->
                @if (isOdmCo()) { <button type="button" class="rsheet" (click)="toCompany()" data-testid="pr-company">▦ Company &rsaquo;</button> }
                <button type="button" class="rchg" (click)="change()">change</button>
            </header>

            <!-- GM-3 P0 — the session-clock notice (self-gated: renders only when the fanned session date moved) -->
            <bce-session-notice />
            <!-- GM-3 P1 (S36) — the CURRENT session date, from the hydrated currentDate the fan already carries (zero wire change):
                 a late joiner reads the date the table is on. gmSession only — a plain campaign's roster is untouched. -->
            @if (gmSess() && sessionDate(); as d) { <div class="rdate" data-testid="pr-session-date">Session date &middot; {{ d }}</div> }
            <!-- GM-3 P3 — the hand-off: manage the company you brought (repairs / market / pilots) in the ROOT app, then come
                 back to the table. Same-tab, owner-scoped; shown only when this device brought a company (a home id). -->
            @if (myHomeId(); as home) {
                <button type="button" class="rmanage" (click)="manageCompany(home)" data-testid="pr-manage">Manage my company &#9656;</button>
                <div class="rmanage-note">Repairs, market and pilots happen in your home campaign — this opens it, then brings you back to the table. Your session stays joined.</div>
            }

            @if (awaitingSync()) {
                <div class="rbanner">Connecting to the campaign… the roster and engagement load in a moment.</div>
            } @else if (frozen() && session.resolvedView()) {
                <!-- ORDER-3 H17 — the GM resolved and no new spec has arrived: the roster shows the RETAINED last view (an OPFOR
                     device keeps its OpFor cards; claims stay locked by the frozen engagement) until the next deploy.
                     ORDER-5 E-4 — the banner also reads the SERVER's closed flag (the ORDER-4 close); the line says which. -->
                <div class="rbanner" data-testid="pr-resolved" [attr.data-server-closed]="session.serverClosed()">{{ session.resolvedLine() }}</div>
            } @else if (frozen() && gmSess()) {
                <!-- GM-1b — a GM SESSION before any track: say what the device is waiting for (the GM's Present, then
                     the deploy) instead of the generic engagement line. gmSession-only; plain campaigns keep the
                     string below verbatim. -->
                <div class="rbanner" data-testid="pr-gm-wait">{{ gmWaitText() }}</div>
            } @else if (frozen()) {
                <div class="rbanner">No active engagement — claims are locked until the GM starts the mission.</div>
            } @else if (!connected()) {
                <div class="rbanner warn">Host offline — showing the last-known roster. Claims resume when reconnected.</div>
            }
            <!-- HOTFIX-030 — surface the manual heal when the socket is up but registration hasn't landed (the
                 stuck state); auto-heal also reconnects after ~7s. Reconnect re-syncs; Reload evicts + reloads. -->
            @if (connected() && !registered()) {
                <div class="pheal">Stuck on "registering"? <button type="button" (click)="reconnect()">Reconnect</button>
                    <span>·</span> <button type="button" (click)="reloadApp()">Reload app</button></div>
            }

            <!-- GM-1 P2 — the GM-presented brief (renders NOTHING until the GM presents; self-gated) -->
            <bce-presented-brief />
            <!-- GM-1 P3 — the results slip from the last resolve (self-gated; my units via my claim rows) -->
            <bce-results-slip />

            @if (roster().length === 0) {
                <!-- HOTFIX-029 — a player-appropriate LIVE waiting state (not the old GM-directed dead-end). It
                     updates automatically: a post-join deploy / mission-generate re-derives the roster (parts 2/3). -->
                <div class="rempty">
                    {{ gmSess()
                        ? 'No units on your side yet — they appear here when the GM deploys the track.'
                        : side() === 'OPFOR'
                        ? 'Waiting for the GM to generate a mission — the OpFor appears here automatically.'
                        : 'Waiting for the GM to deploy units — this screen updates automatically.' }}
                </div>
            }

            <ul class="rlist">
                @for (u of roster(); track u.instanceId) {
                    <li class="rcard" [attr.data-instance]="u.instanceId" [class.mine]="heldByMe(u.instanceId)" [class.taken]="taken(u.instanceId)">
                        <div class="rinfo">
                            <div class="rname">{{ u.chassis }} {{ u.model }}</div>
                            <div class="rmeta">
                                {{ u.tons }}t · {{ u.bv }} BV
                                @if (u.unitType === 'vehicle') { <span class="rtag">VEH</span> }
                                @if (isHired(u)) { <span class="rtag rhired" data-testid="pr-hired">HIRED</span> }
                            </div>
                            <!-- IMPORT-6 FOLLOWUPS — RESULTS ONLY: the pilot in the cockpit (from the fanned pilot records) -->
                            @if (pilotName(u.instanceId); as pn) { <div class="rpilot" data-testid="pr-pilot">{{ pn }}</div> }
                        </div>
                        <div class="ract">
                            @if (heldByMe(u.instanceId)) {
                                <button type="button" class="rbtn rel" [disabled]="locked()" (click)="release(u.instanceId)">Release</button>
                            } @else if (holder(u.instanceId); as h) {
                                <span class="rheld">{{ h }}</span>
                            } @else {
                                <button type="button" class="rbtn clm" [disabled]="locked()" (click)="claim(u.instanceId)">Claim</button>
                            }
                        </div>
                    </li>
                }
            </ul>
        </div>
    `,
    styles: [`
        :host { display:block; height:calc(100dvh - var(--bce-footer-h, 0px)); /* IMPORT-7 A — minus the reserved legal-footer space */ background:#0c0f13; color:#e7edf3;
                /* GM-1d — THIS host is the page's scroll container. The shared stylesheet locks the document (html 100dvh +
                   body overflow:hidden — MekBay's "every region scrolls itself"), so an in-flow min-height block taller than a
                   PHONE viewport (the presented Brief) could not be scrolled by touch or wheel; programmatic scroll still worked,
                   which is why desktop harnesses never saw it. Same pattern as the admin page host. */
                overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain;
                font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; }
        .ros { max-width:560px; margin:0 auto; padding:14px 14px 40px; }
        .rhead { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px;
                 background:#141a21; border:1px solid #232c37; margin-bottom:12px; }
        .ros.blu .rside { color:#bcd6f2; }
        .ros.opf .rside { color:#f2c4bc; }
        .rside { font-weight:800; letter-spacing:.1em; font-size:14px; }
        .rwho { flex:1; color:#cdd8e3; font-weight:600; }
        .rconn { font-size:12px; color:#7f8a96; }
        .rconn.on { color:#7fe3a0; }
        .rchg { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px;
                padding:6px 10px; font-size:12px; cursor:pointer; }
        .rsheet { background:#2f6b46; border:none; color:#fff; border-radius:8px; padding:7px 12px;
                  font-size:13px; font-weight:700; cursor:pointer; }
        .rdate { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#9fb2c4; margin:8px 0 4px; } /* GM-3 P1 (S36) */
        .rmanage { margin:10px 0 2px; font:inherit; font-size:13px; font-weight:700; padding:9px 14px; border-radius:8px; border:1px solid #4caf7d; background:#12241a; color:#9fe3b8; cursor:pointer; } /* GM-3 P3 */
        .rmanage:hover, .rmanage:focus-visible { background:#173026; outline:none; }
        .rmanage-note { font-size:11.5px; opacity:.7; margin:2px 0 6px; line-height:1.45; } /* GM-3 P3 */
        .rbanner { background:#1c232c; border:1px solid #2a3340; border-radius:10px; padding:10px 12px;
                   font-size:13px; color:#b9c6d4; margin-bottom:12px; }
        .rbanner.warn { color:#e7a86b; border-color:#6b4a2f; }
        /* HOTFIX-030 — the self-heal backstop row (shown while registration is stuck). */
        .pheal { text-align:center; margin:-2px 0 12px; font-size:12px; color:#7f8a96; }
        .pheal button { background:none; border:none; color:#7fb0e6; font-size:12px; cursor:pointer; text-decoration:underline; padding:0 2px; }
        .pheal span { color:#3a424c; }
        .rempty { color:#7f8a96; font-style:italic; padding:24px 8px; text-align:center; }
        .rlist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .rcard { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:11px;
                 background:#141a21; border:1px solid #232c37; }
        .rcard.mine { border-color:#2f6b46; background:#12211a; }
        .rcard.taken { opacity:.72; }
        .rinfo { flex:1; min-width:0; }
        .rname { font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rmeta { font-size:12px; color:#7f8a96; margin-top:2px; }
        .rtag { display:inline-block; margin-left:6px; padding:1px 5px; border-radius:4px;
                background:#2a3340; color:#9fb2c4; font-size:10px; letter-spacing:.06em; }
        .rtag.rhired { background:#3d2f1a; color:#e0b45c; } /* IMPORT-6 FOLLOWUPS — a hired specialist's unit */
        .rpilot { font-size:12px; color:#c9d1d9; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } /* the pilot in the cockpit */
        .ract { flex-shrink:0; }
        .rbtn { border:none; border-radius:8px; padding:10px 16px; font-size:14px; font-weight:700; cursor:pointer; }
        .rbtn:disabled { opacity:.5; cursor:not-allowed; }
        .rbtn.clm { background:#2f5a6b; color:#fff; }
        .rbtn.rel { background:#6b3a2f; color:#fff; }
        .rheld { font-size:13px; color:#e7a86b; font-style:italic; }
    `],
})
export class PlayerRosterComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    protected readonly session = inject(PlayerSessionService); // ORDER-3 H17
    private readonly rt = inject(ClaimRealtimeService);
    private readonly router = inject(Router);

    protected readonly side = this.rt.side;
    protected readonly isOdmCo = computed(() => this.state.packId() === 'odm'); // ODM-18 P1
    protected toCompany(): void { void this.router.navigate(['/company']); } // ODM-18 P1
    // GM-1 P4 — the SIDE A/B display name (null → today's BLUFOR/OPFOR verbatim)
    protected readonly sideHeader = computed(() => {
        const l = sideLabelsOf(this.state);
        if (!l) return this.side();
        return this.side() === 'BLUFOR' ? `SIDE A — ${l.a}` : `SIDE B — ${l.b}`;
    });
    protected readonly name = this.rt.playerName;
    protected readonly connected = this.rt.connected;
    protected readonly registered = this.rt.registered; // HOTFIX-029: green only when own token is in the roster
    protected readonly frozen = computed(() => engagementFrozen(this.state.missionTree()));
    // GM-1b — the pre-track GM-session waiting copy (gmSession + presented from the fanned snapshot)
    protected readonly gmSess = computed(() => this.state.gmSession());
    /** GM-3 P1 (S36) — the session date the table is on, in the campaign clock's display form; null before the first snapshot. */
    protected readonly sessionDate = computed(() => { const d = this.state.currentDate(); return d ? formatDate(d) : null; });
    // GM-3 P3 — the home campaign THIS device brought (provenance.owner ↔ my token's anonId): the hand-off target.
    private readonly myAnon = signal<string | null>(null);
    private readonly anonFill = effect(() => { const t = this.rt.token(); void anonIdWeb(t).then((a) => this.myAnon.set(a)); });
    protected readonly myHomeId = computed(() => {
        if (!this.gmSess()) return null;
        const anon = this.myAnon(); if (!anon) return null;
        return (this.state.startingForce() ?? []).find((u) => u.provenance?.origin === 'player-import' && u.provenance.owner === anon && !!u.provenance.sourceCampaignId)?.provenance?.sourceCampaignId ?? null;
    });
    /** GM-3 P3 — same-tab hand-off to the ROOT app at the home campaign, carrying the join link as returnTo (the client
     *  safeTablePath gate validates it on the way back). The engine + session id come from the current bound campaign. */
    protected manageCompany(homeId: string): void {
        const engine = (() => { try { return localStorage.getItem('bce.engine.url') ?? ''; } catch { return ''; } })();
        const sessionId = this.store.campaignId() ?? '';
        const returnTo = `/player/?campaign=${encodeURIComponent(sessionId)}${engine ? `&engine=${encodeURIComponent(engine)}` : ''}`;
        const url = `${location.origin}/?campaign=${encodeURIComponent(homeId)}${engine ? `&engine=${encodeURIComponent(engine)}` : ''}&returnTo=${encodeURIComponent(returnTo)}`;
        location.assign(url); // same tab — the root app opens the home campaign owner-scoped, with "◄ Back to the table"
    }
    protected readonly presented = this.state.presentedHotspot;
    protected readonly gmWaitText = computed(() => this.presented()
        ? 'The GM has presented a contract — mark your side preference below. Units appear here when the GM deploys the track.'
        : "You're in the GM's session. The GM hasn't presented a contract yet — this screen updates automatically.");
    protected readonly locked = computed(() => this.frozen() || !this.connected());
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    // Has the campaign landed yet? A QR-join phone hydrates from the host snapshot over the socket
    // (campaignSnapshot); a LAN player from the REST "last" (faction set on hydrate). BEFORE either lands the
    // default-empty tree reads as "frozen" — but that is "still syncing", NOT "the GM hasn't started". Splitting
    // the two stops the phone flashing "no active engagement" during the connect handshake / persist race.
    private readonly hydrated = computed(() => this.rt.campaignSnapshot() !== null || this.state.faction() !== null);
    protected readonly awaitingSync = computed(() => this.frozen() && !this.hydrated());

    // Side gates visibility (ROLE-002): BLUFOR = the deployed company; OPFOR = the mission OpFor.
    protected readonly roster = computed<ProtoInstance[]>(() =>
        this.rt.side() === 'OPFOR'
            ? this.state.missionSpec()?.opforForce ?? []
            : deployedSet(this.state.startingForce()),
    );
    // How many of the visible units THIS device holds — gates the "My Sheet" affordance (phase B).
    protected readonly heldCount = computed(() => this.roster().filter((u) => this.rt.heldByMe(u.instanceId)).length);
    /** IMPORT-6 FOLLOWUPS — RESULTS ONLY: who is in the cockpit (the fanned `pilots` by assignedInstanceId; BLUFOR only —
     *  the OpFor roster has no pilot records) + whether the unit is a hired specialist (provenance 'hired-merc'). Reads the
     *  fielded records, never the hire OFFERS. */
    protected readonly pilotByInstance = computed(() => {
        const m = new Map<string, string>();
        // PD3 P4 (PD3-5) — the phone shows `callsign || name`: ONE rule for the player bundle (the ODM company list already reads it), so a rename
        // reaches the phone under the same convention the GM row uses for its callsign chip; a pilot WITH a callsign keeps showing the callsign.
        if (this.rt.side() === 'BLUFOR') for (const p of this.state.pilots() ?? []) if (p.assignedInstanceId && (p.callsign || p.name)) m.set(p.assignedInstanceId, p.callsign || p.name);
        return m;
    });
    protected pilotName(instanceId: string): string { return this.pilotByInstance().get(instanceId) ?? ''; }
    protected isHired(u: ProtoInstance): boolean { return u.provenance?.origin === 'hired-merc'; }

    constructor() {
        // Reconnect/resync the claim room AND re-announce to the lobby (a reload lands straight here).
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.joinLobby(); }
        });
    }

    protected holder(instanceId: string): string | null {
        return this.rt.claims()[instanceId]?.holderName || null;
    }
    protected heldByMe(instanceId: string): boolean {
        return this.rt.heldByMe(instanceId);
    }
    protected taken(instanceId: string): boolean {
        return !!this.rt.claims()[instanceId] && !this.rt.heldByMe(instanceId);
    }
    protected claim(instanceId: string): void {
        if (!this.locked()) this.rt.claim(instanceId);
    }
    protected release(instanceId: string): void {
        if (!this.locked()) this.rt.release(instanceId);
    }
    /** HOTFIX-030 — manual heal backstop (auto-heal reconnects after ~7s stuck). */
    protected reconnect(): void { this.rt.reconnect(); }
    protected reloadApp(): void { void evictAndReload(); }
    protected change(): void {
        this.router.navigate(['/']);
    }
    protected toSheet(): void {
        this.router.navigate(['/sheet']);
    }
}
