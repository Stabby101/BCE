
/** The subset of a resolved user the authz decisions read (a full auth User satisfies this). */
export interface AuthzUser {
    id: string;
    role: string;   // 'admin' passes ownership; any other approved role must own the campaign
    status: string; // only 'approved' may act (banned/rejected/pending are denied every event — DEPLOY-003)
}

// ── isGm — a live-verified GM OF THIS CAMPAIGN (approved admin, or approved owner). ──
export function isGmDecision(input: { user: AuthzUser | null | undefined; ownerId: string | null }): boolean {
    const { user, ownerId } = input;
    if (!user || user.status !== 'approved') return false;
    if (user.role === 'admin') return true;
    return ownerId != null && ownerId === user.id;
}

// ── access — the P2/P3/DEPLOY-003 campaign-ACCESS gate (deniedAccess's logic). `deny` = block the event; when
//    `bindCampaignId` is present the caller must set client.data.boundCampaignId to it (the account-less player's
//    bind-on-first-campaign). authRequired=false → always allow (dev/LAN trusted single-tenant). ──
export interface AccessInput {
    user: AuthzUser | null | undefined; // the resolved GM user (null → account-less player)
    authRequired: boolean;
    ownerId: string | null;             // getOwnerId(campaignId) — only consulted for a non-admin GM
    campaignId: string;
    boundCampaignId: string | undefined; // client.data.boundCampaignId (a player's already-bound campaign)
    campaignExists: boolean;             // campaigns.exists(campaignId) — a player can't bind to a phantom id
    // grant, of THE pinned ODM record — campaigns.socketReadAllowed, the same gate as the REST get()). The
    // gateway computes it ONLY for a non-owner/non-admin GM (else false), so there is no per-event cost for
    // owners, admins, or players. It widens ACCESS to the room for a READ; it grants NO write (actionDecision
    // is untouched — a co-GM still fails 'gm'/'unit'/'token', so it can join and observe but not act).
    coGmRead?: boolean;
}
export function accessDecision(input: AccessInput): { deny: boolean; bindCampaignId?: string } {
    const { user, authRequired, ownerId, campaignId, boundCampaignId, campaignExists, coGmRead } = input;
    if (user) {
        if (user.status !== 'approved') return { deny: true };                        // banned/rejected/pending GM — denied every event
        if (user.role === 'admin') return { deny: false };                            // admin passes
        return { deny: !(ownerId == null || ownerId === user.id || coGmRead === true) };
    }
    // account-less PLAYER (P3):
    if (!authRequired) return { deny: false };
    if (boundCampaignId) return { deny: campaignId !== boundCampaignId }; // already bound → reject any OTHER campaign
    if (!campaignExists) return { deny: true };                         // can't bind to a phantom campaign id
    return { deny: false, bindCampaignId: campaignId };                 // bind on the first existing campaign it joins
}

// ── action — the per-message ACTION gate (allowed's logic, POST-lazy-bind-removal). authRequired=false → allow;
//    a verified GM → allow anything; gm-kind requires GM; participant requires a bound identity; token requires a
//    bound token that MATCHES the message token (no adoption of an arbitrary first-message token); unit
export interface ActionInput {
    authRequired: boolean;
    isGm: boolean;
    kind: 'gm' | 'token' | 'participant' | 'unit';
    boundToken: string | undefined; // client.data.lobbyToken (set only at join-lobby)
    msgToken: unknown;              // the token the message asserts (holderToken / token)
    /** 'unit' kind only — the target instance's claim-row holderToken; null = NO claim row (deny-unclaimed,
     *  the P0 R5 ruling); undefined = not a unit decision. A claim row with an EMPTY holderToken also denies
     *  (boundToken is vLobbyJoin-guaranteed non-empty, so '' can never match).
     *  // DECISION: empty-token rows deny under 'unit' (consistent with deny-unclaimed) even though
     *  // onRelease treats them as releasable-by-anyone — releasing a ghost differs from writing a sheet. */
    instanceHolderToken?: string | null;
}
export function actionDecision(input: ActionInput): boolean {
    const { authRequired, isGm, kind, boundToken, msgToken, instanceHolderToken } = input;
    if (!authRequired) return true;               // dev/LAN — permissive
    if (isGm) return true;                         // a verified GM may act on anyone's behalf
    if (kind === 'gm') return false;               // GM-only action, non-GM caller
    if (kind === 'unit') return boundToken != null && !!instanceHolderToken && instanceHolderToken === boundToken;
    if (kind === 'participant') return boundToken != null; // must have a bound lobby identity
    return boundToken != null && boundToken === msgToken;  // token-scoped: only as ITSELF, and only if bound
}

