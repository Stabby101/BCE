/*
 * BCE Inventory I (DIRECTIVE-055, T-037 slice 1) — the CATALOG service (read-only, server-authoritative).
 * Reads the `component_catalog` table baked by apps/api/seed/seed-catalog.mjs (DATA-002 — no runtime
 * fetch; the seed pulls the witness at build time). The era-gate + tech-base filter + formula cost come
 * from the pure catalog-rules module. CREATE TABLE IF NOT EXISTS here is a safety so the api serves an
 * (empty) catalog even before the seed runs.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { dbPath } from '../db-path';
import { type CatalogRow, type TechBase, availableInEra, techBaseMatches, evalCostFormula } from './catalog-rules';

const CREATE = `CREATE TABLE IF NOT EXISTS component_catalog (
  id TEXT PRIMARY KEY, source TEXT, name TEXT, category TEXT, tech_base TEXT, tech_rating TEXT,
  intro_year INTEGER, extinction_year INTEGER, reintro_year INTEGER, cost_cbills INTEGER,
  cost_formula TEXT, tonnage REAL, crit_slots INTEGER, availability TEXT, provenance TEXT, notes TEXT
);`;

export interface CostResult { id: string; name: string; flat: number | null; formula: string | null; computed: number | null; context: { tons?: number; rating?: number }; }

@Injectable()
export class CatalogService implements OnModuleInit {
    private readonly log = new Logger('CatalogService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
        this.db.exec(CREATE);
        const n = (this.db.prepare('SELECT COUNT(*) AS n FROM component_catalog').get() as { n: number }).n;
        this.log.log(`catalog ready (${n} rows)${n === 0 ? ' — run apps/api/seed/seed-catalog.mjs to populate' : ''}`);
    }

    private all(): CatalogRow[] {
        return this.db.prepare('SELECT * FROM component_catalog').all() as unknown as CatalogRow[];
    }

    /** Era-legal, tech-base-filtered rows. era omitted → no era-gate; techBase omitted → all bases. */
    list(opts: { era?: number; category?: string; techBase?: string }): CatalogRow[] {
        let rows = this.all();
        if (opts.category) rows = rows.filter((r) => r.category === opts.category);
        const tb = (opts.techBase as TechBase) || 'All';
        rows = rows.filter((r) => techBaseMatches(r.tech_base, tb));
        if (opts.era != null && Number.isFinite(opts.era)) rows = rows.filter((r) => availableInEra(r, opts.era as number));
        return rows;
    }

    get(id: string): CatalogRow | null {
        return (this.db.prepare('SELECT * FROM component_catalog WHERE id = ?').get(id) as unknown as CatalogRow) ?? null;
    }

    stats(): { total: number; bySource: Record<string, number>; byCategory: Record<string, number> } {
        const total = (this.db.prepare('SELECT COUNT(*) AS n FROM component_catalog').get() as { n: number }).n;
        const bySource: Record<string, number> = {};
        const byCategory: Record<string, number> = {};
        for (const r of this.db.prepare('SELECT source, COUNT(*) AS n FROM component_catalog GROUP BY source').all() as { source: string; n: number }[]) bySource[r.source] = r.n;
        for (const r of this.db.prepare('SELECT category, COUNT(*) AS n FROM component_catalog GROUP BY category').all() as { category: string; n: number }[]) byCategory[r.category] = r.n;
        return { total, bySource, byCategory };
    }

    /** Resolve a row's price: flat cost, or the tonnage/rating-scaled formula cost for the given context. */
    cost(id: string, ctx: { tons?: number; rating?: number }): CostResult | null {
        const row = this.get(id);
        if (!row) return null;
        const computed = row.cost_formula ? evalCostFormula(row.cost_formula, ctx) : row.cost_cbills;
        return { id: row.id, name: row.name, flat: row.cost_cbills, formula: row.cost_formula, computed, context: ctx };
    }
}
