/*
 * DIRECTIVE-HARDEN-1 Part B — pinned-value specs for the D-128 book-exact negotiation math (Draconis Reach
 * pp.27–28, re-verified at D-128). The STEPS table is pinned IN FULL (it is the book's negotiation matrix —
 * any diff is a rules change, not a refactor), plus the row-cost / sacrifice / budget / cap arithmetic.
 * If one of these fails after a refactor, compare against the book and the D-128 directive, not the spec.
 */
import {
    CONTRACT_COLUMNS,
    CONTRACT_STEP_COUNT,
    CHAOS_CONTRACT_TYPES,
    stepValue,
    nextValidStep,
    repCostUp,
    sacrificeDropTarget,
    repBudgetFor,
    canRaiseTerm,
    type ContractColumn,
} from './chaos-contract-steps';

/** The book's 17-step negotiation matrix, pinned verbatim (null = an invalid `—` row). */
const PINNED_STEPS: Record<ContractColumn, (number | string | null)[]> = {
    basePay: [50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
    command: [null, null, 'Integrated', null, null, null, 'House', 'Liaison', null, null, 'Independent', null, null, null, null, null, null],
    salvage: ['None', null, 'Exchange', 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, null, null, null, null],
    support: ['None', 'Straight/20', 'Straight/40', 'Straight/60', 'Straight/70', 'Straight/80', 'Straight/90', 'Straight/100', 'Battle/10', 'Battle/20', 'Battle/30', 'Battle/40', 'Battle/50', 'Battle/75', 'Battle/100', null, null],
    transport: [null, null, null, null, 0, 25, 50, 75, 100, null, null, null, null, null, null, null, null],
};

describe('the contract STEPS table — pinned in full (DR §5 negotiation matrix)', () => {
    it('every column matches the book row-for-row (17 steps, `—` = null)', () => {
        for (const col of CONTRACT_COLUMNS) {
            const actual = Array.from({ length: CONTRACT_STEP_COUNT }, (_, i) => stepValue(col, i));
            expect(actual).withContext(col).toEqual(PINNED_STEPS[col]);
        }
    });
    it('out-of-range steps read as null', () => {
        expect(stepValue('basePay', CONTRACT_STEP_COUNT)).toBeNull();
        expect(stepValue('command', -1)).toBeNull();
    });
    it('the six contract types carry valid (non-`—`) default steps', () => {
        for (const t of CHAOS_CONTRACT_TYPES) {
            for (const col of CONTRACT_COLUMNS) {
                expect(stepValue(col, t.defaultSteps[col])).withContext(`${t.id}.${col}`).not.toBeNull();
            }
        }
    });
});

describe('nextValidStep — `—` rows can never be landed on', () => {
    it('skips em-dash rows moving up: Command Liaison(idx 7) → Independent(idx 10)', () => {
        expect(nextValidStep('command', 7, 1)).toBe(10);
    });
    it('skips em-dash rows moving down: Command House(idx 6) → Integrated(idx 2)', () => {
        expect(nextValidStep('command', 6, -1)).toBe(2);
    });
    it('returns null when nothing valid remains in that direction', () => {
        expect(nextValidStep('command', 10, 1)).toBeNull(); // Independent is the top
        expect(nextValidStep('transport', 8, 1)).toBeNull(); // 100% is the top
        expect(nextValidStep('basePay', 0, -1)).toBeNull();
    });
});

describe('repCostUp — a raise costs the step-ROWS crossed; `—` rows are PAID-but-WASTED (D-128)', () => {
    it('an all-valid column costs 1 per raise (Base Pay row 4→5 = 1 Rep, the D-128 acceptance)', () => {
        expect(repCostUp('basePay', 3)).toBe(1);
    });
    it('a hop across em-dashes costs every row: Command Liaison(8)→Independent(11) = 3 Rep (rows 9–10 wasted)', () => {
        expect(repCostUp('command', 7)).toBe(3);
    });
    it('Command Integrated(3)→House(7) = 4 Rep (rows 4–6 wasted)', () => {
        expect(repCostUp('command', 2)).toBe(4);
    });
    it('Salvage None(1)→Exchange(3) = 2 Rep (row 2 wasted)', () => {
        expect(repCostUp('salvage', 0)).toBe(2);
    });
    it('null when no valid step remains above (the term is maxed)', () => {
        expect(repCostUp('command', 10)).toBeNull();
        expect(repCostUp('transport', 8)).toBeNull();
        expect(repCostUp('basePay', 16)).toBeNull();
    });
});

describe('sacrificeDropTarget — drop 2 rows, FLOOR to the next valid step at/below (D-128)', () => {
    it('Command Independent(11) lands on Liaison(8), NOT House(7): 11−2=9 is `—`, floor to 8', () => {
        expect(sacrificeDropTarget('command', 10)).toBe(7); // 0-based: 10−2=8 is null → floors to 7 (Liaison)
    });
    it('an all-valid column drops exactly 2 rows (Base Pay idx 5 → 3)', () => {
        expect(sacrificeDropTarget('basePay', 5)).toBe(3);
    });
    it('floors past an em-dash: Salvage 10%(idx 3) → idx 1 is `—` → None(idx 0)', () => {
        expect(sacrificeDropTarget('salvage', 3)).toBe(0);
    });
    it('Command Liaison(idx 7) floors down to Integrated(idx 2)', () => {
        expect(sacrificeDropTarget('command', 7)).toBe(2);
    });
    it('null when no valid step exists 2+ rows below (nothing left to sacrifice)', () => {
        expect(sacrificeDropTarget('basePay', 1)).toBeNull();
        expect(sacrificeDropTarget('command', 2)).toBeNull(); // Integrated is the floor
        expect(sacrificeDropTarget('transport', 5)).toBeNull(); // 25%: idx 3..0 are all `—`
    });
});

describe('repBudgetFor — Rep budget = min(Reputation, 2 × Scale) rows per negotiation (D-128)', () => {
    it('caps at 2×scale when reputation is plentiful', () => {
        expect(repBudgetFor(5, 1)).toBe(2);
        expect(repBudgetFor(10, 2)).toBe(4);
    });
    it('caps at reputation when rep is the binding constraint', () => {
        expect(repBudgetFor(1, 2)).toBe(1);
        expect(repBudgetFor(0, 3)).toBe(0);
    });
});

describe('canRaiseTerm — the raise gate: budget AND the per-term row cap (= Scale) (D-128)', () => {
    // canRaiseTerm(cost, repUsed, repBudget, colRaises, scale)
    it('a maxed term (null cost) can never be raised', () => {
        expect(canRaiseTerm(null, 0, 4, 0, 2)).toBeFalse();
    });
    it('Command Liaison→Independent (cost 3) is disabled at Scale 1 (budget 2 < 3) — the D-128 acceptance', () => {
        expect(canRaiseTerm(3, 0, repBudgetFor(5, 1), 0, 1)).toBeFalse();
    });
    it('the per-term cap counts ROWS: cost 3 exceeds a Scale-2 cap even with budget left', () => {
        expect(canRaiseTerm(3, 0, 4, 0, 2)).toBeFalse(); // budget 4 would allow it; the per-term cap (2) refuses
        expect(canRaiseTerm(3, 0, 6, 0, 3)).toBeTrue(); // at Scale 3 the same raise fits
    });
    it('boundary equalities are allowed (spend the budget/cap exactly)', () => {
        expect(canRaiseTerm(2, 0, 2, 0, 2)).toBeTrue();
        expect(canRaiseTerm(1, 1, 2, 1, 2)).toBeTrue();
    });
    it('an exhausted Rep budget refuses further raises even when the term cap has room', () => {
        expect(canRaiseTerm(1, 2, 2, 0, 3)).toBeFalse();
    });
    it('accumulated raises on the SAME term hit the per-term cap independently of the budget', () => {
        expect(canRaiseTerm(1, 1, 4, 2, 2)).toBeFalse(); // 2 rows already raised on this term at Scale 2
    });
});
