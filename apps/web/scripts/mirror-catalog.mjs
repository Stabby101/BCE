/*
 * DEPLOY-007 (A) — build-time mirror of the FULL MekBay catalog JSON to our origin. Fetches the complete
 * JSON set from db.mekbay.com (BUILD-TIME ONLY) into public/mekbay/<file>.json so the market full-catalog +
 * every JSON fetch resolves SAME-ORIGIN at runtime — db.mekbay.com is never contacted by a live user.
 *
 * Output: public/mekbay/{units,equipment2,quirks,factions,eras,units_sources}.json — GITIGNORED (REF-001;
 * witness-derived, build-emitted, never committed). The Cloudflare Pages build re-fetches each deploy.
 * Graceful: a source-fetch failure logs + leaves any existing file (the proxy Function's db.mekbay.com
 * last-resort still covers a missing file). The heavy sheet/fluff tree goes to R2 (mirror-sheets-to-r2.mjs),
 * not here.
 */
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2Configured, r2Bucket, r2Head, r2Put, md5hex } from '../../../tools/r2-put.mjs'; // DEPLOY-012 — the oversize catalog JSON goes to R2

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.BCE_MIRROR_SRC || process.env.BCE_SLICE_SRC || 'https://db.mekbay.com';
const OUT = join(ROOT, 'public', 'mekbay');
const FILES = ['units.json', 'equipment2.json', 'quirks.json', 'factions.json', 'eras.json', 'units_sources.json'];
// DEPLOY-012 — Cloudflare Pages rejects any output file ≥ 25 MiB at DEPLOY (asset validation) — the whole build "succeeds"
// and then silently never goes live. units.json crossed the line with upstream growth (25.3 MiB on 2026-08-16; every push
// since 24ab244 was stranded for a month). These files are STILL mirrored locally (gen-slices + local dev/harness serve
// them) but are NOT shipped in a Pages-bound output (tools/pages-output-guard.mjs strips them) — the /mekbay Pages
// Function serves them from R2 (static → R2 → db.mekbay.com last-resort), so the mirror also uploads them to R2 here when
// the R2 creds are in the env (the Pages build env / a dev box). Without creds it logs and moves on (never a build failure).
const R2_SERVED = ['units.json'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// db.mekbay.com rate-limits (429) under the build's heavy fetches — retry with exponential backoff so a
// throttle window doesn't fail the mirror (which would leave a JSON surface proxying to db.mekbay.com).
async function fetchRetry(url, tries = 7) {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
        try {
            const r = await fetch(url);
            if ((r.status === 429 || r.status >= 500) && attempt < tries) {
                const ra = Number(r.headers.get('retry-after'));
                await sleep(ra ? ra * 1000 : delay); delay = Math.min(delay * 2, 30000); continue;
            }
            return r;
        } catch (e) { if (attempt >= tries) throw e; await sleep(delay); delay = Math.min(delay * 2, 30000); }
    }
}

async function main() {
    mkdirSync(OUT, { recursive: true });
    console.log(`[mirror] fetching full catalog JSON from ${SRC} …`);
    let okCount = 0, totalKb = 0;
    for (const f of FILES) {
        try {
            const r = await fetchRetry(`${SRC}/${f}`);
            if (!r.ok) throw new Error(`${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            const file = join(OUT, f);
            writeFileSync(file, buf);
            const kb = statSync(file).size / 1024;
            totalKb += kb; okCount++;
            console.log(`[mirror] ${f}: ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb.toFixed(0) + ' KB'}`);
        } catch (e) {
            console.warn(`[mirror] ${f} FAILED (${e.message}) — left as-is; the proxy Function's db.mekbay.com last-resort covers it.`);
        }
    }
    console.log(`[mirror] DONE — ${okCount}/${FILES.length} JSON mirrored → public/mekbay/ (${(totalKb / 1024).toFixed(1)} MB total)`);
    await mirrorToR2();
}

/** DEPLOY-012 — upload the R2-served catalog JSON to the bce-mekbay bucket (skipped when unchanged by ETag/MD5, or when
 *  no R2 creds are present — the Function then falls back to the db.mekbay.com last-resort for that file). */
async function mirrorToR2() {
    if (!r2Configured()) { console.log(`[mirror] R2 upload of ${R2_SERVED.join(', ')} SKIPPED — no R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY in the env (the /mekbay Function falls back to db.mekbay.com for it until uploaded).`); return; }
    for (const f of R2_SERVED) {
        try {
            const body = readFileSync(join(OUT, f));
            const head = await r2Head(f);
            if (head.ok && head.etag && head.etag.replace(/"/g, '') === md5hex(body)) { console.log(`[mirror] R2 ${f}: unchanged (etag match) — skipped`); continue; }
            await r2Put(f, body, 'application/json; charset=utf-8');
            console.log(`[mirror] R2 ${f}: uploaded ${(body.length / 1048576).toFixed(1)} MiB → ${r2Bucket()}/${f}`);
        } catch (e) {
            console.warn(`[mirror] R2 ${f} upload FAILED (${e.message}) — the /mekbay Function's db.mekbay.com last-resort covers it.`);
        }
    }
}

main().catch((e) => console.warn('[mirror] error (non-fatal):', e.message));
