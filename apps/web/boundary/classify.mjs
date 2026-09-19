// baseline generator (gen-baseline.mjs). Because they classify identically, the generated baseline is complete by
// construction → `nx lint` exits 0 today (every existing forbidden edge is grandfathered). NON-PRODUCTION (config).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const cfg = JSON.parse(readFileSync(join(here, 'scopes.json'), 'utf8'));
const ROOT = cfg.root; // 'apps/web/src/app'

// Flatten scopes → prefixes, longest-first so the most specific wins (e.g. a scoped file beats a scoped folder).
const STRIP_EXT = /\.(ts|tsx|html|js|mjs)$/;
const prefixes = [];
for (const [scope, list] of Object.entries(cfg.scopes)) {
    for (const raw of list) {
        const isDir = raw.endsWith('/');
        // Strip a file-entry's extension so it matches the (also extension-stripped) input path.
        prefixes.push({ p: raw.replace(/\/$/, '').replace(STRIP_EXT, ''), dir: isDir, scope });
    }
}
prefixes.sort((a, b) => b.p.length - a.p.length);

export const forbidden = new Set(cfg.forbidden.map(([a, b]) => a + '>' + b));

/** Normalise an absolute (or messy) path to a POSIX path relative to apps/web/src/app, or null if outside it. */
export function toRel(absPath) {
    if (!absPath) return null;
    const norm = absPath.replace(/\\/g, '/');
    const marker = '/' + ROOT + '/';
    const i = norm.indexOf(marker);
    if (i !== -1) return norm.slice(i + marker.length);
    const j = norm.indexOf('src/app/'); // fallback for already-relative-ish inputs
    return j === -1 ? null : norm.slice(j + 'src/app/'.length);
}

/** Classify a src/app-relative path (extension optional) → scope, or null (unscoped/exempt). */
export function classifyRel(rel) {
    if (rel == null) return null;
    const clean = rel.replace(STRIP_EXT, '');
    for (const { p, dir, scope } of prefixes) {
        if (dir ? (clean === p || clean.startsWith(p + '/')) : clean === p) return scope;
    }
    return null;
}

export function classifyAbs(absPath) { return classifyRel(toRel(absPath)); }
