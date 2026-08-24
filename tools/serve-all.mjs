/*
 * BCE dev — bring up the WHOLE stack with one command: GM web (:4200) + api (:3000) + the
 * port-isolated player serve (:4300).
 *
 * Two hazards make a naive `nx run-many -t serve,serve-player` or a parallel spawn unreliable:
 *   1. Vite cache race — the GM serve and the player serve are BOTH `ng serve` on the SAME `mekbay`
 *      project, sharing one Vite optimize-deps cache (.angular/cache/<ver>/mekbay/vite/deps). Started
 *      together from a cold cache they race to write it -> "504 Outdated Optimize Dep" -> blank page.
 *   2. Nx daemon conflict — several `npx nx serve` spawned at the SAME instant fight over the Nx
 *      daemon and exit code 1.
 * So we (a) run with NX_DAEMON=false (no daemon to fight over) and (b) start SEQUENTIALLY: GM first
 * (it warms the Vite cache alone), then api, then the player serve (which reuses the warm cache).
 * Ctrl-C tears all three down. If a serve ever 504s, `npx ng cache clean` (from apps/web) clears it.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const ENV = { ...process.env, NX_DAEMON: 'false' };
const procs = [];
function run(label, args) {
    const p = spawn('npx', ['nx', ...args], { stdio: 'inherit', shell: true, env: ENV });
    p.on('exit', (code) => console.log(`[serve-all] ${label} exited (code ${code})`));
    procs.push(p);
    return p;
}
function ping(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (r) => { r.resume(); resolve(true); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
async function waitListening(label, port, ms) {
    const t = Date.now();
    while (Date.now() - t < ms) { if (await ping(port)) { console.log(`[serve-all] ${label} is up (:${port})`); return true; } await new Promise((r) => setTimeout(r, 1000)); }
    console.log(`[serve-all] WARN ${label} (:${port}) not up after ${Math.round(ms / 1000)}s — continuing`);
    return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let down = false;
const shutdown = () => { if (down) return; down = true; console.log('\n[serve-all] shutting down…'); for (const p of procs) { try { p.kill(); } catch { /* */ } } setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 1) GM web first — it warms the shared Vite optimize-deps cache ALONE (no race).
console.log('[serve-all] [1/3] starting GM web (:4200) — warming the Vite cache…');
run('web GM :4200', ['serve', 'web']);
await waitListening('GM web', 4200, 150000);
await sleep(15000); // let the first optimize-deps pass settle before any second mekbay serve

// 2) api — separate project (webpack, no Vite cache), started after the GM to avoid a simultaneous nx spawn.
console.log('[serve-all] [2/3] starting api (:3000)…');
run('api', ['serve', 'api']);
await waitListening('api', 3000, 60000);

// 3) player serve — reuses the now-warm Vite cache (no race).
console.log('[serve-all] [3/3] starting the port-isolated player serve (:4300)…');
run('player :4300', ['serve-player', 'web']);
await waitListening('player', 4300, 90000);

console.log('[serve-all] all three up — GM http://localhost:4200 · player http://localhost:4300 · api http://localhost:3000. Ctrl-C stops all.');
