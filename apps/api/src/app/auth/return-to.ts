/*
 * DIRECTIVE-GM-1c — where an OAuth sign-in LANDS. The join page hands the start route a `returnTo` (carried through the
 * provider as the OAuth `state`), so a player who signed in from `/player/?campaign=…&engine=…` comes back to that exact
 * URL with the session on the fragment (HOTFIX-040 Bearer-first, unchanged). `state` is attacker-writable, so this is an
 * OPEN-REDIRECT gate first and a convenience second: only a same-site PATH (prefixed with the canonical frontend origin)
 * or an absolute URL whose origin is in the BCE_WEB_ORIGIN allow-list survives; anything else lands where it always did
 * (the root). Pure — jest-pinned in return-to.spec.ts.
 */
const MAX_LEN = 2048;

/** The canonical frontend origins (BCE_WEB_ORIGIN, comma-list, trailing slashes dropped). The first is where a relative
 *  path lands — the same origin `completeOAuth` always redirected to. Empty when unset (dev/LAN: relative to the api). */
export function frontendOrigins(env: string | undefined): string[] {
    return (env ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Validate a requested return target → the ABSOLUTE landing URL (no fragment), or null for anything that is not a
 * same-site path or an allow-listed absolute URL.
 *   - a path: a single leading '/', never '//' (protocol-relative = another host), no backslash / whitespace / control
 *     chars, any fragment dropped → `${origins[0]}${path}` (bare when no origin is configured — today's dev posture)
 *   - absolute http(s): its origin (scheme + host + port, exact) must be one of `origins` → origin + pathname + search
 */
export function safeReturnTo(raw: unknown, origins: string[]): string | null {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_LEN) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\s\x00-\x1f\x7f\\]/.test(raw)) return null;
    const noHash = raw.split('#')[0];
    if (!noHash) return null;
    if (noHash.startsWith('/')) {
        if (noHash.startsWith('//')) return null;
        return `${origins[0] ?? ''}${noHash}`;
    }
    if (/^https?:\/\//i.test(noHash)) {
        try {
            const u = new URL(noHash);
            if (!origins.includes(u.origin)) return null;
            return `${u.origin}${u.pathname}${u.search}`;
        } catch {
            return null;
        }
    }
    return null;
}

/** The post-callback redirect: the validated target — or the root, exactly as before GM-1c — with the session JWT on the
 *  FRAGMENT (never a query param: a fragment is not sent to the server, logs, or Referer). */
export function oauthLanding(origins: string[], returnTo: unknown, token: string): string {
    const base = safeReturnTo(returnTo, origins) ?? `${origins[0] ?? ''}/`;
    return `${base}#bce_auth=${encodeURIComponent(token)}`;
}
