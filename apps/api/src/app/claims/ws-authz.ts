/*
 * BCE ENGINE — DIRECTIVE-HARDEN-6: the WebSocket AUTHORIZATION decisions as PURE functions (no Socket, no DI,
 * no env reads). The gateway's isGm / allowed / deniedAccess become thin adapters that GATHER the inputs
 * (resolve token→user, look up the campaign owner, read client.data, read AuthService.authRequired()) and then
 * call these deciders. Extracting the decision from the plumbing makes the shipped HARDEN-5+5b security rules
 * unit-testable (ws-authz.spec.ts pins every one) AND shrinks the gateway. Behavior is byte-identical — the
 * deciders encode the exact branches that lived inline.
 *
 * DECISION (input structs over positional params): each decider takes ONE plain object. It's self-documenting
 * at the call site, order-independent, and trivial to spec (build the struct, assert the verdict). The account-
 * less-player BIND is a SIDE EFFECT the pure code can't perform, so accessDecision RETURNS the bind intent
 * (`bindCampaignId`) and the gateway adapter applies it to client.data.
 */

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
}
export function accessDecision(input: AccessInput): { deny: boolean; bindCampaignId?: string } {
    const { user, authRequired, ownerId, campaignId, boundCampaignId, campaignExists } = input;
    if (user) {
        if (user.status !== 'approved') return { deny: true };          // banned/rejected/pending GM — denied every event
        if (user.role === 'admin') return { deny: false };              // admin passes
        return { deny: !(ownerId == null || ownerId === user.id) };     // GM must own it (null-owner legacy isn't GM-scoped)
    }
    // account-less PLAYER (P3):
    if (!authRequired) return { deny: false };                          // dev/LAN — open (D-048 LAN loop unchanged)
    if (boundCampaignId) return { deny: campaignId !== boundCampaignId }; // already bound → reject any OTHER campaign
    if (!campaignExists) return { deny: true };                         // can't bind to a phantom campaign id
    return { deny: false, bindCampaignId: campaignId };                 // bind on the first existing campaign it joins
}

// ── action — the per-message ACTION gate (allowed's logic, POST-lazy-bind-removal). authRequired=false → allow;
//    a verified GM → allow anything; gm-kind requires GM; participant requires a bound identity; token requires a
//    bound token that MATCHES the message token (no adoption of an arbitrary first-message token). ──
export interface ActionInput {
    authRequired: boolean;
    isGm: boolean;
    kind: 'gm' | 'token' | 'participant';
    boundToken: string | undefined; // client.data.lobbyToken (set only at join-lobby)
    msgToken: unknown;              // the token the message asserts (holderToken / token)
}
export function actionDecision(input: ActionInput): boolean {
    const { authRequired, isGm, kind, boundToken, msgToken } = input;
    if (!authRequired) return true;               // dev/LAN — permissive
    if (isGm) return true;                         // a verified GM may act on anyone's behalf
    if (kind === 'gm') return false;               // GM-only action, non-GM caller
    if (kind === 'participant') return boundToken != null; // must have a bound lobby identity
    return boundToken != null && boundToken === msgToken;  // token-scoped: only as ITSELF, and only if bound
}
