/*
 * PLATFORM-1 Part C — the RULED assert, pinned: "a persisted -1 record resolves by name and never yields
 * the 1-tonne infantry suit." The catalog carries 1,545 units sharing id:-1; before the guard, a name-miss
 * on a -1 record short-circuited the correct chassis/model fallback with the FIRST -1 unit in the catalog
 * (Nighthawk PA(L) — Infantry, 1 t, BV 11): wrong sheet, wrong sprite, wrong BV. These specs fail on the
 * un-guarded chain and pass on the guarded one — they prove the failure mode, not just a null check.
 */
import type { Unit } from '../../../models/units.model';
import { resolveInstanceUnit } from './resolve-instance-unit';

const u = (partial: Partial<Unit>): Unit => partial as Unit;

// the real-world shape: the FIRST id:-1 unit in catalog order is an infantry suit
const SUIT = u({ id: -1, name: 'Nighthawk PA(L) Mk. XXX (Bounty Hunter)(Non-Functional)', chassis: 'Nighthawk PA(L) Mk. XXX', model: '(Bounty Hunter)(Non-Functional)', type: 'Infantry', tons: 1, bv: 11 });
const MARAUDER = u({ id: 731, name: 'Marauder MAD-3R', chassis: 'Marauder', model: 'MAD-3R', type: 'Mek', tons: 75, bv: 1363 });
const NEG_MEK = u({ id: -1, name: 'Prototype Mek X-1', chassis: 'Prototype Mek', model: 'X-1', type: 'Mek', tons: 50, bv: 900 });
const CATALOG: Unit[] = [SUIT, NEG_MEK, MARAUDER];

describe('resolveInstanceUnit (PLATFORM-1 Part C — the id:-1 guard)', () => {
    it('THE RULED ASSERT: a persisted -1 record on a name miss resolves by chassis/model — NEVER the 1-tonne infantry suit', () => {
        // a Marauder bought in another era: unitRef misses the loaded slice, mulId was persisted as -1
        const inst = { unitRef: 'Marauder MAD-3R (off-slice name form)', chassis: 'Marauder', model: 'MAD-3R', mulId: -1 };
        const r = resolveInstanceUnit(inst, undefined, CATALOG);
        expect(r).toBe(MARAUDER);
        expect(r).not.toBe(SUIT); // the pre-guard behavior: find(id === -1) returned the suit
    });

    it('a persisted -1 behaves exactly like an ABSENT mulId (the inert-by-read guarantee — no repair pass needed)', () => {
        const withNeg = resolveInstanceUnit({ unitRef: 'x', chassis: 'Marauder', model: 'MAD-3R', mulId: -1 }, undefined, CATALOG);
        const without = resolveInstanceUnit({ unitRef: 'x', chassis: 'Marauder', model: 'MAD-3R' }, undefined, CATALOG);
        expect(withNeg).toBe(without);
    });

    it('the hire path\'s 0 fallback is inert too (no unit has id 0)', () => {
        const r = resolveInstanceUnit({ unitRef: 'x', chassis: 'Marauder', model: 'MAD-3R', mulId: 0 }, undefined, CATALOG);
        expect(r).toBe(MARAUDER);
    });

    it('a POSITIVE mulId still resolves by id (the HOTFIX-013 off-era-buy path, unchanged)', () => {
        const r = resolveInstanceUnit({ unitRef: 'not-in-slice', chassis: 'renamed', model: 'zz', mulId: 731 }, undefined, CATALOG);
        expect(r).toBe(MARAUDER);
    });

    it('the name lookup wins outright when it resolves (order preserved)', () => {
        const r = resolveInstanceUnit({ unitRef: 'Marauder MAD-3R', chassis: 'wrong', model: 'wrong', mulId: -1 }, MARAUDER, CATALOG);
        expect(r).toBe(MARAUDER);
    });

    it('falls to the bare-chassis match last; undefined on an empty catalog', () => {
        expect(resolveInstanceUnit({ unitRef: 'x', chassis: 'Marauder', model: 'MAD-5D', mulId: -1 }, undefined, CATALOG)).toBe(MARAUDER);
        expect(resolveInstanceUnit({ unitRef: 'x', chassis: 'Marauder', model: 'MAD-3R', mulId: -1 }, undefined, [])).toBeUndefined();
    });
});
