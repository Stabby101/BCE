/*
 * DEPLOY-005 (A) — build-time per-era catalog SLICES. From the full MekBay catalog, emit a tiny static
 * file per era containing only that era's era-legal UNITS (slim: the light fields force-gen + faction-select
 * need, NOT the 24MB of components) + the FACTIONS active in that era (with just this era's id-set). The
 * faction-select page + the force generator fetch ONLY the chosen era's slice (tens–low-hundreds of KB),
 * never the 24MB units.json. Served same-origin from /mekbay/slim/ on the Cloudflare edge (brotli +
 * long-cache); the full catalog stays lazy via the D-004 proxy for the market full-search.
 *
 * Output: public/mekbay/slim/index.json (the era index) + public/mekbay/slim/<eraId>.json (per era).
 * GITIGNORED (REF-001) — build-emitted from the proxied data, never committed. Graceful: if the source
 * fetch fails (offline build), it logs + no-ops (the client falls back to the full catalog).
 */
import { mkdirSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.BCE_SLICE_SRC || 'https://db.mekbay.com';
const OUT = join(ROOT, 'public', 'mekbay', 'slim');
// DEPLOY-011: the catalog JSON mirror-catalog writes (it runs BEFORE gen-slices in prerun). Reading these
// LOCAL files is the reliable build source on the Cloudflare Pages env — no second 24MB db.mekbay.com fetch.
const MIRROR = join(ROOT, 'public', 'mekbay');

// the unit fields the era-gated path needs: faction-select gating + force-gen pool/toGenUnit, PLUS the
// roster/battle DISPLAY fields (DEPLOY-006) — movement (walk/run/jump), the unit-icon/sprite ref, and the
// record-sheet ref. The display adds are light (3 ints + two short strings); still NO 24MB comp[]: the record
// sheet renders from the pre-rendered SVG fetched lazily from /mekbay/sheets/<ref> when a cell is opened.
// DIRECTIVE-127 — the MUL Piece-Value overlay (content-forge/mul/ilclan/pv-lookup.json = {mulId: pv}, unit.id===MUL id).
// Folds the authoritative (errata-current) MUL PV into the slim record so the per-era slices carry PV (the AS-card /
// #113 blocker: slimUnit historically stripped `as`/`pv`). MUL first, then the catalog's own pv/as.PV as the fill.
let MUL_PV = {};
const slimUnit = (u, equip) => ({
    id: u.id, name: u.name, chassis: u.chassis, model: u.model, type: u.type, subtype: u.subtype,
    year: u.year, level: u.level, techRating: u.techRating, weightClass: u.weightClass, role: u.role,
    techBase: u.techBase, // DIRECTIVE-063 (D): the market's tech-base (IS/Clan/All) filter reads this off the row
    tons: u.tons, bv: u.bv,
    pv: MUL_PV[u.id] ?? u.pv ?? (u.as && u.as.PV), // DIRECTIVE-127 — folded PV (MUL authoritative, catalog fill)
    walk: u.walk, run: u.run, jump: u.jump, icon: u.icon, sheets: u.sheets,
    // DEPLOY-006: crewSize so the ForceUnit mints crew[0] → the roster sheet thumbnail's pilot box is driven
    // from the campaign pilot (applyCrew); without it slim units get 0 crew and the box stays blank (regression).
    crewSize: u.crewSize,
    // HOTFIX-008 + DIRECTIVE-057: WEAPON comps only — {t,n,q} for weapon types (E/M/B/A) — so the roster ARMS
    // readout (armsLine groups by name×qty) + the inventory weapon-spread show the real loadout. DIRECTIVE-057
    // also joins equipment2.json at BUILD time so ammo-bearing weapons carry {at:ammoType, rs:rackSize} — the
    // inventory ammo roll needs these and the slim units have no runtime `.eq` (D-006). Energy weapons (ammoType
    // 'NA') get no at/rs (lean). Deliberately NOT the structure/armor/ammo comps (S/X/C/O/P). comp REMAINS an
    // array so CBTForceUnit.tagBV's comp.some() never throws (no `.eq` → tagBV reads 0, correct). Full comp+eq
    // still loads from the 24MB catalog on market/detail paths.
    comp: (u.comp || [])
        .filter((c) => c.t === 'E' || c.t === 'M' || c.t === 'B' || c.t === 'A')
        .map((c) => {
            const w = equip[c.id]?.weapon;
            const out = { t: c.t, n: c.n, q: c.q };
            if (w && w.ammoType && w.ammoType !== 'NA') { out.at = w.ammoType; out.rs = w.rackSize; }
            return out;
        }),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// db.mekbay.com rate-limits (429) under the build's heavy fetches (units 24MB + equipment2 3.6MB + mirror) —
// retry with exponential backoff (honoring Retry-After) so a throttle window doesn't fail/stall the build.
async function getJson(path, tries = 7) {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
        try {
            const r = await fetch(`${SRC}/${path}`);
            if ((r.status === 429 || r.status >= 500) && attempt < tries) {
                const ra = Number(r.headers.get('retry-after'));
                await sleep(ra ? ra * 1000 : delay); delay = Math.min(delay * 2, 30000); continue;
            }
            if (!r.ok) throw new Error(`${path} ${r.status}`);
            return r.json();
        } catch (e) {
            if (attempt >= tries) throw e;
            await sleep(delay); delay = Math.min(delay * 2, 30000);
        }
    }
}
const asArray = (v) => (Array.isArray(v) ? v : v ? [...v] : []);

// DEPLOY-011 build-source resilience: PREFER the local mirrored file (mirror-catalog wrote it first this
// build → no second db.mekbay.com fetch, the concurrent re-fetch is what failed silently on Cloudflare);
// fall back to a bounded db.mekbay.com fetch (with 429 retry/backoff) only if the mirror is absent (dev).
function loadCatalog(name) {
    const lp = join(MIRROR, name);
    if (existsSync(lp)) {
        try { return Promise.resolve(JSON.parse(readFileSync(lp, 'utf8'))); }
        catch (e) { console.warn(`[slices] local ${name} unreadable (${e.message}) — fetching from ${SRC}`); }
    }
    console.log(`[slices] ${name}: no local mirror → fetching from ${SRC}`);
    return getJson(name);
}

async function main() {
    console.log(`[slices] building slices (source: local mirror at ${MIRROR}, else ${SRC}) …`);
    let units, factions, eras;
    try {
        [units, factions, eras] = await Promise.all([loadCatalog('units.json'), loadCatalog('factions.json'), loadCatalog('eras.json')]);
    } catch (e) {
        // DEPLOY-011 (C) FAIL LOUD: never ship a slice-less deploy that silently falls back to the 24MB catalog.
        console.error(`[slices] FATAL: catalog source unavailable (${e.message}). Refusing to ship a slice-less build — ensure mirror-catalog runs first (prerun) or set BCE_SLICE_SRC.`);
        process.exit(1);
    }
    // DIRECTIVE-057: the equipment registry, for the build-time weapon→ammo join (at/rs). Graceful: a load
    // failure leaves equip={} → weapon comps emit without at/rs (ammo derivation degrades, no crash).
    let equip = {};
    try { const eq = await loadCatalog('equipment2.json'); equip = eq.equipment || eq; }
    catch (e) { console.warn(`[slices] equipment2.json unavailable (${e.message}) — comps emit without ammoType/rackSize.`); }
    const unitArr = units.units || units;
    const facArr = factions.factions || factions;
    const eraArr = eras.eras || eras;
    const unitById = new Map(unitArr.map((u) => [u.id, u]));

    // DIRECTIVE-127 — fold the MUL ilClan overlays (authored under content-forge/mul/ilclan/, committed source).
    // GRACEFUL: a build without the scrape leaves MUL_PV={} (slimUnit falls back to the catalog PV) and copies no
    // allow-list (the OpFor/Market gate is inert). PV overlay → slim `pv`; allow-list → served same-origin asset.
    const MULDIR = join(ROOT, '..', '..', 'content-forge', 'mul', 'ilclan');
    try {
        MUL_PV = JSON.parse(readFileSync(join(MULDIR, 'pv-lookup.json'), 'utf8'));
        console.log(`[slices] DIRECTIVE-127: MUL PV overlay loaded — ${Object.keys(MUL_PV).length} unit ids`);
    } catch (e) { console.warn(`[slices] DIRECTIVE-127: no MUL pv-lookup (${e.code || e.message}) — slim PV falls back to catalog`); }
    try {
        const allow = readFileSync(join(MULDIR, 'allowlist.json'), 'utf8');
        mkdirSync(join(MIRROR, 'mul-ilclan'), { recursive: true });
        writeFileSync(join(MIRROR, 'mul-ilclan', 'allowlist.json'), allow);
        console.log(`[slices] DIRECTIVE-127: MUL allow-list → public/mekbay/mul-ilclan/allowlist.json (${(allow.length / 1024).toFixed(1)} KB)`);
    } catch (e) { console.warn(`[slices] DIRECTIVE-127: no MUL allowlist (${e.code || e.message}) — the OpFor/Market MUL gate stays inert`); }

    mkdirSync(OUT, { recursive: true });
    // the era index — tiny; the client loads it to resolve the wizard era → eraId.
    const index = eraArr.map((e) => ({ id: e.id, name: e.name, years: e.years, icon: e.icon, img: e.img }));
    writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));

    let total = 0, maxKb = 0, maxEra = '';
    for (const era of eraArr) {
        const eraId = era.id;
        const unitIds = new Set(asArray(era.units).map(Number));
        const sliceUnits = [];
        for (const id of unitIds) { const u = unitById.get(id); if (u) sliceUnits.push(slimUnit(u, equip)); }
        // factions active in this era — keep only this era's id-set (force-gen + faction-select read eras[eraId]).
        const sliceFactions = [];
        for (const f of facArr) {
            const set = f.eras ? f.eras[eraId] : null;
            const ids = asArray(set).map(Number);
            if (ids.length) sliceFactions.push({ id: f.id, name: f.name, group: f.group, img: f.img, eras: { [eraId]: ids } });
        }
        const slice = { id: eraId, name: era.name, years: era.years, units: sliceUnits, factions: sliceFactions };
        const file = join(OUT, `${eraId}.json`);
        writeFileSync(file, JSON.stringify(slice));
        const kb = statSync(file).size / 1024;
        total++; if (kb > maxKb) { maxKb = kb; maxEra = `${eraId} ${era.name}`; }
        console.log(`[slices] era ${eraId} "${era.name}": ${sliceUnits.length} units · ${sliceFactions.length} factions · ${kb.toFixed(1)} KB`);
    }
    // DEPLOY-011 (C) FAIL LOUD: an empty catalog (0 slices) must error the build, not silently ship slice-less.
    if (total === 0) {
        console.error('[slices] FATAL: 0 era slices emitted (empty/invalid catalog). Refusing to ship a slice-less build.');
        process.exit(1);
    }

    // DIRECTIVE-065: the 'Mech/vehicle-RELEVANT catalog id set, derived from the equipment2.json discriminator
    // (the deferred D-055 filter). Weapons need F_MEK/F_TANK_WEAPON; misc needs F_MEK/F_TANK_EQUIPMENT; ammo is
    // relevant unless it's INFANTRY (ammo.type) or BA (F_BATTLEARMOR / "BA …"). Shipped same-origin at
    // /mekbay/parts-relevant.json (build-generated like the slices); the shop + starting stock filter on it so
    // the in-system list excludes infantry small-arms, BA torpedo/inferno ammo, BA manipulators, etc. The
    // authored structural rows (struct:*) are always relevant (resolved client-side, not in this set).
    const F = (e) => e.flags || [];
    // misc unit-type flags that mark an item as for OTHER unit types (exclude only when no mek/tank flag is present).
    const OTHER_TYPE = ['F_BA_EQUIPMENT', 'F_BA_WEAPON', 'F_INF_EQUIPMENT', 'F_INFANTRY', 'F_FIGHTER_EQUIPMENT', 'F_PROTOMEK_EQUIPMENT', 'F_DS_EQUIPMENT', 'F_SC_EQUIPMENT', 'F_WS_EQUIPMENT', 'F_SS_EQUIPMENT'];
    // HOTFIX-014 — a real 'Mech/vehicle MOUNT flag (weapon or equipment). Anything without one that is infantry /
    // personal / BA is dropped, INCLUDING the MegaMek InfantryWeapon class (F_INFANTRY/F_INF_* + an `infantry`
    // sub-object). Belt-and-suspenders against dirty type data: a personal-arm NAME is also dropped unless it has a
    // mount flag (so 'Mech "Medium Rifle"/"Limb Club"-with-a-flag stay, but Whip/Pistol/Revolver/Man-Portable go).
    const hasMount = (f) => f.includes('F_MEK_WEAPON') || f.includes('F_TANK_WEAPON') || f.includes('F_MEK_EQUIPMENT') || f.includes('F_TANK_EQUIPMENT');
    const isInfantryPersonal = (e, f) => f.includes('F_INFANTRY') || f.some((x) => /^F_INF_/.test(x)) || !!e.infantry || (e.ammo && e.ammo.type === 'INFANTRY');
    const isBA = (e, f) => f.includes('F_BATTLEARMOR') || f.includes('F_BA_WEAPON') || f.includes('F_BA_EQUIPMENT') || /^BA /.test(e.name || '');
    const PERSONAL_NAME = /\b(auto-?pistol|pistol|revolver|whip|sub-?machine ?gun|smg|musket|derringer|blowgun|needler|gyrojet|nullifier|shotgun)\b|man-?portable|\b(laser|support|portable|semi-?portable)\s+(pistol|rifle|laser|ppc|smg|weapon)\b|rifle\s*\(|\bvibro-?(blade|knife|sword|katana|mace|axe|claw|dagger)\b/i;
    const mechRelevant = (e) => {
        const f = F(e);
        const mount = hasMount(f);
        // (1)+(2)+(3): without a real mount flag, drop infantry/personal/BA (by flag, sub-object, ammo, or name).
        if (!mount && (isInfantryPersonal(e, f) || isBA(e, f) || PERSONAL_NAME.test(e.name || ''))) return false;
        if (e.type === 'weapon') return mount;                                                    // weapons REQUIRE a mount flag — no include-by-default
        if (e.type === 'misc') {
            if (f.includes('F_MEK_EQUIPMENT') || f.includes('F_TANK_EQUIPMENT')) return true;     // explicitly 'Mech/vehicle
            if (f.some((x) => OTHER_TYPE.includes(x))) return false;                              // only BA/inf/aero/proto/naval → out
            return true; // core construction (heat sinks, etc.) carry NO unit-type flag → 'Mech-relevant
        }
        if (e.type === 'ammo') return true; // infantry/BA ammo already dropped above
        return false;
    };
    const equipEntries = Array.isArray(equip) ? equip : Object.values(equip || {});
    const relevantIds = equipEntries.filter((e) => e && e.id != null && mechRelevant(e)).map((e) => String(e.id));
    if (relevantIds.length === 0 && equipEntries.length > 0) {
        console.error('[slices] FATAL: parts-relevance produced 0 ids from a non-empty equipment registry (predicate/shape drift).');
        process.exit(1);
    }
    writeFileSync(join(MIRROR, 'parts-relevant.json'), JSON.stringify(relevantIds));
    console.log(`[slices] parts-relevant.json: ${relevantIds.length} / ${equipEntries.length} 'Mech-relevant ids (infantry/BA/aero clutter excluded)`);

    console.log(`[slices] DONE — ${total} era slices + index.json → public/mekbay/slim/ (largest ${maxKb.toFixed(1)} KB: ${maxEra})`);
}

// DEPLOY-011 (C): any uncaught error fails the build (was a silent non-fatal warn that hid the 404 regression).
main().catch((e) => { console.error('[slices] FATAL:', e.stack || e.message); process.exit(1); });
