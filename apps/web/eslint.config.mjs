// BCE — DIRECTIVE-HARDEN-1 Part A: the apps/web ESLint gate (flat config, eslint 9 + angular-eslint 21).
//
// POSTURE (first pass, advisory-with-teeth): recommended rulesets; every rule with PRE-EXISTING violations at
// gate-creation (2026-07-06: 649 findings, 146/533 files) is demoted to 'warn' — the grandfathered backlog,
// listed explicitly below — while every OTHER recommended rule keeps its native 'error' severity. The gate
// therefore passes today yet FAILS on new classes of mistakes (no-debugger, no-dupe-keys, no-fallthrough, …);
// the warn backlog burns down in later HARDEN passes. Escalate a demoted rule back to error the moment its
// count hits zero.
//
// Prettier stays the formatter: eslint-config-prettier is layered LAST so no formatting rule can conflict.
// Scope: TypeScript + Angular templates (inline + .html); plain .js/.mjs scripts are out of scope this pass.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import bceBoundary from './boundary/plugin.mjs'; // DIRECTIVE-BOUNDARY-1 Slice 1 — the engine/gamesystem boundary fence

const tsExtends = [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended, prettier];

// The grandfathered backlog — rules with pre-existing violations at gate creation (count at demotion in brackets).
const grandfatheredTs = {
    '@typescript-eslint/no-explicit-any': 'warn', // [338]
    '@typescript-eslint/no-unused-vars': 'warn', // [188]
    'prefer-const': 'warn', // [37] auto-fixable; deliberately NOT fixed this pass (fork-diff noise in vendored files)
    '@typescript-eslint/no-unused-expressions': 'warn', // [7]
    'no-empty': 'warn', // [5]
    'no-case-declarations': 'warn', // [4]
    'no-useless-escape': 'warn', // [3]
    'no-extra-boolean-cast': 'warn', // [2]
    'no-constant-binary-expression': 'warn', // [1] — a REAL upstream bug (page-turn-summary.component.ts:501), flagged upstream
    '@typescript-eslint/no-wrapper-object-types': 'warn', // [1]
    '@angular-eslint/no-output-native': 'warn', // [13]
    '@angular-eslint/no-output-on-prefix': 'warn', // [6]
    '@angular-eslint/no-input-rename': 'warn', // [2]
    '@angular-eslint/prefer-inject': 'warn', // [2]
};

export default tseslint.config(
    {
        ignores: ['dist/**', 'dist-player/**', '.angular/**', 'out-tsc/**', 'public/**', 'node_modules/**', '**/*.js', '**/*.mjs'],
    },
    {
        files: ['**/*.ts'],
        // Two files carry `\\'` escapes inside inline-template expression strings — valid Angular (the views are
        // live) but the angular-eslint inline-template extractor chokes on the escape and reports a false-positive
        // parse error. They get the full TS ruleset in the block below, minus inline-template extraction.
        ignores: ['src/app/campaign/dashboard/deploy-roster.ts', 'src/app/campaign/sprite/mech-silhouette.ts'],
        extends: tsExtends,
        processor: angular.processInlineTemplates,
        rules: grandfatheredTs,
    },
    {
        files: ['src/app/campaign/dashboard/deploy-roster.ts', 'src/app/campaign/sprite/mech-silhouette.ts'],
        extends: tsExtends,
        rules: grandfatheredTs,
    },
    {
        files: ['**/*.html'],
        extends: [...angular.configs.templateRecommended],
        rules: {
            '@angular-eslint/template/eqeqeq': 'warn', // [38] grandfathered — template == vs ===; audit in a HARDEN pass
        },
    },
    // DIRECTIVE-BOUNDARY-1 Slice 1 — the engine/gamesystem boundary fence (advisory-with-teeth). Existing forbidden
    // edges (baseline.json) → warn; any NEW cross-boundary import → error that fails `nx lint`. See BOUNDARY-MAP.md §4.
    {
        files: ['src/app/**/*.ts'],
        plugins: { 'bce-boundary': bceBoundary },
        rules: {
            'bce-boundary/no-new-cross-boundary': 'error',
            'bce-boundary/grandfathered-cross-boundary': 'warn',
        },
    },
);
