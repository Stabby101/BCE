import { deniedClaimText, DENIED_CLAIM_NOTICE_MS } from './denied-claim';

describe('deniedClaimText — P5 (the denied-claim notice)', () => {
    it('names the seat rule, the side rule, the door, and the first-come guard in plain words', () => {
        expect(deniedClaimText('another player holds that seat')).toBe('Not taken — another player holds that seat.');
        expect(deniedClaimText('already claimed')).toBe('Not taken — someone claimed it first.');
        expect(deniedClaimText('not your side')).toBe('Not taken — that unit fights for the other side.');
        expect(deniedClaimText('no active engagement')).toContain('no engagement is live');
        expect(deniedClaimText('not the live engagement')).toContain('live engagement');
        expect(deniedClaimText('reserved key')).toContain('GM');
    });
    it('an unknown reason is shown as the host said it; an empty one is still a line; the notice is a few seconds', () => {
        expect(deniedClaimText('the moon is full')).toBe('Not taken — the moon is full.');
        expect(deniedClaimText('')).toBe('Not taken.');
        expect(deniedClaimText(null)).toBe('Not taken.');
        expect(DENIED_CLAIM_NOTICE_MS).toBeGreaterThanOrEqual(3000);
    });
});
