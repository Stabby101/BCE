import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..', '..');
const MAPS = join(REPO, 'MAPS', 'data');
const OUT = join(__dir, '..', 'src', 'app', 'campaign', 'star', 'iscs');
const TMP = join(REPO, 'MAPS', '_extract105');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// our 12 eras (era/era.ts) — for the era→snapshot map
const ERAS = [
    { id: 1, from: 2005, to: 2570 }, { id: 2, from: 2571, to: 2780 }, { id: 3, from: 2781, to: 2900 },
    { id: 4, from: 2901, to: 3019 }, { id: 5, from: 3020, to: 3049 }, { id: 6, from: 3050, to: 3061 },
    { id: 7, from: 3062, to: 3067 }, { id: 8, from: 3068, to: 3080 }, { id: 9, from: 3081, to: 3100 },
    { id: 10, from: 3101, to: 3130 }, { id: 11, from: 3131, to: 3150 }, { id: 12, from: 3151, to: 9999 },
];
const ISCS_END = 3062; // ISCS coverage ends ~3062; post-3062 eras always use the systems.json ownerAt hex-fill

// ── discover + extract every iscs_{year}.tar.gz (self-contained; relative paths avoid the GNU-tar C: bug) ──
const yearTars = readdirSync(MAPS).filter((f) => /^iscs_\d+\.tar\.gz$/.test(f));
const YEARS = yearTars.map((f) => +f.match(/\d+/)[0]).sort((a, b) => a - b);
for (const f of [...yearTars, 'iscs_inc.tar.gz']) execFileSync('tar', ['-xzf', `../data/${f}`], { cwd: TMP });

// ── faction_key.txt → code → full name ──
const factionNames = {};
for (const m of readFileSync(join(MAPS, 'faction_key.txt'), 'utf8').matchAll(/^([A-Z]{1,3})\s+-\s+(.+?)\s*$/gm)) factionNames[m[1]] = m[2].trim();

// ── iscs_borders.inc → code → canon RGB (0..1) + the shared hex polygon shape ──
const bordersTxt = readFileSync(join(TMP, 'iscs_borders.inc'), 'utf8');
const factionRGB = {};
for (const m of bordersTxt.matchAll(/#declare\s+([A-Z]+)Prism\s*=[\s\S]*?rgbf\s*<\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/g)) factionRGB[m[1]] = [+m[2], +m[3], +m[4]];
// hex outline: the prism's linear_spline points (a flat hex). Parse the first prism; fall back to the canon shape.
let hexShape = [[7.5, 13], [15, 0], [7.5, -13], [-7.5, -13], [-15, 0], [-7.5, 13]];
const shapeM = bordersTxt.match(/linear_spline\s+[-0-9.]+,\s*[-0-9.]+,\s*\d+,\s*([\s\S]*?)\n/);
if (shapeM) {
    const pts = [...shapeM[1].matchAll(/<\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*>/g)].map((p) => [+p[1], +p[2]]);
    if (pts.length >= 6) { const uniq = pts.slice(0, 6); if (uniq.every((p) => Math.abs(p[0]) <= 20 && Math.abs(p[1]) <= 20)) hexShape = uniq; }
}

// ── palette harmonize (keep hue; normalize L/S for the dark theme) ──
function rgbToHsl(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; } return [h * 360, s, l]; }
function hslToHex(h, s, l) { h /= 360; const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; const hx = (n) => f(n).toString(16).padStart(2, '0'); return `#${hx(0)}${hx(8)}${hx(4)}`; }
function harmonize(rgb) { const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]); return hslToHex(h, Math.max(0.4, Math.min(0.7, s < 0.05 ? 0.06 : s)), Math.max(0.42, Math.min(0.6, l < 0.05 ? 0.5 : l))); }
const r2 = (v) => Math.round(v * 100) / 100;

