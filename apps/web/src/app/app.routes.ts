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

import { inject } from '@angular/core';
import { Router, type Routes, type CanActivateFn } from '@angular/router';
import { LegalPageComponent } from './shared/legal-page'; // COMPLIANCE-1 — /legal
import { App } from './app';
import { CoverComponent } from './cover/cover';
import { CampaignSetupComponent } from './campaign/setup/campaign-setup';
import { EraComponent } from './campaign/era/era';
import { DateForceComponent } from './campaign/date-force/date-force';
import { FactionComponent } from './campaign/faction/faction';
import { SizeCapitalComponent } from './campaign/size-capital/size-capital';
import { MercCommandComponent } from './campaign/chaos/merc-command'; // D-113 — Hot Spots creation tail
import { CampaignDashboardComponent } from './campaign/dashboard/dashboard';
import { CampaignHostComponent } from './campaign/campaign-host';
import { ShutdownComponent } from './shutdown/shutdown';
import { AdminPageComponent } from './auth/admin-page';
import { LoginComponent } from './auth/login'; // LINK-1 Part B2 — the always-available login screen (works with auth off)
import { AuthService } from './auth/auth.service';

// DEPLOY-003: /admin is admin-only. This route guard is UX convenience — the SERVER AdminGuard on every
// /api/admin/* call is the real gate (a non-admin sees nothing because every data call 403s anyway).
const adminRouteGuard: CanActivateFn = () => {
    const router = inject(Router);
    return inject(AuthService).isAdmin() ? true : router.createUrlTree(['/']);
};

// MekBay has no path routing of its own; its "deep links" are query params on '/'
// (?shareUnit, ?instance, ?units, ?q, ?protocolLink, …) consumed by App + UrlStateService.
// With the cover now at '', redirect any such link to the MekBay view (/app),
// preserving the query, so existing share / force / protocol links keep working.
const MEKBAY_DEEPLINK_PARAMS = ['shareUnit', 'instance', 'units', 'q', 'filters', 'sort', 'protocolLink', 'tab', 'gs'];

const coverOrDeepLinkRedirect: CanActivateFn = (route) => {
    const router = inject(Router);
    const qp = route.queryParams ?? {};
    const isDeepLink = MEKBAY_DEEPLINK_PARAMS.some((k) => qp[k] !== undefined);
    return isDeepLink
        ? router.createUrlTree(['/app'], { queryParams: qp, fragment: route.fragment ?? undefined })
        : true;
};

export const routes: Routes = [
    { path: '', component: CoverComponent, canActivate: [coverOrDeepLinkRedirect] },
    { path: 'campaign/new/setup', component: CampaignSetupComponent }, // D-108 — new FIRST wizard step
    { path: 'campaign/new/era', component: EraComponent },
    { path: 'campaign/new/date-force', component: DateForceComponent },
    { path: 'campaign/new/faction', component: FactionComponent },
    { path: 'campaign/new/size-capital', component: SizeCapitalComponent },
    { path: 'campaign/new/merc-command', component: MercCommandComponent }, // D-113 — Hot Spots creation tail (replaces date-force→size-capital)
    { path: 'campaign', component: CampaignHostComponent }, // ODM-1 — the shell host routes packId:'odm' to the fenced odm container; a pack-less campaign mounts the untouched dashboard
    { path: 'admin', component: AdminPageComponent, canActivate: [adminRouteGuard] },
    { path: 'login', component: LoginComponent }, // LINK-1 Part B2 — always-available (renders in the 'open' state; wall intercepts when auth is on)
    { path: 'shutdown', component: ShutdownComponent },
    { path: 'legal', component: LegalPageComponent }, // DIRECTIVE-COMPLIANCE-1 — the Legal & Attribution page
    { path: 'app', component: App },
    { path: '**', redirectTo: '' },
];
