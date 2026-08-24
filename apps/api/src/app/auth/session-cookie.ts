/*
 * BCE — the session-cookie helper (shared). Extracted by DIRECTIVE-HARDEN-7 B5 so BOTH the controller (login/
 * guest/recover set it) and the sliding-refresh guard (re-set it near expiry) write the SAME cookie — one
 * definition of name + options, so a refresh can never drift from the original login cookie. Hosted → secure +
 * sameSite:none (the cross-site Pages↔Railway cookie); dev/LAN → lax. 7-day maxAge, matching the 7d JWT.
 */
import type { Response } from 'express';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'bce_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The attribute set the cookie is written with — hosted → secure + sameSite:none (the cross-site Pages↔Railway
 *  cookie); dev/LAN → lax. Shared by set + clear so a CLEAR matches how it was SET (HOTFIX-040 Fix B: a browser
 *  won't drop a cookie unless the clear matches secure/sameSite/path — otherwise the cross-site cookie survives
 *  logout and re-authenticates on the next /auth/me). */
function cookieAttrs(): { httpOnly: true; secure: boolean; sameSite: 'none' | 'lax'; path: '/' } {
    const hosted = AuthService.isHosted();
    return { httpOnly: true, secure: hosted, sameSite: hosted ? 'none' : 'lax', path: '/' };
}

export function setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, { ...cookieAttrs(), maxAge: SESSION_MAX_AGE_MS });
}

/** HOTFIX-040 Fix B — clear the session cookie with the SAME attributes it was set with, so the browser
 *  actually drops it (a `{ path }`-only clear leaves a secure+sameSite:none cookie in place). */
export function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieAttrs());
}
