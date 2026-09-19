import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { PlayerSessionService } from './player-session.service';
import { deployedSet } from '../campaign/force/deployed';
import { deniedClaimText, DENIED_CLAIM_NOTICE_MS } from './denied-claim';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { engagementKeyOf, engagementFrozen } from '../campaign/claims/engagement-key';
import { evictAndReload } from '../shared/app-reset';
import type { ProtoInstance } from '../campaign/force/force-generator';
import { PresentedBriefComponent } from './player-presented';
import { ResultsSlipComponent } from './player-results';
import { sideLabelsOf, anonIdWeb } from '../campaign/gm/side-labels';
import { formatDate } from '../campaign/clock/campaign-clock';
import { SessionNoticeComponent } from './session-notice';

@Component({
    selector: 'bce-player-roster',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [PresentedBriefComponent, ResultsSlipComponent, SessionNoticeComponent],
    template: `
        <div class="ros" [class.blu]="side() === 'BLUFOR'" [class.opf]="side() === 'OPFOR'">
            <header class="rhead">
                <div class="rside">{{ sideHeader() }}</div>
                <div class="rwho">{{ name() || 'Player' }}</div>
                <div class="rconn" [class.on]="registered()">{{ registered() ? '● live' : connected() ? '● registering…' : '○ offline' }}</div>
                @if (heldCount() > 0) {
                    <button type="button" class="rsheet" (click)="toSheet()">My Sheet ({{ heldCount() }}) ›</button>
                }
                @if (isOdmCo()) { <button type="button" class="rsheet" (click)="toCompany()" data-testid="pr-company">▦ Company &rsaquo;</button> }
                <button type="button" class="rchg" (click)="change()">change</button>
            </header>

            <bce-session-notice />
            @if (deniedNote(); as dn) {
                <div class="rbanner warn" role="status" aria-live="polite" data-testid="pr-denied">{{ dn }}</div>
            }
            @if (gmSess() && sessionDate(); as d) { <div class="rdate" data-testid="pr-session-date">Session date &middot; {{ d }}</div> }
            @if (myHomeId(); as home) {
                <button type="button" class="rmanage" (click)="manageCompany(home)" data-testid="pr-manage">Manage my company &#9656;</button>
                <div class="rmanage-note">Repairs, market and pilots happen in your home campaign — this opens it, then brings you back to the table. Your session stays joined.</div>
            }

            @if (awaitingSync()) {
                <div class="rbanner">Connecting to the campaign… the roster and engagement load in a moment.</div>
            } @else if (frozen() && session.resolvedView()) {
                <div class="rbanner" data-testid="pr-resolved" [attr.data-server-closed]="session.serverClosed()">{{ session.resolvedLine() }}</div>
            } @else if (frozen() && gmSess()) {
                <div class="rbanner" data-testid="pr-gm-wait">{{ gmWaitText() }}</div>
            } @else if (frozen()) {
                <div class="rbanner">No active engagement — claims are locked until the GM starts the mission.</div>
            } @else if (!connected()) {
                <div class="rbanner warn">Host offline — showing the last-known roster. Claims resume when reconnected.</div>
            }
            @if (connected() && !registered()) {
                <div class="pheal">Stuck on "registering"? <button type="button" (click)="reconnect()">Reconnect</button>
                    <span>·</span> <button type="button" (click)="reloadApp()">Reload app</button></div>
            }

            <bce-presented-brief />
            <bce-results-slip />

            @if (roster().length === 0) {
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
        :host { display:block; height:calc(100dvh - var(--bce-footer-h, 0px));background:#0c0f13; color:#e7edf3;
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
        .rdate { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#9fb2c4; margin:8px 0 4px; }
        .rmanage { margin:10px 0 2px; font:inherit; font-size:13px; font-weight:700; padding:9px 14px; border-radius:8px; border:1px solid #4caf7d; background:#12241a; color:#9fe3b8; cursor:pointer; }
        .rmanage:hover, .rmanage:focus-visible { background:#173026; outline:none; }
        .rmanage-note { font-size:11.5px; opacity:.7; margin:2px 0 6px; line-height:1.45; }
        .rbanner { background:#1c232c; border:1px solid #2a3340; border-radius:10px; padding:10px 12px;
                   font-size:13px; color:#b9c6d4; margin-bottom:12px; }
        .rbanner.warn { color:#e7a86b; border-color:#6b4a2f; }
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
        .rtag.rhired { background:#3d2f1a; color:#e0b45c; }
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
    protected readonly session = inject(PlayerSessionService);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly router = inject(Router);

    protected readonly side = this.rt.side;
    protected readonly isOdmCo = computed(() => this.state.packId() === 'odm');
    protected toCompany(): void { void this.router.navigate(['/company']); }
    protected readonly sideHeader = computed(() => {
        const l = sideLabelsOf(this.state);
        if (!l) return this.side();
        return this.side() === 'BLUFOR' ? `SIDE A — ${l.a}` : `SIDE B — ${l.b}`;
    });
    protected readonly name = this.rt.playerName;
    protected readonly connected = this.rt.connected;
    protected readonly registered = this.rt.registered;
    protected readonly frozen = computed(() => engagementFrozen(this.state.missionTree()));
    protected readonly gmSess = computed(() => this.state.gmSession());
    protected readonly sessionDate = computed(() => { const d = this.state.currentDate(); return d ? formatDate(d) : null; });
    private readonly myAnon = signal<string | null>(null);
    private readonly anonFill = effect(() => { const t = this.rt.token(); void anonIdWeb(t).then((a) => this.myAnon.set(a)); });
    protected readonly myHomeId = computed(() => {
        if (!this.gmSess()) return null;
        const anon = this.myAnon(); if (!anon) return null;
        return (this.state.startingForce() ?? []).find((u) => u.provenance?.origin === 'player-import' && u.provenance.owner === anon && !!u.provenance.sourceCampaignId)?.provenance?.sourceCampaignId ?? null;
    });
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
    protected readonly pilotByInstance = computed(() => {
        const m = new Map<string, string>();
        // reaches the phone under the same convention the GM row uses for its callsign chip; a pilot WITH a callsign keeps showing the callsign.
        if (this.rt.side() === 'BLUFOR') for (const p of this.state.pilots() ?? []) if (p.assignedInstanceId && (p.callsign || p.name)) m.set(p.assignedInstanceId, p.callsign || p.name);
        return m;
    });
    protected pilotName(instanceId: string): string { return this.pilotByInstance().get(instanceId) ?? ''; }
    protected isHired(u: ProtoInstance): boolean { return u.provenance?.origin === 'hired-merc'; }

    protected readonly deniedNote = signal<string | null>(null);
    private deniedTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        // Reconnect/resync the claim room AND re-announce to the lobby (a reload lands straight here).
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.joinLobby(); }
        });
        effect(() => {
            const d = this.rt.lastDenied();
            if (!d || d.event !== 'claim') return;
            this.deniedNote.set(deniedClaimText(d.reason));
            if (this.deniedTimer) clearTimeout(this.deniedTimer);
            this.deniedTimer = setTimeout(() => this.deniedNote.set(null), DENIED_CLAIM_NOTICE_MS);
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
    protected reconnect(): void { this.rt.reconnect(); }
    protected reloadApp(): void { void evictAndReload(); }
    protected change(): void {
        this.router.navigate(['/']);
    }
    protected toSheet(): void {
        this.router.navigate(['/sheet']);
    }
}
