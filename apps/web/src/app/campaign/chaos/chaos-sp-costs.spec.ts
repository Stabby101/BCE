import { combatPayFor, salvageFractionFor, CHAOS_COMBAT_PAY, CHAOS_START, CHAOS_MONTHLY } from './chaos-sp-costs';

describe('combatPayFor — OutcomeGate → book combat pay × Track Scale (DR §7)', () => {
    it('pays 750/500/250/0 × scale across the gate map, at scale 1 AND 2', () => {
        for (const scale of [1, 2]) {
            expect(combatPayFor('FULL_SUCCESS', scale)).toBe(750 * scale);
            expect(combatPayFor('SUCCESS', scale)).toBe(500 * scale);
            expect(combatPayFor('PARTIAL', scale)).toBe(250 * scale);
            expect(combatPayFor('COMPROMISED', scale)).toBe(250 * scale); // the ½ tier
            expect(combatPayFor('FAILURE', scale)).toBe(0);
            expect(combatPayFor('ANY', scale)).toBe(0); // GM-override sentinel — never paid
        }
    });
    it('the underlying tier table is the book table', () => {
        expect(CHAOS_COMBAT_PAY).toEqual({ allObjectives: 750, success: 500, unsuccessful: 250, none: 0 });
    });
});

describe('salvageFractionFor — the estimated-salvage fraction by outcome ', () => {
    it('maps 0.5 / 0.35 / 0.15 / 0 across the tiers', () => {
        expect(salvageFractionFor('FULL_SUCCESS')).toBe(0.5);
        expect(salvageFractionFor('SUCCESS')).toBe(0.35);
        expect(salvageFractionFor('PARTIAL')).toBe(0.15);
        expect(salvageFractionFor('FAILURE')).toBe(0);
    });
});

describe('the SP economy constants (DR §2/§6)', () => {
    it('a fresh Merc command seeds 3000 SP / Rep 1 / Scale 1', () => {
        expect(CHAOS_START).toEqual({ warchestSP: 3000, reputation: 1, contractScale: 1 });
    });
    it('monthly maintenance is 500 SP × Contract Scale', () => {
        expect(CHAOS_MONTHLY.maintenancePerScale).toBe(500);
    });
});
