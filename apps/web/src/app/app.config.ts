/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { EquipmentInteractionRegistryService } from './services/equipment-interaction-registry.service';
import { WakeLockService } from './services/wake-lock.service';
import { registerAllHandlers } from './equipment-handlers';
import { CampaignSaveStore } from './campaign/campaign-save-store';
import { AuthService } from './auth/auth.service';
import { authInterceptor } from './auth/auth.interceptor';

/*
 * Author: Drake
 */
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
        // HOTFIX-028 — TIMEOUT-BOUND first paint (~3.5s): a blackhole engine URL must not hang /auth/me (6s) and
        // black-screen the shell. On the deadline, fail OPEN (paint the cover); the refresh finishes in the
        // background and sets the real gate. A reachable host answers in well under this.
        provideAppInitializer(() => {
            const auth = inject(AuthService);
            auth.adoptAuthFragment(); // HOTFIX-040 Fix A — Bearer-first for OAuth: read + strip #bce_auth BEFORE the first /auth/me
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
            // BCE (DIRECTIVE-011/013): open the multi-save store + migrate the legacy slot, then rehydrate the
            // "last" campaign BEFORE routing — so a refresh on /campaign stays on the dashboard.
            // HOTFIX-028 — TIMEOUT-BOUND first paint (~4s). A garbage/slow stored engine URL made
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
        // HOTFIX-009: the vendored MekBay PWA service worker is DISABLED — it triggered an "install MekBay"
        // prompt and served stale cached bundles (the faction-"unavailable"-until-hard-refresh class). The
        // index.html kill-script evicts it from testers who already registered it; a branded BCE PWA is a
        // deliberate later task. (provideServiceWorker('ngsw-worker.js', …) removed; angular.json serviceWorker:false.)
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ]
};