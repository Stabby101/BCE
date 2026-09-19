import { UNIVERSAL_TRACK_LIBRARY, synthSeedFromTemplate, TRACK_TEMPLATES } from './track-setup';

describe('UNIVERSAL_TRACK_LIBRARY + synthSeedFromTemplate ', () => {
    it('exposes every §18 template (12 — the arena Duel joins)', () => {
        expect(UNIVERSAL_TRACK_LIBRARY.length).toBe(Object.keys(TRACK_TEMPLATES).length);
        expect(UNIVERSAL_TRACK_LIBRARY.length).toBe(12);
        expect(UNIVERSAL_TRACK_LIBRARY.every((u) => !!u.key && !!u.name)).toBe(true);
    });

    it('synthesizes a forkless, id-resolvable seed per template', () => {
        const s = synthSeedFromTemplate('defend');
        expect(s.seedId).toBe('preset-tpl-defend');
        expect(s.forks).toEqual([]);            // never branches the tree (like a preset)
        expect(s.register).toBe('chaos-preset');
        expect(s.family).toBe('GARRISON_DUTY');
        expect(s.objectives.primary).toBeTruthy();
        expect(s.objectives.secondary).toBeTruthy();
        expect(s.objectives.bonus).toBeTruthy();
        expect(s.title).toBe(TRACK_TEMPLATES.defend.name);
    });

    it('every template synthesizes without throwing and stays forkless', () => {
        for (const u of UNIVERSAL_TRACK_LIBRARY) {
            const s = synthSeedFromTemplate(u.key);
            expect(s.seedId).toBe('preset-tpl-' + u.key);
            expect(s.forks).toEqual([]);
        }
    });
});

//    template's FULL mechanical set — typed objectives at the book's per-objective VP, side-tagged, OUR words —
//    plus the deepened procedural rules and the role stamp the resolve filter needs. ──
describe('synthSeedFromTemplate — the deepened mechanical set rides as trackObjectives ', () => {
    const BOOK_VP = [10, 50, 100, 150, 200, 250, 300, 400];

    it('defend carries its §18 set: 3 side-both objectives at 50/250/150, defender role, deep rules', () => {
        const s = synthSeedFromTemplate('defend');
        expect(s.trackObjectives!.map((o) => o.vp)).toEqual([50, 250, 150]);
        expect(s.trackObjectives!.every((o) => o.side === 'both')).toBeTrue();
        expect(s.trackSheet?.playerRole).toBe('defender');            // GARRISON_DUTY plays defender
        expect(s.trackSheet?.specialRules).toContain('reserve');      // the deepened defender-reserve rule
        expect(s.trackObjectives!.every((o) => !/Complete your/i.test(o.text))).toBeTrue(); // no generic slot text
    });

    it('every template ships ≥3 typed objectives, book VP values only, valid sides, and a role stamp', () => {
        for (const u of UNIVERSAL_TRACK_LIBRARY) {
            const s = synthSeedFromTemplate(u.key);
            expect(s.trackObjectives!.length).toBeGreaterThanOrEqual(3);
            expect(s.trackObjectives!.every((o) => BOOK_VP.includes(o.vp))).toBeTrue();
            expect(s.trackObjectives!.every((o) => ['attacker', 'defender', 'both'].includes(o.side!))).toBeTrue();
            expect(s.trackSheet?.playerRole === 'attacker' || s.trackSheet?.playerRole === 'defender').toBeTrue();
            expect((s.trackSheet?.specialRules ?? '').length).toBeGreaterThan(0);
        }
    });

    it("the legacy narrator trio mirrors the PLAYER side's rows (fallback text only when a kind is absent for that side)", () => {
        const s = synthSeedFromTemplate('objective-raid'); // attacker role
        expect(s.objectives.primary).toContain('Haul it home');
        expect(s.objectives.bonus).toContain('Past the wire');
    });
});
