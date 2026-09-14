/*
 * DIRECTIVE-IMPORT-1 Part A — the guest-gate decision (pure). Pins that only a guest carrying custom hotspots,
 * with auth required, is refused; every other combination passes.
 */
import { snapshotCustomHotspotCount, guestCustomHotspotRefused, gmOnlyRefused } from './custom-hotspot-gate';

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
        // ── GM-1 P2 — the gmOnly layout counts too (the smuggling bypass the panel caught) ──
        it('counts customHotSpots UNDER gmOnly (a GM-session snapshot), and BOTH layouts summed', () => {
            expect(snapshotCustomHotspotCount({ gmOnly: { customHotSpots: [{ id: 'a' }] } })).toBe(1);
            expect(snapshotCustomHotspotCount({ customHotSpots: [{ id: 'a' }], gmOnly: { customHotSpots: [{ id: 'b' }, { id: 'c' }] } })).toBe(3);
        });
        it('a crafted {gmOnly:{customHotSpots:[...]}} from a GUEST is REFUSED (the chokepoint holds)', () => {
            expect(guestCustomHotspotRefused('guest', true, { gmOnly: { customHotSpots: [{ id: 'smuggled', custom: true }] } })).toBe(true);
        });
        it('a malformed gmOnly (non-object / non-array list) still counts 0 — never throws', () => {
            expect(snapshotCustomHotspotCount({ gmOnly: 'nope' })).toBe(0);
            expect(snapshotCustomHotspotCount({ gmOnly: { customHotSpots: 'nope' } })).toBe(0);
            expect(snapshotCustomHotspotCount({ gmOnly: null })).toBe(0);
        });
    });

    describe('gmOnlyRefused (GM-1 — the gmOnly entitlement belt)', () => {
        const withGmOnly = { gmOnly: { hotSpotOffer: ['hs-1'] } };
        it('REFUSES a non-entitled account persisting a gmOnly-carrying snapshot (guest or gm)', () => {
            expect(gmOnlyRefused('guest', true, false, withGmOnly)).toBe(true);
            expect(gmOnlyRefused('gm', true, false, withGmOnly)).toBe(true);
        });
        it('allows the gm-mode-granted account and any admin', () => {
            expect(gmOnlyRefused('gm', true, true, withGmOnly)).toBe(false);
            expect(gmOnlyRefused('admin', true, false, withGmOnly)).toBe(false);
        });
        it('never gates a snapshot WITHOUT the key, and never parses the contents (any shape gates the same)', () => {
            expect(gmOnlyRefused('guest', true, false, { hotSpotOffer: ['hs-1'] })).toBe(false);
            expect(gmOnlyRefused('guest', true, false, { gmOnly: 'weird' })).toBe(true); // existence, not shape
            expect(gmOnlyRefused('guest', true, false, null)).toBe(false);
        });
        it('does nothing when auth is OFF (dev/LAN — permissive, unchanged)', () => {
            expect(gmOnlyRefused('guest', false, false, withGmOnly)).toBe(false);
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
