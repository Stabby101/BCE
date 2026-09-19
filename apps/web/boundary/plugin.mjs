// @nx/enforce-module-boundaries cannot fence intra-project folders; this is the behaviourally-equivalent mechanism).
//   no-new-cross-boundary   → reports a forbidden edge NOT in the baseline  → configured 'error' (fails nx lint)
//   grandfathered-cross-boundary → reports a forbidden edge IN the baseline → configured 'warn'  (visible burn-down)
// The baseline is generated (gen-baseline.mjs) with the SAME classify, so lint exits 0 today; a NEW forbidden edge
// cannot be added. NON-PRODUCTION (lint config only — never bundled).
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAbs, forbidden, toRel } from './classify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let baseline = new Set();
try {
    const arr = JSON.parse(readFileSync(join(here, 'baseline.json'), 'utf8'));
    baseline = new Set(arr.map((e) => e.from + '|' + e.to));
} catch { /* no baseline yet (first generation) → every existing edge would ERROR; that's expected pre-generation */ }

/** Build a rule that fires only for edges whose baselined-ness === `grandfatheredMode`. */
function makeRule(grandfatheredMode) {
    return {
        meta: { type: 'problem', docs: { description: 'BCE engine/gamesystem boundary fence (1)' }, schema: [] },
        create(context) {
            const filename = context.filename ?? context.getFilename();
            const fromScope = classifyAbs(filename);
            if (!fromScope) return {}; // unscoped importer → not fenced
            const fromRel = toRel(filename);
            const check = (node, spec) => {
                if (typeof spec !== 'string' || !spec.startsWith('.')) return; // external/bare package
                const toScope = classifyAbs(resolve(dirname(filename), spec));
                if (!toScope || toScope === fromScope) return;
                if (!forbidden.has(fromScope + '>' + toScope)) return; // allowed edge
                const targetRel = toRel(resolve(dirname(filename), spec));
                const isBaselined = baseline.has(fromRel + '|' + targetRel);
                if (isBaselined !== grandfatheredMode) return; // the other rule owns this one
                context.report({
                    node,
                    message: grandfatheredMode
                        ? `[boundary] grandfathered ${fromScope} ✗→ ${toScope}: '${fromRel}' imports '${targetRel}' — burn this down; it can never grow.`
                        : `[boundary] FORBIDDEN ${fromScope} ✗→ ${toScope}: '${fromRel}' imports '${targetRel}' — a NEW cross-boundary import. Engines depend on gamesystem-api + platform only; engine-classic and engine-hs never import each other.`,
                });
            };
            return {
                ImportDeclaration(node) { check(node, node.source && node.source.value); },
                ExportNamedDeclaration(node) { if (node.source) check(node, node.source.value); },
                ExportAllDeclaration(node) { if (node.source) check(node, node.source.value); },
                ImportExpression(node) { if (node.source && node.source.type === 'Literal') check(node, node.source.value); },
            };
        },
    };
}

export default {
    meta: { name: 'bce-boundary' },
    rules: {
        'no-new-cross-boundary': makeRule(false),
        'grandfathered-cross-boundary': makeRule(true),
    },
};
