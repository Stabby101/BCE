/*
 * DEPLOY-005 (A) — build-time per-era catalog SLICES. From the full MekBay catalog, emit a tiny static
 * file per era containing only that era's era-legal UNITS (slim: the light fields force-gen + faction-select
 * need, NOT the 24MB of components) + the FACTIONS active in that era (with just this era's id-set). The
 * faction-select page + the force generator fetch ONLY the chosen era's slice (tens–low-hundreds of KB),
 * never the 24MB units.json. Served same-origin from /mekbay/slim/ on the Cloudflare edge (brotli +
 * long-cache); the full catalog stays lazy via the D-004 proxy for the market full-search.
 *
 * SLICE-1 (2026-09-01) amends "NOT the 24MB of components": a slice now carries the comp types a rendered
 * sheet DERIVES FROM — weapons (E/M/B/A) plus components (C) and ammunition (X) — with the id/p/l fields
 * those rules read, and a small {id: flags} side-car so eq-gated rules resolve without the full registry.
 * It is still not the full catalog: O/S/P stay out. See the SLICE_T block below for the reasoning.
 *
 * Output: public/mekbay/slim/index.json (the era index) + public/mekbay/slim/<eraId>.json (per era)
 *         + public/mekbay/slim/comp-flags.json (SLICE-1 component-flag side-car).
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

// SLICE-1 — the comp types a slice carries. WEAPON_T is the HOTFIX-008 set (the roster ARMS line);
// SLICE_T adds C (components — heat sinks, jump jets, CASE) and X (ammunition). Rationale, measured:
// every campaign after its FIRST session is slice-resident on every fork (ensureFullCatalog has no
// resume caller), so a resumed sheet derived its heat sinks, its ammunition and its ODM strip yields
// from data that did not contain them — silently. Of the 46,555 unit rows across the shipped slices,
// 50.9% lost their heat-sink count and 61.5% lost their ammunition.
// O and S are DELIBERATELY still excluded: nothing on a rendered sheet reads S, and O (TAG / C3 Master /
// weapon bays) changes BV on TAG-carrying units — a correctness GAIN that must not ride inside a
// rendering fix. O is its own order. P (physical weapons) likewise untouched.
const WEAPON_T = new Set(['E', 'M', 'B', 'A']);
const SLICE_T = new Set(['E', 'M', 'B', 'A', 'C', 'X']);

const slimUnit = (u, equip) => ({
    id: u.id, name: u.name, chassis: u.chassis, model: u.model, type: u.type, subtype: u.subtype,
    year: u.year, level: u.level, techRating: u.techRating, weightClass: u.weightClass, role: u.role,
    techBase: u.techBase, // DIRECTIVE-063 (D): the market's tech-base (IS/Clan/All) filter reads this off the row
    mixed: u.mixed, // REBASE-1 P1 (e): upstream split mixed-tech out of techBase into a separate `mixed: boolean`;
                    // carry it so slice-resident units keep pin-shape (market IS/Clan filter + chaos-repair clanOrMixed read it)
    tons: u.tons, bv: u.bv,
    pv: MUL_PV[u.id] ?? u.pv ?? (u.as && u.as.PV), // DIRECTIVE-127 — folded PV (MUL authoritative, catalog fill)
    walk: u.walk, run: u.run, jump: u.jump, icon: u.icon, sheets: u.sheets,
    // DEPLOY-006: crewSize so the ForceUnit mints crew[0] → the roster sheet thumbnail's pilot box is driven
    // from the campaign pilot (applyCrew); without it slim units get 0 crew and the box stays blank (regression).
    crewSize: u.crewSize,
    // SLICE-1: the maximum armour POINTS. Without it every consumer of `unit.armor` read 0 — and
    // field-walk-core's `maxArmor > 0 ? … : 1` then reported armorPct = 1 (PRISTINE) for every machine,
    // driving the severity ladder, the strip fraction AND the component cap. A wrecked hull walked the
    // field as untouched. One scalar; it costs nothing.
    armor: u.armor,
    // SLICE-1: the engine heat-sink seed. Meks carry their engine sinks as comp rows at p:-1, but NON-Mek
    // units (1,014 aero; 531 with engineHS > 0) have NO 'C' sink comps at all — engineHS/engineHSType is
    // their ONLY sink source (heat-management.ts:125-129). Without these two, aero dissipation stays 0 and
    // unit-svg-aero has no pip fallback to hide it, so a "heat sinks fixed" change would have fixed only Meks.
    engineHS: u.engineHS, engineHSType: u.engineHSType,
    // HOTFIX-008 + DIRECTIVE-057 + SLICE-1: the comps a rendered sheet derives from.
    //   {t,n,q} — HOTFIX-008, the roster ARMS readout (armsLine groups by name×qty).
    //   {at,rs}  — DIRECTIVE-057, the build-time equipment2 ammo join for the inventory ammo roll.
    //   {id}     — SLICE-1. THE LOAD-BEARING ONE: comp.eq is bound by id (data.service linkEquipment), and
    //              EVERY heat-sink / CASE / jump-jet rule in the vendored fork gates on comp.eq flags. Carrying
    //              C rows WITHOUT id fixes nothing (heat-management.ts:134 `if (!comp.eq) continue`) *and*
    //              inverts five suppression rules that hide those rows from the component lists. Both halves
    //              of the fix are this field.
    //   {p}      — SLICE-1. The engine-mount test (`comp.p < 0`) in heatsinkProfile, and the C-hide branch in
    //              the details tab. Absent, `undefined < 0` is false: engine sinks become "hittable".
    //   {l}      — SLICE-1. The crit LOCATION. odm-repair-bays applyBreakdownCrits does
    //              `(c.l ?? '').split('/').includes(loc)`, so without it the candidate list was ALWAYS empty
    //              and every mothball breakdown fell through to generic "internal structure damage".
    //   {q2}     — SLICE-1, the ammo SHOT COUNT. `q` is the ammo TONNAGE (what the ODM strip yields need),
    //              but three DISPLAY consumers read q2: filter-ammo.pipe.ts, unit-component-item's template,
    //              and cbtprint.util.ts. Carrying X without it would print "1x MG Ammo" on a resumed sheet
    //              where the same unit prints "1x MG Ammo (100)" once the market loads the full catalog —
    //              a divergence THIS change would have introduced, on the very rows it added to restore
    //              ammunition. All 10,519 catalog X rows carry it; the cost is ~3.4 KB brotli on the largest
    //              era. (This is a deliberate addition beyond the ruled +id,p,l shape, made because the
    //              ruling predates the finding; it is flagged in the hand-back and is one line to revert.)
    // NOT carried: comp types O/S/P (see SLICE_T above).
    comp: (u.comp || [])
        .filter((c) => SLICE_T.has(c.t))
        .map((c) => {
            const out = { t: c.t, n: c.n, q: c.q, id: c.id, p: c.p };
            if (c.l) out.l = c.l;
            if (c.q2) out.q2 = c.q2;
            // CONSTRAINT — the at/rs join is WEAPON-ONLY, and must stay that way. inventory.service.ts's
            // ammo branch has NO type gate: it keys on `c.at ?? eq?.ammoType`. Emitting `at` on an X
            // (ammunition) row would make the force's ammo demand count each load TWICE — once for the
            // launcher, once for the ammo itself. The type gate below is the only thing preventing that.
            if (WEAPON_T.has(c.t)) {
                const w = equip[c.id]?.weapon;
                if (w && w.ammoType && w.ammoType !== 'NA') { out.at = w.ammoType; out.rs = w.rackSize; }
            }
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
    // DIRECTIVE-057: the equipment registry, for the build-time weapon→ammo join (at/rs).
    // NOTE (SLICE-1, 2026-09-01): this load is NO LONGER merely graceful. It was — a failure left equip={}
    // and weapon comps emitted without at/rs. Since SLICE-1 the same registry also feeds the comp-flag
    // side-car, and an empty registry now trips the FATAL guard below (0 resolved ids / missing heat-sink
    // sentinels) and fails the build. That is deliberate: a slice carrying comp ids no rule can read is the
    // pre-SLICE-1 bug with extra bytes, and must never ship silently.
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

    // ── SLICE-1: THE COMPONENT-FLAG SIDE-CAR ────────────────────────────────────────────────────────
    // Carrying `comp.id` is only half the fix: the vendored rules read `comp.eq.hasFlag(...)`, and `eq` is
    // bound from the equipment registry — which is a FULL-CATALOG store (`getEquipments()` reads
    // this.data['equipment'], populated only by initialize()). On a slice-only resume it is empty, so every
    // eq-gated rule stays inert no matter what the slice carries.
    //
    // Shipping equipment2.json whole would fix that for 175.7 KB brotli — but that is an unscoped market
    // benefit priced into a rendering fix. This emits ONLY {id: flags[]} — 3.9 KB brotli — which is what
    // every eq-gated rule on the resume path actually reads.
    //
    // THE ID SET IS STRUCTURAL, NEVER HAND-MAINTAINED: every id appearing on a C or X comp row, catalog-wide.
    // A set defined as "the flags some consumer reads today" would ROT SILENTLY the first time a consumer
    // read a new flag — a wrong number with nothing arguing back, the exact class this fix exists to close.
    // Derived from the data, so it cannot go stale.
    //
    // ══ CONSTRAINT — DO NOT WIDEN THIS TO "every id in any comp". IT IS NOT AN OVERSIGHT. ══
    // The count is ~302, not ~915, and the difference is WEAPON ids, excluded deliberately. Weapons
    // (E/M/B/A) shipped in slices long before SLICE-1 and have NEVER carried `eq`. Binding it to them now
    // makes the slice path diverge from the full-catalog path IN THE OTHER DIRECTION:
    //     hit-modifier.util.ts:81  returns early on `!entry.equipment`  → a stand-in PASSES this gate
    //     hit-modifier.util.ts:90  no-range guard needs `instanceof WeaponEquipment` → a stand-in FAILS it
    // so a bound weapon passes the first and skips the second, rendering a to-hit modifier that the full
    // catalog suppresses. Measured against this registry: of the 469 ids appearing on weapon comp rows,
    // 41 are hasNoRange() and none of those are club/hand — so 41 ids is the exact divergence set (MMLs,
    // torpedoes). The stand-ins are base Equipment BY DESIGN (see hydrateSliceEq), so this cannot be fixed
    // by constructing richer objects without reintroducing the BV movement that base-class stand-ins avoid.
    // Widening the id set trades a fixed rendering bug for a new one. The narrowing IS the correctness.
    // SCOPED TO THE ROWS THIS CHANGE ADDED — ids appearing on a C or X comp, never on a weapon.
    // Weapons (E/M/B/A) shipped in slices long before SLICE-1 and have NEVER carried `eq`; binding it to
    // them now would make the slice path DIVERGE from the full-catalog path in the other direction. Concrete
    // case found in pre-commit review: hit-modifier.util.ts:81 returns early on `!entry.equipment`, but its
    // no-range guard at :90 requires `instanceof WeaponEquipment` — which a flag-only stand-in is not, by
    // design. Binding weapon eq would pass the first gate and skip the second, rendering a to-hit modifier
    // on variable-range launchers (MMLs, torpedoes) that the full catalog suppresses. Leaving weapons
    // exactly as they were keeps that path byte-identical.
    const nonWeaponIds = new Set();
    for (const u of unitArr) for (const c of (u.comp || [])) {
        if (c.id == null || WEAPON_T.has(c.t)) continue;
        if (SLICE_T.has(c.t)) nonWeaponIds.add(String(c.id));
    }
    // C3 IS DELIBERATELY WITHHELD, and this is a SCOPE boundary, not a taste call. Binding these flags turns
    // C3 network detection on for slice-resident units, and c3Tax (cbt-force-unit.model.ts) feeds getBv() —
    // so a rendering fix would silently change the BV printed on sheets, rosters, prints and exports. The
    // ruling that put comp type O in its own order did so for exactly this reason (TAG/C3 BV is a
    // correctness GAIN that must not ride inside a rendering fix); the C3 family reaches type C as well, so
    // the same boundary has to be drawn here. Measured reach: F_C3S 1471 · F_C3I 1124 · F_C3SBS 118 ·
    // F_NOVA 32 · F_C3EM 7 comp rows. THE O ORDER LIFTS THIS — it is one line, and it belongs with the
    // review that prices the BV change.
    const BV_WITHHELD_FLAGS = new Set(['F_C3S', 'F_C3SBS', 'F_C3EM', 'F_C3M', 'F_C3MBS', 'F_C3I', 'F_NOVA', 'F_NAVAL_C3']);
    const compFlags = {};
    let flaggedIds = 0, withheld = 0;
    for (const id of nonWeaponIds) {
        const e = equip[id];
        if (!e) continue;                       // an id with no registry entry contributes nothing
        const all = e.flags || [];
        const f = all.filter((x) => !BV_WITHHELD_FLAGS.has(x));
        if (f.length !== all.length) withheld++;
        if (!f.length) continue;                // flagless entries would be dead weight
        compFlags[id] = f;
        flaggedIds++;
    }
    // FAIL LOUD, on the parts-relevant precedent: a slice that carries `id` but ships no flags is a build
    // that LOOKS fixed and renders exactly as broken as before — heat sinks back to 0, silently.
    if (flaggedIds === 0 && nonWeaponIds.size > 0) {
        console.error(`[slices] FATAL: comp-flags side-car resolved 0 of ${nonWeaponIds.size} non-weapon comp ids against the equipment registry (equipment2.json missing or shape drift). Refusing to ship a slice that carries comp ids no rule can read.`);
        process.exit(1);
    }
    // A COUNT IS NOT EVIDENCE: a side-car that resolved everything EXCEPT heat sinks would satisfy the check
    // above and still render dissipation 0 — the exact silent-zero this whole change exists to close. Name
    // the ids the fix actually turns on and fail loud if any is missing or loses its flag upstream.
    const HS_SENTINELS = ['Heat Sink', 'ISDoubleHeatSink', 'CLDoubleHeatSink'];
    const hsMissing = HS_SENTINELS.filter((k) => !Array.isArray(compFlags[k]) || !compFlags[k].some((f) => /HEAT_SINK/.test(f)));
    if (hsMissing.length) {
        console.error(`[slices] FATAL: the comp-flag side-car does not resolve the heat-sink flags themselves (${JSON.stringify(hsMissing)}). The slice would ship carrying sink rows that no rule can read — i.e. the pre-SLICE-1 bug with extra bytes.`);
        process.exit(1);
    }
    // Written under slim/ so it travels with the slices it serves and is covered by the same _headers rule.
    // (The /mekbay Pages Function serves BOTH `slim/` and top-level *.json from static ASSETS first, falling
    // through to R2 only on a static miss — so this is a colocation choice, not a routing requirement.)
    const cfFile = join(OUT, 'comp-flags.json');
    writeFileSync(cfFile, JSON.stringify(compFlags));
    console.log(`[slices] SLICE-1 comp-flags.json: ${flaggedIds} / ${nonWeaponIds.size} non-weapon comp ids carry flags (${withheld} had BV-affecting C3 flags withheld — the O order lifts that) · ${(statSync(cfFile).size / 1024).toFixed(1)} KB raw`);

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
