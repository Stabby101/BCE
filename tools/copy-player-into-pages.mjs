/*
 * HOTFIX-010 — fold the PLAYER bundle into the GM Pages deploy output under /player/.
 * Runs (cwd = apps/web) as the last step of `nx build web`, after:
 *   1. `ng build --configuration=production`            → apps/web/dist/browser  (the GM app at /)
 *   2. `ng build --configuration=player --base-href=/player/` → apps/web/dist-player/browser (the player app, base /player/)
 * Then this copies dist-player/browser/** → dist/browser/player/**, so Cloudflare Pages serves the PLAYER
 * SPA (its own index.html + chunks + assets, all base-href'd to /player/) at https://<host>/player/ —
 * statically, same origin, never swallowed by the GM **→cover fallback (see public/_redirects).
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const SRC = 'dist-player/browser';   // relative to apps/web (the nx run-commands cwd)
const DEST = 'dist/browser/player';

if (!existsSync(SRC)) {
    console.error(`[copy-player] missing ${SRC} — did the player build run? (ng build --configuration=player --base-href=/player/)`);
    process.exit(1);
}
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
if (!existsSync(`${DEST}/index.html`)) {
    console.error(`[copy-player] ${DEST}/index.html absent after copy — aborting`);
    process.exit(1);
}
console.log(`[copy-player] PLAYER bundle → ${DEST} (served at /player/)`);
