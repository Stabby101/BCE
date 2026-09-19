import { bootstrapApplication } from '@angular/platform-browser';
import { appPlayerConfig } from './app/app.player.config';
import { AppShell } from './app/app-shell';
import { chooseEngineUrl } from './app/shared/host-env';
import { handleFreshParam } from './app/shared/app-reset';

// localStorage) with the GM app, so a device that ever created a GM/guest identity holds a bce.auth.token. The
// player is account-less by design (ROLE-002); if its socket sent that token, the server would treat it as a GM
// who doesn't own the scanned campaign and DENY it (no snapshot, no registration — the "stuck on registering"
// state on any device that was also used as a GM). This flag makes ClaimRealtimeService withhold the token so
// the player socket stays account-less (P3), which correctly binds to whatever campaign it joins.
(globalThis as { __bcePlayerBundle?: boolean }).__bcePlayerBundle = true;

const ENGINE_URL_KEY = 'bce.engine.url';

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
    // when it handles the param a reload is in flight, so we must NOT bootstrap onto a half-cleared store.
    if (await handleFreshParam()) return;
    resolveEngineUrl();
    enablePinchZoom();
    bootstrapApplication(AppShell, appPlayerConfig).catch((err) => console.error(err));
}

void boot();
