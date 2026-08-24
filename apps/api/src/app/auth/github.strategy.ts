/*
 * BCE multi-tenant (DEPLOY-002 P1) — GitHub OAuth strategy (passport-github2 via @nestjs/passport,
 * vetted). Client id/secret from Railway env ONLY. Registered conditionally by the module.
 */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-github2';
import type { OAuthProfile } from './auth.types';

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor() {
        super({
            clientID: process.env.BCE_GITHUB_CLIENT_ID as string,
            clientSecret: process.env.BCE_GITHUB_CLIENT_SECRET as string,
            callbackURL: `${process.env.BCE_OAUTH_CALLBACK_URL ?? ''}/github/callback`,
            scope: ['user:email'],
        });
    }

    validate(_accessToken: string, _refreshToken: string, profile: Profile, done: (err: unknown, user?: OAuthProfile) => void): void {
        done(null, {
            provider: 'github',
            providerUserId: profile.id,
            email: profile.emails?.[0]?.value ?? null,
            displayName: profile.displayName ?? profile.username ?? null,
        });
    }
}
