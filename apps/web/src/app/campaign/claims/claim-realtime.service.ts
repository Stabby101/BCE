/*
 * BCE ENGINE slice 2 (DIRECTIVE-042) — client realtime service for claim/release fan-out.
 * Lives in the BCE CAMPAIGN LAYER (never the vendored MekBay core — MERGE-002, the engine->core
 * arrow stays one-way). Wraps socket.io-client: rooms by campaignId, built-in reconnection (the
 * token survives a wifi drop, T-030), full RESYNC on every (re)connect via 'join'. Identity = a
 * device token in localStorage (no accounts — ROLE-001, the room is the boundary); the holder's
 * display NAME rides the claim. Engine/socket-down degrades honestly (the `connected` signal feeds
 * the panel's read-only / last-known state, extending D-041's online/offlineReason).
 */
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state'; // GM-1 P4 — the adopt-effect's gmSession gate (leaf state svc; no cycle)
import { io, type Socket } from 'socket.io-client';
import { BUILD_COMMIT_HASH } from '../../build-meta';
import { evictAndReload } from '../../shared/app-reset';

export interface Claim {
    instanceId: string;
    holderName: string;
    holderToken: string;
    at: number;
}

/** D-048 lobby roster row — mirrors the host LobbyService.LobbyPlayer. */
export interface LobbyPlayer {
    token: string;
    name: string;
    side: string; // 'BLUFOR' | 'OPFOR'
    joinedAt: number;
    connected?: boolean; // HOTFIX-030: live socket presence (green/red dot); optional for older payloads
    sidePref?: string | null; // GM-1 P2: advisory side preference ('a' | 'b' | null); GM sees all, players see only their own (server-redacted)
    pendingPhase?: number; // REBASE-1 P3 item 1: this device's un-ended-pick count this phase (the GM's "who hasn't ended" signal)
}

/** ODM-18 P1 — a company-console intent fanned to GM sockets (allowlist-validated server-side; the GM
 *  device applies it through the SAME services its own UI calls, then persists — the one-writer law). */
/** GM-2 P2b — a phone's signing, fanned to GM sockets (server-shaped: the actor's lobby name; signedBy stamped 'player'). */
export interface SignRequest { campaignId: string; token: string; name: string; key: string; contract: Record<string, unknown> }

export interface OdmIntent {
    campaignId: string;
    token: string;
    name: string; // the actor's lobby callsign (server-resolved) — the audit line's actor
    verb: string;
    payload: Record<string, unknown>;
}

/** GM-1 P3 — a server-minted join-with-force payload fanned to GM sockets (raw token rides it: the GM is
 *  trusted with tokens per HOTFIX-030; it never reaches player sockets). Units arrive re-minted + stamped
 *  (imp- ids, condition Deployed, provenance {origin:'player-import', owner:anonId}) — the GM merge is dumb. */
export interface ImportRequest {
    campaignId: string;
    token: string;
    name: string;
    units: import('../force/force-generator').ProtoInstance[];
    pilots: import('../barracks/pilot-generator').Pilot[];
}

const ENGINE_URL_KEY = 'bce.engine.url'; // D-041: 'http://host:3000/api'
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api';
const TOKEN_KEY = 'bce.device.token';
const NAME_KEY = 'bce.player.name';
const SIDE_KEY = 'bce.player.side'; // D-048: 'BLUFOR' | 'OPFOR' — gates visibility (ROLE-002)
const SESSION_TOKEN_KEY = 'bce.auth.token'; // DEPLOY-002 P4: the GM session JWT (mirrored by AuthService); absent for players → account-less

@Injectable({ providedIn: 'root' })
export class ClaimRealtimeService {
    private socket: Socket | null = null;
    private campaignId = '';
    private engagementKey = 'none';
    /** HOTFIX-029 — this device's stable lobby token, resolved once, for the `registered` truth check. */
    private readonly deviceToken = this.token();
    private readonly stateRef = inject(NewCampaignState); // GM-1 P4 — gmSession gate only

    constructor() {
        // GM-1 P4 — players LAND on their GM-ASSIGNED side automatically: the lobby row is the server truth
        // (reassign fans it); when this device's OWN row carries a different side, adopt it. Player-joined
        // devices only (lobbyMode 'player') AND gmSessions only (panel finding: without the gate, a plain-HS/
        // Traditional reassign would move the player device's ROLE-002 side gate — a Traditional-surface
        // behavior change the standing byte-identical rule forbids; pre-P4 reassign semantics stay there).
        // NB: the SIGNALS are read FIRST — an early return before any read would track nothing on the first
        // run and the effect would never re-fire (lobbyMode is a plain field, deliberately untracked).
        effect(() => {
            const own = this.lobby().find((p) => p.token === this.deviceToken);
            const cur = this.side();
            const gm = this.stateRef.gmSession();
            if (this.lobbyMode !== 'player' || !gm) return;
            if (own?.side && own.side !== cur) this.setSide(own.side);
        });
    }

