import { participantPay, slipPayFor } from './participant-pay';
import { combatPayFor, salvageFractionFor } from '../chaos/chaos-sp-costs';
import { resolved, type ChaosContract } from '../chaos/chaos-contract';
import type { OutcomeGate } from '../mission/mission-tree';

const contract = (scale: number, salvageStep: number): ChaosContract => ({
    id: 'pc-x', type: 'garrison', scale, intensity: 2, status: 'active', acceptedDate: null, tracksDone: 0,
    steps: { basePay: 2, command: 1, salvage: salvageStep, support: 1, transport: 2 },
});
const TIERS: OutcomeGate[] = ['FULL_SUCCESS', 'SUCCESS', 'PARTIAL', 'COMPROMISED', 'FAILURE'];

describe('participantPay — the primary\'s formulas, verbatim', () => {
    it('combat pay = combatPayFor(tier, the contract\'s Scale) for every tier and scale', () => {
        for (const tier of TIERS) for (const scale of [1, 2, 3]) {
            expect(participantPay(contract(scale, 3), tier, 5000).combatPay).toBe(combatPayFor(tier, scale));
        }
    });
    it('salvage = round((opforBv − claimed) × the tier fraction × 0.5 × the contract\'s salvage %) — the estimate', () => {
        const c = contract(2, 3);
        const pct = resolved(c.steps).salvage as number;
        expect(typeof pct).toBe('number'); expect(pct).toBeGreaterThan(0); // the fixture must carry a numeric %
        for (const tier of TIERS) {
            const expected = salvageFractionFor(tier) > 0 ? Math.round(((5000 - 800) * salvageFractionFor(tier) * 0.5 * pct) / 100) : 0;
            expect(participantPay(c, tier, 5000, 800).salvageSp).toBe(expected);
        }
        expect(participantPay(c, 'FULL_SUCCESS', 100, 800).salvageSp).toBe(0); // a claimed prize larger than the pool → 0, never negative
    });
    it('a non-numeric salvage term (None / Exchange) pays 0 salvage', () => {
        const steps = { basePay: 2, command: 1, salvage: 0, support: 1, transport: 2 };
        const c = { ...contract(1, 0), steps };
        const term = resolved(c.steps).salvage;
        if (typeof term === 'number') { expect(participantPay(c, 'FULL_SUCCESS', 5000).salvageSp).toBe(Math.round((5000 * 0.5 * 0.5 * term) / 100)); }
        else { expect(participantPay(c, 'FULL_SUCCESS', 5000).salvageSp).toBe(0); }
    });
    it('two contracts with different terms pay differently on the same resolve (the S21 close)', () => {
        const a = participantPay(contract(2, 3), 'SUCCESS', 6000);
        const b = participantPay(contract(1, 1), 'SUCCESS', 6000);
        expect(a.combatPay).toBe(1000); expect(b.combatPay).toBe(500);
        expect(a).not.toEqual(b);
    });
});

describe('slipPayFor — the map/companies join + the empty-map fallback', () => {
    it('one entry per company that signed; a company without a contract is absent; duplicates collapse', () => {
        const map = { 'home-a': contract(2, 3), 'home-b': contract(1, 2) };
        const pay = slipPayFor(map, ['home-a', 'home-a', 'home-c', 'home-b'], 'SUCCESS', 4000)!;
        expect(Object.keys(pay).sort()).toEqual(['home-a', 'home-b']);
        expect(pay['home-a']).toEqual(participantPay(map['home-a'], 'SUCCESS', 4000, 0, { settleSigning: true, completed: false }));
        expect('home-c' in pay).toBeFalse();
    });
    it('an EMPTY map → undefined (the P1 slip shape, byte-identical); no companies → undefined', () => {
        expect(slipPayFor({}, ['home-a'], 'SUCCESS', 4000)).toBeUndefined();
        expect(slipPayFor({ 'home-a': contract(1, 1) }, [], 'SUCCESS', 4000)).toBeUndefined();
    });
});

