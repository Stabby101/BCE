import { campaignWeek } from './campaign-clock';

describe('campaignWeek — P3 (S54): the header WK off the one clock', () => {
    it('week 1 on the start date and through day 7; week 2 from day 8; week 16 at day 111 (Pendragon\'s "Day 111 · WK 1")', () => {
        expect(campaignWeek({ y: 3050, m: 2, d: 21 }, { y: 3050, m: 2, d: 21 })).toBe(1);
        expect(campaignWeek({ y: 3050, m: 2, d: 21 }, { y: 3050, m: 2, d: 27 })).toBe(1);
        expect(campaignWeek({ y: 3050, m: 2, d: 21 }, { y: 3050, m: 2, d: 28 })).toBe(2);
        expect(campaignWeek({ y: 3050, m: 0, d: 1 }, { y: 3050, m: 3, d: 21 })).toBe(16); // day 111 → floor(110/7)+1
    });
    it('a missing start or current date reads week 1 (the pre-fallback), never NaN', () => {
        expect(campaignWeek(null, { y: 3050, m: 2, d: 21 })).toBe(1); expect(campaignWeek({ y: 3050, m: 2, d: 21 }, undefined)).toBe(1);
    });
});
