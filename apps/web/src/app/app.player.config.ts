import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth/auth.interceptor';
import { playerRoutes } from './player/player.routes';
import { LoggerService } from './services/logger.service';
import { CampaignSaveStore } from './campaign/campaign-save-store';
import { PlayerSessionService } from './player/player-session.service';
import { AuthService } from './auth/auth.service';
import { classifyHost } from './shared/host-env';

export const appPlayerConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        { provide: ErrorHandler, useExisting: LoggerService },
        provideBrowserGlobalErrorListeners(),
        provideRouter(playerRoutes),
        // company" source list is the ACCOUNT's hosted campaigns (GET /campaigns, owner-scoped), and the
        // device's bce.auth.token (guest or GM, shared-origin localStorage) is exactly that account. The
        // interceptor is engine-origin-scoped and injects nothing (zero auth-module pull-in). THE SOCKET
        // socket-specific: a GM token that doesn't own the joined campaign gets DENIED). The roster still
        // arrives over the P3-confined socket; REST here serves only the player's OWN campaign list.
        provideHttpClient(withInterceptors([authInterceptor])),
        provideAppInitializer(async () => {
            // Learn the campaign from the host BEFORE routing: the player needs campaignId + the deployed force
            // + the OpFor. bce.engine.url is already set (main.player.ts) → this hits the host.
            const store = inject(CampaignSaveStore);
            const session = inject(PlayerSessionService); // inject BEFORE any await (injection context)
            // store's first credentialed call so the account is visible to Bring-my-company without a retry; the
            // path + query (campaign, engine) survive the strip. Adopted → the join page re-opens the block.
            if (inject(AuthService).adoptAuthFragment()) session.markSignInReturn();
            // authoritative) OR on a PUBLIC origin with no ?campaign (render the honest "scan the QR" prompt
            // instead of a zombie session). Only a returning DEV/LAN player with no QR rehydrates "last".
            let skipRehydrate = true;
            try {
                const params = new URLSearchParams(location.search);
                const hasCampaign = !!(params.get('campaign') || params.get('c'));
                skipRehydrate = hasCampaign || classifyHost(location.hostname) === 'public';
            } catch { /* keep the safe default (skip) */ }
            // TIMEOUT-BOUND first paint (~4s) — a slow/garbage engine URL must never hang the player boot.
            const boot = (async () => {
                try { await store.init(); if (!skipRehydrate) await store.rehydrateLast(); }
                catch (e) { console.warn('[boot] player rehydrate failed — showing the join prompt', e); }
            })();
            await Promise.race([boot, new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
            // no QR on a public origin, leave campaignId null so the join screen prompts for the current QR.
            session.start();
        }),
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ],
};
