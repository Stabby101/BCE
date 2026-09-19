import type { Response } from 'express';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'bce_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieAttrs(): { httpOnly: true; secure: boolean; sameSite: 'none' | 'lax'; path: '/' } {
    const hosted = AuthService.isHosted();
    return { httpOnly: true, secure: hosted, sameSite: hosted ? 'none' : 'lax', path: '/' };
}

export function setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, { ...cookieAttrs(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieAttrs());
}
