import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TECH_BASES = new Set(['Inner Sphere', 'Clan']);
const TECH_LEVELS = new Set(['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial']);
const COMP_T = new Set(['E', 'M', 'B', 'A', 'X', 'P', 'O', 'C', 'S', 'HIDDEN']);

function validateUnit(u, where, errs) {
    if (u == null || typeof u !== 'object') { errs.push(`${where}: not an object`); return; }
    if (typeof u.id !== 'number') errs.push(`${where}: id not a number (got ${typeof u.id})`);
    if (typeof u.name !== 'string') errs.push(`${where}: name not a string`);
    // FORK-SHAPE MARKERS (the whole point of this gate):
    if (u.techBase === 'Mixed') errs.push(`${where}: techBase 'Mixed' is FORK-SHAPE — the pin split mixed-tech into a boolean 'mixed'`);
    else if (!TECH_BASES.has(u.techBase)) errs.push(`${where}: techBase ${JSON.stringify(u.techBase)} not in {Inner Sphere, Clan}`);
    if (typeof u.level === 'number') errs.push(`${where}: level is a NUMBER (${u.level}) — FORK-SHAPE; the pin uses ComponentTechLevel name strings`);
    else if (!TECH_LEVELS.has(u.level)) errs.push(`${where}: level ${JSON.stringify(u.level)} not a ComponentTechLevel name`);
    if (typeof u.mixed !== 'boolean') errs.push(`${where}: mixed missing/non-boolean (got ${typeof u.mixed}) — the pin UnitSummary requires it`);
    if (u.pv != null && typeof u.pv !== 'number') errs.push(`${where}: pv present but not a number (got ${typeof u.pv})`);
    for (const c of (u.comp || [])) {
        if (!COMP_T.has(c.t)) errs.push(`${where}: comp.t ${JSON.stringify(c.t)} not a valid UnitComponent type`);
        if (c.id != null && typeof c.id !== 'string') errs.push(`${where}: comp.id not a string`);
    }
}

function run(sliceDir) {
    if (!existsSync(sliceDir)) { console.warn(`[slice-shape] no slice dir (${sliceDir}) — gen-slices no-op'd (offline build). Nothing to validate.`); return 0; }
    const files = readdirSync(sliceDir).filter((f) => /^\d+\.json$/.test(f));
    if (!files.length) { console.warn(`[slice-shape] no era slices in ${sliceDir}. Nothing to validate.`); return 0; }
    const errs = [];
    let unitCount = 0;
    for (const f of files) {
        const slice = JSON.parse(readFileSync(join(sliceDir, f), 'utf8'));
        for (const u of (slice.units || [])) {
            validateUnit(u, `${f}#${u && u.name}`, errs);
            unitCount++;
            if (errs.length > 25) break;
        }
        if (errs.length > 25) break;
    }
    if (errs.length) {
        console.error(`[slice-shape] FAIL — fork-shape / invalid slice unit(s):`);
        errs.slice(0, 25).forEach((e) => console.error('  - ' + e));
        return 1;
    }
    console.log(`[slice-shape] OK — ${unitCount} slim units across ${files.length} era slice(s) conform to the pin UnitSummary shape.`);
    return 0;
}

function selftest() {
    const valid = { id: 1, name: 'Locust LCT-1V', techBase: 'Inner Sphere', mixed: false, level: 'Introductory', pv: 20, comp: [{ t: 'C', id: 'ISHeatSink', p: -1 }] };
    const noMixed = { ...valid }; delete noMixed.mixed;
    const cases = [
        { name: 'valid pin-shape', unit: valid, expectFail: false },
        { name: 'valid, no pv (pv optional)', unit: (() => { const u = { ...valid }; delete u.pv; return u; })(), expectFail: false },
        { name: "techBase 'Mixed' (fork)", unit: { ...valid, techBase: 'Mixed' }, expectFail: true },
        { name: 'level numeric 0 (fork)', unit: { ...valid, level: 0 }, expectFail: true },
        { name: 'mixed missing (the pin gap slimUnit had to fix)', unit: noMixed, expectFail: true },
        { name: 'techBase unknown value', unit: { ...valid, techBase: 'Whatever' }, expectFail: true },
        { name: 'level unknown name', unit: { ...valid, level: 'SuperExperimental' }, expectFail: true },
        { name: 'pv a string', unit: { ...valid, pv: '20' }, expectFail: true },
        { name: 'bad comp.t', unit: { ...valid, comp: [{ t: 'Z', id: 'x', p: 0 }] }, expectFail: true },
    ];
    let killed = 0;
    for (const c of cases) {
        const errs = [];
        validateUnit(c.unit, 'selftest', errs);
        const failed = errs.length > 0;
        const ok = failed === c.expectFail;
        console.log(`  ${ok ? 'PASS' : 'MISS'} — ${c.name}: ${failed ? 'flagged' : 'clean'} (expected ${c.expectFail ? 'flagged' : 'clean'})`);
        if (ok) killed++;
    }
    const total = cases.length;
    console.log(`[slice-shape --selftest] ${killed}/${total} cases correct` + (killed === total ? '' : ' — MUTATION SURVIVED'));
    return killed === total ? 0 : 1;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLICE_DIR = join(ROOT, 'public', 'mekbay', 'slim');
process.exit(process.argv.includes('--selftest') ? selftest() : run(SLICE_DIR));
