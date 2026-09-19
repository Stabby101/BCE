const UPSTREAM = 'https://db.mekbay.com';
const R2_PREFIXES = ['sheets/', 'images/fluff/'];
// DEPLOY-012 — top-level catalog JSON that OUTGREW the Pages 25 MiB per-file asset limit (units.json: 25.3 MiB on
// 2026-08-16 — every deploy since 24ab244 failed asset validation for a month) is NOT shipped in the Pages output
// (tools/pages-output-guard.mjs strips it for Pages-bound builds); it is mirrored to R2 by the build
// (apps/web/scripts/mirror-catalog.mjs, key = the file name) and served from tier (2). Any top-level *.json missing
// from static tries R2 before the db.mekbay.com last-resort, so the fallback chain is static → R2 → upstream.
const R2_TOPLEVEL_JSON = /^[^/]+\.json$/;
const isTopLevelJson = (p) => R2_TOPLEVEL_JSON.test(p);

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const subpath = url.pathname.replace(/^\/mekbay\//, '');

    //    allow-list (mul-ilclan/, build-emitted from content-forge). Fall through to (3) if the asset is absent
    //    (a build where the mirror didn't emit it / SPA-fallback HTML) so a JSON surface never hard-breaks.
    if (subpath.startsWith('slim/') || subpath.startsWith('mul-ilclan/') || /^[^/]+\.json$/.test(subpath)) {
        if (!env || !env.ASSETS) return context.next();
        const a = await env.ASSETS.fetch(request);
        const isHtml = (r) => (r.headers.get('content-type') || '').includes('text/html');
        if (a.status === 304) {
            // DEPLOY-304 — a REVALIDATED asset is a success, not an absence. `_headers` serves this whole tree
            // `no-cache`, so every returning browser sends If-None-Match and the asset store correctly answers 304;
            // `a.ok` is FALSE for 304, so this branch used to fall through to the proxy on essentially every repeat
            // visit: /slim/* → 404 (upstream has no slim/) → ensureSlice false → the 27 MB full catalog the slice
            // exists to avoid; top-level *.json → 200 straight from db.mekbay.com, silently bypassing the mirror.
            // A 304 alone cannot distinguish "revalidated" from "absent": the SPA fallback honours conditionals
            // too (measured on wrangler pages dev — a missing path + the index ETag → a BARE 304, no content-type),
            // so confirm a real non-HTML asset stands behind it with a body-less HEAD before trusting it.
            // DECISION: HEAD probe rather than the bare one-liner — the only observable that separates the two cases.
            const probe = await env.ASSETS.fetch(new Request(url.toString(), { method: 'HEAD' }));
            if (probe.ok && !isHtml(probe)) {
                const r = new Response(null, a); // a 304 carries no body
                if (!r.headers.has('etag') && probe.headers.get('etag')) r.headers.set('ETag', probe.headers.get('etag')); // the store's 304 is bare; a 304 SHOULD echo the validator
                r.headers.set('x-bce-asset-origin', 'static');
                return r;
            }
            // else: the 304 was the HTML fallback's → the asset is absent → fall through
        } else if (a.ok && !isHtml(a)) {
            const r = new Response(a.body, a);
            r.headers.set('x-bce-asset-origin', 'static'); // DoD probe: which tier served this (never db-mekbay-proxy once mirrored)
            return r;
        }
        // else: asset missing → fall through to the db.mekbay.com last-resort
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    // 2) R2 — record sheets + fluff images (immutable, edge-cached 30d) + DEPLOY-012 the oversize catalog JSON
    //    (revalidating: it changes when the build re-mirrors upstream growth). R2 miss → fall through to (3).
    const r2Json = isTopLevelJson(subpath);
    if (env && env.MEKBAY && (r2Json || R2_PREFIXES.some((p) => subpath.startsWith(p)))) {
        const obj = await env.MEKBAY.get(subpath);
        if (obj) {
            const headers = new Headers();
            obj.writeHttpMetadata(headers);
            if (r2Json) {
                headers.set('content-type', 'application/json; charset=utf-8');
                headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400'); // the client also IndexedDB-caches the catalog
                if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
            } else {
                headers.set('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
                if (!headers.has('content-type')) headers.set('content-type', subpath.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
            }
            headers.set('x-bce-asset-origin', 'r2');
            const resp = new Response(obj.body, { headers });
            if (request.method === 'GET') context.waitUntil(cache.put(cacheKey, resp.clone()));
            return resp;
        }
    }

    // 3) LEGACY LAST-RESORT — proxy db.mekbay.com (never hit once the mirror is complete).
    const upstream = await fetch(`${UPSTREAM}/${subpath}${url.search}`, { cf: { cacheEverything: true, cacheTtl: 86400 } });
    const resp = new Response(upstream.body, upstream);
    resp.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
    resp.headers.set('x-bce-asset-origin', 'db-mekbay-proxy'); // DoD: a trace finding THIS header = a surface still hitting db.mekbay.com
    resp.headers.delete('set-cookie');
    if (request.method === 'GET' && upstream.ok) context.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
}
