import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUCTURAL_COMPONENTS } from './structural-components.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.BCE_DB_PATH || resolve(HERE, '..', '.data', 'campaigns.db');
const CACHE = resolve(HERE, '..', '.seed-cache', 'equipment2.json');
const WITNESS_URL = 'https://db.mekbay.com/equipment2.json';

const yr = (s) => { if (s == null) return null; const m = String(s).match(/\d{3,4}/); return m ? parseInt(m[0], 10) : null; };
const num = (v) => (Number.isFinite(v) ? v : null);
const intOrNull = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/** Resolve the witness: cached file if present, else fetch once + cache it (gitignored). */
async function loadWitness() {
    if (existsSync(CACHE)) {
        console.log(`[seed] using cached witness ${CACHE}`);
        return JSON.parse(readFileSync(CACHE, 'utf8'));
    }
    console.log(`[seed] fetching witness ${WITNESS_URL} (build-time lookup; cached, never committed)…`);
    const res = await fetch(WITNESS_URL);
    if (!res.ok) throw new Error(`witness fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, text);
    return JSON.parse(text);
}

/** Pull the equipment entry list out of the witness (top-level holds a version + an id-keyed map/array). */
function entriesOf(witness) {
    if (Array.isArray(witness)) return witness;
    for (const v of Object.values(witness)) {
        if (Array.isArray(v) && v.length && v[0] && (v[0].type || v[0].stats)) return v;
        if (v && typeof v === 'object') {
            const vals = Object.values(v);
            if (vals.length && vals[0] && (vals[0].type || vals[0].stats)) return vals;
        }
    }
    return [];
}

/** Source (A): transform one witness entry → a catalog row (weapon|ammo|misc only; armor is Source B). */
function rowFromWitness(e) {
    const cat = e.type;
    if (cat !== 'weapon' && cat !== 'ammo' && cat !== 'misc') return null;
    if (!e.id || !e.name) return null;
    const base = e.tech?.base || 'All';
    const adv = (base === 'Clan' ? e.tech?.advancement?.clan : e.tech?.advancement?.is)
        || e.tech?.advancement?.is || e.tech?.advancement?.clan || {};
    const refs = String(e.rulesRefs || '');
    const page = refs.match(/(\d+)/)?.[1];
    const provenance = page
        ? `TechManual p.${page} (rules data; xref MekBay/MegaMek equipment2.json)`
        : `TechManual (rules data; xref MekBay/MegaMek equipment2.json)`;
    return {
        id: e.id, source: 'mekbay', name: e.name, category: cat,
        tech_base: base, tech_rating: e.tech?.rating ?? null,
        intro_year: yr(adv.production) ?? yr(adv.common) ?? yr(adv.prototype),
        extinction_year: yr(adv.extinct), reintro_year: yr(adv.reintroduced),
        cost_cbills: intOrNull(e.stats?.cost), cost_formula: null,
        tonnage: num(e.stats?.tonnage), crit_slots: intOrNull(e.stats?.criticalSlots),
        availability: e.tech?.availability ? JSON.stringify(e.tech.availability) : null,
        provenance, notes: null,
    };
}

const COLS = ['id', 'source', 'name', 'category', 'tech_base', 'tech_rating', 'intro_year', 'extinction_year', 'reintro_year', 'cost_cbills', 'cost_formula', 'tonnage', 'crit_slots', 'availability', 'provenance', 'notes'];

const CREATE = `CREATE TABLE IF NOT EXISTS component_catalog (
  id TEXT PRIMARY KEY, source TEXT, name TEXT, category TEXT, tech_base TEXT, tech_rating TEXT,
  intro_year INTEGER, extinction_year INTEGER, reintro_year INTEGER, cost_cbills INTEGER,
  cost_formula TEXT, tonnage REAL, crit_slots INTEGER, availability TEXT, provenance TEXT, notes TEXT
);`;

async function main() {
    const witness = await loadWitness();
    const entries = entriesOf(witness);
    console.log(`[seed] witness entries: ${entries.length}`);

    const sourceA = entries.map(rowFromWitness).filter(Boolean);
    const sourceB = STRUCTURAL_COMPONENTS;
    // de-dup by id (Source B "struct:*" never collides with witness ids; guard anyway)
    const byId = new Map();
    for (const r of [...sourceA, ...sourceB]) byId.set(r.id, r);
    const rows = [...byId.values()];

    mkdirSync(dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec(CREATE);
    db.exec('DELETE FROM component_catalog;'); // clean, reproducible re-run
    const ins = db.prepare(`INSERT INTO component_catalog (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
    db.exec('BEGIN');
    for (const r of rows) ins.run(...COLS.map((c) => (r[c] === undefined ? null : r[c])));
    db.exec('COMMIT');

    // ── report (DoD §6): row count by category + by source ──
    const byCat = db.prepare('SELECT category, COUNT(*) n FROM component_catalog GROUP BY category ORDER BY category').all();
    const bySrc = db.prepare('SELECT source, COUNT(*) n FROM component_catalog GROUP BY source ORDER BY source').all();
    const total = db.prepare('SELECT COUNT(*) n FROM component_catalog').get();
    console.log(`[seed] DONE → ${DB_PATH}`);
    console.log(`[seed] total rows: ${total.n}`);
    console.log('[seed] by source:', bySrc.map((r) => `${r.source}=${r.n}`).join('  '));
    console.log('[seed] by category:', byCat.map((r) => `${r.category}=${r.n}`).join('  '));
    db.close();
}

main().catch((e) => { console.error('[seed] FAILED:', e.message); process.exit(1); });
