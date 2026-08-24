/*
 * BCE ENGINE slice 2 (DIRECTIVE-042) — the WebSocket fan-out gateway (socket.io).
 * Rooms = campaignId (the room IS the boundary, ROLE-001). On every claim/release the host
 * recomputes the authoritative set and emits it to the whole room → "that 'Mech is taken, and
 * who holds it" is true across devices within a round-trip. JOIN returns the current set to the
 * joiner (reconnect → full resync, no stale/ghost claims). socket.io's built-in reconnection
 * matches "the token survives a wifi drop" (T-030). This is a CAMPAIGN/ENGINE feature living in
 * apps/api — the client half lives in the BCE campaign layer; the MekBay core imports neither
 * (MERGE-002, one-way).
 *
 * DIRECTIVE-HARDEN-5 (ROLE-001 delivered) — the ACTION layer beneath the existing ACCESS gate:
 *  · Part A: every mutating payload is type-guarded (ws-validate.ts) before any state is touched; the
 *    battle `state` is shape-checked + size-bounded (256 KB). Malformed → a 'denied' error ack, no write.
 *  · Part B: server-side authorization, matching deniedAccess's auth-on/auth-off posture EXACTLY —
 *    auth OFF (dev/LAN, the trusted single-tenant model) stays fully permissive; auth ON establishes
 *    identity (GM = live-verified approved owner/admin via the handshake JWT; player = the lobbyToken
 *    bound at join-lobby or first token-scoped use) and bites ONLY on cross-identity/cross-role actions:
 *    reassign/kick = GM-only · claim/release/favorite/leave-lobby = GM or own bound token · battle = GM
 *    or bound participant. Unauthorized → a 'denied' ack, never a silent/partial write. Read-only
 *    handlers (resync/campaign-sync/battle-sync/lobby-sync/favorite-sync/join) are unchanged.
 *    Follow-up (flagged, not this pass): per-unit pilot ownership on `battle` (any bound participant may
 *    still write any instance's state).
 */
import { Logger } from '@nestjs/common';
import {
    type OnGatewayConnection,
    type OnGatewayDisconnect,
    type OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ClaimsService } from './claims.service';
import { LobbyService } from './lobby.service';
import { BattleStateService } from './battle-state.service';
import { FavoritesService } from './favorites.service';
import { AuthService } from '../auth/auth.service';
import { PresenceService } from '../auth/presence.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { buildCommit } from '../version';
import { vJoin, vClaim, vRelease, vLobbyJoin, vLobbyMut, vBattle, vFavorite } from './ws-validate';
import { redactLobby, redactClaims } from './roster-redact';
import { isGmDecision, accessDecision, actionDecision } from './ws-authz';
import type { LobbyPlayer } from './lobby.service';
import type { Claim } from './claims.service';

// localhost-first CORS; LAN reflects origin when BCE_HOST=0.0.0.0 / BCE_LAN=1 (mirrors D-041 REST).
const LAN = process.env.BCE_HOST === '0.0.0.0' || process.env.BCE_LAN === '1';
const CORS = { origin: LAN ? true : [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/], methods: ['GET', 'POST'] };

interface JoinMsg { campaignId: string; engagementKey: string; }
interface ClaimMsg extends JoinMsg { instanceId: string; holderName: string; holderToken: string; at?: number; }
interface ReleaseMsg extends JoinMsg { instanceId: string; holderToken?: string; }
// D-048 lobby (join → name → side); the room IS campaignId, the boundary (ROLE-001).
interface LobbyJoinMsg { campaignId: string; token: string; name: string; side: string; }
interface LobbyMutMsg { campaignId: string; token: string; side?: string; }
// D-048 phase B — per-instance battle state (the live-damage channel; engagementKey-scoped like claims).
interface BattleMsg { campaignId: string; engagementKey: string; instanceId: string; state: unknown; at?: number; }
interface BattleSyncMsg { campaignId: string; engagementKey: string; }
// D-048 phase C — per-player favorite (campaign-persistent; per-player, no fan).
interface FavoriteMsg { campaignId: string; token: string; instanceId?: string | null; pilotId?: string | null; }

