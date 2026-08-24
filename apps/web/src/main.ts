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

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
// BCE (DEPLOY-002 P4): the GM bundle boots the GATED shell (login wall → pending → in). The port-isolated
// PLAYER bundle (main.player.ts) keeps the plain AppShell — so the wall is GM-only by construction, never a
// route-guard. AppShellGated uses selector 'app-root' (the index.html host), renders <router-outlet> only
// when the gate opens, and is byte-equivalent to the old shell when auth is off (dev/LAN unchanged).
import { AppShellGated } from './app/auth/app-shell-gated';
import { handleFreshParam } from './app/shared/app-reset';

/*
 * Author: Drake
 */
async function boot(): Promise<void> {
  // HOTFIX-028 — ?fresh=1 support-healing link: nuke SWs/caches/IDB + bce.* localStorage (keeping device
  // token + player name), strip the param, reload. Skip bootstrap when it fires (a reload is in flight).
  if (await handleFreshParam()) return;
  bootstrapApplication(AppShellGated, appConfig).catch((err) => console.error(err));
}

void boot();
