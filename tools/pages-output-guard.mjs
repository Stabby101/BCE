/*
 * tools/pages-output-guard.mjs — DEPLOY-012: the PRE-DEPLOY SIZE GUARD for the Cloudflare Pages output.
 *
 * WHY: Pages enforces a hard 25 MiB per-file limit at DEPLOY time (asset validation), AFTER the build step succeeds —
 * so an oversize file doesn't fail the build, it strands the deploy silently. mekbay/units.json (build-mirrored from
 * upstream) grew from ~24 MB to 25.3 MiB between 2026-07-17 and 2026-08-16 and every push since 24ab244 failed to go
 * live for a month while the build log stayed green. This step runs LAST in `nx build web` (cwd = apps/web) and:
 *   1. STRIPS the known R2-served files (mekbay/units.json — served by the /mekbay Pages Function from the bce-mekbay
 *      bucket, mirrored there by scripts/mirror-catalog.mjs) from the output when the build is PAGES-BOUND
 *      (CF_PAGES=1 in the Cloudflare build env, or BCE_PAGES_DEPLOY=1 — tools/deploy-web.mjs sets it). A local build
 *      KEEPS them (dev serve + the smoke harnesses read the catalog from dist/browser).
 *   2. FAILS LOUD (exit 1, naming file + size) if ANY remaining output file is ≥ 25 MiB — in every build mode — so
 *      this class of upstream growth can never again pass the build and die at deploy. Files within 2 MiB of the line
 *      print a WARNING so the next growth is seen coming.
 * Pure Node, no deps. Override the limit for experiments with BCE_PAGES_MAX_FILE_BYTES.
 */
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = process.env.BCE_PAGES_OUTPUT || 'dist/browser'; // relative to apps/web (the nx run-commands cwd)
const LIMIT = Number(process.env.BCE_PAGES_MAX_FILE_BYTES || 25 * 1024 * 1024); // Cloudflare Pages: 25 MiB per file
const WARN_AT = LIMIT - 2 * 1024 * 1024;
const PAGES_BOUND = process.env.CF_PAGES === '1' || process.env.BCE_PAGES_DEPLOY === '1';
// Output files the /mekbay Pages Function serves from R2 instead of static (see functions/mekbay/[[path]].js).
// resolves REMOTE_HOST to `${origin}/mekbay` (common.model.ts resolveRemoteHost) and the slices to root-absolute
// /mekbay/slim, so nothing ever fetches /player/mekbay/* — the copy is dead weight and equally over the limit.
const R2_SERVED = new Set(['mekbay/units.json', 'player/mekbay/units.json']);

if (!existsSync(OUT)) { console.error(`[pages-guard] output dir ${OUT} not found — did the build run?`); process.exit(1); }

const files = [];
(function walk(dir) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(OUT);

const mib = (n) => (n / 1048576).toFixed(2) + ' MiB';
const rel = (p) => relative(OUT, p).split(sep).join('/');
let stripped = 0, warned = 0; const oversize = [];
for (const f of files) {
    const size = statSync(f).size;
    const key = rel(f);
    if (R2_SERVED.has(key)) {
        if (PAGES_BOUND) { unlinkSync(f); stripped++; console.log(`[pages-guard] STRIPPED ${key} (${mib(size)}) — Pages-bound build; served from R2 by the /mekbay Function`); }
        else console.log(`[pages-guard] kept ${key} (${mib(size)}) for local serve — stripped on a Pages-bound build (CF_PAGES / BCE_PAGES_DEPLOY)`);
        continue;
    }
    if (size >= LIMIT) oversize.push({ key, size });
    else if (size >= WARN_AT) { warned++; console.warn(`[pages-guard] WARNING ${key} is ${mib(size)} — within 2 MiB of the ${mib(LIMIT)} Pages per-file limit`); }
}
if (oversize.length) {
    for (const o of oversize) console.error(`[pages-guard] FAIL ${o.key} is ${mib(o.size)} ≥ the Cloudflare Pages ${mib(LIMIT)} per-file limit — the deploy WOULD be rejected at asset validation. Move it to R2 (add to R2_SERVED + the /mekbay Function + mirror-catalog) or split it.`);
    process.exit(1);
}
console.log(`[pages-guard] OK — ${files.length} output files, none ≥ ${mib(LIMIT)}${stripped ? `; ${stripped} R2-served file(s) stripped for Pages` : ''}${warned ? `; ${warned} warning(s)` : ''}${PAGES_BOUND ? ' (Pages-bound build)' : ' (local build)'}`);
