/*
 * GM-3 P3 — the CLIENT twin of the api's open-redirect gate (apps/api/src/app/auth/return-to.ts `safeReturnTo`, jest-pinned
 * by return-to.spec + the 29-spec suite). The "Manage my company ▸" hand-off sends the player from `/player/…` to the ROOT
 * app carrying the join link as `returnTo`; the root's "◄ Back to the table" navigates to it. `returnTo` is attacker-writable
 * (it rides the URL), so this is an OPEN-REDIRECT gate first: only a SAME-ORIGIN path under `/player/` survives — never a
 * protocol-relative `//host`, an absolute URL to another origin, a backslash/whitespace/control char, or a fragment. The
 * hand-off only ever needs a `/player/` join path, so the client gate is deliberately TIGHTER than the api's (which also
 * allows allow-listed absolute origins for the OAuth landing). Pure; spec-pinned in return-to.spec.ts.
 */
const MAX_LEN = 2048;

/** The validated same-origin `/player/` path (query preserved, fragment dropped), or null. A leading single '/', then
 *  `player/`; never '//' (another host), never backslash/whitespace/control chars, never an absolute URL. */
export function safeTablePath(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_LEN) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\s\x00-\x1f\x7f\\]/.test(raw)) return null;
    const noHash = raw.split('#')[0];
    if (!noHash || !noHash.startsWith('/')) return null; // absolute URLs (http(s)://…, //host) are refused: same-origin only
    if (noHash.startsWith('//')) return null; // protocol-relative → another host
    // exactly the player app's base path (the join link) — nothing else on this origin is a valid table return
    if (!/^\/player\/(?:\?|$)/.test(noHash) && noHash !== '/player') return null;
    return noHash;
}
