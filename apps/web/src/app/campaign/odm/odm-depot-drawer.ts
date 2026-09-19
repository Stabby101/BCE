import type { CatalogItem } from '../inventory/starting-inventory';
import type { InventoryLine } from '../inventory/starting-inventory';

export const DEPOT_GROUP_ORDER: readonly string[] = ['weapon', 'misc', 'armor', 'structure', 'engine', 'gyro', 'cockpit', 'actuator'];

export const DEPOT_GROUP_TITLE: Record<string, string> = {
    weapon: 'Weapons', misc: 'Equipment', armor: 'Armor', structure: 'Internal structure',
    engine: 'Engines', gyro: 'Gyros', cockpit: 'Cockpits', actuator: 'Actuators',
};

export interface DepotDrawerGroup {
    key: string;
    title: string;
    /** Era-legal items the company holds NO line for — every one of them at zero. */
    items: { id: string; name: string }[];
    /** Era-legal, 'Mech-relevant, non-ammo rows in this category — held and unheld together. */
    eraLegal: number;
    /** How many of those the company already holds a line for. */
    held: number;
    /**
     * THE THREE STATES, and the reason they are three rather than a list-or-nothing:
     *   `lacking`     — there are era-legal items with no line. The shortage, listed.
     *   `complete`    — every era-legal item in this category is already held.
     *   `none-in-era` — the era allows none of this category at all.
     * Dropping the last two would render them as SILENCE, and silence would then mean two different
     * things — which is the absent-vs-zero bug this whole feature exists to fix, reappearing one level up
     * inside the fix. "Your armor coverage is complete" is a real fact in a campaign about scarcity.
     * `none-in-era` is not hypothetical: before ~2500 the catalog has no armor, structure, gyro, cockpit or
     * actuator rows at all.
     */
    state: 'lacking' | 'complete' | 'none-in-era';
}

/** The id a depot line occupies. `catalogId` is the join key; a null-id line (pure ammo tonnage) can never
 *  collide with a catalog row and is simply not a tier-1 claim on one. */
const heldIds = (lines: readonly InventoryLine[]): Set<string> =>
    new Set(lines.map((l) => l.catalogId).filter((x): x is string => !!x));

export function isDepotRelevant(id: string, relevant: ReadonlySet<string> | null): boolean {
    if (id.startsWith('struct:')) return true;
    return !relevant || relevant.has(id);
}

/**
 * THE PARTITION. Era-legal catalog rows the company does not hold, grouped, in the fixed order.
 *
 * @param rows      catalog rows for the campaign's era — already era-filtered SERVER-side (/api/catalog
 *                  ?era=, "no client-side re-gating"), which is also why no year is passed here: this
 *                  module must not re-implement era legality and then disagree with the server about it.
 * @param lines     the depot's held lines; their catalogIds are what makes an item tier 1.
 * @param relevant  the build-time 'Mech/vehicle-relevant id set, or null when unavailable.
 */
export function depotDrawer(
    rows: readonly CatalogItem[],
    lines: readonly InventoryLine[],
    relevant: ReadonlySet<string> | null,
): DepotDrawerGroup[] {
    /* AN UNREACHABLE CATALOG RENDERS NOTHING, not "the era allows none of anything". Zero rows means we do
       not KNOW what the era allows, and reporting ignorance as a fact is the exact failure this feature
       exists to prevent — it would be a screen confidently stating a total shortage that is really an
       outage. The caller renders the drawer only when this returns groups. */
    if (!rows.length) return [];

    const held = heldIds(lines);
    const byGroup = new Map<string, { id: string; name: string }[]>();
    const legalCount = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of rows) {
        if (!r?.id || r.category === 'ammo') continue;          // ruling 2 — ammo lives in the magazine
        if (!isDepotRelevant(r.id, relevant)) continue;          // ruling 2 — no infantry/BA kit on a 'Mech shelf
        if (seen.has(r.id)) continue;                            // a catalog with duplicate ids must not double-render
        seen.add(r.id);
        legalCount.set(r.category, (legalCount.get(r.category) ?? 0) + 1);
        if (held.has(r.id)) continue;                            // tier 1 already; the tiers PARTITION
        const g = byGroup.get(r.category) ?? [];
        g.push({ id: r.id, name: r.name });
        byGroup.set(r.category, g);
    }
    return DEPOT_GROUP_ORDER.map((key) => {
        const items = (byGroup.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name));
        const eraLegal = legalCount.get(key) ?? 0;
        return {
            key,
            title: DEPOT_GROUP_TITLE[key] ?? key,
            items,
            eraLegal,
            held: eraLegal - items.length,
            state: eraLegal === 0 ? 'none-in-era' as const : items.length === 0 ? 'complete' as const : 'lacking' as const,
        };
    });
}
