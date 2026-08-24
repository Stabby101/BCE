/*
 * tools/r2-put.mjs — a tiny SigV4 PUT/HEAD helper for the bce-mekbay R2 bucket (DEPLOY-012). Shared by the build's
 * catalog mirror (apps/web/scripts/mirror-catalog.mjs uploads the oversize catalog JSON) — the same signing the
 * one-off tools/mirror-sheets-to-r2.mjs carries inline. Credentials come from the ENV only, never hard-coded
 * (SEC-001):  R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · (R2_BUCKET, default bce-mekbay).
 * `r2Configured()` is false when any is missing → callers skip the upload and log it (never a build failure).
 */
import { createHash, createHmac } from 'node:crypto';

const ACCOUNT = process.env.R2_ACCOUNT_ID, KEY = process.env.R2_ACCESS_KEY_ID, SECRET = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'bce-mekbay';
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;

export const r2Configured = () => !!(ACCOUNT && KEY && SECRET);
export const r2Bucket = () => BUCKET;

const sha256hex = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const awsUriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const amzNow = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(method, key, bodyHash, amzDate) {
    const date = amzDate.slice(0, 8), region = 'auto', service = 's3';
    const canonicalUri = '/' + BUCKET + '/' + key.split('/').map(awsUriEncode).join('/');
    const canonicalHeaders = `host:${HOST}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
    const scope = `${date}/${region}/${service}/aws4_request`;
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const kDate = hmac('AWS4' + SECRET, date), kRegion = hmac(kDate, region), kService = hmac(kRegion, service), kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(sts).digest('hex');
    return { url: `https://${HOST}${canonicalUri}`, headers: { Host: HOST, 'x-amz-date': amzDate, 'x-amz-content-sha256': bodyHash, Authorization: `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` } };
}

/** HEAD an object → { ok, etag } (etag = quoted MD5 for single-part uploads, which is what r2Put does). */
export async function r2Head(key) {
    const { url, headers } = sign('HEAD', key, sha256hex(''), amzNow());
    const r = await fetch(url, { method: 'HEAD', headers });
    return { ok: r.ok, etag: r.headers.get('etag') };
}

/** PUT a Buffer under `key` (single-part; retries on 429/5xx). Throws on a hard failure. */
export async function r2Put(key, body, contentType = 'application/octet-stream') {
    let delay = 800;
    for (let attempt = 1; ; attempt++) {
        const { url, headers } = sign('PUT', key, sha256hex(body), amzNow()); // re-sign each attempt (SigV4 freshness)
        headers['content-type'] = contentType;
        try {
            const r = await fetch(url, { method: 'PUT', headers, body });
            if (r.ok) return;
            if ((r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(delay); delay = Math.min(delay * 2, 20000); continue; }
            throw new Error(`put ${key} ${r.status} ${(await r.text()).slice(0, 160)}`);
        } catch (e) { if (attempt >= 5) throw e; await sleep(delay); delay = Math.min(delay * 2, 20000); }
    }
}

/** md5 hex of a Buffer — compare against a single-part R2 ETag to skip an unchanged upload. */
export const md5hex = (b) => createHash('md5').update(b).digest('hex');
