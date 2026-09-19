
/** The verbs that target a seat. Everything else on the odm-intent allowlist is a COMPANY verb. */
export const ODM_SEAT_VERBS = ['reassign-pilot', 'set-deploy', 'bay-assign', 'rename-pilot', 'seat-note', 'seat-request'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

/** The seat the named pilot currently rides (null = spare / unknown / a malformed blob). */
export function pilotSeatOf(snapshot: unknown, pilotId: string | null): string | null {
    if (!pilotId || !snapshot || typeof snapshot !== 'object') return null;
    const pilots = (snapshot as { pilots?: unknown }).pilots;
    if (!Array.isArray(pilots)) return null;
    for (const p of pilots) {
        if (p && typeof p === 'object' && (p as { pilotId?: unknown }).pilotId === pilotId) return str((p as { assignedInstanceId?: unknown }).assignedInstanceId);
    }
    return null;
}

/** The seats this intent touches — [] for a COMPANY verb. Resolve it BEFORE the intent is applied: a crew move
 *  rewires the very link this reads. */
export function odmIntentSeats(verb: string, payload: Record<string, unknown> | null | undefined, snapshot: unknown): string[] {
    if (!(ODM_SEAT_VERBS as readonly string[]).includes(verb)) return [];
    const seat = str(payload?.['instanceId']);
    if (!seat) return [];
    if (verb !== 'reassign-pilot') return [seat];
    const leaving = pilotSeatOf(snapshot, str(payload?.['pilotId'])); // '' = stand the crew down — no second seat
    return leaving && leaving !== seat ? [seat, leaving] : [seat];
}


/** The reserved engagement key the GM's seat assignments live under. Never a real engagement. */
export const SEAT_KEY = '__seat';

/** The campaign's LIVE engagement key, server-side: the ACTIVE branch's id, else null (frozen — nothing is claimable).
 *  LOCKSTEP with apps/web engagement-key.ts (its ACTIVE rule; its RESOLVED/'none' fallbacks name a FROZEN record). */
export function activeEngagementKeyOf(snapshot: unknown): string | null {
    const tree = snapshot && typeof snapshot === 'object' ? (snapshot as { missionTree?: unknown }).missionTree : null;
    if (!Array.isArray(tree)) return null;
    for (const b of tree) {
        if (b && typeof b === 'object' && (b as { state?: unknown }).state === 'ACTIVE') return str((b as { branchId?: unknown }).branchId);
    }
    return null;
}

export type OdmClaimDenial = 'reserved key' | 'no active engagement' | 'not the live engagement' | 'another player holds that seat';
/** May a NON-GM claim land under this key, on this unit? (The GM is never asked.)
 *  ORDER-12 (2026-09-18) — the door also reads the SEAT MAP: the per-key steal guard in the gateway only sees rows under the
 *  key the message names, but the seat is cross-engagement, so under the LIVE key a unit whose seat another player holds
 *  (a GM seating under the reserved key, or the unit it last flew) was claimable with no live row yet — the seat moved to
 *  the claimant. A player may claim a FREE unit (the lobby pick) or its OWN seat (which carries into the live engagement);
 *  another player's seat only the GM may move. `seatHolderToken` = the seat map's holder for the unit (null = unseated). */
export function odmClaimDecision(input: { isOdm: boolean; engagementKey: string | null | undefined; activeKey: string | null; seatHolderToken?: string | null; callerToken?: string | null }): { allow: boolean; reason?: OdmClaimDenial } {
    if (input.engagementKey === SEAT_KEY) return { allow: false, reason: 'reserved key' };
    if (!input.isOdm) return { allow: true };
    if (!input.activeKey) return { allow: false, reason: 'no active engagement' };
    if (input.engagementKey !== input.activeKey) return { allow: false, reason: 'not the live engagement' };
    if (input.seatHolderToken && input.seatHolderToken !== input.callerToken) return { allow: false, reason: 'another player holds that seat' };
    return { allow: true };
}

/** The company's unit ids, duck-read (a malformed blob fields nothing). */
export function companyUnitIdsOf(snapshot: unknown): string[] {
    const force = snapshot && typeof snapshot === 'object' ? (snapshot as { startingForce?: unknown }).startingForce : null;
    if (!Array.isArray(force)) return [];
    return force.map((u) => (u && typeof u === 'object' ? str((u as { instanceId?: unknown }).instanceId) : null)).filter((x): x is string => !!x);
}

/** ORDER-13 — a unit's label for a ledger line (`chassis model`, off the company or the mission's OpFor — the two places a
 *  claimable instance lives, the instanceSideOf pair; the id when the blob does not know it). */
export function seatLabelOf(snapshot: unknown, instanceId: string): string {
    const o = snapshot && typeof snapshot === 'object' ? (snapshot as { startingForce?: unknown; missionSpec?: { opforForce?: unknown } | null }) : null;
    for (const force of [o?.startingForce, o?.missionSpec?.opforForce]) {
        if (!Array.isArray(force)) continue;
        for (const u of force) {
            if (u && typeof u === 'object' && (u as { instanceId?: unknown }).instanceId === instanceId) {
                const label = `${str((u as { chassis?: unknown }).chassis) ?? ''} ${str((u as { model?: unknown }).model) ?? ''}`.trim();
                return label || instanceId;
            }
        }
    }
    return instanceId;
}

export type SeatRole = 'owner' | 'owner-reading' | 'admin' | 'co-gm' | 'player' | 'dev';
export interface SeatActor { actor: string; actorKey: string; role: SeatRole }
export function seatActorOf(input: {
    authRequired: boolean;
    gm: { userId: string; displayName: string | null | undefined; admin: boolean } | null; // a GM-app account (owner / admin / co-GM reader)
    ownerId: string | null;
    isWriterDevice: boolean; // the sending socket's DEVICE holds the table
    player: { token: string; name: string | null | undefined } | null;
    anon: (s: string) => string;
}): SeatActor {
    if (!input.authRequired) return input.player ? { actor: input.player.name?.trim() || 'Player', actorKey: input.anon(input.player.token), role: 'dev' } : { actor: 'GM', actorKey: 'gm', role: 'dev' };
    if (input.gm) {
        const owner = input.ownerId != null && input.gm.userId === input.ownerId;
        const role: SeatRole = owner ? (input.isWriterDevice ? 'owner' : 'owner-reading') : input.gm.admin ? 'admin' : 'co-gm';
        return { actor: `${input.gm.displayName?.trim() || 'GM'} (GM)`, actorKey: `gm-${input.anon(input.gm.userId)}`, role };
    }
    if (input.player) return { actor: input.player.name?.trim() || 'Player', actorKey: input.anon(input.player.token), role: 'player' };
    return { actor: 'Player', actorKey: '?', role: 'player' };
}

export type SeatAssignVerdict = { verdict: 'seat' | 'unseat' } | { verdict: 'deny'; reason: 'no such unit in the company' | 'not a joined player' };
/** THE GM SEATS A PLAYER: `toToken` = a player of THIS campaign's lobby roster ('' = clear the seat), on a unit of THIS
 *  company. The caller is already a verified GM (the 'gm' kind); this decides only the target. */
export function seatAssignDecision(input: { instanceId: string; toToken: string; unitIds: readonly string[]; lobbyTokens: readonly string[] }): SeatAssignVerdict {
    if (!input.unitIds.includes(input.instanceId)) return { verdict: 'deny', reason: 'no such unit in the company' };
    if (input.toToken === '') return { verdict: 'unseat' };
    return input.lobbyTokens.includes(input.toToken) ? { verdict: 'seat' } : { verdict: 'deny', reason: 'not a joined player' };
}