    /** live socket connectivity — drives the panel's host-offline / read-only cue. */
    readonly connected = signal(false);
    /** the authoritative claim set for the current engagement, keyed by instanceId. */
    readonly claims = signal<Record<string, Claim>>({});
    /** the holder display name (editable in the proof UI). */
    readonly playerName = signal<string>(localStorage.getItem(NAME_KEY) || '');
    /** D-048: this device's side (BLUFOR/OPFOR) — gates which force the player sees (ROLE-002). */
    readonly side = signal<string>(localStorage.getItem(SIDE_KEY) || 'BLUFOR');
    /** D-048: the host-authoritative lobby roster (campaign-room scoped), fanned on 'lobby'. */
    readonly lobby = signal<LobbyPlayer[]>([]);
    /** HOTFIX-029 — CONNECTION TRUTH for a PLAYER: green means REGISTERED, not merely socket-connected. True
     *  only when the socket is up AND this device's own token is echoed back in the fanned roster (socket +
     *  room + registration). A pre-registration or stale-room socket is honestly "connecting/registering", not
     *  "connected" — this is what makes the reported tablet-"connected"-but-GM-"Joined 0" state impossible. */
    readonly registered = computed(() => this.connected() && this.lobby().some((p) => p.token === this.deviceToken));
    /** Whether this device registers as a player (re-announce on reconnect) or just observes (GM). */
    private lobbyMode: 'player' | 'observer' | null = null;

    /** D-048 phase B: the host-authoritative per-instance battle state for the current engagement,
     *  keyed by instanceId. `state` is opaque transport (MekBay's CBTSerializedState) — the battle
     *  force service does the typing/apply. Updated by 'battle' deltas + the 'battle-state' resync. */
    readonly battleStates = signal<Record<string, { state: unknown; at: number }>>({});
    /** Push subscribers (BattleForceService) — applied to a loaded sheet the instant a delta arrives. */
    private readonly battleListeners = new Set<(instanceId: string, state: unknown, at: number) => void>();

    /** D-048 phase C: this device's campaign-persistent favorite (host-authoritative, keyed by token). */
    readonly favorite = signal<{ instanceId: string | null; pilotId: string | null }>({ instanceId: null, pilotId: null });

    /** DEPLOY-002 P4: the host campaign snapshot, delivered over the socket to a joined account-less PLAYER
     *  (its REST is gated in cloud mode). Null until 'campaign-sync' is enabled + answered. The GM ignores
     *  this (it hydrates the snapshot via REST); only the player bundle enables + consumes it. */
    readonly campaignSnapshot = signal<unknown | null>(null);
    private wantsCampaign = false; // player-only: request the snapshot over the socket on (re)connect

    /** HOTFIX-028 — set true when the server's deployed build commit (socket 'hello') differs from this
     *  bundle's baked BUILD_COMMIT_HASH: a stale cached bundle. Drives the "new version — tap to update"
     *  banner in both shells. Suppressed when either side is unknown/empty (no false alarms). */
    readonly updateAvailable = signal(false);
    /** TESTER-4 (1) — the server's deployed commit that raised updateAvailable (the banner keys its once-per-version quiet on it). */
    readonly serverVersion = signal<string | null>(null);

