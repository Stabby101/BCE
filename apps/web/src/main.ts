// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
// BCE (DEPLOY-002 P4; REBASE-1 P1 c): the GM bundle boots the GATED shell (login wall → pending → in). The
// port-isolated PLAYER bundle (main.player.ts) keeps the plain AppShell — so the wall is GM-only by
// construction, never a route-guard. AppShellGated uses selector 'app-root' (the index.html host), renders
// <router-outlet> only when the gate opens, and is byte-equivalent to the old shell when auth is off (dev/LAN).
// The pin's runServiceWorkerUpdateBootstrap is DROPPED: HOTFIX-028 ships NO service worker (angular.json
// serviceWorker:false + active SW unregistration in app-reset/index.html); re-enabling it reintroduces the
// session-freshness wedge.
import { AppShellGated } from './app/auth/app-shell-gated';
import { handleFreshParam } from './app/shared/app-reset';

async function boot(): Promise<void> {
  // HOTFIX-028 — ?fresh=1 support-healing link: nuke SWs/caches/IDB + bce.* localStorage (keeping device
  // token + player name), strip the param, reload. Skip bootstrap when it fires (a reload is in flight).
  if (await handleFreshParam()) return;
  bootstrapApplication(AppShellGated, appConfig)
    // BCE-EDIT (REBASE-1 P1, ruling #8): the opt-in computed-BV capture witness (dev-only, lazy chunk —
    // a NO-OP unless localStorage['bce.test.bvcapture'] is set). See app/dev/bv-capture.ts. The goldens
    // cannot see getBv(); this is the witness for every BV delta the re-baseline moves.
    .then((ref) => { void import('./app/dev/bv-capture').then((m) => m.installBvCapture(ref.injector)).catch(() => undefined); })
    .catch((err) => console.error(err));
}

void boot();
