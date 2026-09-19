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

export function oauthLanding(origins: string[], returnTo: unknown, token: string): string {
    const base = safeReturnTo(returnTo, origins) ?? `${origins[0] ?? ''}/`;
    return `${base}#bce_auth=${encodeURIComponent(token)}`;
}
