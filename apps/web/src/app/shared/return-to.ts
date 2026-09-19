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
