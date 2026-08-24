/*
 * BCE — PLAYER bundle entry (DIRECTIVE-048, phase A). A SEPARATE Angular application from the GM app
 * (main.ts), built/served on its own port (serve-player → 4300). It reuses the neutral AppShell
 * (a bare <router-outlet>, selector app-root — matches the shared index.html) but with appPlayerConfig,
 * whose route table imports NONE of the GM dashboard. That is the port-isolation: the dashboard simply
 * isn't in this graph.
 *
 * CRITICAL — resolve the LAN engine URL BEFORE bootstrap. The store initializer + the socket both read
 * localStorage 'bce.engine.url'; if it points at the player's own device the player loads an empty
 * campaign and the lobby/claims never reach the GM. Priority:
 *   1. ?engine=<url>  — explicit override (baked into the QR if the host wants).
 *   2. derive from the serving host — the player loaded THIS page from the GM host, so
 *      location.hostname IS the GM's LAN IP; the engine is :3000/api on that host.
 *   3. an already-stored value (a returning player).
 * The GM QR is simply http://<lan-ip>:4300/ — derivation (2) makes the engine URL automatic.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { appPlayerConfig } from './app/app.player.config';
import { AppShell } from './app/app-shell';
import { chooseEngineUrl } from './app/shared/host-env';
import { handleFreshParam } from './app/shared/app-reset';

// HOTFIX-033 — mark this as the PLAYER bundle BEFORE anything runs. The player app shares its origin (and
// localStorage) with the GM app, so a device that ever created a GM/guest identity holds a bce.auth.token. The
// player is account-less by design (ROLE-002); if its socket sent that token, the server would treat it as a GM
// who doesn't own the scanned campaign and DENY it (no snapshot, no registration — the "stuck on registering"
// state on any device that was also used as a GM). This flag makes ClaimRealtimeService withhold the token so
// the player socket stays account-less (P3), which correctly binds to whatever campaign it joins.
(globalThis as { __bcePlayerBundle?: boolean }).__bcePlayerBundle = true;

const ENGINE_URL_KEY = 'bce.engine.url';

/**
 * HOTFIX-028 — hosted-aware, NEVER-destructive engine-URL resolution. The old logic derived
 * `<serving-host>:3000/api` for EVERY non-localhost open and unconditionally overwrote the stored value; on
 * the PUBLIC origin (bcengine.org) that wrote `https://bcengine.org:3000/api` (garbage — prod api is Railway)
 * over a previously-good value → the "offline / Connecting…" wedge. New rules:
 *   - ?engine explicit → use AND persist (a scanned QR always wins).
 *   - PUBLIC origin → default the Railway prod api; REPLACE a stored localhost/private-LAN value (unreachable
 *     from public by definition) but NEVER overwrite a stored PUBLIC value with a derived guess.
 *   - DEV/LAN → derive `<host>:3000/api` exactly as before (localhost keeps a stored value; the LAN flow is
 *     byte-equivalent).
 */
function resolveEngineUrl(): void {
    try {
        const chosen = chooseEngineUrl({
            engineParam: new URLSearchParams(window.location.search).get('engine'),
            hostname: window.location.hostname,
            protocol: window.location.protocol,
            stored: localStorage.getItem(ENGINE_URL_KEY),
        });
        if (chosen !== null) localStorage.setItem(ENGINE_URL_KEY, chosen); // null = keep the stored public value
    } catch {
        /* localStorage/URL unavailable (shouldn't happen in a browser) — the store defaults to localhost. */
    }
}

/** The shared index.html locks browser zoom (user-scalable=no — the GM/MekBay surfaces implement their
 *  own sheet/map zoom and page zoom would fight them). The PLAYER surfaces are plain pages read on
 *  phones: pinch-zoom is essential there (record-sheet fine print) and an accessibility requirement.
 *  Same one index for both bundles → the player entry swaps the viewport before bootstrap. */
function enablePinchZoom(): void {
    try {
        document.querySelector('meta[name="viewport"]')
            ?.setAttribute('content', 'width=device-width, initial-scale=1.0, interactive-widget=resizes-content');
    } catch {
        /* meta absent — the browser default already allows zoom */
    }
}

async function boot(): Promise<void> {
    // HOTFIX-028 — ?fresh=1 heals a wedged device (SWs + caches + IDB + bce.* except token/name) then reloads;
    // when it handles the param a reload is in flight, so we must NOT bootstrap onto a half-cleared store.
    if (await handleFreshParam()) return;
    resolveEngineUrl();
    enablePinchZoom();
    bootstrapApplication(AppShell, appPlayerConfig).catch((err) => console.error(err));
}

void boot();
