export const PROD_API_URL = 'https://bce-production.up.railway.app/api';

export type HostClass = 'dev' | 'lan' | 'public';

const PRIVATE_LAN_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Classify a hostname: localhost/127.x/::1 = dev · private-LAN ranges = lan · anything else = public. */
export function classifyHost(hostname: string): HostClass {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return 'dev';
    if (PRIVATE_LAN_RE.test(hostname)) return 'lan';
    return 'public';
}

/** True when a stored engine URL points at a localhost / private-LAN host — i.e. UNREACHABLE from a public
 *  origin, so on a public origin it is safe (and correct) to replace such a value with the prod default. A
 *  malformed URL counts as replaceable (it is not a usable public value). */
export function isLocalOrLanEngineUrl(url: string | null | undefined): boolean {
    if (!url) return true;
    try { return classifyHost(new URL(url).hostname) !== 'public'; } catch { return true; }
}

export function perHostNoteApplies(engineUrl: string | null | undefined): boolean {
    return isLocalOrLanEngineUrl(engineUrl);
}

/** On a PUBLIC origin, is the stored engine URL replaceable with the prod default? Yes when it is:
 *   - empty / malformed, or a localhost/private-LAN host (unreachable from public), OR
 *   - the OLD BAD DERIVE: the serving public host itself with an explicit api port (e.g. bcengine.org:3000) —
 *     never a real prod value (Railway is a different host on 443). This is exactly the reported wedge.
 *  A genuine public api on a different host (Railway, a custom domain, standard ports) STANDS. */
export function isReplaceableOnPublic(stored: string | null | undefined, currentHost: string): boolean {
    if (!stored) return true;
    let u: URL;
    try { u = new URL(stored); } catch { return true; }
    if (classifyHost(u.hostname) !== 'public') return true;
    if (u.hostname === currentHost && u.port && u.port !== '443' && u.port !== '80') return true;
    return false;
}

export function chooseEngineUrl(p: { engineParam: string | null; hostname: string; protocol: string; stored: string | null }): string | null {
    if (p.engineParam) return p.engineParam;
    const cls = classifyHost(p.hostname);
    if (cls === 'public') return isReplaceableOnPublic(p.stored, p.hostname) ? PROD_API_URL : null;
    if (cls === 'dev' && p.stored) return p.stored;
    return `${p.protocol}//${p.hostname}:3000/api`;
}
