/*
 * HOTFIX-028 — hosted-aware host classification, shared by the engine-URL resolution (main.player.ts) and the
 * version/reset plumbing. The prod api origin is a single const (mirrors index.html:18 + the GM auto-set). The
 * private-LAN regex matches lobby-panel.ts:117-118. Pure — no Angular, safe to import from the pre-bootstrap
 * entry files.
 */
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

/** GM-1c — does the join page's per-host note ("campaigns live on the host you joined") apply? Only when the engine
 *  is NOT a public host: on the cloud host the note is noise that reads as a technical failure (the directive's rule),
 *  on a dev/LAN host it is the truth. Same classification as isLocalOrLanEngineUrl, named for what it decides;
 *  pinned by host-env.spec.ts (the browser harness can only stand up a local engine). */
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

/**
 * HOTFIX-028 — the PURE engine-URL decision (main.player.ts wires location + localStorage to it). Returns the
 * value to persist, or null to KEEP the current stored value untouched. NEVER-destructive on a stored public
 * value; explicit ?engine always wins. This is the classification table:
 *   ?engine present            → the explicit value        (persist — a scanned QR always wins)
 *   public + stored good-public → null                     (KEEP — never clobber a real api with a guess)
 *   public + stored LAN/—/self:3000 → PROD_API_URL         (REPLACE — unreachable value / the reported wedge)
 *   dev (localhost) + stored    → the stored value          (KEEP — a manually-set engine survives)
 *   dev (localhost), no stored  → <host>:3000/api           (derive)
 *   lan                         → <host>:3000/api           (derive — the serving host IS the GM box)
 */
export function chooseEngineUrl(p: { engineParam: string | null; hostname: string; protocol: string; stored: string | null }): string | null {
    if (p.engineParam) return p.engineParam;
    const cls = classifyHost(p.hostname);
    if (cls === 'public') return isReplaceableOnPublic(p.stored, p.hostname) ? PROD_API_URL : null;
    if (cls === 'dev' && p.stored) return p.stored;
    return `${p.protocol}//${p.hostname}:3000/api`;
}