    private origin(): string {
        return (localStorage.getItem(ENGINE_URL_KEY) || DEFAULT_ENGINE_URL).replace(/\/api\/?$/, '');
    }
    /** The GM session JWT, if signed in (AuthService mirrors it here). Undefined for the account-less player
     *  → the socket handshake sends no token → the gateway treats it as a player (P3 confinement).
     *  HOTFIX-033: the PLAYER bundle NEVER sends a token — even if this device's localStorage carries a
     *  bce.auth.token from also being used as a GM, the player must stay account-less or the server would deny
     *  it access to a campaign its guest doesn't own. (We withhold the token, never CLEAR it — the GM app on
     *  the same origin still needs it.) */
    private sessionToken(): string | undefined {
        if ((globalThis as { __bcePlayerBundle?: boolean }).__bcePlayerBundle) return undefined;
        try { return localStorage.getItem(SESSION_TOKEN_KEY) || undefined; } catch { return undefined; }
    }
    token(): string {
        let t = localStorage.getItem(TOKEN_KEY);
        if (!t) {
            t = (globalThis.crypto?.randomUUID?.() ?? `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
            localStorage.setItem(TOKEN_KEY, t);
        }
        return t;
    }
    setName(name: string): void {
        this.playerName.set(name);
        localStorage.setItem(NAME_KEY, name);
    }
    setSide(side: string): void {
        this.side.set(side);
        localStorage.setItem(SIDE_KEY, side);
    }

    /** Connect (once) + (re)join the campaign room for an engagement. Re-join on an engagement change
     *  resyncs the new key's set (a new engagement starts empty — claims reset). */
    ensure(campaignId: string, engagementKey: string): void {
        if (!campaignId) return;
        const changed = campaignId !== this.campaignId || engagementKey !== this.engagementKey;
        // ODM-18 P1 (panel fix): leave the PRIOR room on a campaign switch — server rooms otherwise never
        // shrink, so this socket kept counting as a present GM for the old campaign (odm-intents acked
        // 'delivered' there and black-holed; this client discards mismatched-campaignId fans anyway).
        if (campaignId !== this.campaignId && this.campaignId && this.socket) {
            this.socket.emit('leave-campaign', { campaignId: this.campaignId });
        }
        if (changed) this.engagementClosed.set(false); // ORDER-5 E-4 — a new key starts OPEN until the server says otherwise
        this.campaignId = campaignId;
        this.engagementKey = engagementKey;
        if (!this.socket) {
            // DEPLOY-002 P4: send the GM session JWT in the handshake (auth.token → the host's P2 ownership
            // path). An account-less player sends no token → the gateway's P3 confinement applies. socket.io
            // reads auth at construction; the GM dashboard only mounts post-login, so the token is present here.
            this.socket = io(this.origin(), { transports: ['websocket', 'polling'], reconnection: true, auth: { token: this.sessionToken() } });
            this.socket.on('connect', () => { this.lastPendingPhase = -1; this.connected.set(true); this.join(); this.rejoinLobby(); this.battleSync(); this.favoriteSync(); this.campaignSyncEmit(); }); // (re)connect → full resync (claims + lobby + battle + favorite + campaign); REBASE-1 P3 item 1: reset the pending dedup so the next re-derivation re-reports (the server cleared pending on disconnect)
            this.socket.on('disconnect', () => this.connected.set(false));
            this.socket.on('connect_error', () => this.connected.set(false)); // reconnect attempts fail while offline
            this.socket.on('claims', (p: { engagementKey: string; claims: Claim[] }) => {
                if (!p || p.engagementKey !== this.engagementKey) return; // ignore other engagements
                this.claims.set(Object.fromEntries((p.claims || []).map((c) => [c.instanceId, c])));
            });
            this.socket.on('lobby', (roster: LobbyPlayer[]) => {
                const list = Array.isArray(roster) ? roster : [];
                this.lobby.set(list);
                // PD3 P2 (PD3-9) — RE-SEED this device's own preference from the fan: the server preserves the recipient's own
                // sidePref (roster-redact), but the signal was local-only, so a reload read "unpicked" over a stored pick.
                const me = list.find((p) => p.token === this.token());
                if (me && 'sidePref' in me) this.mySidePref.set(me.sidePref === 'a' || me.sidePref === 'b' ? me.sidePref : null);
            });
            this.socket.on('favorite', (f: { instanceId?: string | null; pilotId?: string | null }) => this.favorite.set({ instanceId: f?.instanceId ?? null, pilotId: f?.pilotId ?? null }));
            this.socket.on('campaign', (snap: unknown) => { // P4: the player's host snapshot over the socket
                this.campaignSnapshot.set(snap ?? null);
                // GM-2 P2a test seam (OPT-IN: localStorage['bce.test.snapshot']) — expose the LAST RECEIVED wire snapshot so a
                // harness can prove what THIS device was fanned (the H14 negative: no other company's terms), never a re-render.
                try { if (typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.snapshot') === '1') (window as unknown as { __bceLastCampaign?: unknown }).__bceLastCampaign = snap; } catch { /* no storage */ }
            });
            this.socket.on('hello', (m: { version?: string }) => this.onServerVersion(m?.version)); // HOTFIX-028 version handshake
            // GM-1 P3 — the join-with-force lanes: 'import-request' arrives on GM sockets only (server-shaped
            // per-recipient); 'denied' finally gets a CLIENT consumer (the import one-shot + any future UX).
            this.socket.on('import-request', (r: ImportRequest) => { if (r?.campaignId === this.campaignId) this.importRequests.update((q) => [...q, r]); });
            this.socket.on('sign-contract', (r: SignRequest) => { if (r?.campaignId === this.campaignId) this.signRequests.update((q) => [...q, r]); }); // GM-2 P2b — GM sockets only
            // ODM-18 P1 — company-console intents arrive on GM sockets only (server-fanned; the GM applies)
            this.socket.on('odm-intent', (r: OdmIntent) => { if (r?.campaignId === this.campaignId) this.odmIntents.update((q) => [...q, r]); });
            this.socket.on('denied', (d: { event?: string; reason?: string }) => this.lastDenied.set({ event: d?.event ?? '', reason: d?.reason ?? '', at: Date.now() }));
            // D-048 phase B — a per-instance battle delta: update the map + push to loaded sheets.
            this.socket.on('battle', (p: { engagementKey: string; instanceId: string; state: unknown; at: number }) => {
                if (!p || p.engagementKey !== this.engagementKey || !p.instanceId) return;
                this.battleStates.update((m) => ({ ...m, [p.instanceId]: { state: p.state, at: p.at } }));
                this.battleListeners.forEach((cb) => cb(p.instanceId, p.state, p.at));
            });
            // ORDER-5 E-4 — the server's word that the GM CLOSED this engagement (ORDER-4): the room event at resolve, and the flag
            // every battle-sync reply carries (a reload / late join learns it on connect). The player's Resolved banner reads it.
            this.socket.on('engagement-closed', (e: { engagementKey?: string }) => { if (e?.engagementKey === this.engagementKey) this.engagementClosed.set(true); });
            // The full resync (reconnect / late-join): replace the map + push each to loaded sheets.
            this.socket.on('battle-state', (p: { engagementKey: string; states: { instanceId: string; state: unknown; at: number }[]; closed?: boolean }) => {
                if (!p || p.engagementKey !== this.engagementKey) return;
                this.engagementClosed.set(p.closed === true); // ORDER-5 E-4 — the server's flag, not only the client's inference
                const m: Record<string, { state: unknown; at: number }> = {};
                for (const s of p.states || []) m[s.instanceId] = { state: s.state, at: s.at };
                this.battleStates.set(m);
                (p.states || []).forEach((s) => this.battleListeners.forEach((cb) => cb(s.instanceId, s.state, s.at)));
            });
        } else if (changed && this.socket.connected) {
            this.claims.set({}); // clear stale view; the join resyncs the truth
            this.battleStates.set({}); // a new engagement starts clean
            this.join();
            this.battleSync();
        }
    }

    private join(): void {
        this.socket?.emit('join', { campaignId: this.campaignId, engagementKey: this.engagementKey });
    }
    private battleSync(): void {
        this.socket?.emit('battle-sync', { campaignId: this.campaignId, engagementKey: this.engagementKey });
    }

    /** DEPLOY-002 P4 (player only): request the host campaign snapshot over the socket — the cloud player's
     *  REST is gated (no account), so the roster/OpFor ride the P3-confined socket instead. Re-emits on every
     *  (re)connect (the connect handler calls campaignSyncEmit). No-op for the GM (it never enables this). */
    /** HOTFIX-030 — the PLAYER "Reconnect" heal: drop the (possibly half-open) transport and reconnect, which
     *  re-fires the connect handler → re-join the room + re-register in the lobby + re-pull the campaign
     *  snapshot (campaign-sync) + battle/favorite sync. Recovers a stuck phone — a mobile socket that reads
     *  "connected" while its transport is silently dead, so registration + late snapshots never arrive — with
     *  no reload and without losing identity. No-op before the socket exists (the join effect creates it). */
    reconnect(): void {
        const s = this.socket;
        if (!s) return;
        this.connected.set(false); // immediate UI feedback while the transport re-establishes
        try { s.disconnect(); s.connect(); } catch { /* the reconnection option retries on its own */ }
    }

    // HOTFIX-030 — AUTO-HEAL watchdog (player only). A mobile socket can read "connected" while its transport is
    // silently dead (no 'disconnect' fires — see the WS-SMOKE-OFFLINE gotcha), so registration + the campaign
    // snapshot never arrive and the phone sits on "registering…" / empty. The watchdog notices the stuck state
    // (joined-but-unregistered, or wants-snapshot-but-null, while "connected") and auto-reconnect()s — faster
    // than socket.io's ~45s ping timeout — with a cooldown so it never thrashes. GM sockets never trip it.
    private healTimer: ReturnType<typeof setInterval> | null = null;
    private stuckSince = 0;
    private lastHealAt = 0;
    private startHealthWatch(): void {
        if (this.healTimer || typeof setInterval === 'undefined') return;
        this.healTimer = setInterval(() => this.healthCheck(), 3000);
    }
    private healthCheck(): void {
        if (!this.socket) return;
        const isPlayer = this.wantsCampaign || this.lobbyMode === 'player'; // GM: false → no-op
        if (!isPlayer) return;
        const connected = this.connected();
        const joinedButUnregistered = this.lobbyMode === 'player' && connected && !this.registered();
        const snapshotMissing = this.wantsCampaign && connected && this.campaignSnapshot() === null;
        if (!(joinedButUnregistered || snapshotMissing)) { this.stuckSince = 0; return; }
        const now = Date.now();
        if (!this.stuckSince) { this.stuckSince = now; return; }
        if (now - this.stuckSince > 7000 && now - this.lastHealAt > 15000) {
            this.lastHealAt = now;
            this.stuckSince = 0;
            this.reconnect(); // auto-heal
        }
    }

    enableCampaignSync(): void { this.wantsCampaign = true; this.startHealthWatch(); this.campaignSyncEmit(); }
    private campaignSyncEmit(): void {
        if (this.wantsCampaign && this.campaignId) this.socket?.emit('campaign-sync', { campaignId: this.campaignId });
    }

    /** HOTFIX-028 — clear the per-campaign socket-layer mirrors when the player SWITCHES campaigns (a new QR),
     *  so the previous session's claims / lobby roster / battle states / host snapshot never bleed into the new
     *  one. Identity (device token, player name, side) is deliberately untouched. */
    resetCampaignResidue(): void {
        this.engagementClosed.set(false); // ORDER-5 E-4
        this.claims.set({});
        this.lobby.set([]);
        this.battleStates.set({});
        this.campaignSnapshot.set(null);
        this.favorite.set({ instanceId: null, pilotId: null });
    }

    /** HOTFIX-028 — version handshake. The server greets every socket with its deployed build commit; a stale
     *  cached bundle (older baked hash) surfaces the update banner and, at most once per hour, self-heals via a
     *  cache-evicting reload. Suppressed when either side is unknown/empty so a co-deploy gap or an un-stamped
     *  dev build never false-alarms. */
    private onServerVersion(server?: string): void {
        // HOTFIX-036 — the PLAYER app is no-store (always the current bundle), so an "update available" banner is
        // never legitimate there; it only appears when a stale service worker serves an old bundle, and tapping
        // it reloads into that SW's GM-index fallback (the "tap to update → GM sign-in" bug). Suppress on player.
        if ((globalThis as { __bcePlayerBundle?: boolean }).__bcePlayerBundle) return;
        const local: string = BUILD_COMMIT_HASH; // widen the generated literal so the compare isn't narrowed away
        if (!server || server === 'unknown' || !local || local === 'unknown' || server === local) return;
        // TESTER-4 (1) — notify ONCE PER NEW SERVER VERSION, then stay quiet: the hello fires on every (re)connect and the
        // guarded reload used to re-arm hourly, so a co-deploy gap where the web host lags the api (the exact live case:
        // Pages still serving an older bundle than Railway's commit) re-toasted + re-reloaded all session long. Now the
        // auto-reload happens at most once per server version (a reload that doesn't fix the mismatch is not retried),
        // and the banner is keyed by server version so a dismissal/tap holds until a NEWER server version appears.
        this.serverVersion.set(server);
        this.updateAvailable.set(true);
        try {
            const KEY = 'bce.update.autoReloadFor';
            if (localStorage.getItem(KEY) !== server) { localStorage.setItem(KEY, server); void evictAndReload(); }
        } catch { /* localStorage blocked — the banner still offers the manual update */ }
    }

    // ── D-048 LOBBY (client half) — join → name → side; the GM observes + reassigns/kicks ──
    /** Re-announce the lobby role on every (re)connect (mirrors join() for claims). No-op for the
     *  claims-only GM panel (lobbyMode stays null) → the D-042 surface is unchanged. */
    private rejoinLobby(): void {
        if (!this.campaignId) return;
        if (this.lobbyMode === 'player') {
            this.socket?.emit('join-lobby', { campaignId: this.campaignId, token: this.token(), name: this.playerName() || 'Player', side: this.side() });
            /* TESTER-PLAYTEST-1 #2 — CLAIM RECOVERY after a device interruption (universal: Traditional, HS
               and ODM all ride this path). The device token is DURABLE (bce.device.token in localStorage —
               it survives sleep, back-out, tab discard and reload), so nothing is ever actually lost. What
               broke was the ORDER: on (re)connect the client emits `join` BEFORE `join-lobby`, and the
               server shapes its claims reply with redactClaims(full, client.data.lobbyToken) — which is
               still UNDEFINED at that moment, so every claim including the player's OWN came back
               anonymised. heldByMe() then compared the durable token against an anonId, judged the player's
               own machines to belong to a stranger, and rendered them .taken. join-lobby binds a moment
               later but replies with `lobby` only, so nothing ever re-sent the claims and the lockout
               persisted for the rest of the session.
               The fix is to ask again AFTER the identity is bound: `resync` exists for exactly this and
               returns the set shaped for the now-bound socket. Covers the reconnect race AND the very first
               join (where the claims fetch also precedes joinLobby()). Ownership is UNCHANGED — the server
               still matches the same token, so a stranger presenting a different one is denied at
               join-lobby's rebind check and still sees anonymised claims (HARDEN-5b / HARDEN-7 intact). */
            this.socket?.emit('resync', { campaignId: this.campaignId, engagementKey: this.engagementKey });
        } else if (this.lobbyMode === 'observer') {
            this.socket?.emit('lobby-sync', { campaignId: this.campaignId });
        }
    }
    /** Player: register (or re-announce name/side) in the lobby. Safe before connect — connect replays it. */
    joinLobby(): void { this.lobbyMode = 'player'; this.startHealthWatch(); this.rejoinLobby(); }
    /** GM/observer: subscribe to the roster without registering as a player. */
    observeLobby(): void { this.lobbyMode = 'observer'; this.rejoinLobby(); }
    /** GM: move a player to a side (BLUFOR/OPFOR). */
    reassign(token: string, side: string): void { this.socket?.emit('reassign', { campaignId: this.campaignId, token, side }); }
    /** GM: remove a player from the lobby (token can re-join — the room is trusted, ROLE-001). */
    kick(token: string): void { this.socket?.emit('kick', { campaignId: this.campaignId, token }); }
    /** Player: leave the lobby (self). */
    leaveLobby(): void { this.socket?.emit('leave-lobby', { campaignId: this.campaignId, token: this.token() }); }

    // ── D-048 PHASE B — battle-state channel (the live-damage fan, engine-authoritative) ──
    /** Publish one instance's edited sheet state -> host persists + fans the delta to the room. */
    publishBattle(instanceId: string, state: unknown): void {
        this.socket?.emit('battle', { campaignId: this.campaignId, engagementKey: this.engagementKey, instanceId, state, at: Date.now() });
    }
    /** ORDER-5 E-4 — TRUE once the SERVER has said this engagement is closed (the ORDER-4 close): set by the 'engagement-closed'
     *  room event and by every battle-sync reply's `closed`; reset when the engagement key changes (a new track opens). The
     *  player's Resolved banner + the read-only sheet read this beside the client's own retained-view inference. */
    readonly engagementClosed = signal(false);
    /** ORDER-4 H18 — the GM's resolve ENDS the engagement explicitly: the server marks the key closed and refuses every later
     *  battle write to it (claims untouched). Sent as the LAST step of a resolve by both resolve services (+ Traditional, the
     *  same Classic path). ensure() first so a GM who never opened a claims surface still has the socket; socket.io buffers an
     *  emit until connect. GM-only on the server; harmless where no players are joined. */
    closeEngagement(campaignId: string, engagementKey: string): void {
        this.ensure(campaignId, engagementKey);
        this.socket?.emit('engagement-close', { campaignId, engagementKey });
    }
    /** Subscribe to inbound battle deltas (BattleForceService applies them to loaded sheets).
     *  Returns an unsubscribe. */
    onBattle(cb: (instanceId: string, state: unknown, at: number) => void): () => void {
        this.battleListeners.add(cb);
        return () => this.battleListeners.delete(cb);
    }

    /** D-048 phase D — fetch the host's CURRENT battle state for an engagement NOW (one-shot), so the
     *  reconcile at resolve has the authoritative player-entered damage even if this device never joined
     *  the room / opened a sheet. Connects if needed; resolves with whatever has arrived by the timeout
     *  (offline → the last-known map — best-effort, the resolve never blocks). */
    syncBattleStatesNow(campaignId: string, engagementKey: string): Promise<Record<string, { state: unknown; at: number }>> {
        return this.syncBattleStatesTimed(campaignId, engagementKey).then((r) => r.states);
    }
    /** DIRECTIVE-PD3 P1 (PD3-12) — the same one-shot sync, REPORTING: `connected` = a socket existed to ask; `timedOut` = the
     *  host never answered within the 3 s window (the map returned is then the last-known one, NOT the host's word). The
     *  reconcile turns either into a LOUD failure instead of a silent 0. `bce.test.pd3` = 'timeout' (localStorage, a test
     *  seam) forces the timed-out shape so the failure path can be witnessed by a harness without killing the api. */
    syncBattleStatesTimed(campaignId: string, engagementKey: string): Promise<{ states: Record<string, { state: unknown; at: number }>; connected: boolean; timedOut: boolean }> {
        this.ensure(campaignId, engagementKey);
        const s = this.socket;
        if (!s) return Promise.resolve({ states: this.battleStates(), connected: false, timedOut: false });
        let forcedTimeout = false;
        try { forcedTimeout = typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.pd3') === 'timeout'; } catch { forcedTimeout = false; }
        if (forcedTimeout) return Promise.resolve({ states: this.battleStates(), connected: true, timedOut: true });
        return new Promise((resolve) => {
            let done = false;
            const finish = (timedOut: boolean): void => { if (done) return; done = true; s.off('battle-state', h); clearTimeout(timer); resolve({ states: this.battleStates(), connected: true, timedOut }); };
            const h = (p: { engagementKey?: string }): void => { if (p?.engagementKey === engagementKey) finish(false); }; // the persistent handler set battleStates first
            s.on('battle-state', h);
            s.emit('battle-sync', { campaignId, engagementKey }); // socket.io buffers until connect
            const timer = setTimeout(() => finish(true), 3000);
        });
    }

    // ── D-048 PHASE C — favorite (campaign-persistent, per-player; host round-trip echoes 'favorite') ──
    private favoriteSync(): void {
        this.socket?.emit('favorite-sync', { campaignId: this.campaignId, token: this.token() });
    }
    /** Star a unit/pilot (toggle in the caller). Optimistic set; the host echo confirms/corrects. */
    setFavorite(instanceId: string | null, pilotId: string | null): void {
        this.favorite.set({ instanceId, pilotId });
        this.socket?.emit('favorite', { campaignId: this.campaignId, token: this.token(), instanceId, pilotId });
    }

    // ── GM-1 P2 — the ADVISORY side preference for the presented hotspot. Optimistic local signal (this
    //    device's own pick — the server strips others' prefs from player recipients anyway); the lobby row
    //    is durable server-side (SQLite), so no reconnect re-emit is needed. Emit AFTER joinLobby (the
    //    token must be bound — D-048 ordering holds on the player pages). ──
    readonly mySidePref = signal<'a' | 'b' | null>(null);
    setSidePref(pref: 'a' | 'b' | null): void {
        this.mySidePref.set(pref);
        this.socket?.emit('side-pref', { campaignId: this.campaignId, token: this.token(), pref });
    }

    // ── REBASE-1 P3 item 1 — report this device's UN-ENDED-pick count so the GM's lobby/claims shows who still has
    //    unshared damage before Resolve (the pin fans damage only at END PHASE). Own-token, ephemeral server-side. ──
    private lastPendingPhase = -1;
    setPhasePending(count: number): void {
        if (count === this.lastPendingPhase) return; // dedup — the player-sheet effect fires on every re-derivation
        this.lastPendingPhase = count;
        this.socket?.emit('phase-pending', { campaignId: this.campaignId, token: this.token(), count });
    }

    // ── GM-1 P3 — JOIN-WITH-FORCE ──
    /** GM-2 P2b — GM side: a phone's signing, queued for the ContractSignService (the import-request pattern). */
    readonly signRequests = signal<SignRequest[]>([]);
    consumeSignRequest(): SignRequest | null {
        const q = this.signRequests();
        if (!q.length) return null;
        this.signRequests.set(q.slice(1));
        return q[0];
    }
    /** GM-2 P2b — the phone's last signing receipt (ack / denied / timeout) for the brief's honest note. */
    readonly lastSignResult = signal<{ ok: boolean; reason?: string; at: number } | null>(null);
    /** Player side: sign THIS company's contract on the phone — one-shot (ack or denied, the odm-intent pattern). */
    sendSignContract(key: string, contract: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
        const s = this.socket;
        if (!s) return Promise.resolve({ ok: false, reason: 'offline' });
        const nonce = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        return new Promise((resolve) => {
            let done = false;
            const finish = (r: { ok: boolean; reason?: string }): void => { if (done) return; done = true; s.off('sign-contract-ack', okH); s.off('denied', dnH); clearTimeout(timer); this.lastSignResult.set({ ...r, at: Date.now() }); resolve(r); };
            const okH = (d: { nonce?: string; delivered?: boolean } | null): void => { if (d?.nonce === nonce && d?.delivered) finish({ ok: true }); };
            const dnH = (d: { event?: string; reason?: string; nonce?: string } | null): void => { if (d?.event === 'sign-contract' && d?.nonce === nonce) finish({ ok: false, reason: d?.reason ?? 'denied' }); };
            s.on('sign-contract-ack', okH);
            s.on('denied', dnH);
            s.emit('sign-contract', { campaignId: this.campaignId, token: this.token(), key, contract, nonce });
            const timer = setTimeout(() => finish({ ok: false, reason: 'timeout — the host did not answer' }), 6000);
        });
    }
    /** GM side: import requests fanned from the server (GM sockets only), queued for the merge service. */
    readonly importRequests = signal<ImportRequest[]>([]);
    consumeImportRequest(): ImportRequest | null {
        const q = this.importRequests();
        if (!q.length) return null;
        this.importRequests.set(q.slice(1));
        return q[0];
    }
    /** The last 'denied' ack this socket received (event + reason) — the client-side observability HARDEN-5
     *  never had; the import one-shot listens through it. */
    readonly lastDenied = signal<{ event: string; reason: string; at: number } | null>(null);
    // ── ODM-18 P1 — the company-console intent lanes ──
    /** GM side: intents queued for the apply service (the import-request pattern). */
    readonly odmIntents = signal<OdmIntent[]>([]);
    consumeOdmIntent(): OdmIntent | null {
        const q = this.odmIntents();
        if (!q.length) return null;
        this.odmIntents.set(q.slice(1));
        return q[0];
    }
    /** Player side: send one intent, one-shot (ack or denied — the importForce promise pattern; emit AFTER
     *  joinLobby, never in the reconnect chain). */
    sendOdmIntent(verb: string, payload: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
        const s = this.socket;
        if (!s) return Promise.resolve({ ok: false, reason: 'offline' });
        // nonce (panel fix): the server echoes it in ack AND deny — two same-verb intents in flight no
        // longer resolve each other's promises (a deploy's denial was swallowed by its sibling's ack).
        const nonce = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        return new Promise((resolve) => {
            let done = false;
            const finish = (r: { ok: boolean; reason?: string }): void => { if (done) return; done = true; s.off('odm-intent-ack', okH); s.off('denied', dnH); clearTimeout(timer); resolve(r); };
            const okH = (d: { verb?: string; nonce?: string; delivered?: boolean } | null): void => { if (d?.nonce === nonce && d?.delivered) finish({ ok: true }); };
            const dnH = (d: { event?: string; reason?: string; nonce?: string } | null): void => { if (d?.event === 'odm-intent' && d?.nonce === nonce) finish({ ok: false, reason: d?.reason ?? 'denied' }); };
            s.on('odm-intent-ack', okH);
            s.on('denied', dnH);
            s.emit('odm-intent', { campaignId: this.campaignId, token: this.token(), verb, payload, nonce });
            const timer = setTimeout(() => finish({ ok: false, reason: 'timeout — the host did not answer' }), 6000);
        });
    }

    /** Player side: the one-shot company import (D-048 ordering — call AFTER joinLobby). NOT in the
     *  reconnect-resync chain by design: replaying an import on every wifi blip would duplicate the ask. */
    importForce(payload: { units: unknown[]; pilots: unknown[]; engagementKey: string; name: string; sourceCampaignId?: string; reputation?: number }): Promise<{ ok: boolean; reason?: string; instanceIds?: string[] }> {
        const s = this.socket;
        if (!s) return Promise.resolve({ ok: false, reason: 'offline' });
        return new Promise((resolve) => {
            let done = false;
            const finish = (r: { ok: boolean; reason?: string; instanceIds?: string[] }): void => { if (done) return; done = true; s.off('force-imported', okH); s.off('denied', dnH); clearTimeout(timer); resolve(r); };
            const okH = (d: { instanceIds?: string[] } | null): void => { if (d && Array.isArray(d.instanceIds)) finish({ ok: true, instanceIds: d.instanceIds }); };
            const dnH = (d: { event?: string; reason?: string } | null): void => { if (d?.event === 'import-force') finish({ ok: false, reason: d?.reason ?? 'denied' }); };
            s.on('force-imported', okH);
            s.on('denied', dnH);
            s.emit('import-force', { campaignId: this.campaignId, token: this.token(), ...payload });
            const timer = setTimeout(() => finish({ ok: false, reason: 'timeout — the host did not answer' }), 6000);
        });
    }

    claim(instanceId: string): void {
        this.socket?.emit('claim', { campaignId: this.campaignId, engagementKey: this.engagementKey, instanceId, holderName: this.playerName() || 'GM', holderToken: this.token() });
    }
    release(instanceId: string): void {
        this.socket?.emit('release', { campaignId: this.campaignId, engagementKey: this.engagementKey, instanceId, holderToken: this.token() });
    }

    /** Whether the current device holds this instance (drives claim vs release affordance). */
    heldByMe(instanceId: string): boolean {
        return this.claims()[instanceId]?.holderToken === this.token();
    }
}
