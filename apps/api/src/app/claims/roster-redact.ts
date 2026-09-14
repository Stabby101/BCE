/*
 * BCE ENGINE — DIRECTIVE-HARDEN-5b: player-token REDACTION for the room fans (pure; no framework).
 *
 * The player device token is a self-asserted bearer identity. HARDEN-5 scoped actions to it, but the token was
 * still BROADCAST — the lobby roster (LobbyPlayer.token) AND the claims set (Claim.holderToken) both carry it,
 * and the gateway fans both to the whole room. So any player held every other player's token and could
 * join-lobby AS them. Root cause = the token is broadcast on two channels; these helpers redact BOTH.
 *
 * Rule (applied only in hosted auth-ON — see the gateway; dev/LAN stays the trusted single-tenant full-roster
 * model): a NON-GM recipient sees, for OTHER players, a stable non-reversible opaque handle (anonId) in place of
 * the raw token; its OWN entry keeps its real token so the client's self-identity check (`entry.token === myToken`)
 * and `isMine` still work with no client change. The GM socket always gets the full, unredacted roster/set (it
 * kicks/reassigns BY token — HOTFIX-030 presence + the claims-board kick both depend on real tokens).
 */
import { createHash } from 'node:crypto';

/** A stable, non-reversible handle for a token — same token → same id, but the raw token is unrecoverable.
 *  Prefixed so it can never be mistaken for (or replayed as) a real client token. */
export function anonId(token: string): string {
    return 'anon-' + createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/** Redact a lobby roster for one non-GM recipient: others' `token` → anonId; the recipient's own entry unchanged.
 *  GM-1 P2 — others' `sidePref` is GM-only advisory truth: stripped to null on rows that carry it (the recipient's
 *  own row keeps its own preference). Rows WITHOUT the field stay byte-identical (the pre-GM-1 pins hold). */
export function redactLobby<T extends { token: string }>(full: readonly T[], ownToken: string | undefined): T[] {
    return full.map((p) => {
        if (p.token === ownToken) return p;
        const anon = { ...p, token: anonId(p.token) } as T & { sidePref?: string | null };
        if ('sidePref' in p) anon.sidePref = null; // advisory prefs fan to the GM panel, never to other players
        return anon;
    });
}

/** Redact a claims set for one non-GM recipient: others' `holderToken` → anonId; the recipient's own claim
 *  keeps its real holderToken (so `isMine` matches). A blank holderToken (unclaimed/legacy) is left as-is. */
export function redactClaims<T extends { holderToken: string }>(set: readonly T[], ownToken: string | undefined): T[] {
    return set.map((c) => (!c.holderToken || c.holderToken === ownToken ? c : { ...c, holderToken: anonId(c.holderToken) }));
}
