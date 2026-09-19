import { signRefusal } from './contract-sign.service';
import { repBudgetFor } from '../chaos/chaos-contract-steps';
import type { ChaosContract } from '../chaos/chaos-contract';

const primary: ChaosContract = { id: 'cc-1', type: 'garrison', scale: 2, intensity: 2, status: 'active', acceptedDate: null, tracksDone: 0, hotspotId: 'hs-1', steps: { basePay: 2, command: 1, salvage: 2, support: 1, transport: 2 } };
const signed = (over: Partial<ChaosContract> = {}): ChaosContract => ({ ...primary, id: 'pc-home-a-hs-1', steps: { ...primary.steps, basePay: 3 }, repSpent: 1, transportSp: 420, ...over });

describe('signRefusal (P2b — the GM device\'s belts on a phone-signed contract)', () => {
    it('a contract on the session\'s hot spot, Command untouched, within the company\'s rep budget → written', () => {
        expect(signRefusal(signed(), primary, 4)).toBeNull();
    });
    it('refuses: no primary · another hot spot · Command moved · Scale out of range · rep over the company\'s OWN budget', () => {
        expect(signRefusal(signed(), null, 4)).toContain('no session contract');
        expect(signRefusal(signed({ hotspotId: 'hs-9' }), primary, 4)).toContain('hot spot');
        expect(signRefusal(signed({ steps: { ...primary.steps, command: 2 } }), primary, 4)).toContain('Command');
        expect(signRefusal(signed({ scale: 4 as never }), primary, 4)).toContain('Scale');
        const budget = repBudgetFor(1, 2);
        expect(signRefusal(signed({ repSpent: budget + 1 }), primary, 1)).toContain('exceeds');
        expect(signRefusal(signed({ repSpent: budget }), primary, 1)).toBeNull();
    });
});

describe('signRefusal — P2b-fix: the PATH check against the authored seed', () => {
    const seed = { basePay: 2, command: 1, salvage: 2, support: 1, transport: 2 }; // the authored side's steps (Command replaced by the primary's before the search)
    it('a legitimate signing that spent exactly the minimal cost is accepted (Base Pay +1 -> 1 Rep)', () => {
        expect(signRefusal(signed(), primary, 4, seed)).toBeNull();
    });
    it('inside the budget but OFF the chain: a spend below the minimal cost is refused', () => {
        const forged = signed({ steps: { ...primary.steps, basePay: 3, salvage: 3 }, repSpent: 1 }); // two raises, one paid
        expect(signRefusal(forged, primary, 4, seed)).toContain('below the chain');
    });
    it('a landing no chain reaches (a dash row; a column moved down outside a sacrifice) is refused', () => {
        expect(signRefusal(signed({ steps: { ...primary.steps, basePay: 3, transport: 9 }, repSpent: 4 }), primary, 4, seed)).toContain('off the chain');
        expect(signRefusal(signed({ steps: { ...primary.steps, basePay: 0 }, repSpent: 0 }), primary, 4, seed)).toContain('off the chain'); // Base Pay down TWO rows with every other column at its seed: no pair of sacrifices lands there
    });
    it('a spend ABOVE the minimal cost is tolerated (the budget belt still bounds it); an unknown hot spot refuses', () => {
        expect(signRefusal(signed({ repSpent: 2 }), primary, 4, seed)).toBeNull();
        expect(signRefusal(signed(), primary, 4, null)).toContain('not in this device');
    });
    it('the seed argument is optional: without it the four original belts alone decide', () => {
        expect(signRefusal(signed({ steps: { ...primary.steps, basePay: 3, salvage: 3 }, repSpent: 1 }), primary, 4)).toBeNull();
    });
});
