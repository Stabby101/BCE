/*
 * DIRECTIVE-IMPORT-6 Part A — the authored-intensity seam. Pins that a hot spot signs at its AUTHORED intensity (the
 * track count the author wrote), never clamped into the mapped contract type's intensityRange — the clamp was the
 * tester's "5-track custom ended silently at track 3" (Recon → expedition [1,3]). Completion itself (tracksDone >=
 * intensity, mission-tree.service.ts) is unchanged and harness-proven (smoke/verify-import6.js).
 */
import { authoredIntensity, syntheticOfferFromChaos, isSessionContract, participantSideFor, type ChaosContract, sessionPhase, hasGeneratedTrackOf } from './chaos-contract';
import { CHAOS_CONTRACT_TYPES } from './chaos-contract-steps';
import { hotspotTypeId } from './hotspots-catalog';

describe('authoredIntensity — IMPORT-6 Part A (the authored track count is the contract intensity, verbatim)', () => {
    it('keeps an authored intensity ABOVE the mapped type range (the pre-IMPORT-6 clamp bug: Recon 5 → 3)', () => {
        const type = hotspotTypeId({ type: 'Recon' } as never); // → 'expedition'
        const [, hi] = CHAOS_CONTRACT_TYPES.find((t) => t.id === type)!.intensityRange;
        expect(hi).toBe(3); // the range that used to clamp
        expect(authoredIntensity({ intensity: 5 })).toBe(5);
    });
    it('keeps an authored intensity BELOW the mapped type range (hs-drm-08: garrison [2,4], authored 1 track)', () => {
        const [lo] = CHAOS_CONTRACT_TYPES.find((t) => t.id === 'garrison')!.intensityRange;
        expect(lo).toBe(2);
        expect(authoredIntensity({ intensity: 1 })).toBe(1);
    });
    it('coerces to an integer ≥ 1 (0 / NaN / negative / fractional never yield a contract that completes at zero tracks)', () => {
        expect(authoredIntensity({ intensity: 0 })).toBe(1);
        expect(authoredIntensity({ intensity: 'x' })).toBe(1);
        expect(authoredIntensity({ intensity: -3 })).toBe(1);
        expect(authoredIntensity({ intensity: 2.6 })).toBe(3);
        expect(authoredIntensity({ intensity: '4' })).toBe(4);
    });
    it('the synthetic Traditional offer mirrors it as durationMonths (≈ the number of tracks; HS pay is C-bill-zero)', () => {
        const c = { id: 'cc-x', type: 'expedition', scale: 1, intensity: authoredIntensity({ intensity: 5 }), steps: { basePay: 4, command: 10, salvage: 3, support: 3, transport: 5 }, status: 'active', acceptedDate: null, tracksDone: 0 } as ChaosContract;
        const off = syntheticOfferFromChaos(c);
        expect(off.durationMonths).toBe(5);
        expect(off.pay.total).toBe(0);
        expect(off.status).toBe('ACTIVE');
    });
});

describe('participantSideFor (GM-3 P1 hook 3 — the participant side, and the session flip-suppression)', () => {
    it('a GM-signed primary (D-133): a wire-OPFOR player signs the OPPOSING side; BLUFOR/no-side signs the primary side', () => {
        expect(participantSideFor({ side: 'a' }, 'OPFOR')).toBe('b');
        expect(participantSideFor({ side: 'b' }, 'OPFOR')).toBe('a');
        expect(participantSideFor({ side: 'a' }, 'BLUFOR')).toBe('a');
        expect(participantSideFor({ side: 'b' }, 'BLUFOR')).toBe('b');
        expect(participantSideFor({ side: 'a' }, null)).toBe('a');
        expect(participantSideFor({}, 'OPFOR')).toBe('b'); // undefined side defaults to 'a' → flip to 'b'
    });
    it('a SESSION contract: EVERY participant signs the table\'s side — the flip is SUPPRESSED even on OPFOR (hook 3)', () => {
        expect(participantSideFor({ party: 'session', side: 'a' }, 'OPFOR')).toBe('a');
        expect(participantSideFor({ party: 'session', side: 'a' }, 'BLUFOR')).toBe('a');
        expect(participantSideFor({ party: 'session', side: 'b' }, 'OPFOR')).toBe('b'); // the table plays side b → all sign b, no flip
        expect(isSessionContract({ party: 'session' })).toBeTrue();
        expect(isSessionContract({})).toBeFalse();
    });
});

describe('sessionPhase — DIRECTIVE-PD3 P2 (PD3-9/11): the ONE phase the phone gates the pick window and the brief on', () => {
    const live = { status: 'active' as const }; const done = { status: 'completed' as const };
    it("'none' — nothing presented, no contract, no record", () => { expect(sessionPhase({ presented: null, contract: null, completed: null, tree: [], spec: null })).toBe('none'); });
    it("'lobby' — presented + a live contract, nothing generated (the pick is live)", () => { expect(sessionPhase({ presented: {}, contract: live, completed: null, tree: [{ state: 'AVAILABLE' }], spec: null })).toBe('lobby'); });
    it("'committed' — a track ACTIVE, or RESOLVED, or a spec (the side is a fact)", () => {
        expect(sessionPhase({ presented: {}, contract: live, completed: null, tree: [{ state: 'ACTIVE' }], spec: null })).toBe('committed');
        expect(sessionPhase({ presented: {}, contract: live, completed: null, tree: [{ state: 'RESOLVED' }], spec: null })).toBe('committed');
        expect(sessionPhase({ presented: {}, contract: live, completed: null, tree: [], spec: { forge: {} } })).toBe('committed');
    });
    it("'complete' — the terminal record, or a completed status, or a brief with no contract (the pre-P2 null)", () => {
        expect(sessionPhase({ presented: {}, contract: null, completed: done, tree: [{ state: 'RESOLVED' }], spec: null })).toBe('complete');
        expect(sessionPhase({ presented: {}, contract: done, completed: null, tree: [], spec: null })).toBe('complete');
        expect(sessionPhase({ presented: {}, contract: null, completed: null, tree: [], spec: null })).toBe('complete');
    });
    it('a NEW live contract after a completion is a lobby again (the record is superseded by the singular)', () => { expect(sessionPhase({ presented: {}, contract: live, completed: done, tree: [], spec: null })).toBe('lobby'); });
    it('hasGeneratedTrackOf mirrors MissionTreeService.hasGeneratedTrack', () => {
        expect(hasGeneratedTrackOf([{ state: 'AVAILABLE' }], null)).toBe(false); expect(hasGeneratedTrackOf([{ state: 'ACTIVE' }], null)).toBe(true);
        expect(hasGeneratedTrackOf([], { x: 1 })).toBe(true); expect(hasGeneratedTrackOf(null, null)).toBe(false);
    });
});
