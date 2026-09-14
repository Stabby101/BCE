/*
 * GM-2 P2b-fix — the PATH CHECK, pinned against the STEPS table (chaos-contract-steps.ts): the minimal Rep a D-128 chain
 * must spend to reach a signed terms vector, em-dash rows paid, sacrifices free, the per-term cap, the two-sacrifice cap,
 * unreachable landings, a column moved down outside a sacrifice, and the locked Command.
 */
import { minimalRepCost, type Steps } from './chaos-chain-cost';
import { repCostUp } from './chaos-contract-steps';

const seed = (over: Partial<Steps> = {}): Steps => ({ basePay: 3, command: 7, salvage: 3, support: 3, transport: 5, ...over });

describe('minimalRepCost — the D-128 chain, re-derived', () => {
    it('no change → 0 Rep, 0 sacrifices', () => {
        expect(minimalRepCost(seed(), seed(), 2)).toEqual({ ok: true, minimalRep: 0, sacrifices: 0 });
    });
    it('one Rep raise costs the rows crossed; an em-dash row is paid (salvage None→Exchange crosses the `—` at index 1)', () => {
        expect(minimalRepCost(seed(), seed({ basePay: 4 }), 2)).toEqual({ ok: true, minimalRep: 1, sacrifices: 0 });
        const r = minimalRepCost(seed({ salvage: 0 }), seed({ salvage: 2 }), 2);
        expect(repCostUp('salvage', 0)).toBe(2); // the pinned helper: None(0) → Exchange(2) crosses the `—` at 1
        expect(r.ok && r.minimalRep).toBe(2);
    });
    it('two raises on two columns add up; two raises on ONE column add up within the cap', () => {
        expect(minimalRepCost(seed(), seed({ basePay: 4, support: 4 }), 2)).toEqual({ ok: true, minimalRep: 2, sacrifices: 0 });
        expect(minimalRepCost(seed(), seed({ basePay: 5 }), 2)).toEqual({ ok: true, minimalRep: 2, sacrifices: 0 });
    });
    it('the per-term cap = Scale: two rows on one column at Scale 1 is OFF the chain; at Scale 2 it is 2 Rep', () => {
        expect(minimalRepCost(seed(), seed({ basePay: 5 }), 1).ok).toBeFalse();
        expect(minimalRepCost(seed(), seed({ basePay: 5 }), 2).ok).toBeTrue();
    });
    it('a sacrifice: drop one column two rows (floored) to raise another — 0 Rep, 1 sacrifice; the raise still counts toward its cap', () => {
        expect(minimalRepCost(seed({ basePay: 5 }), seed({ basePay: 3, support: 4 }), 2)).toEqual({ ok: true, minimalRep: 0, sacrifices: 1 });
        // Command Independent(10) drops to Liaison(7), not House(6) — only when Command is negotiable (no lock)
        expect(minimalRepCost(seed({ command: 10 }), seed({ command: 7, support: 4 }), 2)).toEqual({ ok: true, minimalRep: 0, sacrifices: 1 });
    });
    it('the chain prefers the cheaper path: a sacrifice-funded raise beats a paid one when a drop is available', () => {
        // basePay 5→3 (drop) funds support 3→4; the second support row (4→5) is paid → 1 Rep, 1 sacrifice
        expect(minimalRepCost(seed({ basePay: 5 }), seed({ basePay: 3, support: 5 }), 2)).toEqual({ ok: true, minimalRep: 1, sacrifices: 1 });
    });
    it('a column moved DOWN one row: off the chain at Scale 1 (the cap blocks the roundabout), but at Scale 2 a two-sacrifice roundabout + one paid raise reaches it — the search is exact', () => {
        expect(minimalRepCost(seed({ basePay: 5 }), seed({ basePay: 4 }), 1).ok).toBeFalse();
        // S1: drop basePay 5→3 raising support 3→4 · S2: drop support 4→2 raising basePay 3→4 · then a paid raise support 2→3 (1 Rep; support's raise-rows 2 = the Scale-2 cap)
        expect(minimalRepCost(seed({ basePay: 5 }), seed({ basePay: 4 }), 2)).toEqual({ ok: true, minimalRep: 1, sacrifices: 2 });
        expect(minimalRepCost(seed({ basePay: 9, support: 9, salvage: 9 }), seed({ basePay: 7, support: 7, salvage: 7, transport: 8 }), 3).ok).toBeFalse();
    });
    it('a landing on a `—` row (transport 9) or past the top is off the chain', () => {
        expect(minimalRepCost(seed(), seed({ transport: 9 }), 3).ok).toBeFalse();
        expect(minimalRepCost(seed(), seed({ transport: 12 }), 3).ok).toBeFalse();
    });
    it('the locked Command: a moved step is refused before any search; with the lock, Command never moves as a drop or a raise', () => {
        const r = minimalRepCost(seed(), seed({ command: 10 }), 3, { lockCommand: true });
        expect(r.ok).toBeFalse(); expect(!r.ok && r.reason).toContain('Command');
        expect(minimalRepCost(seed({ command: 10 }), seed({ command: 10, support: 4 }), 2, { lockCommand: true })).toEqual({ ok: true, minimalRep: 1, sacrifices: 0 }); // no free drop from Command
    });
    it('the salvage dash trick: a sacrifice up through salvage and one back down nets Base Pay ONE row lower for 0 Rep at Scale 2 — legal, and the search finds it', () => {
        // S1: drop salvage 2→0 raising basePay 2→3 · S2: drop basePay 3→1 raising salvage 0→2 (one valid step, two rows across the `—`)
        const s = { basePay: 2, command: 1, salvage: 2, support: 1, transport: 4 };
        expect(minimalRepCost(s, { ...s, basePay: 1 }, 2, { lockCommand: true })).toEqual({ ok: true, minimalRep: 0, sacrifices: 2 });
        expect(minimalRepCost(s, { ...s, basePay: 0 }, 2, { lockCommand: true }).ok).toBeFalse(); // two rows down leaves no way back for the other column
    });
    it('the claimed spend the phone chain produces (Base Pay +1 → repSpent 1) is exactly the minimal cost', () => {
        const r = minimalRepCost(seed(), seed({ basePay: 4 }), 2, { lockCommand: true });
        expect(r.ok && r.minimalRep).toBe(1);
    });
});