describe('participantPay — P2b: base pay per track (S22) · the signing settlement (S23) · completion', () => {
    const signed = { ...contract(2, 3), repSpent: 1, transportSp: 420 };
    it('ONE month of the contract\'s own Base Pay per track = round(500 × scale × basePay% / 100) — the monthly-tick formula', () => {
        const pct = resolved(signed.steps).basePay;
        expect(participantPay(signed, 'SUCCESS', 4000).basePaySp).toBe(Math.round((500 * 2 * pct) / 100));
        expect(participantPay(signed, 'FAILURE', 4000).basePaySp).toBe(Math.round((500 * 2 * pct) / 100)); // paid per track, whatever the tier
    });
    it('the first slip after signing settles the net transport and −repSpent; a settled contract carries neither', () => {
        const first = participantPay(signed, 'SUCCESS', 4000, 0, { settleSigning: true });
        expect(first.transportSp).toBe(420); expect(first.repDelta).toBe(-1);
        const later = participantPay(signed, 'SUCCESS', 4000, 0, { settleSigning: false });
        expect('transportSp' in later).toBeFalse(); expect('repDelta' in later).toBeFalse();
    });
    it('the primary\'s last track adds the completion +1 (net 0 when it is also the signing slip)', () => {
        expect(participantPay(signed, 'SUCCESS', 4000, 0, { completed: true }).repDelta).toBe(1);
        expect('repDelta' in participantPay(signed, 'SUCCESS', 4000, 0, { settleSigning: true, completed: true })).toBeFalse();
    });
    it('slipPayFor settles a contract only until repSettled is set, and passes completion through', () => {
        const map = { 'home-a': signed, 'home-b': { ...signed, repSettled: true } };
        const pay = slipPayFor(map, ['home-a', 'home-b'], 'SUCCESS', 4000, 0, true)!;
        expect(pay['home-a'].transportSp).toBe(420); expect('repDelta' in pay['home-a']).toBeFalse(); // −1 + 1
        expect('transportSp' in pay['home-b']).toBeFalse(); expect(pay['home-b'].repDelta).toBe(1);
    });
});

describe('slipPayFor — P1 (the session contract)', () => {
    const signed = { id: 'pc-x', type: 'garrison', scale: 2, intensity: 2, steps: { basePay: 4, command: 2, salvage: 6, support: 3, transport: 3 }, status: 'active' as const, acceptedDate: null, tracksDone: 0, repSpent: 1, transportSp: 420, signedBy: 'player' as const, repSettled: false };
    it('at COMPLETION every SIGNED participant gets the +1 — one with no rows on the last track gets a completion-only entry (no track pay, the signing settlement if owed, +1) — closes S27', () => {
        const map = { 'home-a': signed, 'home-b': { ...signed, repSettled: true }, 'home-c': signed };
        const pay = slipPayFor(map, ['home-a'], 'SUCCESS', 4000, 0, true)!;
        expect(pay['home-a'].combatPay).toBeGreaterThan(0); // fought the track: paid by its terms
        expect(pay['home-b']).toEqual({ combatPay: 0, salvageSp: 0, basePaySp: 0, repDelta: 1 }); // settled, absent from the track: the +1 alone
        expect(pay['home-c']).toEqual({ combatPay: 0, salvageSp: 0, basePaySp: 0, transportSp: 420, repDelta: 0 }); // unsettled + absent: -1 + 1 = 0, transport still owed
    });
    it('short of completion an absent signed company is NOT paid (it did not fight the track)', () => {
        const pay = slipPayFor({ 'home-a': signed, 'home-b': signed }, ['home-a'], 'SUCCESS', 4000, 0, false)!;
        expect(Object.keys(pay)).toEqual(['home-a']);
    });
    it('the GM own participant contract (GM_SELF_KEY) never rides the slip — it is paid on the GM device', () => {
        const pay = slipPayFor({ 'gm-self': signed, 'home-a': signed }, ['gm-self', 'home-a'], 'SUCCESS', 4000, 0, true)!;
        expect(Object.keys(pay)).toEqual(['home-a']);
    });
});