// ── per-year parse: hexes + planets + faction palette ──
function parseYear(year) {
    const hexTxt = readFileSync(join(TMP, `is${year}_hexes.pov`), 'utf8');
    const hexes = [...hexTxt.matchAll(/([A-Z]+)Prism translate <\s*([-0-9.]+)\s*,\s*[-0-9.]+\s*,\s*([-0-9.]+)\s*>/g)].map((m) => ({ c: m[1], x: r2(+m[2]), z: r2(+m[3]) }));
    const plTxt = readFileSync(join(TMP, `is${year}_planets.pov`), 'utf8');
    const planets = [...plTxt.matchAll(/([A-Z]*)Planet translate <\s*([-0-9.]+)\s*,\s*[-0-9.]+\s*,\s*([-0-9.]+)\s*>\s*}\s*\/\/\s*(.+?)\s*$/gm)].map((m) => ({ n: m[4].trim(), c: m[1] || 'IND', x: r2(+m[2]), z: r2(+m[3]) }));
    const codes = [...new Set(hexes.map((h) => h.c))].sort();
    const factions = {};
    for (const c of codes) { const rgb = factionRGB[c] ?? [0.5, 0.5, 0.5]; factions[c] = { name: factionNames[c] ?? c, color: harmonize(rgb), rgb: rgb.map((v) => Math.round(v * 255)) }; }
    return { year, factions, hexes, planets };
}

const parsed = {};
let ext = { minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
for (const y of YEARS) {
    const d = parseYear(y);
    parsed[y] = d;
    writeFileSync(join(OUT, `iscs-${y}.json`), JSON.stringify({ year: y, factions: d.factions, hexes: d.hexes }));
    for (const h of d.hexes) { ext = { minx: Math.min(ext.minx, h.x), maxx: Math.max(ext.maxx, h.x), minz: Math.min(ext.minz, h.z), maxz: Math.max(ext.maxz, h.z) }; }
    console.log(`iscs-${y}.json — hexes=${d.hexes.length} planets=${d.planets.length} factions=${Object.keys(d.factions).length} [${Object.keys(d.factions).join(' ')}]`);
}

// shared dense planet layer — from the latest snapshot (positions are era-invariant; c = that era's owner hint)
const latest = YEARS[YEARS.length - 1];
writeFileSync(join(OUT, 'iscs-planets.json'), JSON.stringify(parsed[latest].planets));
console.log(`iscs-planets.json — ${parsed[latest].planets.length} planets (from ${latest})`);

// era → nearest snapshot (≤45y, era.from ≤ ISCS_END); else null = systems.json ownerAt hex-fill fallback
const dist = (y, from, to) => (y < from ? from - y : y > to ? y - to : 0);
const eraMap = {};
for (const e of ERAS) {
    if (e.from > ISCS_END) { eraMap[e.id] = null; continue; }
    let best = null, bd = Infinity;
    for (const y of YEARS) { const d = dist(y, e.from, e.to); if (d < bd) { bd = d; best = y; } }
    eraMap[e.id] = bd <= 45 ? best : null;
}
const index = {
    _meta: { built: '2026-07-01', directive: '', cartography: 'Cartography data: ISCS — own render from canon hex facts', timeline: 'Flashpoints: Sarna (CC BY-NC-SA) — event facts', snapshots: YEARS },
    eraMap, extent: { minx: r2(ext.minx), maxx: r2(ext.maxx), minz: r2(ext.minz), maxz: r2(ext.maxz) }, hexShape,
};
writeFileSync(join(OUT, 'iscs-index.json'), JSON.stringify(index, null, 2));
console.log(`iscs-index.json — snapshots ${JSON.stringify(YEARS)} · eraMap ${JSON.stringify(eraMap)} · extent x[${index.extent.minx},${index.extent.maxx}] z[${index.extent.minz},${index.extent.maxz}] · hexShape ${JSON.stringify(hexShape)}`);

// ── flashpoints: compact FACTS from the Sarna timeline (unchanged) ──
const tl = JSON.parse(readFileSync(join(REPO, 'sarna-timeline', 'timeline.json'), 'utf8'));
const eras = Array.isArray(tl.eras) ? tl.eras : Object.values(tl.eras);
const events = [];
for (const era of eras) for (const e of (era.events || era.entries || [])) {
    const y = e.startDate ? +String(e.startDate).slice(0, 4) : null;
    if (!y || Number.isNaN(y)) continue;
    const worlds = (e.worlds || []).map((w) => (typeof w === 'string' ? w : '').replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean);
    if (!worlds.length) continue;
    events.push({ y, w: worlds, t: (e.title || '').trim(), k: (e.type || '').trim() });
}
writeFileSync(join(OUT, 'flashpoints.json'), JSON.stringify({ _meta: { source: 'Sarna (https://www.sarna.net) — CC BY-NC-SA; event FACTS only', count: events.length }, events }));
console.log(`flashpoints.json — ${events.length} dated events`);
