/*
 * BCE multi-tenant (DEPLOY-002 P1) — the auth module. Vetted libs only (@nestjs/passport + @nestjs/jwt).
 * The OAuth strategies register ONLY when their Railway env (client id/secret) is present, so local dev
 * boots without credentials. ApprovedGmGuard is the global APP_GUARD (a no-op unless BCE_AUTH_REQUIRED).
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { AuthService } from './auth.service';
import { RecoverThrottleService } from './recover-throttle.service';
import { PresenceService } from './presence.service';
import { AdminGuard, ApprovedGmGuard } from './auth.guards';
import { GoogleStrategy } from './google.strategy';
import { GitHubStrategy } from './github.strategy';
import { AuthController } from './auth.controller';
import { BackupService } from './backup.service';
import { AdminController } from './admin.controller';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EntitlementsService } from './entitlements.service';
import { PackController } from '../pack/pack.controller';

// DEPLOY-010: @Global so UsersService/PresenceService inject anywhere (the campaign-created audit in
// CampaignsController) WITHOUT a CampaignsModule→AuthModule import — while AuthModule imports CampaignsModule
// for the admin /stats campaign count. One-way (Auth→Campaigns), so no dependency cycle.
@Global()
@Module({
    imports: [
        PassportModule,
        JwtModule.register({
            secret: AuthService.sessionSecret(), // BCE_SESSION_SECRET (env) — fail-fast checked in main.ts
            signOptions: { expiresIn: '7d' },
        }),
        CampaignsModule, // DEPLOY-010: AdminController reads the total campaign count for /stats
    ],
    controllers: [AuthController, AdminController, PackController], // ODM-1: entitled pack serving (AuthModule owns entitlement wiring)
    providers: [
        UsersService,
        EntitlementsService, // ODM-1: feature grants
        AuthService,
        RecoverThrottleService, // DEPLOY-009: per-IP limiter for POST /auth/recover (enumeration defense)
        BackupService, // HARDEN-7 A1: the AdminController /admin/export off-box DB snapshot
        PresenceService, // DEPLOY-010: live online-user presence (the gateway updates it)
        ApprovedGmGuard,
        AdminGuard,
        { provide: APP_GUARD, useExisting: ApprovedGmGuard }, // global gate (skips @Public / no-op unless required)
        // OAuth strategies register their side effect ONLY when configured (env present) — else absent.
        // LOGIN-1: the SAME signal (AuthService.hasOAuthProvider) drives /api/auth/me's enabledProviders, so a
        // provider whose strategy is absent here also shows no sign-in button (one source of truth).
        { provide: GoogleStrategy, useFactory: () => (AuthService.hasOAuthProvider('google') ? new GoogleStrategy() : null) },
        { provide: GitHubStrategy, useFactory: () => (AuthService.hasOAuthProvider('github') ? new GitHubStrategy() : null) },
    ],
    exports: [UsersService, AuthService, PresenceService, EntitlementsService],
})
export class AuthModule {}
