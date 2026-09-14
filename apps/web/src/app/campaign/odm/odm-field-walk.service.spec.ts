/*
 * TABLE-2 T2-1 — the FAST mutation-kill for the per-mission walk-routing fix (the ORDER-9 "faster spec" rule).
 *
 * The SHORT COUNT bug: the walk addressed a single global head — pendingBranch was `missionTree.find(isPending)`,
 * the FIRST pending branch in tree order — so a later mission (SHORT COUNT, gated behind PALE CANDLE) could never
 * be walked while an earlier pending one (PALE CANDLE) stayed uncleared. The fix threads an explicit selected
 * branch id through the pure `pickPendingBranch`, so the AAR row (and the just-resolved auto-open) routes the walk
 * to a SPECIFIC mission. This spec pins that selection at the SOURCE in milliseconds — no `nx build web`, no
 * puppeteer. `mutate.py` reverting pickPendingBranch to a plain `.find()` (ignore the selection) fails the
 * "selected wins" case directly under `nx test web`. The E2E witness is smoke/verify-t2walk.js (each AAR row
 * walks its own mission), which proves the DOM/user-facing behaviour; this is its fast twin.
 *
 * pickPendingBranch/isPendingWalk are PURE — no Angular, no TestBed, no DI — so the spec constructs nothing.
 */
import { isPendingWalk, pickPendingBranch } from './odm-field-walk.service';
import type { MissionBranch } from '../mission/mission-tree';

const pending = (id: string): MissionBranch => ({
    branchId: id,
    name: id,
    state: 'RESOLVED',
    resolution: { outcomeTier: 'SUCCESS', resolvedDate: { y: 3025, m: 0, d: 1 }, engaged: { bluforIds: [], opfor: [] } },
} as unknown as MissionBranch);

const walked = (id: string): MissionBranch => ({
    branchId: id,
    name: id,
    state: 'RESOLVED',
    resolution: {
        outcomeTier: 'SUCCESS',
        resolvedDate: { y: 3025, m: 0, d: 1 },
        engaged: { bluforIds: [], opfor: [] },
        fieldWalk: { walkedDate: { y: 3025, m: 0, d: 1 }, rows: [], totalCredit: 0, prizesClaimed: 0 },
    },
} as unknown as MissionBranch);

const active = (id: string): MissionBranch => ({ branchId: id, name: id, state: 'ACTIVE' } as unknown as MissionBranch);

describe('TABLE-2 T2-1 — pickPendingBranch / isPendingWalk', () => {
    it('isPendingWalk: RESOLVED + engaged + no fieldWalk = pending; a completed walk is not; a non-resolved branch is not', () => {
        expect(isPendingWalk(pending('X'))).toBe(true);
        expect(isPendingWalk(walked('X'))).toBe(false);
        expect(isPendingWalk(active('X'))).toBe(false);
    });

    it('with NO selection returns the FIRST pending branch in tree order (the banner affordance)', () => {
        const tree = [pending('ALPHA'), pending('BRAVO')];
        expect(pickPendingBranch(tree, null)?.branchId).toBe('ALPHA');
    });

    it('with a selection returns THAT pending branch — a later mission is NOT shadowed by an earlier one (THE T2-1 FIX)', () => {
        const tree = [pending('ALPHA'), pending('BRAVO')];
        // KILLS the reverted `.find()`-first mutation: without the selection, BRAVO is unreachable behind ALPHA.
        expect(pickPendingBranch(tree, 'BRAVO')?.branchId).toBe('BRAVO');
    });

    it('falls back to the first-pending when the selected branch is already walked (stale selection)', () => {
        const tree = [pending('ALPHA'), walked('BRAVO')];
        expect(pickPendingBranch(tree, 'BRAVO')?.branchId).toBe('ALPHA');
    });

    it('returns undefined when nothing is pending', () => {
        expect(pickPendingBranch([walked('ALPHA'), active('BRAVO')], null)).toBeUndefined();
        expect(pickPendingBranch([], 'ALPHA')).toBeUndefined();
    });
});