@WebSocketGateway({ cors: CORS })
export class ClaimsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server!: Server;
    private readonly log = new Logger('ClaimsGateway');

    constructor(
        private readonly claims: ClaimsService,
        private readonly lobby: LobbyService,
        private readonly battle: BattleStateService,
        private readonly favorites: FavoritesService,
        private readonly auth: AuthService,
        private readonly presence: PresenceService,
        private readonly campaigns: CampaignsService,
    ) {}

    /** DEPLOY-002 P4 (player live-sync) — after every authoritative campaign WRITE, fan the fresh snapshot to
     *  that campaign's room. A joined player (in the room via 'join') receives 'campaign' → hydrateFromSocket →
     *  its mission tree tracks the GM live, so the engagement unfreezes the instant the GM generates a track /
     *  deploys a 'Mech (no longer stuck on the one-shot connect pull that races the GM's debounced persist).
     *  The GM never consumes 'campaign' (it hydrates via REST) → no re-save loop. Same payload shape as the
     *  one-shot 'campaign-sync' reply, so the client's existing on('campaign') handler covers both. */
    afterInit(): void {
        this.campaigns.changes$.subscribe((id) => {
            if (id) this.server.to(id).emit('campaign', this.campaigns.rawSnapshot(id));
        });
    }

    handleConnection(client: Socket): void {
        this.log.log(`socket connect ${client.id}`);
        // HOTFIX-028 — version handshake: greet every socket with the deployed build commit. The client
        // compares it to its baked BUILD_COMMIT_HASH on connect/reconnect; a stale cached bundle (older hash)
        // surfaces the non-blocking "new version — tap to update" banner. Fires before any auth work so it
        // reaches players and GMs alike; 'unknown' when the server has no git env → the client suppresses.
        client.emit('hello', { version: buildCommit() });
        // DEPLOY-002 P2/P3 + DEPLOY-003: store the handshake token; the GM user is re-resolved LIVE per
        // event in deniedAccess, so a BAN (or a revoked approval) takes effect on the socket's very next
        // event — no stale cached status survives the ban.
        client.data.gmToken = (client.handshake?.auth as { token?: string } | undefined)?.token ?? null;
        // DEPLOY-010: an AUTHED socket counts toward live presence + refreshes lastSeen (the socket channel
        // is the other half of "active" beyond HTTP). Account-less players (no token) aren't counted. The
        // userId is cached on the socket so disconnect decrements the SAME id even after a mid-session ban.
        const user = client.data.gmToken ? this.auth.userFromToken(client.data.gmToken) : null;
        if (user) {
            client.data.userId = user.id;
            this.presence.connect(user.id);
            this.auth.touchSeen(user.id);
        }
        // P2+P3 access gate (ONE choke point for EVERY campaign-scoped event — rooms/claims/battle/lobby/
        // favorite). A GM socket (token) may touch ONLY campaigns it owns (P2). An account-less PLAYER
        // socket (no token) is CONFINED to the ONE campaign it first joined (P3) — so a player in GM-A's
        // session cannot reach GM-B's campaign on any channel. Dev/LAN (auth off) is the trusted
        // single-tenant model (D-048 unchanged).
        client.use((event, next) => {
            const payload = event[1] as { campaignId?: string } | undefined;
            if (payload?.campaignId && this.deniedAccess(client, payload.campaignId)) {
                next(new Error('forbidden: not your campaign/session'));
                return;
            }
            next();
        });
    }

    /** Deny iff a GM is banned/un-approved (P4/DEPLOY-003), OR a GM doesn't own the campaign (P2), OR a
     *  player reaches a campaign other than the one its socket joined (P3). Returns false (allow) in
     *  dev/LAN, for approved admins, and for a GM's own campaign. The GM user is re-resolved LIVE from the
     *  stored token here (not cached at connect) → a ban bites on the next event. */
    private deniedAccess(client: Socket, campaignId: string): boolean {
        // HARDEN-6 — thin adapter: gather inputs, call the pure accessDecision, apply the bind side effect.
        const token = client.data?.gmToken as string | null | undefined;
        const user = token ? this.auth.userFromToken(token) : null;
        const r = accessDecision({
            user,
            authRequired: AuthService.authRequired(),
            ownerId: user ? this.campaigns.getOwnerId(campaignId) : null,
            campaignId,
            boundCampaignId: client.data?.boundCampaignId as string | undefined,
            campaignExists: this.campaigns.exists(campaignId),
        });
        if (r.bindCampaignId) client.data.boundCampaignId = r.bindCampaignId;
        return r.deny;
    }
    // ── DIRECTIVE-HARDEN-5 — the ACTION-authorization layer (beneath the deniedAccess ACCESS gate). ──
    /** The error ack for a rejected message: additive (current clients ignore it), observable by tooling. */
    private deny(client: Socket, event: string, reason: string): void {
        this.log.warn(`denied '${event}' from ${client.id}: ${reason}`);
        client.emit('denied', { event, reason });
    }
    /** A live-verified GM of this campaign — mirrors deniedAccess's GM branch EXACTLY (re-resolved from the
     *  stored token per call, so a ban bites immediately; approved admin passes; else owner match). */
    private isGm(client: Socket, campaignId: string): boolean {
        // HARDEN-6 — thin adapter over isGmDecision.
        const token = client.data?.gmToken as string | null | undefined;
        const user = token ? this.auth.userFromToken(token) : null;
        return isGmDecision({ user, ownerId: user ? this.campaigns.getOwnerId(campaignId) : null });
    }
    /** The per-action authorization rule. Matches deniedAccess's posture: auth OFF → always allow (dev/LAN,
     *  the trusted single-tenant model — D-048 unchanged). Auth ON: a verified GM may do anything here;
     *  'gm' actions need that; 'participant' needs a bound lobby identity; 'token' actions must present the
     *  socket's OWN bound token — with the P3-style lazy bind: a socket's FIRST token-scoped message binds
     *  its identity if join-lobby hasn't already (so an account-less guest is never locked out by ordering),
     *  and every later message must match it. */
    /** HARDEN-5+5b action gate (post-lazy-bind-removal): identity is bound ONLY at join-lobby; a token-scoped
     *  action requires an already-bound matching token. HARDEN-6 — a thin adapter over the pure actionDecision. */
    private allowed(client: Socket, campaignId: string, kind: 'gm' | 'token' | 'participant', msgToken?: unknown): boolean {
        return actionDecision({
            authRequired: AuthService.authRequired(),
            isGm: this.isGm(client, campaignId),
            kind,
            boundToken: client.data?.lobbyToken as string | undefined,
            msgToken,
        });
    }

    // ── HARDEN-5b (Part A) — per-recipient roster/claims shaping: the GM socket gets the FULL fan (it kicks/
    //    reassigns BY token; the claims-board kick + HOTFIX-030 presence depend on real tokens); a NON-GM player
    //    gets a redacted copy (others' tokens → an opaque handle; its own token preserved for self-identity).
    //    Gated on authRequired(): dev/LAN (auth off) keeps the trusted single-tenant full-roster model unchanged. ──
    /** The lobby roster shaped for ONE recipient socket (full for a GM / dev-LAN; redacted for a hosted player). */
    private lobbyFor(client: Socket, campaignId: string, full: LobbyPlayer[]): LobbyPlayer[] {
        if (!AuthService.authRequired() || this.isGm(client, campaignId)) return full;
        return redactLobby(full, client.data?.lobbyToken as string | undefined);
    }
    /** Fan a lobby roster to the room, shaped PER-RECIPIENT. Single-node: iterate the room's live sockets. */
    private fanLobby(campaignId: string, full: LobbyPlayer[]): void {
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('lobby', full); return; } // dev/LAN — full to all
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            sock.emit('lobby', this.isGm(sock, campaignId) ? full : redactLobby(full, sock.data?.lobbyToken as string | undefined));
        }
    }
    /** Fan a claims set to the room, shaped PER-RECIPIENT (others' holderToken redacted for non-GM players). */
    private fanClaims(campaignId: string, engagementKey: string, full: Claim[]): void {
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('claims', { engagementKey, claims: full }); return; }
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            const claims = this.isGm(sock, campaignId) ? full : redactClaims(full, sock.data?.lobbyToken as string | undefined);
            sock.emit('claims', { engagementKey, claims });
        }
    }
    /** The claims set shaped for ONE recipient (the join/resync direct reply). */
    private claimsFor(client: Socket, campaignId: string, full: Claim[]): Claim[] {
        if (!AuthService.authRequired() || this.isGm(client, campaignId)) return full;
        return redactClaims(full, client.data?.lobbyToken as string | undefined);
    }

    handleDisconnect(client: Socket): void {
        this.log.log(`socket disconnect ${client.id}`);
        // DEPLOY-010: drop this connection's presence ref (2 tabs → 1 user means the user stays online until
        // the LAST tab closes — ref-counted in PresenceService).
        this.presence.disconnect(client.data?.userId as string | undefined);
        // HOTFIX-030 — a player device dropped: flip its lobby presence to disconnected + re-fan so the GM
        // board's dot goes RED live (the claim stays; a reconnect re-registers → green). Token + campaignId
        // were stashed on this socket at join-lobby (client.data has no player token otherwise).
        const lobbyToken = client.data?.lobbyToken as string | undefined;
        const lobbyCampaignId = client.data?.lobbyCampaignId as string | undefined;
        if (lobbyToken && lobbyCampaignId) {
            const roster = this.lobby.setConnected(lobbyCampaignId, lobbyToken, false);
            this.fanLobby(lobbyCampaignId, roster); // HARDEN-5b — per-recipient (presence dots unchanged; GM keeps tokens)
        }
    }

    /** Join a campaign room + resync: the joiner gets the current claim set for its engagement. */
    @SubscribeMessage('join')
    onJoin(@ConnectedSocket() client: Socket, @MessageBody() msg: JoinMsg): { event: string; data: unknown } {
        const v = vJoin(msg); // HARDEN-5 A — read-only join still validates (it names a room)
        if (!v.ok) { this.deny(client, 'join', v.reason ?? 'invalid payload'); return { event: 'claims', data: { engagementKey: '', claims: [] } }; }
        const { campaignId, engagementKey } = msg;
        client.join(campaignId);
        return { event: 'claims', data: { engagementKey, claims: this.claimsFor(client, campaignId, this.claims.list(campaignId, engagementKey)) } }; // HARDEN-5b — shaped for the caller
    }

    /** Re-request the current set (client-driven resync, e.g. on an engagement change). */
    @SubscribeMessage('resync')
    onResync(@ConnectedSocket() client: Socket, @MessageBody() msg: JoinMsg): { event: string; data: unknown } {
        const { campaignId, engagementKey } = msg || ({} as JoinMsg);
        return { event: 'claims', data: { engagementKey, claims: this.claimsFor(client, campaignId, this.claims.list(campaignId, engagementKey)) } }; // HARDEN-5b — shaped for the caller
    }

    /** DEPLOY-002 P4 — hand the joined account-less PLAYER the campaign snapshot over the socket. In cloud
     *  mode (BCE_AUTH_REQUIRED) the player's REST is 401 (no GM account), so it can't rehydrate the force
     *  via /api/campaigns; the socket is the isolation-correct channel — the `client.use` middleware above
     *  has already P3-confined this campaignId to the socket's bound campaign, so this never crosses
     *  tenants and needs no @Public REST hole. The GM never emits this (it hydrates via REST). */
    @SubscribeMessage('campaign-sync')
    onCampaignSync(@MessageBody() msg: { campaignId: string }): { event: string; data: unknown } {
        const campaignId = msg?.campaignId;
        return { event: 'campaign', data: campaignId ? this.campaigns.rawSnapshot(campaignId) : null };
    }

    @SubscribeMessage('claim')
    onClaim(@ConnectedSocket() client: Socket, @MessageBody() msg: ClaimMsg): void {
        const v = vClaim(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'claim', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId, holderName, holderToken } = msg;
        // HARDEN-5 B — token-scoped: a player claims only AS ITSELF (its bound token); a verified GM as anyone.
        if (!this.allowed(client, campaignId, 'token', holderToken)) { this.deny(client, 'claim', 'not your token'); return; }
        const set = this.claims.claim(campaignId, engagementKey, instanceId, holderName || '', holderToken || '', msg.at || Date.now());
        this.fanClaims(campaignId, engagementKey, set); // HARDEN-5b — per-recipient (others' holderToken redacted for players)
    }

    @SubscribeMessage('release')
    onRelease(@ConnectedSocket() client: Socket, @MessageBody() msg: ReleaseMsg): void {
        const v = vRelease(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'release', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId } = msg;
        // HARDEN-5 B — token-scoped: a player releases only with ITS OWN token; a verified GM releases anyone's.
        if (!this.allowed(client, campaignId, 'token', msg.holderToken)) { this.deny(client, 'release', 'not your token'); return; }
        // HARDEN-5 B — and only a claim it actually HOLDS: with auth on, a non-GM release of another token's
        // claim is denied even when presented under the caller's own identity (releasing unclaimed = no-op, fine).
        if (AuthService.authRequired() && !this.isGm(client, campaignId)) {
            const held = this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId);
            if (held && held.holderToken && held.holderToken !== msg.holderToken) { this.deny(client, 'release', 'not the holder'); return; }
        }
        const set = this.claims.release(campaignId, engagementKey, instanceId);
        this.fanClaims(campaignId, engagementKey, set); // HARDEN-5b — per-recipient
    }

    // ── D-048 LOBBY — join/side roster, fanned to the room (the GM lobby + every player update live) ──
    @SubscribeMessage('join-lobby')
    onJoinLobby(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyJoinMsg): { event: string; data: unknown } {
        const v = vLobbyJoin(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'join-lobby', v.reason ?? 'invalid payload'); return { event: 'lobby', data: [] }; }
        const { campaignId, token, name, side } = msg;
        // HARDEN-5 B — a REBIND to a DIFFERENT token on an already-bound non-GM socket is cross-identity
        // (one device impersonating another) → reject; the same token re-joining (reconnect/rejoinLobby)
        // is the normal idempotent path; a verified GM socket may switch freely. Auth OFF: permissive.
        if (AuthService.authRequired() && !this.isGm(client, campaignId)) {
            const bound = client.data?.lobbyToken as string | undefined;
            if (bound != null && bound !== token) {
                this.deny(client, 'join-lobby', 'socket already bound to another identity');
                return { event: 'lobby', data: this.lobbyFor(client, campaignId, this.lobby.list(campaignId)) }; // HARDEN-5b
            }
        }
        client.join(campaignId);
        // HOTFIX-030 — stash the device token + campaignId so handleDisconnect can flip this player's presence.
        client.data.lobbyToken = token;
        client.data.lobbyCampaignId = campaignId;
        const roster = this.lobby.join(campaignId, token, name || 'Player', side || 'BLUFOR', Date.now());
        this.fanLobby(campaignId, roster); // HARDEN-5b — per-recipient fan (GM full; players redacted)
        return { event: 'lobby', data: this.lobbyFor(client, campaignId, roster) }; // resync the caller (its own token preserved)
    }
    /** The GM lobby (and a reconnecting player) requests the current roster + joins the room. */
    @SubscribeMessage('lobby-sync')
    onLobbySync(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId: string }): { event: string; data: unknown } {
        const campaignId = msg?.campaignId;
        if (campaignId) client.join(campaignId);
        return { event: 'lobby', data: campaignId ? this.lobbyFor(client, campaignId, this.lobby.list(campaignId)) : [] }; // HARDEN-5b — a reconnecting player gets the redacted view; a GM the full roster
    }
    @SubscribeMessage('reassign')
    onReassign(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, true); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'reassign', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, side } = msg;
        // HARDEN-5 B — GM-only: re-siding another player is a GM board action (ROLE-001).
        if (!this.allowed(client, campaignId, 'gm')) { this.deny(client, 'reassign', 'GM only'); return; }
        this.fanLobby(campaignId, this.lobby.reassign(campaignId, token, side as string)); // HARDEN-5b
    }
    @SubscribeMessage('kick')
    onKick(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, false); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'kick', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token } = msg;
        // HARDEN-5 B — GM-only: booting a player is a GM board action (ROLE-001).
        if (!this.allowed(client, campaignId, 'gm')) { this.deny(client, 'kick', 'GM only'); return; }
        this.fanLobby(campaignId, this.lobby.remove(campaignId, token)); // HARDEN-5b
    }
    @SubscribeMessage('leave-lobby')
    onLeaveLobby(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, false); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'leave-lobby', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token } = msg;
        // HARDEN-5 B — token-scoped: a player removes only ITSELF; a verified GM may remove anyone (kick path).
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'leave-lobby', 'not your token'); return; }
        this.fanLobby(campaignId, this.lobby.remove(campaignId, token)); // HARDEN-5b
    }

    // ── D-048 PHASE B — live battle-state fan (per-instance damage/heat/ammo, engine-authoritative) ──
    /** An edited sheet's serialized state -> persist (host record) + fan the DELTA to the whole room. */
    @SubscribeMessage('battle')
    onBattle(@ConnectedSocket() client: Socket, @MessageBody() msg: BattleMsg): void {
        const v = vBattle(msg); // HARDEN-5 A — shape + non-null JSON object + the 256 KB size bound
        if (!v.ok) { this.deny(client, 'battle', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId, state } = msg;
        // HARDEN-5 B — a verified GM or a BOUND session participant (has a lobby identity). Per-unit pilot
        // ownership (only your claimed sheet) is the flagged follow-up — not enforced this pass.
        if (!this.allowed(client, campaignId, 'participant')) { this.deny(client, 'battle', 'not a session participant'); return; }
        const at = msg.at || Date.now();
        this.battle.set(campaignId, engagementKey, instanceId, state, at);
        this.server.to(campaignId).emit('battle', { engagementKey, instanceId, state, at });
    }
    /** Resync the current battle state for an engagement (reconnect / late-join / tab-open). */
    @SubscribeMessage('battle-sync')
    onBattleSync(@ConnectedSocket() client: Socket, @MessageBody() msg: BattleSyncMsg): { event: string; data: unknown } {
        const { campaignId, engagementKey } = msg || ({} as BattleSyncMsg);
        if (campaignId) client.join(campaignId);
        const states = campaignId && engagementKey ? this.battle.list(campaignId, engagementKey) : [];
        return { event: 'battle-state', data: { engagementKey, states } };
    }

    // ── D-048 PHASE C — per-player favorite (campaign-persistent; returned to the caller, no room fan) ──
    @SubscribeMessage('favorite')
    onFavorite(@ConnectedSocket() client: Socket, @MessageBody() msg: FavoriteMsg): { event: string; data: unknown } {
        const v = vFavorite(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'favorite', v.reason ?? 'invalid payload'); return { event: 'favorite', data: { instanceId: null, pilotId: null } }; }
        const { campaignId, token } = msg;
        // HARDEN-5 B — token-scoped: a player sets only ITS OWN favorite; a verified GM anyone's.
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'favorite', 'not your token'); return { event: 'favorite', data: { instanceId: null, pilotId: null } }; }
        return { event: 'favorite', data: this.favorites.set(campaignId, token, msg.instanceId ?? null, msg.pilotId ?? null, Date.now()) };
    }
    @SubscribeMessage('favorite-sync')
    onFavoriteSync(@MessageBody() msg: FavoriteMsg): { event: string; data: unknown } {
        const { campaignId, token } = msg || ({} as FavoriteMsg);
        const fav = campaignId && token ? this.favorites.get(campaignId, token) : { instanceId: null, pilotId: null };
        return { event: 'favorite', data: fav };
    }
}