//    claim an instance whose side is not X. Same posture as every rule above: authRequired=false → allow (dev/LAN, the
//    GM claims across sides from the same path). The rule bites ONLY when BOTH sides are KNOWN wire values: an instance
//    the snapshot does not place (null) or a row without a recognised side never invents a side — it is the client
//    roster's gate mirrored (BLUFOR = the company, OPFOR = the mission OpFor), not a new one. ──
export type WireSide = 'BLUFOR' | 'OPFOR';
const WIRE_SIDES: ReadonlySet<string> = new Set(['BLUFOR', 'OPFOR']);
export interface SideInput {
    authRequired: boolean;
    isGm: boolean;
    rowSide: string | null | undefined;          // the caller's lobby row side (LobbyPlayer.side; null = no row)
    instanceSide: WireSide | null;               // instanceSideOf(snapshot, instanceId); null = not placed by the snapshot
}
export function sideDecision(input: SideInput): boolean {
    const { authRequired, isGm, rowSide, instanceSide } = input;
    if (!authRequired) return true;                                   // dev/LAN — permissive (the sacred short-circuit)
    if (isGm) return true;                                            // a verified GM claims across sides (reassign is its tool)
    if (!instanceSide || !rowSide || !WIRE_SIDES.has(rowSide)) return true; // no side known on either end → no rule
    return rowSide === instanceSide;
}
export function instanceSideOf(snapshot: unknown, instanceId: string): WireSide | null {
    if (snapshot === null || typeof snapshot !== 'object') return null;
    const o = snapshot as { startingForce?: unknown; missionSpec?: { opforForce?: unknown } | null };
    const holds = (arr: unknown): boolean => Array.isArray(arr) && arr.some((u) => u !== null && typeof u === 'object' && (u as { instanceId?: unknown }).instanceId === instanceId);
    if (holds(o.missionSpec?.opforForce)) return 'OPFOR';
    if (holds(o.startingForce)) return 'BLUFOR';
    return null;
}

//    auth question is asked. The close is a GAME rule, not an auth rule: the dev/LAN short-circuit, a verified GM, the claim-row
//    holder — none of them writes to a fight the GM has ended (a GM re-opening is a re-generate, which mints a new key). An
//    decision's business — a player keeps their claim row; only writes stop. ──
export interface SidePrefInput { hasContract: boolean; hasGeneratedTrack: boolean; completed: boolean }
export function sidePrefDecision(input: SidePrefInput): boolean {
    if (input.hasContract) return !input.hasGeneratedTrack; // lobby: a live contract, nothing generated yet
    return !input.completed;                                // none: no contract, no terminal record
}
/** The three phase facts, duck-read off the opaque snapshot (top-level fields only — never a gmOnly parse). */
export function sidePrefFactsOf(snapshot: unknown): SidePrefInput {
    const s = (snapshot ?? {}) as { contractSummary?: { status?: string } | null; activeChaosContract?: { status?: string } | null; completedChaosContract?: unknown; missionTree?: { state?: string }[] | null; missionSpec?: unknown };
    const c = s.contractSummary ?? s.activeChaosContract ?? null;
    const live = !!c && c.status !== 'completed';
    const hasGeneratedTrack = (Array.isArray(s.missionTree) ? s.missionTree : []).some((b) => b?.state === 'ACTIVE' || b?.state === 'RESOLVED') || !!s.missionSpec;
    return { hasContract: live, hasGeneratedTrack, completed: !!s.completedChaosContract || (!!c && c.status === 'completed') };
}

