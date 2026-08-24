/*
 * DIRECTIVE-IMPORT-6 Part A — the authored-intensity seam. Pins that a hot spot signs at its AUTHORED intensity (the
 * track count the author wrote), never clamped into the mapped contract type's intensityRange — the clamp was the
 * tester's "5-track custom ended silently at track 3" (Recon → expedition [1,3]). Completion itself (tracksDone >=
 * intensity, mission-tree.service.ts) is unchanged and harness-proven (smoke/verify-import6.js).
 */
import { authoredIntensity, syntheticOfferFromChaos, type ChaosContract } from './chaos-contract';
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
