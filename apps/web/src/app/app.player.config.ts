/*
 * BCE — the PORT-ISOLATED PLAYER bundle config (DIRECTIVE-048, phase A). A SEPARATE Angular
 * application (browser entry src/main.player.ts, served on its own port) whose route table NEVER
 * imports the GM dashboard — hard isolation, not route-guarding. It keeps only what a player needs:
 * zoneless CD, the logger, the HTTP client, the BCE save store (to learn campaignId + the deployed
 * force + the OpFor from the host), and the player routes. It deliberately DROPS the MekBay
 * equipment-handler registry, the wake-lock, and the service worker — pulling those would drag the
 * vendored core graph into the player surface and blur MERGE-002 (engine/campaign -> core stays
 * one-way; the player surface is campaign-layer only). bce.engine.url is set in main.player.ts
 * BEFORE bootstrap so the store + socket hit the LAN host, never the player's own device.
 */
import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { playerRoutes } from './player/player.routes';
import { LoggerService } from './services/logger.service';
import { CampaignSaveStore } from './campaign/campaign-save-store';
import { PlayerSessionService } from './player/player-session.service';
import { classifyHost } from './shared/host-env';

export const appPlayerConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        { provide: ErrorHandler, useExisting: LoggerService },
        provideBrowserGlobalErrorListeners(),
        provideRouter(playerRoutes),
        // NOTE (DEPLOY-002 P4): NO auth interceptor here (unlike the GM app.config) — the account-less player's
        // REST stays credential-free (ROLE-002). In cloud mode its REST is gated anyway; the roster arrives
        // over the P3-confined socket (PlayerSessionService), never a gated/owner-scoped REST read.
        provideHttpClient(),
        provideAppInitializer(async () => {
            // Learn the campaign from the host BEFORE routing: the player needs campaignId + the deployed force
            // + the OpFor. bce.engine.url is already set (main.player.ts) → this hits the host.
            const store = inject(CampaignSaveStore);
            const session = inject(PlayerSessionService); // inject BEFORE any await (injection context)
            // HOTFIX-028 — do NOT bind the stale "last" campaign when a ?campaign QR is present (it is
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
            // DEPLOY-002 P4 / HOTFIX-028: bind ?campaign (clearing prior-campaign residue on a switch) or, with
            // no QR on a public origin, leave campaignId null so the join screen prompts for the current QR.
            session.start();
        }),
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ],
};
