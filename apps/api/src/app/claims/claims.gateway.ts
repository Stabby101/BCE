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
import { vJoin, vClaim, vRelease, vLobbyJoin, vLobbyMut, vBattle, vFavorite, vSidePref, vPhasePending, vImportForce, vOdmIntent, vSignContract, vEngagementClose } from './ws-validate';
import { ownCompanyKeysOf } from './snapshot-shape'; // GM-2 P2b — a phone signs only ITS OWN company's contract
import { remintImport, countOwnedImports, importCapOf, type ImportUnit, type ImportPilot } from './import-force'; // GM-1 P3
import { redactLobby, redactClaims, anonId } from './roster-redact';
import { shapeSnapshot } from './snapshot-shape'; // GM-1 P2 — the per-recipient gmOnly strip · GM-2 P2a — + the per-recipient contract attach

/** GM-2 P2a — the recipient's identity for the contract attach: the anonId of the device token it joined the lobby with
 *  (the same handle the mint wrote into provenance.owner). An unbound socket has none → nothing attaches. */
const recipientAnonOf = (s: Socket): string | null => { const t = s.data?.lobbyToken as string | undefined; return t ? anonId(t) : null; };
import { isGmDecision, accessDecision, actionDecision, sideDecision, instanceSideOf, engagementWriteDecision, sidePrefDecision, sidePrefFactsOf } from './ws-authz';
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
// ORDER-4 H18 — the GM's resolve ends the fight explicitly; the server marks the key CLOSED and refuses battle writes after it.
interface EngagementCloseMsg { campaignId: string; engagementKey: string; }
// D-048 phase C — per-player favorite (campaign-persistent; per-player, no fan).
interface FavoriteMsg { campaignId: string; token: string; instanceId?: string | null; pilotId?: string | null; }
// GM-1 P2 — the advisory side preference for the presented hotspot (token-scoped; fanned like reassign).
interface SidePrefMsg { campaignId: string; token: string; pref: 'a' | 'b' | null; }
// REBASE-1 P3 item 1 — this device's UN-ENDED-pick count this phase (token-scoped; fanned on the lobby roster like side-pref).
interface PhasePendingMsg { campaignId: string; token: string; count: number; }
// GM-1 P3 — JOIN-WITH-FORCE: the one-shot serialized-company payload (dedicated message, 128 KB gate).
interface ImportForceMsg { campaignId: string; token: string; engagementKey?: string; name?: string; units: ImportUnit[]; pilots?: ImportPilot[]; sourceCampaignId?: string; reputation?: number; } // GM-2 P1: sourceCampaignId = the player's HOME campaign
// ODM-18 P1 — the company-console INTENT (allowlist-gated verbs; the GM device applies, never the server).
interface OdmIntentMsg { campaignId: string; token: string; verb: string; payload: Record<string, unknown>; nonce?: string; }

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
            if (id) this.fanCampaign(id);
        });
    }

    /** GM-1 P2 — the campaign fan, per-recipient shaped (the HARDEN-5b fanLobby pattern): the snapshot is
     *  parsed ONCE, then each room socket gets it with the gmOnly key STRIPPED unless that recipient is the
     *  verified GM. Dev/LAN short-circuits to the full room emit (the 5b posture — a LAN GM owns the box).
     *  The strip is recipient-conditional, not gmSession-conditional: a snapshot without gmOnly passes
     *  through by reference and this fan is byte-equivalent to the old room emit. */
    private fanCampaign(campaignId: string): void {
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('campaign', snap); return; } // dev/LAN — full to all
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            sock.emit('campaign', shapeSnapshot(snap, this.isGm(sock, campaignId), recipientAnonOf(sock))); // GM-2 P2a — + the recipient's own contract
        }
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
    private deny(client: Socket, event: string, reason: string, nonce?: string): void {
        this.log.warn(`denied '${event}' from ${client.id}: ${reason}`);
        client.emit('denied', nonce ? { event, reason, nonce } : { event, reason }); // nonce (ODM-18 P1): per-send ack correlation, additive
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
    private allowed(client: Socket, campaignId: string, kind: 'gm' | 'token' | 'participant' | 'unit', msgToken?: unknown, instanceHolderToken?: string | null): boolean {
        return actionDecision({
            authRequired: AuthService.authRequired(),
            isGm: this.isGm(client, campaignId),
            kind,
            boundToken: client.data?.lobbyToken as string | undefined,
            msgToken,
            instanceHolderToken, // GM-1 P3 — 'unit' kind only (the claim-row holder the adapter gathered)
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
    onCampaignSync(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId: string }): { event: string; data: unknown } {
        const campaignId = msg?.campaignId;
        if (!campaignId) return { event: 'campaign', data: null };
        // GM-1 P2 — the direct reply is the second fan site: same per-recipient gmOnly strip as fanCampaign
        // (dev/LAN full — the 5b posture). Still a read-only handler; the reply-style shape is unchanged.
        const full = !AuthService.authRequired() || this.isGm(client, campaignId);
        return { event: 'campaign', data: shapeSnapshot(this.campaigns.rawSnapshot(campaignId), full, recipientAnonOf(client)) }; // GM-2 P2a — the second fan site attaches too
    }

    @SubscribeMessage('claim')
    onClaim(@ConnectedSocket() client: Socket, @MessageBody() msg: ClaimMsg): void {
        const v = vClaim(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'claim', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId, holderName, holderToken } = msg;
        // HARDEN-5 B — token-scoped: a player claims only AS ITSELF (its bound token); a verified GM as anyone.
        if (!this.allowed(client, campaignId, 'token', holderToken)) { this.deny(client, 'claim', 'not your token'); return; }
        // GM-1 P3 (panel finding — the claim-steal close): a non-GM may not claim OVER another holder's row.
        // The per-unit battle rule is only as strong as the claim row it keys on — without this guard, "your
        // opponent cannot edit your record" is two messages away (steal the claim, then write the sheet).
        // Mirrors onRelease's holder-match; re-claiming your OWN row stays allowed; the GM reassigns freely.
        if (AuthService.authRequired() && !this.isGm(client, campaignId)) {
            const held = this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId);
            if (held && held.holderToken && held.holderToken !== holderToken) { this.deny(client, 'claim', 'already claimed'); return; }
            // ORDER-2 H15 (SMOKE-ODM-4P S43) — the SIDE is a SERVER rule at claim, not a client-roster signal: the caller's
            // lobby row side vs the instance's side in the snapshot (company → BLUFOR · mission OpFor → OPFOR). The GM is
            // exempt (this branch is non-GM only — reassign is the GM's tool); dev/LAN stays permissive by the SAME
            // authRequired() gate that fences the lookups above (the decider short-circuits too). Denied → no write.
            const bound = client.data?.lobbyToken as string | undefined;
            const row = bound ? this.lobby.list(campaignId).find((p) => p.token === bound) : undefined;
            if (!sideDecision({ authRequired: true, isGm: false, rowSide: row?.side ?? null, instanceSide: instanceSideOf(this.campaigns.rawSnapshot(campaignId), instanceId) })) { this.deny(client, 'claim', 'not your side'); return; }
        }
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
    /** GM-1 P2 — a player's ADVISORY side preference for the presented hotspot. Token-scoped (a player sets
     *  only ITS OWN pref; a verified GM anyone's) and FANNED like reassign — the GM panel watches live; the
     *  per-recipient redaction strips others' prefs from player recipients (roster-redact). */
    @SubscribeMessage('side-pref')
    onSidePref(@ConnectedSocket() client: Socket, @MessageBody() msg: SidePrefMsg): void {
        const v = vSidePref(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'side-pref', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, pref } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'side-pref', 'not your token'); return; }
        // PD3 P2 (PD3-9) — a late pick is a SERVER-SIDE no-op: once a track is generated / the contract is complete, refuse (ws-authz)
        if (!sidePrefDecision(sidePrefFactsOf(this.campaigns.rawSnapshot(campaignId)))) { this.deny(client, 'side-pref', 'sides are assigned — the contract is being played'); return; }
        this.fanLobby(campaignId, this.lobby.setSidePref(campaignId, token, pref)); // HARDEN-5b — per-recipient shaped
    }
    /** REBASE-1 P3 item 1 — the player device reports its UN-ENDED-pick count (the pin fans damage only at END PHASE,
     *  so the GM needs a signal for "who still has unshared picks before Resolve"). Token-scoped (own device only),
     *  validated + fanned on the lobby roster like side-pref; the count is EPHEMERAL server-side (LobbyService.pending). */
    @SubscribeMessage('phase-pending')
    onPhasePending(@ConnectedSocket() client: Socket, @MessageBody() msg: PhasePendingMsg): void {
        const v = vPhasePending(msg); // HARDEN-5 A
        if (!v.ok) { this.deny(client, 'phase-pending', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, count } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'phase-pending', 'not your token'); return; }
        this.fanLobby(campaignId, this.lobby.setPending(campaignId, token, count)); // HARDEN-5b — per-recipient shaped
    }
    /** GM-1 P3 — JOIN-WITH-FORCE (the one-shot company import). The SERVER is the id + cap authority:
     *  it re-mints instance/pilot ids (cross-campaign collision-proof), enforces the GM-set playerUnitCap
     *  (default 4) against the owner's EXISTING imports, PRE-CLAIMS the new ids for their owner (the claim
     *  board shows them already theirs — and the P3 per-unit battle rule keys off exactly these rows), then
     *  fans the minted payload to GM SOCKETS ONLY ('import-request', raw token included — the GM is trusted
     *  with tokens, HOTFIX-030). The GM CLIENT stays the snapshot author: it merges + persists (the D-130
     *  shape) → the normal campaign fan is the player's authoritative confirmation. Token-scoped: a player
     *  imports only AS ITSELF (join-lobby must precede — D-048 ordering). */
    @SubscribeMessage('import-force')
    onImportForce(@ConnectedSocket() client: Socket, @MessageBody() msg: ImportForceMsg): { event: string; data: unknown } {
        const nothing = { event: 'force-imported', data: null };
        const v = vImportForce(msg); // HARDEN-5 A — shape + the explicit 128 KB gate (never the silent frame drop)
        if (!v.ok) { this.deny(client, 'import-force', v.reason ?? 'invalid payload'); return nothing; }
        const { campaignId, token } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'import-force', 'not your token'); return nothing; }
        const owner = anonId(token);
        const snap = this.campaigns.rawSnapshot(campaignId);
        // GM-1 P3 (panel finding) — imports exist ONLY in GM sessions: a plain hosted campaign has no merge
        // consumer, so accepting would mint phantom claims + a lying success (the black-hole class). A
        // top-level duck-read, not a gmOnly parse.
        if (!snap || (snap as { gmSession?: unknown }).gmSession !== true) { this.deny(client, 'import-force', 'not a GM session'); return nothing; }
        // GM-1 P3 (panel finding) — DELIVERY BEFORE PERSISTENCE: the merge lives on a GM device; with no GM
        // socket in the room the minted company would vanish after an ok ack. Checked FIRST — on a no-GM
        // deny, nothing is minted and nothing is claimed. (A GM socket dying between this check and the fan
        // is a retry, not a loss — the player is told to try again.)
        const gmSocks = [...this.server.sockets.sockets.values()].filter((s) => s.rooms.has(campaignId) && (!AuthService.authRequired() || this.isGm(s, campaignId)));
        if (!gmSocks.length) { this.deny(client, 'import-force', 'the GM is not connected — try again when the table is up'); return nothing; }
        const cap = importCapOf(snap);
        // GM-1 P3 (panel finding) — the snapshot LAGS the merge (fan → GM merge → debounced PUT), so a burst
        // of imports would each see the stale count. The in-memory recent ledger closes the window (handlers
        // are sync-atomic — no race); TTL'd, the snapshot catches up and becomes the floor.
        const rkey = `${campaignId}|${owner}`;
        const prior = this.recentImports.get(rkey);
        const recent = prior && Date.now() - prior.at < 600_000 ? prior.n : 0;
        const have = Math.max(countOwnedImports(snap, owner), recent);
        if (have + msg.units.length > cap) { this.deny(client, 'import-force', `unit cap: ${have}/${cap} imported — ${msg.units.length} more won't fit`); return nothing; }
        const minted = remintImport(msg.units, msg.pilots ?? [], owner, Date.now(), msg.sourceCampaignId, msg.reputation); // GM-2 P1 — the identity rides the mint · P2b — + the home reputation
        this.recentImports.set(rkey, { n: have + minted.units.length, at: Date.now() });
        const engagementKey = msg.engagementKey || 'none';
        let set: Claim[] = [];
        for (const id of minted.instanceIds) set = this.claims.claim(campaignId, engagementKey, id, msg.name || 'Player', token, Date.now());
        if (set.length) this.fanClaims(campaignId, engagementKey, set); // HARDEN-5b — per-recipient shaped
        // the GM-only fan (the pre-checked recipient list — the raw token rides it, GM-trusted)
        for (const sock of gmSocks) {
            sock.emit('import-request', { campaignId, token, name: msg.name || 'Player', units: minted.units, pilots: minted.pilots });
        }
        return { event: 'force-imported', data: { instanceIds: minted.instanceIds, count: minted.units.length, cap, owner } };
    }
    // GM-1 P3 (panel) — the per-(campaign, owner) recent-import ledger backing the cap against the
    // snapshot lag. In-memory by design: an api restart forgets it and the persisted snapshot count
    // takes over as the floor.
    private readonly recentImports = new Map<string, { n: number; at: number }>();

    /** ODM-18 P1 — the COMPANY-CONSOLE INTENT (the GM-1 P3 seam, verbatim pattern): validate (allowlist +
     *  per-verb shape) → token-scoped authz → ODM-campaign check → DELIVERY BEFORE EFFECT (no GM socket in
     *  the room → denied, nothing forwarded) → fan to GM sockets with the actor's lobby name → receipt.
     *  The SERVER changes no state — the GM device applies through the same services its own UI calls. */
    /** GM-2 P2b — SIGN-CONTRACT (the odm-intent pattern, un-fenced from ODM): a PLAYER device signs its own company's
     *  contract on the phone. Shape-validated (never the D-128 math), bound token, a GM session, the key must be a home
     *  campaign THIS device brought (provenance.owner ↔ anonId(token)) → fanned to GM sockets with the actor's lobby name
     *  → receipt. The SERVER changes no state — the GM device re-checks its belts and applies through its own setters. */
    @SubscribeMessage('sign-contract')
    onSignContract(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId: string; token: string; key: string; contract: Record<string, unknown>; nonce?: string }): { event: string; data: unknown } {
        const nothing = { event: 'sign-contract-ack', data: null };
        const nonce = typeof (msg as { nonce?: unknown })?.nonce === 'string' ? (msg as { nonce: string }).nonce.slice(0, 40) : undefined;
        const v = vSignContract(msg);
        if (!v.ok) { this.deny(client, 'sign-contract', v.reason ?? 'invalid payload', nonce); return nothing; }
        const { campaignId, token, key, contract } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'sign-contract', 'not your token', nonce); return nothing; }
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!snap || (snap as { gmSession?: unknown }).gmSession !== true) { this.deny(client, 'sign-contract', 'not a GM session', nonce); return nothing; }
        if (!ownCompanyKeysOf(snap as Record<string, unknown>, anonId(token)).includes(key)) { this.deny(client, 'sign-contract', 'not your company', nonce); return nothing; }
        const gmSocks = [...this.server.sockets.sockets.values()].filter((s) => s.rooms.has(campaignId) && (!AuthService.authRequired() || this.isGm(s, campaignId)));
        if (!gmSocks.length) { this.deny(client, 'sign-contract', 'the GM is not connected — try again when the table is up', nonce); return nothing; }
        const name = this.lobby.list(campaignId).find((p) => p.token === token)?.name || 'Player';
        for (const sock of gmSocks) sock.emit('sign-contract', { campaignId, token, name, key, contract: { ...contract, signedBy: 'player' } });
        return { event: 'sign-contract-ack', data: { nonce, delivered: true } };
    }

    @SubscribeMessage('odm-intent')
    onOdmIntent(@ConnectedSocket() client: Socket, @MessageBody() msg: OdmIntentMsg): { event: string; data: unknown } {
        const nothing = { event: 'odm-intent-ack', data: null };
        // nonce (panel fix): echoed in ack AND deny so a client with two same-verb intents in flight can
        // tell whose answer arrived. Pre-validation extraction is safe (string-guarded, bounded).
        const nonce = typeof (msg as { nonce?: unknown })?.nonce === 'string' ? (msg as { nonce: string }).nonce.slice(0, 40) : undefined;
        const v = vOdmIntent(msg); // HARDEN-5 A — the allowlist IS the gate (burnDays etc. never validate)
        if (!v.ok) { this.deny(client, 'odm-intent', v.reason ?? 'invalid payload', nonce); return nothing; }
        const { campaignId, token, verb, payload } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'odm-intent', 'not your token', nonce); return nothing; }
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!snap || (snap as { packId?: unknown }).packId !== 'odm') { this.deny(client, 'odm-intent', 'not an ODM campaign', nonce); return nothing; }
        const gmSocks = [...this.server.sockets.sockets.values()].filter((s) => s.rooms.has(campaignId) && (!AuthService.authRequired() || this.isGm(s, campaignId)));
        if (!gmSocks.length) { this.deny(client, 'odm-intent', 'the GM is not connected — try again when the table is up', nonce); return nothing; }
        const name = this.lobby.list(campaignId).find((p) => p.token === token)?.name || 'Player';
        for (const sock of gmSocks) sock.emit('odm-intent', { campaignId, token, name, verb, payload });
        return { event: 'odm-intent-ack', data: { verb, nonce, delivered: true } };
    }
    /** ODM-18 P1 (panel fix — the stale-room black hole): rooms otherwise never shrink, so a GM who
     *  switched campaigns in the same session still counted toward gmSocks for the OLD room while their
     *  client discarded the fan (campaignId filter) — intents acked 'delivered' and vanished, the exact
     *  state the GM-absent deny exists to prevent. The client leaves the prior room on ensure-change;
     *  leaving needs no authz (it only REDUCES what the socket receives). */
    @SubscribeMessage('leave-campaign')
    onLeaveCampaign(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId?: unknown }): void {
        const id = msg?.campaignId;
        if (typeof id !== 'string' || !id.length || id.length > 500) return;
        void client.leave(id);
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
        // GM-1 P3 — PER-UNIT OWNERSHIP (the HARDEN-7 ledgered close, R5-ruled): a battle write lands only from
        // the instance's CLAIM-ROW holder or a verified GM. Deny-unclaimed; a release racing a write resolves
        // last-write-wins (handlers are atomic on the sync sqlite loop — the claim row at message arrival
        // decides). The claims lookup is gated behind authRequired (cost only — the decider's auth-off
        // short-circuit ignores the field and stays byte-permissive, the SACRED dev/LAN posture).
        const held = AuthService.authRequired()
            ? this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId)
            : undefined;
        // ORDER-4 H18 — a CLOSED engagement refuses every write first (a game rule: the dev/LAN short-circuit and the GM do
        // not bypass it); an open one takes the HARDEN-7 per-unit rule exactly as before. Denied → no partial write.
        const closed = this.battle.isClosed(campaignId, engagementKey);
        const ok = engagementWriteDecision({
            authRequired: AuthService.authRequired(),
            isGm: this.isGm(client, campaignId),
            kind: 'unit',
            boundToken: client.data?.lobbyToken as string | undefined,
            msgToken: undefined,
            instanceHolderToken: held ? held.holderToken : null,
            closed,
        });
        if (!ok) { this.deny(client, 'battle', closed ? 'engagement closed' : 'not your unit'); return; }
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
        const closed = !!campaignId && !!engagementKey && this.battle.isClosed(campaignId, engagementKey); // ORDER-4 H18 — the server's word on the fight
        return { event: 'battle-state', data: { engagementKey, states, closed } };
    }
    /** ORDER-4 H18 — ENGAGEMENT-CLOSE: the GM's resolve tells the server the fight is over. GM-only under auth (the HARDEN-5
     *  'gm' kind — owner/admin via isGmDecision; dev/LAN permissive like every GM board action), validated, idempotent. The
     *  mark lives beside the battle state (in memory + persisted); every later `battle` write to this key is refused, claims
     *  untouched. The room is told ('engagement-closed') and every later battle-sync reply carries `closed: true`. */
    @SubscribeMessage('engagement-close')
    onEngagementClose(@ConnectedSocket() client: Socket, @MessageBody() msg: EngagementCloseMsg): { event: string; data: unknown } {
        const v = vEngagementClose(msg);
        if (!v.ok) { this.deny(client, 'engagement-close', v.reason ?? 'invalid payload'); return { event: 'engagement-closed', data: null }; }
        const { campaignId, engagementKey } = msg;
        if (!this.allowed(client, campaignId, 'gm')) { this.deny(client, 'engagement-close', 'GM only'); return { event: 'engagement-closed', data: null }; }
        const closedAt = Date.now();
        this.battle.close(campaignId, engagementKey, closedAt);
        this.server.to(campaignId).emit('engagement-closed', { engagementKey, closedAt });
        return { event: 'engagement-closed', data: { engagementKey, closedAt } };
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
