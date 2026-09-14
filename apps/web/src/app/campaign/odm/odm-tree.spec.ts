/*
 * odmSpecIsCurrent — ORDER-10 / P7, the FAST mutation-kill for the resume-brief fix.
 *
 * A pure predicate: an ODM carrier missionSpec (stamped `odm-<branchId>-<seed>` at BEGIN OPERATION) is
 * CURRENT only when a branch it is stamped with is ACTIVE. A resolved mission's spec (Pale Candle) is
 * therefore NOT current the moment its branch resolves — even while a DIFFERENT branch (Last Bearing) is
 * ACTIVE (the exact P7 shape). The GM brief computed, the reconcile clear, and the resume/hydrate all
 * share this rule. This spec pins it at the SOURCE level in milliseconds — no `nx build web`, no puppeteer;
 * the E2E RESUME proof lives in smoke/verify-odm-resume-brief.js. mutate m17 (break the predicate) fails
 * this under `nx test web`; mutate m16 (revert the caller) fails the E2E RESUME.
 */
import { odmSpecIsCurrent } from './odm-tree';
import type { MissionBranch } from '../mission/mission-tree';

const br = (branchId: string, state: MissionBranch['state']): MissionBranch => ({ branchId, state, name: branchId } as MissionBranch);
const paleSpec = { missionId: 'odm-PALE_CANDLE-0cdbd513' };
const bearingSpec = { missionId: 'odm-LAST_BEARING-3f23efe2' };

describe('odmSpecIsCurrent — ORDER-10 P7: a resolved spec is never current', () => {
    it('is CURRENT when the spec is stamped with the ACTIVE branch', () => {
        const tree = [br('PALE_CANDLE', 'RESOLVED'), br('LAST_BEARING', 'ACTIVE')];
        expect(odmSpecIsCurrent(bearingSpec, tree)).toBe(true);
    });

    it('is NOT current when the spec belongs to a RESOLVED branch while a DIFFERENT branch is ACTIVE (the P7 case)', () => {
        const tree = [br('PALE_CANDLE', 'RESOLVED'), br('LAST_BEARING', 'ACTIVE')];
        expect(odmSpecIsCurrent(paleSpec, tree)).toBe(false);
    });

    it('is NOT current when no branch is ACTIVE (a fully-idle/resolved tree)', () => {
        const tree = [br('PALE_CANDLE', 'RESOLVED'), br('LAST_BEARING', 'AVAILABLE')];
        expect(odmSpecIsCurrent(paleSpec, tree)).toBe(false);
    });

    it('is NOT current for a null/absent spec', () => {
        expect(odmSpecIsCurrent(null, [br('LAST_BEARING', 'ACTIVE')])).toBe(false);
        expect(odmSpecIsCurrent(undefined, [br('LAST_BEARING', 'ACTIVE')])).toBe(false);
        expect(odmSpecIsCurrent({ missionId: undefined }, [br('LAST_BEARING', 'ACTIVE')])).toBe(false);
    });

    it('does not match a branch id that is only a PREFIX of the active branch (the trailing dash is required)', () => {
        // spec stamped for 'LAST_BEARING' must not read as current merely because 'LAST' is active
        const tree = [br('LAST', 'ACTIVE')];
        expect(odmSpecIsCurrent(bearingSpec, tree)).toBe(false);
    });

    it('resolves a HYPHEN-PREFIX branch id to the RIGHT owner (longest match) — the review-found false positive', () => {
        // 'iron-dividend' is a hyphen-prefix of 'iron-dividend-relief' (the sibling packs use this convention)
        const tree = [br('iron-dividend', 'ACTIVE'), br('iron-dividend-relief', 'RESOLVED')];
        // the resolved sibling's spec must NOT read as current merely because 'iron-dividend' is active
        expect(odmSpecIsCurrent({ missionId: 'odm-iron-dividend-relief-3f23efe2' }, tree)).toBe(false);
        // the active branch's own spec is current
        expect(odmSpecIsCurrent({ missionId: 'odm-iron-dividend-0cdbd513' }, tree)).toBe(true);
    });

    it('a non-odm carrier (the pack-unreachable Forge fallback `msn-` spec) is current while a branch is ACTIVE, stale otherwise', () => {
        // review finding 2: the fix must not strip an in-progress fallback mission's spec
        expect(odmSpecIsCurrent({ missionId: 'msn-9f3a1c' }, [br('LAST_BEARING', 'ACTIVE')])).toBe(true);
        expect(odmSpecIsCurrent({ missionId: 'msn-9f3a1c' }, [br('LAST_BEARING', 'RESOLVED')])).toBe(false);
    });
});
