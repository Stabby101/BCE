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
//    bound token that MATCHES the message token (no adoption of an arbitrary first-message token); unit
//    (GM-1 P3, the HARDEN-7 per-unit close) requires the target instance's CLAIM-ROW holder to be the caller. ──
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
    if (kind === 'unit') return boundToken != null && !!instanceHolderToken && instanceHolderToken === boundToken; // GM-1 P3 — owner-or-GM; unclaimed denies
    if (kind === 'participant') return boundToken != null; // must have a bound lobby identity
    return boundToken != null && boundToken === msgToken;  // token-scoped: only as ITSELF, and only if bound
}

// ── side — ORDER-2 H15 (SMOKE-ODM-4P S43): the SIDE is a SERVER rule at `claim`. A lobby row bound to side X may not
//    claim an instance whose side is not X. Same posture as every rule above: authRequired=false → allow (dev/LAN, the
//    trusted single-tenant model — the HARDEN-5 short-circuit); a verified GM → allow (reassign is the GM's tool, and the
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
/** Which side an instance belongs to, read DEFENSIVELY off the opaque snapshot (the countOwnedImports discipline).
 *  `missionSpec.opforForce[]` is checked FIRST → OPFOR: it is the engagement's declared side-B roster, and GM-1 P4's
 *  "seed side B from the players" COPIES a player-import unit into it while the company copy stays in startingForce
 *  with its condition flipped off Deployed ("one unit is never on both sides" is a condition rule, not a membership
 *  one) — company-first answered BLUFOR for a side-B player's own machine and denied its re-claim (caught by the
 *  gm1b family gate, ORDER-2). Else `startingForce[]` → BLUFOR (the company, any condition — an undeployed hull is
 *  still the company's, so an OPFOR row may not claim it); placed by neither → null (no rule). */
export function instanceSideOf(snapshot: unknown, instanceId: string): WireSide | null {
    if (snapshot === null || typeof snapshot !== 'object') return null;
    const o = snapshot as { startingForce?: unknown; missionSpec?: { opforForce?: unknown } | null };
    const holds = (arr: unknown): boolean => Array.isArray(arr) && arr.some((u) => u !== null && typeof u === 'object' && (u as { instanceId?: unknown }).instanceId === instanceId);
    if (holds(o.missionSpec?.opforForce)) return 'OPFOR';
    if (holds(o.startingForce)) return 'BLUFOR';
    return null;
}

// ── engagement write — ORDER-4 H18 (ENGAGE-1's first brick): a `battle` write to a CLOSED engagement is refused BEFORE any
//    auth question is asked. The close is a GAME rule, not an auth rule: the dev/LAN short-circuit, a verified GM, the claim-row
//    holder — none of them writes to a fight the GM has ended (a GM re-opening is a re-generate, which mints a new key). An
//    OPEN engagement delegates to actionDecision unchanged (the HARDEN-7 per-unit rule, byte-identical). Claims are not this
//    decision's business — a player keeps their claim row; only writes stop. ──
/** DIRECTIVE-PD3 P2 (PD3-9) — a side PREFERENCE is a LOBBY thing. Once the singular is being played (a track generated: any branch
 *  ACTIVE/RESOLVED, or a spec) the side is a fact, and once the contract is complete the pick is meaningless — both are REFUSED
 *  server-side (a hidden button is not a gate). LOCKSTEP with apps/web chaos-contract.ts sessionPhase(): allowed = 'lobby' | 'none'. */
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

export interface EngagementWriteInput extends ActionInput { closed: boolean }
export function engagementWriteDecision(input: EngagementWriteInput): boolean {
    if (input.closed) return false;               // closed → refused for everyone, in every auth posture
    return actionDecision(input);                  // open → the per-unit rule, unchanged
}
