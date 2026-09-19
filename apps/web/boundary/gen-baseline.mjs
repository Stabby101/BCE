// (between two scoped files) as of today. Run: `node apps/web/boundary/gen-baseline.mjs`. The plugin grandfathers
// exactly these (→ warn) and ERRORs anything new. Regenerating should be a burn-down (edges removed), never additions.
// NON-PRODUCTION tooling. Run from repo root (C:/BCE).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAbs, forbidden, toRel, cfg } from './classify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', 'src', 'app'); // apps/web/src/app

function walk(dir, acc = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, acc);
        else if (e.name.endsWith('.ts')) acc.push(full);
    }
    return acc;
}

const IMPORT_RE = /(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

const edges = new Map(); // from|to -> {from,to,fromScope,toScope}
let scannedFrom = 0;
for (const file of walk(SRC)) {
    const fromScope = classifyAbs(file);
    if (!fromScope) continue;
    scannedFrom++;
    const src = readFileSync(file, 'utf8');
    const specs = new Set();
    for (const re of [IMPORT_RE, DYN_RE, BARE_RE]) { let m; re.lastIndex = 0; while ((m = re.exec(src))) specs.add(m[1]); }
    for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const targetAbs = resolve(dirname(file), spec);
        const toScope = classifyAbs(targetAbs);
        if (!toScope || toScope === fromScope) continue;
        if (!forbidden.has(fromScope + '>' + toScope)) continue;
        const fromRel = toRel(file), toRelP = toRel(targetAbs);
        edges.set(fromRel + '|' + toRelP, { from: fromRel, to: toRelP, fromScope, toScope });
    }
}

const list = [...edges.values()].sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
writeFileSync(join(here, 'baseline.json'), JSON.stringify(list, null, 2) + '\n');

// summary
const byEdge = {};
for (const e of list) { const k = `${e.fromScope} -> ${e.toScope}`; byEdge[k] = (byEdge[k] || 0) + 1; }
console.log(`Scanned ${scannedFrom} scoped files. Baseline: ${list.length} existing forbidden edges.`);
for (const [k, n] of Object.entries(byEdge).sort()) console.log(`  ${n}  ${k}`);
console.log(`Scopes: ${Object.keys(cfg.scopes).join(', ')}`);
