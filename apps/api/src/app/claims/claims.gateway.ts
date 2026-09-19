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
import { EntitlementsService } from '../auth/entitlements.service';
import { UsersService } from '../auth/users.service';
import { CampaignsService, type Viewer } from '../campaigns/campaigns.service';
import { WriterTokenService, writerFallbackDecision } from '../campaigns/writer-token.service';
import { buildCommit } from '../version';
import { vJoin, vClaim, vRelease, vLobbyJoin, vLobbyMut, vBattle, vFavorite, vSidePref, vPhasePending, vImportForce, vOdmIntent, vSignContract, vEngagementClose, vHandTable, vSeat } from './ws-validate';
import { ownCompanyKeysOf } from './snapshot-shape';
import { remintImport, countOwnedImports, importCapOf, type ImportUnit, type ImportPilot } from './import-force';
import { redactLobby, redactClaims, anonId } from './roster-redact';
import { shapeSnapshot } from './snapshot-shape';

const recipientAnonOf = (s: Socket): string | null => { const t = s.data?.lobbyToken as string | undefined; return t ? anonId(t) : null; };
import { isGmDecision, accessDecision, actionDecision, sideDecision, instanceSideOf, engagementWriteDecision, sidePrefDecision, sidePrefFactsOf, handTableDecision, seatDecision } from './ws-authz';
import { odmIntentSeats, SEAT_KEY, activeEngagementKeyOf, odmClaimDecision, companyUnitIdsOf, seatAssignDecision, seatActorOf, seatLabelOf } from './odm-seats';
import { SeatLedgerService, type SeatLedgerEntry } from './seat-ledger.service'; // ORDER-13 — every seat change is written by the SERVER
import type { LobbyPlayer } from './lobby.service';
import type { Claim } from './claims.service';

const LAN = process.env.BCE_HOST === '0.0.0.0' || process.env.BCE_LAN === '1';
const CORS = { origin: LAN ? true : [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/], methods: ['GET', 'POST'] };

