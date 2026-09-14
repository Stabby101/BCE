/*
 * DIRECTIVE-GM-1c — TEST SEAM for the Google strategy. A harness cannot drive a real Google round-trip headless, and
 * the sign-in-from-the-join-page proof IS the redirect chain (start → the provider echoes `state` → callback → the
 * join URL). So the strategy accepts endpoint overrides for a LOCAL stand-in provider, honoured ONLY under
 * BCE_ALLOW_DEV_LOGIN=1 (the same flag as /auth/dev-login; prod never sets it) — a stray env var can never re-point a
 * real sign-in. With the flag off, or the vars unset, the strategy keeps its own defaults, byte-identical to before.
 */
import { AuthService } from './auth.service';

export interface OAuthEndpointOverrides {
    authorizationURL?: string;
    tokenURL?: string;
    userProfileURL?: string;
}

export function devEndpointOverrides(prefix: 'GOOGLE'): OAuthEndpointOverrides {
    if (!AuthService.devLoginAllowed()) return {};
    const auth = process.env[`BCE_${prefix}_AUTH_URL`];
    const token = process.env[`BCE_${prefix}_TOKEN_URL`];
    const profile = process.env[`BCE_${prefix}_PROFILE_URL`];
    return {
        ...(auth ? { authorizationURL: auth } : {}),
        ...(token ? { tokenURL: token } : {}),
        ...(profile ? { userProfileURL: profile } : {}),
    };
}
