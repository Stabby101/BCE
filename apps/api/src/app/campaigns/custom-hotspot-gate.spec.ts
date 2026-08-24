/*
 * DIRECTIVE-IMPORT-1 Part A — the guest-gate decision (pure). Pins that only a guest carrying custom hotspots,
 * with auth required, is refused; every other combination passes.
 */
import { snapshotCustomHotspotCount, guestCustomHotspotRefused } from './custom-hotspot-gate';

describe('custom-hotspot-gate', () => {
    describe('snapshotCustomHotspotCount', () => {
        it('counts the customHotSpots array', () => {
            expect(snapshotCustomHotspotCount({ customHotSpots: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
        });
        it('is 0 for a missing / non-array field, null, or a non-object', () => {
            expect(snapshotCustomHotspotCount({})).toBe(0);
            expect(snapshotCustomHotspotCount({ customHotSpots: 'nope' })).toBe(0);
            expect(snapshotCustomHotspotCount(null)).toBe(0);
            expect(snapshotCustomHotspotCount('a string')).toBe(0);
            expect(snapshotCustomHotspotCount(undefined)).toBe(0);
        });
    });

    describe('guestCustomHotspotRefused', () => {
        const withCustom = { customHotSpots: [{ id: 'hs-custom-0', custom: true }] };
        it('REFUSES a guest carrying custom hotspots when auth is required', () => {
            expect(guestCustomHotspotRefused('guest', true, withCustom)).toBe(true);
        });
        it('allows a gm and an admin', () => {
            expect(guestCustomHotspotRefused('gm', true, withCustom)).toBe(false);
            expect(guestCustomHotspotRefused('admin', true, withCustom)).toBe(false);
        });
        it('allows a guest whose snapshot has NO custom hotspots', () => {
            expect(guestCustomHotspotRefused('guest', true, { customHotSpots: [] })).toBe(false);
            expect(guestCustomHotspotRefused('guest', true, { foo: 1 })).toBe(false);
        });
        it('does nothing when auth is OFF (dev/LAN — no guest tier, unchanged)', () => {
            expect(guestCustomHotspotRefused('guest', false, withCustom)).toBe(false);
        });
        it('allows an undefined/null role (no user) even with a dirty snapshot', () => {
            expect(guestCustomHotspotRefused(undefined, true, withCustom)).toBe(false);
            expect(guestCustomHotspotRefused(null, true, withCustom)).toBe(false);
        });
    });
});
