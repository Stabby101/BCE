/*
 * BCE PLAYER — JOIN screen (DIRECTIVE-048, phase A). The first thing a player sees after scanning the
 * GM's QR: pick a name, pick a side (BLUFOR/OPFOR — the side gates which force you'll see, ROLE-002),
 * tap JOIN. Name + side persist to localStorage (survive a reload) and announce to the host lobby over
 * the D-042 socket; the GM lobby shows the join live. campaignId + the engagement key come from the
 * rehydrated host campaign (app.player.config). Offline degrades honestly — JOIN waits for the host.
 * This is campaign-layer only (no dashboard, no MekBay core import) — the port-isolation boundary.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService, providerLabel } from '../auth/auth.service'; // GM-1c — the root app's sign-in flow, reused (not forked) on the join page
import { PlayerSessionService } from './player-session.service'; // GM-1c — the sign-in round-trip (stash + return flag)
import { classifyHost, perHostNoteApplies } from '../shared/host-env'; // GM-1c — the per-host note only off the public host
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { engagementKeyOf } from '../campaign/claims/engagement-key';
import { sessionCodeOf } from '../campaign/claims/session-code';
import { evictAndReload } from '../shared/app-reset';
import type { ProtoInstance } from '../campaign/force/force-generator'; // GM-1 P3 — bring-my-company (type-only)
import type { Pilot } from '../campaign/barracks/pilot-generator'; // GM-1 P3 (type-only)
import { sideLabelsOf } from '../campaign/gm/side-labels'; // GM-1 P4 — SIDE A/B display names

@Component({
    selector: 'bce-player-join',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="join">
            <header class="jhead">
                <div class="jbrand">BCE · PLAYER</div>
                <div class="jconn" [class.on]="registered()" [class.off]="!registered()">
                    {{ statusText() }}
                </div>
            </header>
            <!-- HOTFIX-029 — SESSION CODE up top: the player eyeball-matches this against the GM lobby header.
                 Different codes = a stale/wrong QR (a different campaign), visible at a glance. -->
            <div class="jsession" [class.on]="registered()" [title]="campaignId() || ''">
                <span class="js-dot" aria-hidden="true">●</span> SESSION {{ sessionCode() }}
            </div>

            <div class="jcard">
                @if (ready()) {
                    <div class="jcamp">Host <strong>{{ hostLabel() }}</strong></div>
                    <!-- P5 (ORDER-2 b): this boot REBOUND to the device's persisted last join (no ?campaign on the URL — a reload,
                         an iOS tab restore). Say so: a device that changed tables must not be silently rebound; a new QR (?campaign)
                         always wins over the persisted join. -->
                    @if (resumed()) { <div class="jcamp jresume" data-testid="pj-resumed">Resuming SESSION {{ sessionCode() }} · not you? Scan a new code.</div> }
                } @else {
                    <!-- HOTFIX-028: no bound campaign (a between-sessions re-open) → honest prompt, never a zombie
                         "connecting" to a stale session. Scanning the CURRENT QR binds ?campaign and joins live. -->
                    <div class="jcamp jwait">Scan the GM's QR code for the current session to join. <span class="jhost">({{ hostLabel() }})</span></div>
                }

                <label class="jlabel" for="pname">Your name</label>
                <input id="pname" class="jinput" type="text" autocomplete="off" autocapitalize="words"
                       maxlength="24" placeholder="Callsign" [value]="name()" (input)="onName($event)" />

                <div class="jlabel">Your side</div>
                <!-- GM-1 P4 — SIDE A/B names in a gmSession (the wire stays BLUFOR/OPFOR; labels only).
                     The GM can reassign you — your device lands on the assigned side automatically. -->
                <div class="jsides">
                    <button type="button" class="jside blu" [class.sel]="side() === 'BLUFOR'"
                            (click)="pick('BLUFOR')">{{ sideNames() ? 'SIDE A' : 'BLUFOR' }}<small>{{ sideNames()?.a ?? 'your company' }}</small></button>
                    <button type="button" class="jside opf" [class.sel]="side() === 'OPFOR'"
                            (click)="pick('OPFOR')">{{ sideNames() ? 'SIDE B' : 'OPFOR' }}<small>{{ sideNames()?.b ?? 'the opposition' }}</small></button>
                </div>

                <!-- GM-1 P3 — BRING MY COMPANY: pick one of the ACCOUNT's hosted campaigns + up to the
                     GM-set cap of its units; the serialized force rides the join (one-shot, server-gated).
                     GM-SESSION ONLY (panel finding): a plain hosted campaign has no merge consumer — the
                     section renders only when the joined campaign's fanned snapshot says gmSession; the
                     server enforces the same gate regardless. -->
                @if (gmSess()) {
                <div class="jlabel">Bring my company <small class="jopt">optional</small></div>
                @if (!bringOpen()) {
                    <button type="button" class="jbring" (click)="openBring()" data-testid="pj-bring">Bring my own units ({{ cap() }} max) &rsaquo;</button>
                } @else {
                    <!-- GM-1c — the four errors that wore one message, told apart by the host's answer (401 = no account
                         on this device → SIGN IN right here; 403 = an account the host won't serve; no answer = retry),
                         each with the one action that fixes it. Written for a player: no "GM app", no LAN note on the
                         cloud host, the installed-app (iOS standalone) caveat only when it applies. -->
                    <div class="jbring-box" data-testid="pj-bring-box">
                        @if (sourceState() === 'loading') { <div class="jbring-note">Looking up your campaigns…</div> }
                        @else if (sourceState() === 'signin') {
                            <div class="jbring-note" data-testid="pj-signin-note">Sign in to bring your company — you'll need an account with a campaign in it. Or join without one.</div>
                            @for (p of providers(); track p) {
                                <button type="button" class="jsignin" [class.google]="p === 'google'" [class.github]="p === 'github'" (click)="signIn(p)" [attr.data-provider]="p" data-testid="pj-signin">Sign in with {{ providerLabel(p) }}</button>
                            } @empty {
                                <div class="jbring-note">No sign-in is set up on {{ hostLabel() }} — join without a company.</div>
                            }
                            @if (standalone()) { <div class="jbring-note jios" data-testid="pj-signin-ios">This page is running as an installed app, which keeps its own sign-in. If signing in here doesn't stick, open the join link in Safari instead.</div> }
                            @if (lanHost()) { <div class="jbring-note">Campaigns live on the host you joined ({{ hostLabel() }}) — a LAN host can't see campaigns saved on the cloud, or the other way round.</div> }
                        }
                        @else if (sourceState() === 'blocked') { <div class="jbring-note" data-testid="pj-blocked">Your account {{ blockedWhy() }} {{ hostLabel() }} — ask the host's admin, then <button type="button" class="jretry" (click)="retryBring()">retry</button>.</div> }
                        @else if (sourceState() === 'offline') { <div class="jbring-note" data-testid="pj-offline">Couldn't reach {{ hostLabel() }} to look up your campaigns. <button type="button" class="jretry" (click)="retryBring()">retry</button></div> }
                        @else if (sourceState() === 'empty') { <div class="jbring-note" data-testid="pj-empty">This account has no campaign with units in it on {{ siteLabel() }} yet. Create a campaign there and add a force, then <button type="button" class="jretry" (click)="retryBring()">retry</button>. If you can't create one, the host's admin may still need to grant you access.</div> }
                        @else {
                            @if (!sourcePick()) {
                                @for (c of sources(); track c.id) {
                                    <button type="button" class="jsource" (click)="pickSource(c.id)" [attr.data-testid]="'pj-source'">
                                        {{ c.name }} <small>{{ c.count }} unit{{ c.count === 1 ? '' : 's' }}</small>
                                    </button>
                                }
                            } @else {
                                <div class="jbring-note">Pick up to {{ cap() }} — {{ picked().size }} selected</div>
                                @for (u of sourceUnits(); track u.instanceId) {
                                    <label class="junit" [class.dis]="!picked().has(u.instanceId) && picked().size >= cap()">
                                        <input type="checkbox" [checked]="picked().has(u.instanceId)" [disabled]="!picked().has(u.instanceId) && picked().size >= cap()" (change)="togglePick(u.instanceId)" data-testid="pj-unit" />
                                        {{ u.chassis }} {{ u.model }} <small>{{ u.tons }}t · {{ u.bv }} BV</small>
                                    </label>
                                }
                                <button type="button" class="jsource" (click)="sourcePick.set(null)">&lsaquo; different campaign</button>
                            }
                        }
                        @if (importError(); as err) { <div class="jbring-err" data-testid="pj-import-err">{{ err }}</div> }
                    </div>
                }
                }

                <button type="button" class="jjoin" [disabled]="!canJoin() || importing()" (click)="join()" data-testid="pj-join">
                    {{ importing() ? 'Bringing your company…' : canJoin() ? (picked().size ? 'JOIN WITH ' + picked().size + ' UNIT' + (picked().size === 1 ? '' : 'S') : 'JOIN BATTLE') : 'Waiting for host…' }}
                </button>
                <div class="jhint">Side gates what you see. The GM can reassign you in the lobby.</div>
            </div>
            <!-- HOTFIX-030 — manual self-heal backstop (auto-heal reconnects a stuck socket after ~7s; this lets
                 an impatient player heal now). Reconnect = re-sync the socket; Reload = evict caches + reload. -->
            <div class="pheal">Stuck? <button type="button" (click)="reconnect()">Reconnect</button>
                <span>·</span> <button type="button" (click)="reloadApp()">Reload app</button></div>
        </div>
    `,
    styles: [`
        :host { display:block; height:calc(100dvh - var(--bce-footer-h, 0px)); /* IMPORT-7 A — minus the reserved legal-footer space */ background:#0c0f13; color:#e7edf3;
                /* GM-1d-b — THIS host is the page's scroll container (the GM-1d roster fix, same lock): the shared stylesheet
                   locks the document (body overflow:hidden), so a join page grown past a PHONE viewport by the Bring-my-company
                   list (+ the GM-1c sign-in block) could not be scrolled by touch — JOIN sat below the fold, unreachable. */
                overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain;
                font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; }
        .join { max-width:460px; margin:0 auto; padding:18px 16px 32px; }
        .jhead { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .jbrand { font-weight:700; letter-spacing:.12em; font-size:12px; color:#9fb2c4; }
        .jconn { font-size:11px; letter-spacing:.06em; padding:3px 8px; border-radius:999px; border:1px solid #2a3340; }
        .jconn.on { color:#7fe3a0; border-color:#2f6b46; }
        .jconn.off { color:#e7a86b; border-color:#6b4a2f; }
        /* HOTFIX-029 — session code up top (eyeball-match vs the GM lobby). */
        .jsession { display:flex; align-items:center; gap:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                    font-size:12px; letter-spacing:.1em; color:#7f8a96; margin:0 0 14px; }
        .jsession .js-dot { color:#6b7682; }
        .jsession.on { color:#cdd8e3; }
        .jsession.on .js-dot { color:#7fe3a0; }
        /* HOTFIX-030 — the self-heal backstop row. */
        .pheal { text-align:center; margin-top:16px; font-size:12px; color:#6b7682; }
        .pheal button { background:none; border:none; color:#7fb0e6; font-size:12px; cursor:pointer; text-decoration:underline; padding:0 2px; }
        .pheal span { color:#3a424c; }
        .jcard { background:#141a21; border:1px solid #232c37; border-radius:14px; padding:18px 16px; }
        .jcamp { font-size:14px; color:#b9c6d4; margin-bottom:16px; }
        .jcamp strong { color:#fff; }
        .jwait { color:#7f8a96; font-style:italic; }
        .jresume { color:#e7c76b; font-size:13px; margin-top:-8px; } /* P5 — the rebound-session notice */
        .jlabel { display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase;
                  color:#7f8a96; margin:14px 0 6px; }
        .jinput { width:100%; box-sizing:border-box; background:#0c0f13; border:1px solid #2a3340;
                  color:#fff; border-radius:9px; padding:12px 12px; font-size:16px; }
        .jinput:focus { outline:none; border-color:#3d6ea5; }
        .jsides { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .jside { display:flex; flex-direction:column; gap:3px; align-items:center; padding:14px 8px;
                 border-radius:10px; border:1px solid #2a3340; background:#0c0f13; color:#cdd8e3;
                 font-weight:700; letter-spacing:.06em; cursor:pointer; }
        .jside small { font-weight:400; letter-spacing:0; font-size:11px; color:#7f8a96; }
        .jside.sel.blu { border-color:#3d6ea5; background:#13243a; color:#bcd6f2; }
        .jside.sel.opf { border-color:#a5483d; background:#3a1714; color:#f2c4bc; }
        .jjoin { width:100%; margin-top:18px; padding:15px; border:none; border-radius:10px;
                 background:#2f6b46; color:#fff; font-size:16px; font-weight:700; letter-spacing:.06em;
                 cursor:pointer; }
        .jjoin:disabled { background:#222a33; color:#6b7682; cursor:not-allowed; }
        .jhint { margin-top:12px; font-size:12px; color:#6b7682; text-align:center; }
        /* GM-1 P3 — bring-my-company */
        .jopt { font-weight:400; letter-spacing:0; text-transform:none; color:#6b7682; }
        .jbring { width:100%; padding:11px; border-radius:9px; border:1px dashed #2a3340; background:transparent; color:#9fb2c4; cursor:pointer; font-size:14px; }
        .jbring-box { border:1px solid #2a3340; border-radius:9px; padding:10px; display:flex; flex-direction:column; gap:6px; }
        .jbring-note { font-size:12px; color:#7f8a96; line-height:1.5; }
        .jbring-err { font-size:12px; color:#e7a86b; }
        .jsource { text-align:left; padding:9px 10px; border-radius:7px; border:1px solid #2a3340; background:#0c0f13; color:#cdd8e3; cursor:pointer; font-size:14px; }
        .jsource small { color:#7f8a96; margin-left:6px; }
        .junit { display:flex; align-items:center; gap:8px; font-size:14px; color:#cdd8e3; padding:4px 2px; }
        .junit small { color:#7f8a96; }
        .junit.dis { opacity:.45; }
        .jretry { background:none; border:none; color:#7fb0e6; font-size:12px; cursor:pointer; text-decoration:underline; padding:0 2px; }
        /* GM-1c — sign in from the join page (the root login screen's button look, in the box) */
        .jsignin { width:100%; padding:11px 12px; border-radius:9px; border:1px solid transparent; font-size:14px; font-weight:700; cursor:pointer; letter-spacing:.02em; }
        .jsignin.google { background:#fff; color:#222; }
        .jsignin.github { background:#24292f; color:#fff; }
        .jios { color:#e7a86b; }
    `],
})
export class PlayerJoinComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly router = inject(Router);
    private readonly http = inject(HttpClient); // GM-1 P3 — the account's campaign list (credentialed player REST)
    private readonly auth = inject(AuthService); // GM-1c — providers + the start URL + (via the initializer) fragment adoption
    private readonly session = inject(PlayerSessionService); // GM-1c — the sign-in round-trip stash + return flag
    private engineBase(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    protected readonly name = signal(this.rt.playerName());
    protected readonly side = signal(this.rt.side());
    protected readonly connected = this.rt.connected;
    protected readonly registered = this.rt.registered; // HOTFIX-029: green ONLY when own token echoed in the roster
    protected readonly online = this.store.online;
    protected readonly ready = computed(() => !!this.store.campaignId());
    // HOTFIX-029 — session identity + honest connection truth. "connected" (green) means REGISTERED; a
    // socket-up-but-not-yet-in-roster state honestly reads "registering…", never a false green.
    protected readonly campaignId = this.store.campaignId;
    protected readonly sessionCode = computed(() => sessionCodeOf(this.store.campaignId()));
    // P5 (ORDER-2 b) — true when this boot rebound to the persisted last join AND it is still the bound campaign
    protected readonly resumed = computed(() => { const r = this.session.resumed(); return !!r && r === this.store.campaignId(); });
    // GM-1b — on THIS screen connected-but-unregistered means "not yet joined" (registration happens at the JOIN
    // tap); "registering…" belongs to the post-join roster page. Pre-track joins read it most.
    protected readonly statusText = computed(() =>
        this.registered() ? 'connected'
            : this.connected() ? 'connected — ready to join'
            : this.online() ? 'connecting…'
            : 'host offline');
    // The LAN host the player actually reached — confirms the engine URL (the #1 silent break is a
    // player device pointed at itself instead of the GM host). Friendly: strip protocol + /api.
    protected readonly hostLabel = computed(() => (localStorage.getItem('bce.engine.url') || 'localhost:3000').replace(/^https?:\/\//, '').replace(/\/api\/?$/, ''));
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    protected readonly canJoin = computed(() => this.ready() && this.name().trim().length > 0);

    constructor() {
        // Connect the socket + join the campaign room as soon as the host campaign is known (mirrors the
        // GM claims panel). The lobby announce waits for the explicit JOIN tap (joinLobby), but the socket
        // is up early so JOIN lands instantly.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) this.rt.ensure(id, key);
        });
        // GM-1c — back from the sign-in round-trip (the initializer adopted #bce_auth, or the stash the page left
        // before leaving is still fresh): restore what the player had typed and re-open Bring-my-company, so the
        // account's campaigns list with NO retry tap. Nothing else about the join changes.
        const stash = this.session.takeSignInStash();
        if (stash?.name) this.name.set(stash.name);
        if (stash?.side === 'BLUFOR' || stash?.side === 'OPFOR') this.side.set(stash.side);
        if (stash || this.session.returnedFromSignIn()) this.openBring();
    }

    /** HOTFIX-030 — manual heal backstop. Reconnect re-syncs the socket (registration + snapshot); Reload
     *  evicts caches + reloads for a stale bundle. Auto-heal already retries a stuck socket after ~7s. */
    protected reconnect(): void { this.rt.reconnect(); }
    protected reloadApp(): void { void evictAndReload(); }

    protected onName(e: Event): void {
        this.name.set((e.target as HTMLInputElement).value);
    }
    protected pick(s: 'BLUFOR' | 'OPFOR'): void {
        this.side.set(s);
    }
    // ── GM-1 P3 — BRING MY COMPANY ──
    protected readonly bringOpen = signal(false);
    protected readonly gmSess = computed(() => this.state.gmSession()); // GM-session-only surface (panel finding)
    protected readonly sideNames = computed(() => sideLabelsOf(this.state)); // GM-1 P4 — SIDE A/B display names (null → BLUFOR/OPFOR)
    protected readonly cap = computed(() => this.state.playerUnitCap() ?? 4); // hydrated from the GM session's fanned snapshot
    protected retryBring(): void { this.sourceState.set('idle'); this.openBring(); } // a transient 401/network error must not cache as "no account"
    protected readonly sourceState = signal<'idle' | 'loading' | 'signin' | 'blocked' | 'offline' | 'empty' | 'ready'>('idle');
    // ── GM-1c — SIGN IN FROM THE JOIN PAGE ──
    protected readonly providers = this.auth.enabledProviders; // LOGIN-1: one button per provider the host actually has (learned on the 401 path)
    protected readonly blockedWhy = signal('does not have access to');
    protected providerLabel(p: string): string { return providerLabel(p); }
    /** R3 — an iOS home-screen install is its own storage partition (a Safari sign-in never reaches it): say so. */
    protected standalone(): boolean {
        try { return (navigator as Navigator & { standalone?: boolean }).standalone === true || !!globalThis.matchMedia?.('(display-mode: standalone)')?.matches; } catch { return false; }
    }
    /** The per-host note ONLY when the engine is not a public host (never on the cloud host — the directive's rule;
     *  the predicate is pure and spec-pinned). */
    protected lanHost(): boolean { return perHostNoteApplies(this.engineBase()); }
    /** Where a campaign is created: the site the player is on when public (same origin as the root app), else the host. */
    protected siteLabel(): string { try { return classifyHost(location.hostname) === 'public' ? location.hostname : this.hostLabel(); } catch { return this.hostLabel(); } }
    /** Run the root app's OAuth flow and come BACK to this exact join link (path + query; the host prefixes its
     *  canonical origin after validating it). Name + side are stashed for the return; the initializer adopts the token. */
    protected signIn(provider: string): void {
        this.session.stashForSignIn({ name: this.name(), side: this.side() });
        location.assign(this.auth.loginUrl(provider, location.pathname + location.search));
    }
    /** The host's answer decides the state: 401 = no signed-in account on this device (offer sign-in — and learn which
     *  providers exist from /auth/me, which also drops a stale mirrored token); 403 = an account the host won't serve
     *  (pending / banned — say which); anything else = the host did not answer (retry). */
    private async classifyBringError(e: unknown): Promise<void> {
        const status = e instanceof HttpErrorResponse ? e.status : 0;
        if (status === 401) {
            await this.auth.refresh();
            this.sourceState.set('signin');
        } else if (status === 403) {
            const st = (e as HttpErrorResponse).error?.status;
            this.blockedWhy.set(st === 'pending' ? 'is still awaiting approval on' : 'does not have access to');
            this.sourceState.set('blocked');
        } else {
            this.sourceState.set('offline');
        }
    }
    protected readonly sources = signal<{ id: string; name: string; count: number; units: ProtoInstance[]; pilots: Pilot[]; reputation: number | null }[]>([]); // P2b — + the home reputation
    protected readonly sourcePick = signal<string | null>(null);
    protected readonly picked = signal<Set<string>>(new Set());
    protected readonly importing = signal(false);
    protected readonly importError = signal<string | null>(null);
    protected readonly sourceUnits = computed(() => this.sources().find((s) => s.id === this.sourcePick())?.units ?? []);

    protected openBring(): void {
        this.bringOpen.set(true);
        if (this.sourceState() !== 'idle') return;
        this.sourceState.set('loading');
        // the ACCOUNT's hosted campaigns (player REST now carries the device credential; 401 = no account
        // here — honest degrade; per-host by design: LAN campaigns are invisible from the cloud origin).
        this.http.get<{ id: string; name: string; snapshot?: { startingForce?: ProtoInstance[] | null; pilots?: Pilot[] | null } }[]>(`${this.engineBase()}/campaigns`).subscribe({
            next: (rows) => {
                const gmId = this.store.campaignId();
                const list = (Array.isArray(rows) ? rows : [])
                    .filter((r) => r.id !== gmId) // never offer the GM session itself as a source
                    .map((r) => ({ id: r.id, name: r.name || r.id, units: r.snapshot?.startingForce ?? [], pilots: r.snapshot?.pilots ?? [], count: (r.snapshot?.startingForce ?? []).length, reputation: (() => { const rep = (r.snapshot as { reputation?: unknown } | null | undefined)?.reputation; return typeof rep === 'number' ? rep : null; })() }))
                    .filter((r) => r.count > 0);
                this.sources.set(list);
                this.sourceState.set(list.length ? 'ready' : 'empty');
            },
            error: (e: unknown) => void this.classifyBringError(e), // GM-1c — 401 / 403 / no answer are different states
        });
    }
    protected pickSource(id: string): void { this.sourcePick.set(id); this.picked.set(new Set()); }
    protected togglePick(instanceId: string): void {
        const next = new Set(this.picked());
        if (next.has(instanceId)) next.delete(instanceId);
        else if (next.size < this.cap()) next.add(instanceId);
        this.picked.set(next);
    }

    protected async join(): Promise<void> {
        if (!this.canJoin() || this.importing()) return;
        this.rt.setName(this.name().trim());
        this.rt.setSide(this.side());
        this.rt.joinLobby(); // announce to the host lobby FIRST (the token binds — the import is token-scoped)
        this.session.rememberJoin(); // P5 (ORDER-2 b) — the device remembers this join (campaign + engine) for a cold boot with no ?campaign
        // GM-1 P3 — the one-shot company import rides the join (dedicated message, server-gated at 128 KB + cap)
        const src = this.sources().find((s) => s.id === this.sourcePick());
        const ids = this.picked();
        if (src && ids.size) {
            this.importing.set(true);
            this.importError.set(null);
            const units = src.units.filter((u) => ids.has(u.instanceId)).map((u) => ({
                instanceId: u.instanceId, unitRef: u.unitRef, chassis: u.chassis, model: u.model,
                mulId: u.mulId, tons: u.tons, bv: u.bv,
                ...(u.unitType ? { unitType: u.unitType } : {}),
                ...(u.damage != null ? { damage: u.damage } : {}),
            }));
            const pilots = src.pilots.filter((p) => p.assignedInstanceId && ids.has(p.assignedInstanceId)).map((p) => ({
                pilotId: p.pilotId, // GM-2 P1 — the origin pilot id (preserved as originPilotId on the mint)
                name: p.name, ...(p.callsign ? { callsign: p.callsign } : {}), gunnery: p.gunnery, piloting: p.piloting, assignedInstanceId: p.assignedInstanceId,
            }));
            // GM-2 P1 — the HOME campaign rides the handshake (sourceCampaignId); the units already carry their home
            // instanceIds. The mint keeps both on provenance so the results slip can come home.
            const r = await this.rt.importForce({ units, pilots, engagementKey: this.engagementKey(), name: this.name().trim(), sourceCampaignId: src.id, ...(src.reputation !== null ? { reputation: src.reputation } : {}) }); // P2b — the home reputation rides IN
            this.importing.set(false);
            if (!r.ok) {
                // panel — clear the picks so a re-tap joins BARE (no silent duplicate import on retry-after-timeout)
                this.picked.set(new Set());
                this.importError.set(`Company not brought — ${r.reason ?? 'denied'}. Tap JOIN again to enter without it.`);
                return; // stay on join so the player sees why (already announced to the lobby — the GM sees them)
            }
            // GM-3 P3 — bind the HOME campaign to this table (the P1 Apply pattern: the player device writes its OWN campaign on
            // its OWN token). Month advance is then withheld at home while bound; "Leave the table" clears it. Best-effort:
            // a bind failure never blocks the join (the player still enters the table). sessionName is unknown at join → the
            // banner falls back to "a GM session".
            try {
                const home = await this.store.get(src.id); const sid = this.campaignId();
                if (home?.snapshot && sid) { await this.store.put({ ...home, snapshot: { ...home.snapshot, tableBound: { sessionId: sid, since: Date.now() } }, savedAt: Date.now() }); }
            } catch { /* bind is best-effort — the join proceeds regardless */ }
        }
        this.router.navigate(['/roster']);
    }
}
