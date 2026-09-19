import { gmDeviceId, deviceLabelHeuristic } from './gm-device';

describe('gm-device — P5 (the baton is per DEVICE)', () => {
    it('mints ONE id per profile and keeps it: two reads agree, the id matches the host alphabet, a fresh profile mints a different one', () => {
        localStorage.removeItem('bce.gm.device');
        const a = gmDeviceId(), b = gmDeviceId();
        expect(a).toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        localStorage.removeItem('bce.gm.device');
        expect(gmDeviceId()).not.toBe(a);
        localStorage.removeItem('bce.gm.device');
    });
    it('the label heuristic: no touch → desktop; a touch-screen PC (fine primary pointer) → desktop; coarse touch + narrow → phone; coarse touch + wide → tablet', () => {
        expect(deviceLabelHeuristic(0, 1500)).toBe('desktop');
        expect(deviceLabelHeuristic(10, 1500, false)).toBe('desktop');
        expect(deviceLabelHeuristic(5, 375, true)).toBe('phone');
        expect(deviceLabelHeuristic(5, 1024, true)).toBe('tablet');
    });
});
