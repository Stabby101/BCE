// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

//   · `provideServiceWorker` + `isDevMode` REMOVED — BCE ships no service worker (actively unregistered at
//     boot in index.html + app-reset.ts; a stale SW was the session-freshness wedge). Re-adding it on a
//   · `withInterceptors([authInterceptor])` added — the GM bundle attaches the cookie + Bearer JWT.
//   · two BCE app-initializers added (session resolve; campaign-save-store rehydrate), both TIMEOUT-BOUND
// The pin's equipment-handlers + wake-lock initializers and OVERLAY_DEFAULT_CONFIG are preserved as-is.
import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { EquipmentInteractionRegistryService } from './services/equipment-interaction-registry.service';
import { WakeLockService } from './services/wake-lock.service';
import { registerAllHandlers } from './equipment-handlers';
import { CampaignSaveStore } from './campaign/campaign-save-store';
import { AuthService } from './auth/auth.service';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        {
            provide: ErrorHandler,
            useExisting: LoggerService,
        },
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        // BCE (DEPLOY-002 P4): the GM-bundle HTTP client carries credentials (cookie) + the Bearer JWT so the
        // existing campaign-store calls authenticate with zero store edits. The PLAYER bundle's provideHttpClient
        // (app.player.config) has NO interceptor → its REST stays account-less (ROLE-002).
        provideHttpClient(withInterceptors([authInterceptor])),
        // Resolve the session FIRST (before routing) so the gated shell knows wall/pending/in with no app flash.
        // Auth off (dev/LAN) → resolves to 'open' instantly; a slow/absent host fails open (no wall on a blip).
        // black-screen the shell. On the deadline, fail OPEN (paint the cover); the refresh finishes in the
        // background and sets the real gate. A reachable host answers in well under this.
        provideAppInitializer(() => {
            const auth = inject(AuthService);
            auth.adoptAuthFragment();
            const done = auth.refresh();
            return Promise.race([done, new Promise<void>((resolve) => setTimeout(() => { auth.resolveOpenOnTimeout(); resolve(); }, 3500))]);
        }),
        provideAppInitializer(() => {
            const registryService = inject(EquipmentInteractionRegistryService);
            registerAllHandlers(registryService);
        }),
        provideAppInitializer(() => {
            inject(WakeLockService);
        }),
        provideAppInitializer(async () => {
            // "last" campaign BEFORE routing — so a refresh on /campaign stays on the dashboard.
            // store.init()+rehydrateLast() (each host-bounded at 6s, sequential) block bootstrap ~12s → the GM
            // "black screen". Cap the initializer; the rehydrate finishes in the BACKGROUND (its signals update
            // reactively → the dashboard restores when it lands). A corrupt/old-schema blob is CAUGHT → warn +
            // paint the cover (which offers "Reset app data"), never a silent black screen.
            const store = inject(CampaignSaveStore);
            const boot = (async () => {
                try { await store.init(); await store.rehydrateLast(); }
                catch (e) { console.warn('[boot] campaign rehydrate failed — starting on the cover', e); }
            })();
            await Promise.race([boot, new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
        }),
        // angular.json serviceWorker:false; index.html + app-reset.ts evict any already-registered SW). A
        // branded BCE PWA is a deliberate later task.
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ]
};
