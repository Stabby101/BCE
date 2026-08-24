/*
 * GAZETTEER-1 Phase 2 — pins the gazetteer's pure selectors: era filing (start-year), the sparse era-keyed
 * resolver (nearest ≤ viewed era), and the change-of-hands display label. These decide WHAT the detail card
 * shows for a given viewed era — pinned so a refactor can't silently shift the filing rule.
 */
import { eventsForEra, sparseEraValue, changeLabel, type WorldEvent } from './world-history';

const ev = (over: Partial<WorldEvent>): WorldEvent => ({
    systemId: 'kentares', year: 2796, eraId: 3, kind: 'battle', name: 'Battle', participants: [],
    confidence: 'high', source: 'battle-infobox', sarnaUrl: 'https://www.sarna.net/wiki/x', cited: true, ...over,
});

describe('world-history pure selectors (GAZETTEER-1 P2)', () => {
    it('eventsForEra files by eraId only — a multi-year event belongs to its START era', () => {
        const rows = [
            ev({ name: 'A', eraId: 3, year: 2796, endYear: 2797 }),
            ev({ name: 'B', eraId: 5, year: 3040 }),
            ev({ name: 'C', eraId: 3, year: 2801 }),
        ];
        expect(eventsForEra(rows, 3).map((r) => r.name)).toEqual(['A', 'C']);
        expect(eventsForEra(rows, 5).map((r) => r.name)).toEqual(['B']);
        expect(eventsForEra(rows, 12)).toEqual([]);
        expect(eventsForEra([], 3)).toEqual([]);
    });

    it('sparseEraValue resolves the nearest era ≤ the viewed one; nothing below → null', () => {
        const m = { '2': 100, '5': 200, '11': 300 };
        expect(sparseEraValue(m, 2)).toBe(100);
        expect(sparseEraValue(m, 4)).toBe(100);   // gap → the last defined below
        expect(sparseEraValue(m, 5)).toBe(200);
        expect(sparseEraValue(m, 10)).toBe(200);
        expect(sparseEraValue(m, 12)).toBe(300);
        expect(sparseEraValue(m, 1)).toBeNull();  // before the first record
        expect(sparseEraValue(undefined, 5)).toBeNull();
    });

    it('changeLabel renders the transition for change-of-hands rows and the name for everything else', () => {
        expect(changeLabel(ev({ kind: 'change-of-hands', name: 'Change of hands', from: ['Federated Suns'], to: ['Draconis Combine'] })))
            .toBe('Federated Suns → Draconis Combine');
        expect(changeLabel(ev({ kind: 'change-of-hands', name: 'Change of hands', from: ['Clan Smoke Jaguar', 'Clan Nova Cat'], to: ['Clan Nova Cat', 'Draconis Combine'] })))
            .toBe('Clan Smoke Jaguar / Clan Nova Cat → Clan Nova Cat / Draconis Combine');
        expect(changeLabel(ev({ kind: 'battle', name: 'Battle of Robinson (2540)' }))).toBe('Battle of Robinson (2540)');
        // a malformed change row (no from/to) falls back to the label — never throws
        expect(changeLabel(ev({ kind: 'change-of-hands', name: 'Change of hands' }))).toBe('Change of hands');
    });
});
