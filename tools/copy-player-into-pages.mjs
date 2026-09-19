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