//    'gm' kind — owner/admin), so this decides only the TARGET. The owner's own id is a TAKE-BACK (release to the
//    owner-default — always possible, which is what makes the hand-off safe). Anyone else must be a co-GM reader WITH
//    A LIVE SOCKET IN THE ROOM (the connected-readers set the gateway fans to the owner): a mistyped or stale id can
//    never strand the write on an account that is not at the table. Dev/LAN has no accounts → nothing to hand to. ──
//    LIVE GM-app socket in the room (`readers` = the connected GM-app devices). The OWNER (or admin — `callerIsGm`) TAKES the
//    table to any of its own connected devices (it can never be locked out) and HANDS it to a co-GM's SPECIFIC device; the
//    HOLDER account MOVES it between its own connected devices; nobody else moves anything. There is no "release to the
//    owner-default" any more — the table is always on a device, or on nobody. ──
export type HandTableVerdict = 'take' | 'move' | 'hand' | 'deny';
export function handTableDecision(input: {
    toUserId: string | null | undefined;
    toDeviceId: string | null | undefined;
    callerId: string | null | undefined;
    ownerId: string | null;
    holder: { userId: string; deviceId: string | null } | null;
    readers: readonly { userId: string; deviceId: string }[];
    callerIsGm?: boolean; // owner/admin (isGmDecision); defaults to "the caller is the owner"
}): HandTableVerdict {
    const { toUserId, toDeviceId, callerId, ownerId, holder, readers } = input;
    if (!toUserId || !toDeviceId || !callerId) return 'deny';
    if (!readers.some((r) => r.userId === toUserId && r.deviceId === toDeviceId)) return 'deny'; // the target device is not at the table
    const callerIsGm = input.callerIsGm ?? (ownerId != null && callerId === ownerId);
    if (callerIsGm) return toUserId === callerId ? 'take' : 'hand';
    if (holder && holder.userId === callerId) return toUserId === callerId ? 'move' : 'deny';
    return 'deny';
}

//    already passed the 'token' identity gate; this decides what it may touch. A SEAT is a unit instance, `holders` is the
//    seat→token map (the claim rows), `targetSeats` is what the intent is about (odm-seats.odmIntentSeats — [] = a COMPANY
//    verb). own seat → allowed · another's seat → denied · an UNCLAIMED seat → GM only · a COMPANY verb → only a caller who
//    holds SOME seat ("no claimed seat = read-only") · the GM (owner/admin, or the baton holder) → unrestricted · dev/LAN
export type SeatDenial = 'no bound identity' | 'not your seat' | 'unclaimed seat — GM only' | 'no claimed seat — the company is read-only';
export interface SeatInput {
    authRequired: boolean;
    isGm: boolean;
    callerToken: string | null | undefined;
    targetSeats: readonly string[];
    holders: Readonly<Record<string, string>>;
}
export function seatDecision(input: SeatInput): { allow: boolean; reason?: SeatDenial } {
    if (!input.authRequired) return { allow: true };
    if (input.isGm) return { allow: true };
    const me = input.callerToken;
    if (!me) return { allow: false, reason: 'no bound identity' };
    for (const seat of input.targetSeats) {
        const holder = Object.prototype.hasOwnProperty.call(input.holders, seat) ? input.holders[seat] : undefined;
        if (!holder) return { allow: false, reason: 'unclaimed seat — GM only' };
        if (holder !== me) return { allow: false, reason: 'not your seat' };
    }
    if (input.targetSeats.length) return { allow: true };
    return Object.values(input.holders).includes(me) ? { allow: true } : { allow: false, reason: 'no claimed seat — the company is read-only' };
}

export interface EngagementWriteInput extends ActionInput { closed: boolean }
export function engagementWriteDecision(input: EngagementWriteInput): boolean {
    if (input.closed) return false;               // closed → refused for everyone, in every auth posture
    return actionDecision(input);                  // open → the per-unit rule, unchanged
}
