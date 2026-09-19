import { emptyWhy, eraLegalIdSet, isEraLegal } from './era-legal';

describe('eraLegalIdSet / isEraLegal — (era-legal, said explicitly)', () => {
    const eras = [{ id: 257, units: [1901, 3565] }, { id: 12, units: new Set([7, 8]) }, { id: 99, units: [] }, { id: 100 }];
    it('the FULL catalog: the era carries its membership → gate on it', () => {
        const s = eraLegalIdSet(eras, 257);
        expect(s?.size).toBe(2);
        expect(isEraLegal(s, 1901)).toBeTrue();   // Locust LCT-1V, in ilClan
        expect(isEraLegal(s, 1569)).toBeFalse();  // Hunchback IIC 2, not in ilClan
        expect(isEraLegal(eraLegalIdSet(eras, 12), 8)).toBeTrue(); // a Set membership works as-is
    });
    it('the SLICE: eras from the slice index carry no membership → null → everything loaded is era-legal', () => {
        expect(eraLegalIdSet(eras, 100)).toBeNull();
        expect(eraLegalIdSet(eras, 99)).toBeNull();     // an empty membership is "unknown", never "nothing is legal"
        expect(isEraLegal(null, 1569)).toBeTrue();
    });
    it('no era resolved, or no eras at all → null (today’s behaviour, ungated)', () => {
        expect(eraLegalIdSet(eras, null)).toBeNull();
        expect(eraLegalIdSet(eras, 4242)).toBeNull();
        expect(eraLegalIdSet(null, 257)).toBeNull();
    });
});

describe('emptyWhy — (an empty search says WHY)', () => {
    it('nothing to say while there are results', () => {
        expect(emptyWhy({ eraLegal: 10, searched: 3, filtered: 1 }, 'x', 'Affordable only', 'ilClan')).toBeNull();
    });
    it('no era-legal units at all', () => {
        expect(emptyWhy({ eraLegal: 0, searched: 0, filtered: 0 }, '', 'Affordable only', 'ilClan')).toBe('No era-legal units are loaded for ilClan.');
    });
    it('the search text matched nothing era-legal — and says an out-of-era unit is not listed', () => {
        expect(emptyWhy({ eraLegal: 4027, searched: 0, filtered: 0 }, 'Hunchback IIC', 'Affordable only', 'ilClan')).toBe('No era-legal unit matches “Hunchback IIC” — a unit outside ilClan is not listed here.');
        expect(emptyWhy({ eraLegal: 4027, searched: 0, filtered: 0 }, 'zzz', 'Affordable only', null)).toBe('No era-legal unit matches “zzz”.');
    });
    it('matches exist but a filter hid them all — names the filter and the count (singular / plural)', () => {
        expect(emptyWhy({ eraLegal: 4027, searched: 1, filtered: 0 }, 'Atlas', 'Affordable only', 'ilClan')).toBe('1 era-legal match — all hidden by Affordable only.');
        expect(emptyWhy({ eraLegal: 4027, searched: 12, filtered: 0 }, 'Locust', 'the Weight / BV filters', 'ilClan')).toBe('12 era-legal matches — all hidden by the Weight / BV filters.');
    });
});
