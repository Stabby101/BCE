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