interface JoinMsg { campaignId: string; engagementKey: string; }
interface ClaimMsg extends JoinMsg { instanceId: string; holderName: string; holderToken: string; at?: number; }
interface ReleaseMsg extends JoinMsg { instanceId: string; holderToken?: string; }
interface LobbyJoinMsg { campaignId: string; token: string; name: string; side: string; }
interface LobbyMutMsg { campaignId: string; token: string; side?: string; }
interface BattleMsg { campaignId: string; engagementKey: string; instanceId: string; state: unknown; at?: number; }
interface BattleSyncMsg { campaignId: string; engagementKey: string; }
interface EngagementCloseMsg { campaignId: string; engagementKey: string; }
interface FavoriteMsg { campaignId: string; token: string; instanceId?: string | null; pilotId?: string | null; }
interface SidePrefMsg { campaignId: string; token: string; pref: 'a' | 'b' | null; }
// REBASE-1 P3 item 1 — this device's UN-ENDED-pick count this phase (token-scoped; fanned on the lobby roster like side-pref).
interface PhasePendingMsg { campaignId: string; token: string; count: number; }
interface ImportForceMsg { campaignId: string; token: string; engagementKey?: string; name?: string; units: ImportUnit[]; pilots?: ImportPilot[]; sourceCampaignId?: string; reputation?: number; }
interface OdmIntentMsg { campaignId: string; token: string; verb: string; payload: Record<string, unknown>; nonce?: string; }
interface HandTableMsg { campaignId: string; toUserId: string; toDeviceId: string; }
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const BATON_GRACE_MS = Math.max(0, Number(process.env['BCE_BATON_GRACE_MS'] ?? 15000) || 0);
type SeatRow = { instanceId: string; holderName: string; mine: boolean; holderToken?: string };

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
        private readonly grants: EntitlementsService,
        private readonly writer: WriterTokenService,
        private readonly users: UsersService,
        private readonly seatLedger: SeatLedgerService, // ORDER-13 — the server-written seat ledger
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
        this.campaigns.writerChanges$.subscribe((id) => { if (id) this.fanWriter(id); });
    }
    private readonly graceTimers = new Map<string, NodeJS.Timeout>();

    private fanCampaign(campaignId: string): void {
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('campaign', snap); return; } // dev/LAN — full to all
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            sock.emit('campaign', shapeSnapshot(snap, this.isReadGm(sock, campaignId), recipientAnonOf(sock)));
        }
    }

    handleConnection(client: Socket): void {
        this.log.log(`socket connect ${client.id}`);
        // compares it to its baked BUILD_COMMIT_HASH on connect/reconnect; a stale cached bundle (older hash)
        // surfaces the non-blocking "new version — tap to update" banner. Fires before any auth work so it
        // reaches players and GMs alike; 'unknown' when the server has no git env → the client suppresses.
        client.emit('hello', { version: buildCommit() });
        // DEPLOY-002 P2/P3 + DEPLOY-003: store the handshake token; the GM user is re-resolved LIVE per
        // event in deniedAccess, so a BAN (or a revoked approval) takes effect on the socket's very next
        // event — no stale cached status survives the ban.
        client.data.gmToken = (client.handshake?.auth as { token?: string } | undefined)?.token ?? null;
        // Validated to the mint's alphabet; a socket without one is "no device" (a cached bundle) — it never takes the table.
        const hsAuth = (client.handshake?.auth ?? {}) as { device?: unknown; deviceLabel?: unknown };
        client.data.deviceId = typeof hsAuth.device === 'string' && DEVICE_ID_RE.test(hsAuth.device) ? hsAuth.device : null;
        client.data.deviceLabel = typeof hsAuth.deviceLabel === 'string' ? hsAuth.deviceLabel.slice(0, 24) : null;
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
        const token = client.data?.gmToken as string | null | undefined;
        const user = token ? this.auth.userFromToken(token) : null;
        const ownerId = user ? this.campaigns.getOwnerId(campaignId) : null;
        // owner/admin check has already failed (an approved, non-admin, non-owner GM), so owners, admins, and
        // players pay no extra DB read. It grants access for READ only — actionDecision is untouched.
        const coGmRead = !!user && user.status === 'approved' && user.role !== 'admin'
            && !(ownerId != null && ownerId === user.id)
            && this.campaigns.socketReadAllowed(campaignId, this.socketViewer(user));
        const r = accessDecision({
            user,
            authRequired: AuthService.authRequired(),
            ownerId,
            campaignId,
            boundCampaignId: client.data?.boundCampaignId as string | undefined,
            campaignExists: this.campaigns.exists(campaignId),
            coGmRead,
        });
        if (r.bindCampaignId) client.data.boundCampaignId = r.bindCampaignId;
        return r.deny;
    }
    private socketViewer(user: { id: string; role: string }): Viewer {
        return { ownerId: user.id, admin: user.role === 'admin', role: user.role, features: this.grants.featuresFor(user.id) };
    }
    private isReadGm(client: Socket, campaignId: string): boolean {
        if (this.isGm(client, campaignId)) return true;
        const token = client.data?.gmToken as string | null | undefined;
        const user = token ? this.auth.userFromToken(token) : null;
        return !!user && user.status === 'approved' && this.campaigns.socketReadAllowed(campaignId, this.socketViewer(user));
    }
    /** The error ack for a rejected message: additive (current clients ignore it), observable by tooling. */
    private deny(client: Socket, event: string, reason: string, nonce?: string): void {
        this.log.warn(`denied '${event}' from ${client.id}: ${reason}`);
        client.emit('denied', nonce ? { event, reason, nonce } : { event, reason });
    }
    /** A live-verified GM of this campaign — mirrors deniedAccess's GM branch EXACTLY (re-resolved from the
     *  stored token per call, so a ban bites immediately; approved admin passes; else owner match). */
    private isGm(client: Socket, campaignId: string): boolean {
        const token = client.data?.gmToken as string | null | undefined;
        const user = token ? this.auth.userFromToken(token) : null;
        return isGmDecision({ user, ownerId: user ? this.campaigns.getOwnerId(campaignId) : null });
    }
    private allowed(client: Socket, campaignId: string, kind: 'gm' | 'token' | 'participant' | 'unit', msgToken?: unknown, instanceHolderToken?: string | null): boolean {
        return actionDecision({
            authRequired: AuthService.authRequired(),
            isGm: this.isGm(client, campaignId),
            kind,
            boundToken: client.data?.lobbyToken as string | undefined,
            msgToken,
            instanceHolderToken,
        });
    }

    //    gets a redacted copy (others' tokens → an opaque handle; its own token preserved for self-identity).
    //    Gated on authRequired(): dev/LAN (auth off) keeps the trusted single-tenant full-roster model unchanged. ──
    /** The lobby roster shaped for ONE recipient socket (full for a GM / dev-LAN; redacted for a hosted player). */
    private lobbyFor(client: Socket, campaignId: string, full: LobbyPlayer[]): LobbyPlayer[] {
        if (this.tokenTrusted(client, campaignId)) return full;
        return redactLobby(full, client.data?.lobbyToken as string | undefined);
    }
    private tokenTrusted(client: Socket, campaignId: string): boolean {
        return !AuthService.authRequired() || this.isGm(client, campaignId) || this.isWriterDevice(client, campaignId);
    }
    /** Fan a lobby roster to the room, shaped PER-RECIPIENT. Single-node: iterate the room's live sockets. */
    private fanLobby(campaignId: string, full: LobbyPlayer[]): void {
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('lobby', full); return; } // dev/LAN — full to all
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            sock.emit('lobby', this.tokenTrusted(sock, campaignId) ? full : redactLobby(full, sock.data?.lobbyToken as string | undefined));
        }
    }
    /** Fan a claims set to the room, shaped PER-RECIPIENT (others' holderToken redacted for non-GM players). */
    private fanClaims(campaignId: string, engagementKey: string, full: Claim[]): void {
        if (!AuthService.authRequired()) { this.server.to(campaignId).emit('claims', { engagementKey, claims: full }); return; }
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId)) continue;
            const claims = this.tokenTrusted(sock, campaignId) ? full : redactClaims(full, sock.data?.lobbyToken as string | undefined);
            sock.emit('claims', { engagementKey, claims });
        }
    }
    /** The claims set shaped for ONE recipient (the join/resync direct reply). */
    private claimsFor(client: Socket, campaignId: string, full: Claim[]): Claim[] {
        if (this.tokenTrusted(client, campaignId)) return full;
        return redactClaims(full, client.data?.lobbyToken as string | undefined);
    }

    handleDisconnect(client: Socket): void {
        this.log.log(`socket disconnect ${client.id}`);
        // DEPLOY-010: drop this connection's presence ref (2 tabs → 1 user means the user stays online until
        // the LAST tab closes — ref-counted in PresenceService).
        this.presence.disconnect(client.data?.userId as string | undefined);
        // board's dot goes RED live (the claim stays; a reconnect re-registers → green). Token + campaignId
        // were stashed on this socket at join-lobby (client.data has no player token otherwise).
        const lobbyToken = client.data?.lobbyToken as string | undefined;
        const lobbyCampaignId = client.data?.lobbyCampaignId as string | undefined;
        if (lobbyToken && lobbyCampaignId) {
            const roster = this.lobby.setConnected(lobbyCampaignId, lobbyToken, false);
            this.fanLobby(lobbyCampaignId, roster);
        }
        // back to the owner-default and the room is told, so the owner writes again the moment the co-GM drops.
        // L1: only when the account has truly LEFT that room — a holder closing one of two tabs keeps the baton
        // (by 'disconnect' this socket is already out of the namespace, so the scan sees only what remains).
        // P5 — PER DEVICE: only the rooms this DEVICE truly left (another socket of the same device keeps the table), and
        // not at once — a grace first (ruling 2), then the fallback (ruling 3). By 'disconnect' this socket is already out
        // of the namespace, so the scan sees only what remains.
        const userId = client.data?.userId as string | undefined;
        const deviceId = client.data?.deviceId as string | null | undefined;
        if (userId) {
            for (const cid of this.writer.heldBy(userId, deviceId ?? null)) {
                if (this.deviceInRoom(cid, userId, deviceId ?? null)) continue;
                this.startGrace(cid);
            }
            // L1 — a reader (or an owner) left: the owner's hand-out list follows.
            for (const cid of (client.data?.gmRooms as Set<string> | undefined) ?? []) this.fanReaders(cid);
        }
    }
    private startGrace(campaignId: string): void {
        const prior = this.graceTimers.get(campaignId);
        if (prior) clearTimeout(prior);
        const t = setTimeout(() => {
            this.graceTimers.delete(campaignId);
            const holder = this.writer.holderOf(campaignId);
            if (!holder || this.deviceInRoom(campaignId, holder.userId, holder.deviceId)) return; // came back within the grace
            const next = writerFallbackDecision({ holder, ownerId: this.campaigns.getOwnerId(campaignId), connected: this.gmDevicesIn(campaignId) });
            if (next) this.writer.hand(campaignId, next, Date.now()); else this.writer.release(campaignId);
            this.fanWriter(campaignId);
        }, BATON_GRACE_MS);
        t.unref?.();
        this.graceTimers.set(campaignId, t);
    }
    private cancelGrace(campaignId: string): void {
        const t = this.graceTimers.get(campaignId);
        if (t) { clearTimeout(t); this.graceTimers.delete(campaignId); }
    }

    /** Join a campaign room + resync: the joiner gets the current claim set for its engagement. */
    @SubscribeMessage('join')
    onJoin(@ConnectedSocket() client: Socket, @MessageBody() msg: JoinMsg): { event: string; data: unknown } {
        const v = vJoin(msg);
        if (!v.ok) { this.deny(client, 'join', v.reason ?? 'invalid payload'); return { event: 'claims', data: { engagementKey: '', claims: [] } }; }
        const { campaignId, engagementKey } = msg;
        client.join(campaignId);
        // writes; holderId null ⇒ owner-default). Direct emit to the joining socket only — no room fan on a join.
        // L1: GM-app sockets only (the owner/admin or a co-GM reader) — it names an account, and a player never
        // needs it. The same sockets drive the owner's hand-out list, so a join re-fans the connected readers.
        if (AuthService.authRequired() && client.data?.userId && this.isReadGm(client, campaignId)) {
            ((client.data.gmRooms as Set<string> | undefined) ?? (client.data.gmRooms = new Set<string>())).add(campaignId);
            // P5 — THE TAKE (ruling 1): nobody holds the table and this is an OWNER (or admin) DEVICE → it takes it. A second
            // device of the same account finds a holder and reads. A holder device rejoining within the grace keeps it.
            const userId = client.data.userId as string, deviceId = client.data.deviceId as string | null;
            const holder = this.writer.holderOf(campaignId);
            if (holder && holder.userId === userId && (holder.deviceId == null || holder.deviceId === deviceId)) this.cancelGrace(campaignId);
            if (!holder && deviceId && this.isGm(client, campaignId)) { this.writer.hand(campaignId, { userId, deviceId }, Date.now()); this.fanWriter(campaignId); }
            client.emit('writer', this.writerPayload(campaignId));
            this.fanReaders(campaignId);
        }
        return { event: 'claims', data: { engagementKey, claims: this.claimsFor(client, campaignId, this.claims.list(campaignId, engagementKey)) } };
    }

    /** Re-request the current set (client-driven resync, e.g. on an engagement change). */
    @SubscribeMessage('resync')
    onResync(@ConnectedSocket() client: Socket, @MessageBody() msg: JoinMsg): { event: string; data: unknown } {
        const { campaignId, engagementKey } = msg || ({} as JoinMsg);
        return { event: 'claims', data: { engagementKey, claims: this.claimsFor(client, campaignId, this.claims.list(campaignId, engagementKey)) } };
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
        // (dev/LAN full — the 5b posture). Still a read-only handler; the reply-style shape is unchanged.
        const full = !AuthService.authRequired() || this.isReadGm(client, campaignId);
        return { event: 'campaign', data: shapeSnapshot(this.campaigns.rawSnapshot(campaignId), full, recipientAnonOf(client)) };
    }

    @SubscribeMessage('claim')
    onClaim(@ConnectedSocket() client: Socket, @MessageBody() msg: ClaimMsg): void {
        const v = vClaim(msg);
        if (!v.ok) { this.deny(client, 'claim', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId, holderName, holderToken } = msg;
        if (!this.allowed(client, campaignId, 'token', holderToken)) { this.deny(client, 'claim', 'not your token'); return; }
        // The per-unit battle rule is only as strong as the claim row it keys on — without this guard, "your
        // opponent cannot edit your record" is two messages away (steal the claim, then write the sheet).
        // Mirrors onRelease's holder-match; re-claiming your OWN row stays allowed; the GM reassigns freely.
        const nonGm = AuthService.authRequired() && !this.isGm(client, campaignId);
        if (nonGm) {
            // engagement, so in an ODM campaign a non-GM claim lands only under the LIVE engagement's key — derived from the
            // snapshot, never from the message — and never under the GM's reserved seat key (any mode). Without this a
            // joined player seated itself on another's unit with one forged claim under a made-up key (the probe).
            const snapC = this.campaigns.rawSnapshot(campaignId);
            const isOdm = (snapC as { packId?: unknown } | null)?.packId === 'odm';
            // ORDER-12 — and the SEAT MAP: under the live key a unit whose seat ANOTHER player holds is not claimable (the
            // per-key `already claimed` guard below cannot see a seat given under the reserved key or an older engagement).
            // Read only for ODM (other modes have no seats — their door and their cost are unchanged).
            const seatHolderToken = isOdm ? (this.claims.seatHolders(campaignId).find((c) => c.instanceId === instanceId)?.holderToken ?? null) : null;
            const door = odmClaimDecision({ isOdm, engagementKey, activeKey: activeEngagementKeyOf(snapC), seatHolderToken, callerToken: holderToken });
            if (!door.allow) { this.deny(client, 'claim', door.reason ?? 'denied'); return; }
            const held = this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId);
            if (held && held.holderToken && held.holderToken !== holderToken) { this.deny(client, 'claim', 'already claimed'); return; }
            // lobby row side vs the instance's side in the snapshot (company → BLUFOR · mission OpFor → OPFOR). The GM is
            // exempt (this branch is non-GM only — reassign is the GM's tool); dev/LAN stays permissive by the SAME
            // authRequired() gate that fences the lookups above (the decider short-circuits too). Denied → no write.
            const bound = client.data?.lobbyToken as string | undefined;
            const row = bound ? this.lobby.list(campaignId).find((p) => p.token === bound) : undefined;
            if (!sideDecision({ authRequired: true, isGm: false, rowSide: row?.side ?? null, instanceSide: instanceSideOf(this.campaigns.rawSnapshot(campaignId), instanceId) })) { this.deny(client, 'claim', 'not your side'); return; }
        }
        // P5 — a non-GM claim is stamped with the SERVER's clock ("most recent" decides the seat; a client `at` could be forged into the future)
        const before = this.seatBefore(campaignId, instanceId); // ORDER-13 — the seat's holder before the write (ODM only)
        const set = this.claims.claim(campaignId, engagementKey, instanceId, holderName || '', holderToken || '', nonGm ? Date.now() : (msg.at || Date.now()));
        this.fanClaims(campaignId, engagementKey, set);
        this.recordSeatChange(client, campaignId, instanceId, 'claim', before); // ORDER-13 — the server writes the seat ledger line (if the seat moved)
        this.fanSeats(campaignId);
    }

    @SubscribeMessage('release')
    onRelease(@ConnectedSocket() client: Socket, @MessageBody() msg: ReleaseMsg): void {
        const v = vRelease(msg);
        if (!v.ok) { this.deny(client, 'release', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId } = msg;
        if (!this.allowed(client, campaignId, 'token', msg.holderToken)) { this.deny(client, 'release', 'not your token'); return; }
        // claim is denied even when presented under the caller's own identity (releasing unclaimed = no-op, fine).
        if (AuthService.authRequired() && !this.isGm(client, campaignId)) {
            if (engagementKey === SEAT_KEY) { this.deny(client, 'release', 'reserved key'); return; }
            const held = this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId);
            if (held && held.holderToken && held.holderToken !== msg.holderToken) { this.deny(client, 'release', 'not the holder'); return; }
        }
        const before = this.seatBefore(campaignId, instanceId); // ORDER-13
        const set = this.claims.release(campaignId, engagementKey, instanceId);
        this.fanClaims(campaignId, engagementKey, set);
        this.recordSeatChange(client, campaignId, instanceId, 'release', before); // ORDER-13 — a release that moves the seat (to nobody, or back to an older claim) is a line
        this.fanSeats(campaignId);
    }

    @SubscribeMessage('join-lobby')
    onJoinLobby(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyJoinMsg): { event: string; data: unknown } {
        const v = vLobbyJoin(msg);
        if (!v.ok) { this.deny(client, 'join-lobby', v.reason ?? 'invalid payload'); return { event: 'lobby', data: [] }; }
        const { campaignId, token, name, side } = msg;
        // (one device impersonating another) → reject; the same token re-joining (reconnect/rejoinLobby)
        // is the normal idempotent path; a verified GM socket may switch freely. Auth OFF: permissive.
        if (AuthService.authRequired() && !this.isGm(client, campaignId)) {
            const bound = client.data?.lobbyToken as string | undefined;
            if (bound != null && bound !== token) {
                this.deny(client, 'join-lobby', 'socket already bound to another identity');
                return { event: 'lobby', data: this.lobbyFor(client, campaignId, this.lobby.list(campaignId)) };
            }
        }
        client.join(campaignId);
        client.data.lobbyToken = token;
        client.data.lobbyCampaignId = campaignId;
        const roster = this.lobby.join(campaignId, token, name || 'Player', side || 'BLUFOR', Date.now());
        this.fanLobby(campaignId, roster);
        return { event: 'lobby', data: this.lobbyFor(client, campaignId, roster) }; // resync the caller (its own token preserved)
    }
    /** The GM lobby (and a reconnecting player) requests the current roster + joins the room. */
    @SubscribeMessage('lobby-sync')
    onLobbySync(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId: string }): { event: string; data: unknown } {
        const campaignId = msg?.campaignId;
        if (campaignId) client.join(campaignId);
        return { event: 'lobby', data: campaignId ? this.lobbyFor(client, campaignId, this.lobby.list(campaignId)) : [] };
    }
    @SubscribeMessage('reassign')
    onReassign(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, true);
        if (!v.ok) { this.deny(client, 'reassign', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, side } = msg;
        if (!this.allowed(client, campaignId, 'gm')) { this.deny(client, 'reassign', 'GM only'); return; }
        this.fanLobby(campaignId, this.lobby.reassign(campaignId, token, side as string));
    }
    @SubscribeMessage('side-pref')
    onSidePref(@ConnectedSocket() client: Socket, @MessageBody() msg: SidePrefMsg): void {
        const v = vSidePref(msg);
        if (!v.ok) { this.deny(client, 'side-pref', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, pref } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'side-pref', 'not your token'); return; }
        if (!sidePrefDecision(sidePrefFactsOf(this.campaigns.rawSnapshot(campaignId)))) { this.deny(client, 'side-pref', 'sides are assigned — the contract is being played'); return; }
        this.fanLobby(campaignId, this.lobby.setSidePref(campaignId, token, pref));
    }
    /** REBASE-1 P3 item 1 — the player device reports its UN-ENDED-pick count (the pin fans damage only at END PHASE,
     *  so the GM needs a signal for "who still has unshared picks before Resolve"). Token-scoped (own device only),
     *  validated + fanned on the lobby roster like side-pref; the count is EPHEMERAL server-side (LobbyService.pending). */
    @SubscribeMessage('phase-pending')
    onPhasePending(@ConnectedSocket() client: Socket, @MessageBody() msg: PhasePendingMsg): void {
        const v = vPhasePending(msg);
        if (!v.ok) { this.deny(client, 'phase-pending', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token, count } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'phase-pending', 'not your token'); return; }
        this.fanLobby(campaignId, this.lobby.setPending(campaignId, token, count));
    }
    @SubscribeMessage('import-force')
    onImportForce(@ConnectedSocket() client: Socket, @MessageBody() msg: ImportForceMsg): { event: string; data: unknown } {
        const nothing = { event: 'force-imported', data: null };
        const v = vImportForce(msg);
        if (!v.ok) { this.deny(client, 'import-force', v.reason ?? 'invalid payload'); return nothing; }
        const { campaignId, token } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'import-force', 'not your token'); return nothing; }
        const owner = anonId(token);
        const snap = this.campaigns.rawSnapshot(campaignId);
        // consumer, so accepting would mint phantom claims + a lying success (the black-hole class). A
        // top-level duck-read, not a gmOnly parse.
        if (!snap || (snap as { gmSession?: unknown }).gmSession !== true) { this.deny(client, 'import-force', 'not a GM session'); return nothing; }
        // socket in the room the minted company would vanish after an ok ack. Checked FIRST — on a no-GM
        // deny, nothing is minted and nothing is claimed. (A GM socket dying between this check and the fan
        // is a retry, not a loss — the player is told to try again.)
        const gmSocks = [...this.server.sockets.sockets.values()].filter((s) => s.rooms.has(campaignId) && (!AuthService.authRequired() || this.isGm(s, campaignId)));
        if (!gmSocks.length) { this.deny(client, 'import-force', 'the GM is not connected — try again when the table is up'); return nothing; }
        const cap = importCapOf(snap);
        // of imports would each see the stale count. The in-memory recent ledger closes the window (handlers
        // are sync-atomic — no race); TTL'd, the snapshot catches up and becomes the floor.
        const rkey = `${campaignId}|${owner}`;
        const prior = this.recentImports.get(rkey);
        const recent = prior && Date.now() - prior.at < 600_000 ? prior.n : 0;
        const have = Math.max(countOwnedImports(snap, owner), recent);
        if (have + msg.units.length > cap) { this.deny(client, 'import-force', `unit cap: ${have}/${cap} imported — ${msg.units.length} more won't fit`); return nothing; }
        const minted = remintImport(msg.units, msg.pilots ?? [], owner, Date.now(), msg.sourceCampaignId, msg.reputation);
        this.recentImports.set(rkey, { n: have + minted.units.length, at: Date.now() });
        const engagementKey = msg.engagementKey || 'none';
        let set: Claim[] = [];
        for (const id of minted.instanceIds) set = this.claims.claim(campaignId, engagementKey, id, msg.name || 'Player', token, Date.now());
        if (set.length) this.fanClaims(campaignId, engagementKey, set);
        this.fanSeats(campaignId);
        // the GM-only fan (the pre-checked recipient list — the raw token rides it, GM-trusted)
        for (const sock of gmSocks) {
            sock.emit('import-request', { campaignId, token, name: msg.name || 'Player', units: minted.units, pilots: minted.pilots });
        }
        return { event: 'force-imported', data: { instanceIds: minted.instanceIds, count: minted.units.length, cap, owner } };
    }
    // snapshot lag. In-memory by design: an api restart forgets it and the persisted snapshot count
    // takes over as the floor.
    private readonly recentImports = new Map<string, { n: number; at: number }>();

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
        const v = vOdmIntent(msg);
        if (!v.ok) { this.deny(client, 'odm-intent', v.reason ?? 'invalid payload', nonce); return nothing; }
        const { campaignId, token, verb, payload } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'odm-intent', 'not your token', nonce); return nothing; }
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!snap || (snap as { packId?: unknown }).packId !== 'odm') { this.deny(client, 'odm-intent', 'not an ODM campaign', nonce); return nothing; }
        // seat's holder (or the GM); a company verb only from a caller who holds SOME seat. The seats are resolved
        // against the PRE-move snapshot; nothing is written on a deny.
        const tableGm = this.isTableGm(client, campaignId);
        const seat = seatDecision({
            authRequired: AuthService.authRequired(),
            isGm: tableGm,
            callerToken: client.data?.lobbyToken as string | undefined,
            targetSeats: odmIntentSeats(verb, payload, snap),
            holders: Object.fromEntries(this.claims.seatHolders(campaignId).map((c) => [c.instanceId, c.holderToken])),
        });
        if (!seat.allow) { this.deny(client, 'odm-intent', seat.reason ?? 'denied', nonce); return nothing; }
        // THE WRITER DEVICE APPLIES (the one-writer law, by construction): the baton holder's sockets while the table is
        // handed out, else the verified GM's. Until L2 this fanned to the owner regardless — and an intent that reached
        // a READ-ONLY owner was applied to a state it could not persist, then overwritten by the next fan.
        // P5 — ONE DEVICE applies: the holder DEVICE's sockets (a legacy account-level holder: that account's sockets). Nobody
        // holds it → nobody applies (the next owner device to join takes it). Dev/LAN: the room, as ever.
        const holder = AuthService.authRequired() ? this.writer.holderOf(campaignId) : null;
        const gmSocks = [...this.server.sockets.sockets.values()].filter((s) => s.rooms.has(campaignId)
            && (!AuthService.authRequired() || (!!holder && s.data?.userId === holder.userId && (holder.deviceId == null || s.data?.deviceId === holder.deviceId) && this.isReadGm(s, campaignId))));
        if (!gmSocks.length) { this.deny(client, 'odm-intent', 'the GM is not at the table — try again when the table is up', nonce); return nothing; }
        // the ACTOR: a player's lobby callsign; a GM socket has no lobby row — it is named by its account. actorKey is an
        // opaque, stable handle (never the bearer token) — the ledger's per-player filter keys on it.
        const gmUser = tableGm && client.data?.gmToken ? this.auth.userFromToken(client.data.gmToken as string) : null;
        const name = this.lobby.list(campaignId).find((p) => p.token === token)?.name || (gmUser ? `${gmUser.displayName?.trim() || 'GM'} (GM)` : 'Player');
        const actorKey = gmUser ? `gm-${anonId(gmUser.id)}` : anonId(token);
        for (const sock of gmSocks) sock.emit('odm-intent', { campaignId, token, name, actorKey, verb, payload });
        return { event: 'odm-intent-ack', data: { verb, nonce, delivered: true } };
    }
    @SubscribeMessage('leave-campaign')
    onLeaveCampaign(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId?: unknown }): void {
        const id = msg?.campaignId;
        if (typeof id !== 'string' || !id.length || id.length > 500) return;
        void client.leave(id);
        // with every socket gives the baton back (the same rule as a disconnect).
        const rooms = client.data?.gmRooms as Set<string> | undefined;
        if (rooms?.delete(id)) {
            const userId = client.data?.userId as string | undefined;
            const holder = this.writer.holderOf(id);
            if (userId && holder?.userId === userId && !this.deviceInRoom(id, userId, holder.deviceId)) this.startGrace(id); // P5 — per device, after the grace
            this.fanReaders(id);
        }
    }
    @SubscribeMessage('kick')
    onKick(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, false);
        if (!v.ok) { this.deny(client, 'kick', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token } = msg;
        if (!this.allowed(client, campaignId, 'gm')) { this.deny(client, 'kick', 'GM only'); return; }
        this.fanLobby(campaignId, this.lobby.remove(campaignId, token));
    }
    @SubscribeMessage('leave-lobby')
    onLeaveLobby(@ConnectedSocket() client: Socket, @MessageBody() msg: LobbyMutMsg): void {
        const v = vLobbyMut(msg, false);
        if (!v.ok) { this.deny(client, 'leave-lobby', v.reason ?? 'invalid payload'); return; }
        const { campaignId, token } = msg;
        if (!this.allowed(client, campaignId, 'token', token)) { this.deny(client, 'leave-lobby', 'not your token'); return; }
        this.fanLobby(campaignId, this.lobby.remove(campaignId, token));
    }

    /** An edited sheet's serialized state -> persist (host record) + fan the DELTA to the whole room. */
    @SubscribeMessage('battle')
    onBattle(@ConnectedSocket() client: Socket, @MessageBody() msg: BattleMsg): void {
        const v = vBattle(msg);
        if (!v.ok) { this.deny(client, 'battle', v.reason ?? 'invalid payload'); return; }
        const { campaignId, engagementKey, instanceId, state } = msg;
        // the instance's CLAIM-ROW holder or a verified GM. Deny-unclaimed; a release racing a write resolves
        // last-write-wins (handlers are atomic on the sync sqlite loop — the claim row at message arrival
        // decides). The claims lookup is gated behind authRequired (cost only — the decider's auth-off
        // short-circuit ignores the field and stays byte-permissive, the SACRED dev/LAN posture).
        const held = AuthService.authRequired()
            ? this.claims.list(campaignId, engagementKey).find((c) => c.instanceId === instanceId)
            : undefined;
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
        const closed = !!campaignId && !!engagementKey && this.battle.isClosed(campaignId, engagementKey);
        return { event: 'battle-state', data: { engagementKey, states, closed } };
    }
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
    @SubscribeMessage('hand-table')
    onHandTable(@ConnectedSocket() client: Socket, @MessageBody() msg: HandTableMsg): { event: string; data: unknown } {
        const v = vHandTable(msg);
        if (!v.ok) { this.deny(client, 'hand-table', v.reason ?? 'invalid payload'); return { event: 'writer', data: null }; }
        const { campaignId, toUserId, toDeviceId } = msg;
        // P5 — the OWNER/admin (the 'gm' kind) takes or hands; the HOLDER account may move the table between its own devices.
        const callerId = client.data?.userId as string | undefined;
        const holder = this.writer.holderOf(campaignId);
        const callerIsGm = this.isGm(client, campaignId);
        if (!(this.allowed(client, campaignId, 'gm') || (!!holder && !!callerId && holder.userId === callerId))) { this.deny(client, 'hand-table', 'GM only'); return { event: 'writer', data: null }; }
        // L1/P5 — the TARGET is validated against the CONNECTED GM-app DEVICES (the very list the controls are built from).
        const verdict = handTableDecision({ toUserId, toDeviceId, callerId, ownerId: this.campaigns.getOwnerId(campaignId), holder, readers: this.gmDevicesIn(campaignId), callerIsGm: AuthService.authRequired() ? callerIsGm : true });
        if (verdict === 'deny') { this.deny(client, 'hand-table', 'not a connected device of the table'); return { event: 'writer', data: null }; }
        this.cancelGrace(campaignId);
        this.writer.hand(campaignId, { userId: toUserId, deviceId: toDeviceId }, Date.now());
        this.fanWriter(campaignId);
        return { event: 'writer', data: this.writerPayload(campaignId) };
    }
    /** The `writer` payload: the explicit holder (null ⇒ the owner holds by default) + the NAME of whoever actually
     *  holds the table right now (the explicit holder, else the owner) — the banner reads "Reading — <name> holds the table". */
    private writerPayload(campaignId: string): { campaignId: string; holderId: string | null; holderDeviceId: string | null; holderName: string | null; holderLabel: string | null } {
        const holder = this.writer.holderOf(campaignId);
        const label = holder?.deviceId ? (this.gmDevicesIn(campaignId).find((d) => d.userId === holder.userId && d.deviceId === holder.deviceId)?.label ?? null) : null;
        return { campaignId, holderId: holder?.userId ?? null, holderDeviceId: holder?.deviceId ?? null, holderName: holder ? (this.users.getById(holder.userId)?.displayName ?? null) : null, holderLabel: label };
    }
    /** Fan the current writer holder to the room's GM-APP sockets (the owner/admin + co-GM readers). Every such device
     *  computes "am I the writer" = holderId===me OR (holderId===null AND I own the record). L1: it names an account,
     *  so it is no longer a whole-room emit — a player never received anything it used from it. */
    private fanWriter(campaignId: string): void {
        const payload = this.writerPayload(campaignId);
        for (const sock of this.server.sockets.sockets.values()) {
            if (sock.rooms.has(campaignId) && sock.data?.userId && this.isReadGm(sock, campaignId)) sock.emit('writer', payload);
        }
        // P5 — the baton moved: re-shape the lobby roster + the seat map for the room, so the new writer device holds real
        // tokens for its seat control (and a device that lost the table is re-shaped on its next fan regardless).
        this.fanLobby(campaignId, this.lobby.list(campaignId));
        this.fanSeats(campaignId);
    }
    private isTableGm(client: Socket, campaignId: string): boolean {
        if (this.isGm(client, campaignId)) return true;
        const holder = this.writer.holderOf(campaignId);
        return !!holder && client.data?.userId === holder.userId && this.isReadGm(client, campaignId);
    }
    private isWriterDevice(client: Socket, campaignId: string): boolean {
        const holder = this.writer.holderOf(campaignId);
        return !!holder && client.data?.userId === holder.userId && (holder.deviceId == null || client.data?.deviceId === holder.deviceId) && this.isReadGm(client, campaignId);
    }
    private seatsFor(client: Socket, campaignId: string): SeatRow[] {
        const me = client.data?.lobbyToken as string | undefined;
        // P5 — a verified GM (or dev/LAN) also gets the holder's TOKEN: its seat control works BY token, exactly as its
        const gm = this.tokenTrusted(client, campaignId); // P5 — the writer device too (its seat control works BY token)
        return this.claims.seatHolders(campaignId).map((c) => ({ instanceId: c.instanceId, holderName: c.holderName, mine: !!me && c.holderToken === me, ...(gm ? { holderToken: c.holderToken } : {}) }));
    }
    /** The `seats` payload for ONE recipient. ORDER-13 — a GM-APP recipient (the owner/admin, a co-GM reader, dev/LAN) also gets the
     *  newest tail of the server's SEAT LEDGER (GM truth, like gmOnly — a player's payload never carries it). Read per recipient
     *  from the DB (one SELECT per GM socket per seat change — the tail is bounded). */
    private seatsPayload(sock: Socket, campaignId: string): { campaignId: string; seats: SeatRow[]; ledger?: SeatLedgerEntry[] } {
        const gmApp = !AuthService.authRequired() || this.isReadGm(sock, campaignId);
        return { campaignId, seats: this.seatsFor(sock, campaignId), ...(gmApp ? { ledger: this.seatLedger.list(campaignId) } : {}) };
    }
    private fanSeats(campaignId: string): void {
        for (const sock of this.server.sockets.sockets.values()) {
            if (sock.rooms.has(campaignId)) sock.emit('seats', this.seatsPayload(sock, campaignId));
        }
    }
    @SubscribeMessage('seat')
    onSeat(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId: string; instanceId: string; toToken: string; nonce?: string }): { event: string; data: unknown } {
        const nothing = { event: 'seat-ack', data: null };
        const nonce = typeof (msg as { nonce?: unknown })?.nonce === 'string' ? (msg as { nonce: string }).nonce.slice(0, 40) : undefined;
        const v = vSeat(msg);
        if (!v.ok) { this.deny(client, 'seat', v.reason ?? 'invalid payload', nonce); return nothing; }
        const { campaignId, instanceId, toToken } = msg;
        // P5 (ruling 5) — the owner/admin (the 'gm' kind) seats; so does the DEVICE holding the table (a baton-holding co-GM).
        if (!(this.allowed(client, campaignId, 'gm') || this.isWriterDevice(client, campaignId))) { this.deny(client, 'seat', 'GM only', nonce); return nothing; }
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!snap || (snap as { packId?: unknown }).packId !== 'odm') { this.deny(client, 'seat', 'not an ODM campaign', nonce); return nothing; }
        const roster = this.lobby.list(campaignId);
        const d = seatAssignDecision({ instanceId, toToken, unitIds: companyUnitIdsOf(snap), lobbyTokens: roster.map((p) => p.token) });
        if (d.verdict === 'deny') { this.deny(client, 'seat', d.reason, nonce); return nothing; }
        const before = this.seatBefore(campaignId, instanceId); // ORDER-13
        const was = before?.holderName ?? null;
        const name = d.verdict === 'seat' ? (roster.find((p) => p.token === toToken)?.name || 'Player') : '';
        this.claims.claim(campaignId, SEAT_KEY, instanceId, name, d.verdict === 'seat' ? toToken : '', Date.now());
        this.recordSeatChange(client, campaignId, instanceId, d.verdict, before); // ORDER-13 — written by the SERVER: a handed-away owner's seating is a line too
        this.fanSeats(campaignId);
        return { event: 'seat-ack', data: { instanceId, nonce, was, now: name || null } };
    }
    /** ORDER-13 — the seat map's row for a unit BEFORE a write (ODM campaigns only — other modes have no seats, no ledger). */
    private seatBefore(campaignId: string, instanceId: string): { holderName: string; holderToken: string } | null | undefined {
        const snap = this.campaigns.rawSnapshot(campaignId);
        if (!snap || (snap as { packId?: unknown }).packId !== 'odm') return undefined; // undefined = not an ODM campaign → nothing to record
        return this.claims.seatHolders(campaignId).find((c) => c.instanceId === instanceId) ?? null;
    }
    /** ORDER-13 — EVERY SEAT CHANGE WRITES ONE ENTRY, by the server, whoever performed it. Compares the seat map's holder before and
     *  after the write (a re-claim of one's own seat under a new key moves nothing → no line; a release that falls the seat back
     *  to an older claim IS a move → one line naming the fallback holder). The actor is the SENDER (a GM by account, a player by
     *  callsign — the intent ledger's naming), with the acting role the server knows: owner · owner-reading · admin · player · dev. */
    private recordSeatChange(client: Socket, campaignId: string, instanceId: string, verb: SeatLedgerEntry['verb'], before: { holderName: string; holderToken: string } | null | undefined): void {
        if (before === undefined) return; // not an ODM campaign
        const after = this.claims.seatHolders(campaignId).find((c) => c.instanceId === instanceId) ?? null;
        if ((before?.holderToken ?? '') === (after?.holderToken ?? '')) return; // the seat did not move
        const authRequired = AuthService.authRequired();
        const gmUser = authRequired && client.data?.gmToken && this.isReadGm(client, campaignId) ? this.auth.userFromToken(client.data.gmToken as string) : null; // P5 — any GM-app account (a co-GM holder seats too)
        const bound = client.data?.lobbyToken as string | undefined;
        const who = seatActorOf({
            authRequired,
            gm: gmUser ? { userId: gmUser.id, displayName: gmUser.displayName, admin: gmUser.role === 'admin' } : null,
            ownerId: this.campaigns.getOwnerId(campaignId),
            isWriterDevice: this.isWriterDevice(client, campaignId),
            player: bound ? { token: bound, name: this.lobby.list(campaignId).find((p) => p.token === bound)?.name } : null,
            anon: anonId,
        });
        this.seatLedger.record(campaignId, { ts: Date.now(), verb, seat: instanceId, seatLabel: seatLabelOf(this.campaigns.rawSnapshot(campaignId), instanceId), was: before?.holderName || null, now: after?.holderName || null, ...who });
    }
    /** seat-sync — { campaignId }: the console asks who holds what (sent AFTER join-lobby, so `mine` is bound). Read-only. */
    @SubscribeMessage('seat-sync')
    onSeatSync(@ConnectedSocket() client: Socket, @MessageBody() msg: { campaignId?: unknown }): { event: string; data: unknown } {
        const campaignId = msg?.campaignId;
        if (typeof campaignId !== 'string' || !campaignId.length || campaignId.length > 500) return { event: 'seats', data: null };
        client.join(campaignId);
        return { event: 'seats', data: this.seatsPayload(client, campaignId) }; // ORDER-13 — a GM-app caller gets the seat ledger tail too
    }

    private readersOf(campaignId: string): { userId: string; deviceId: string; name: string; label: string | null }[] {
        return this.gmDevicesIn(campaignId); // P5 — the connected GM-app DEVICES (owner's included: its other device is a reader too)
    }
    private gmDevicesIn(campaignId: string): { userId: string; deviceId: string; name: string; label: string | null }[] {
        if (!AuthService.authRequired()) return [];
        const seen = new Map<string, { userId: string; deviceId: string; name: string; label: string | null }>();
        for (const sock of this.server.sockets.sockets.values()) {
            if (!sock.rooms.has(campaignId) || !sock.data?.userId || !sock.data?.deviceId) continue;
            const key = `${sock.data.userId}|${sock.data.deviceId}`;
            if (seen.has(key) || !this.isReadGm(sock, campaignId)) continue;
            const user = this.auth.userFromToken(sock.data?.gmToken as string | null | undefined);
            seen.set(key, { userId: sock.data.userId as string, deviceId: sock.data.deviceId as string, name: user?.displayName?.trim() || 'a co-GM', label: (sock.data.deviceLabel as string | null) ?? null });
        }
        return [...seen.values()];
    }
    /** Fan the connected readers to the room's VERIFIED GM sockets only (the owner/admin — the one who hands out). */
    private fanReaders(campaignId: string): void {
        if (!AuthService.authRequired()) return;
        const readers = this.readersOf(campaignId);
        for (const sock of this.server.sockets.sockets.values()) {
            if (sock.rooms.has(campaignId) && this.isGm(sock, campaignId)) sock.emit('readers', { campaignId, readers });
        }
    }
    /** Does this DEVICE of `userId` still have a live socket in the room? (deviceId null = any device of the account.) */
    private deviceInRoom(campaignId: string, userId: string, deviceId: string | null): boolean {
        for (const sock of this.server.sockets.sockets.values()) {
            if (sock.rooms.has(campaignId) && sock.data?.userId === userId && (deviceId == null || sock.data?.deviceId === deviceId)) return true;
        }
        return false;
    }

    @SubscribeMessage('favorite')
    onFavorite(@ConnectedSocket() client: Socket, @MessageBody() msg: FavoriteMsg): { event: string; data: unknown } {
        const v = vFavorite(msg);
        if (!v.ok) { this.deny(client, 'favorite', v.reason ?? 'invalid payload'); return { event: 'favorite', data: { instanceId: null, pilotId: null } }; }
        const { campaignId, token } = msg;
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
