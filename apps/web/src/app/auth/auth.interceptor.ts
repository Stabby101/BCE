/*
 * BCE multi-tenant (DEPLOY-002 P4) — the GM-bundle HTTP interceptor. Registered ONLY in app.config
 * (the GM web bundle), NEVER in app.player.config — so the account-less player's REST stays credential-free
 * (ROLE-002). It authenticates ENGINE-API calls only: (1) sends the session cookie cross-site (Cloudflare
 * Pages ↔ Railway needs withCredentials, the cookie being sameSite=none+secure on the host) so the existing
 * campaign-store calls authenticate with ZERO store edits; (2) attaches the Bearer JWT when present (the host
 * guard's extractToken reads cookie OR Bearer).
 *
 * CRITICAL — it must NOT touch the unit-catalog/sprite fetches to db.mekbay.com (a different origin): adding
 * withCredentials/Authorization there trips CORS and breaks data loading. So it matches the engine origin
 * (bce.engine.url) / relative /api only and passes everything else through untouched.
 */
import type { HttpInterceptorFn } from '@angular/common/http';
import { gmDeviceId } from '../campaign/claims/gm-device';

const SESSION_TOKEN_KEY = 'bce.auth.token';
const ENGINE_URL_KEY = 'bce.engine.url';
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api';

/** Whether a request targets OUR engine API (so credentials are safe + wanted) vs a third-party origin. */
function targetsEngine(url: string): boolean {
    try {
        const engineOrigin = new URL(localStorage.getItem(ENGINE_URL_KEY) || DEFAULT_ENGINE_URL).origin;
        if (/^https?:\/\//i.test(url)) return url.startsWith(engineOrigin); // absolute → same origin as the engine
        return url.startsWith('/api') || url.startsWith('api/'); // relative → our API (same-origin deploy)
    } catch {
        return false;
    }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    if (!targetsEngine(req.url)) return next(req); // db.mekbay.com / fonts / assets — untouched
    let token: string | null = null;
    try { token = localStorage.getItem(SESSION_TOKEN_KEY); } catch { /* localStorage blocked — cookie still rides */ }
    return next(
        req.clone({
            withCredentials: true,
            // (and a request without it — a cached bundle). Harmless on reads and on non-ODM rows.
            setHeaders: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-bce-device': gmDeviceId() },
        }),
    );
};
