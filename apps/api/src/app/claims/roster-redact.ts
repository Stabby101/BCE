import { createHash } from 'node:crypto';

/** A stable, non-reversible handle for a token — same token → same id, but the raw token is unrecoverable.
 *  Prefixed so it can never be mistaken for (or replayed as) a real client token. */
export function anonId(token: string): string {
    return 'anon-' + createHash('sha256').update(token).digest('hex').slice(0, 16);
}

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
