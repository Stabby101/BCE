/*
 * BCE multi-tenant (DEPLOY-002 P1) — Google OAuth strategy (passport-google-oauth20 via @nestjs/passport,
 * vetted). Reads client id/secret from Railway env ONLY (never committed). Registered conditionally by
 * the module — absent when the env isn't set, so local dev boots without Google creds.
 */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-google-oauth20';
import type { OAuthProfile } from './auth.types';
import { devEndpointOverrides } from './oauth-dev-endpoints'; // GM-1c: the harness's local stand-in provider (dev-login-gated)

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor() {
        super({
            clientID: process.env.BCE_GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.BCE_GOOGLE_CLIENT_SECRET as string,
            callbackURL: `${process.env.BCE_OAUTH_CALLBACK_URL ?? ''}/google/callback`,
            scope: ['email', 'profile'],
            ...devEndpointOverrides('GOOGLE'), // {} in prod (BCE_ALLOW_DEV_LOGIN unset) → the strategy's own endpoints
        });
    }

    validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
        return {
            provider: 'google',
            providerUserId: profile.id,
            email: profile.emails?.[0]?.value ?? null,
            displayName: profile.displayName ?? null,
        };
    }
}
