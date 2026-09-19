/*
 * field-walk-core — S66 the weight class off tonnage (50 t = MEDIUM, never LIGHT) · P8 the manifest load state, said
 * (every part while loading; a failure line the moment a part fails or the 10 s clock runs out; never an infinite loading).
 */
import { weightClassOf, manifestLoadState, WALK_MANIFEST_TIMEOUT_MS, type ManifestParts } from './field-walk-core';

describe('S66 · weightClassOf — the BattleTech bands', () => {
    it('35 = LIGHT · 50 = MEDIUM (the Rifleman, the Talos) · 55 = MEDIUM · 60 = HEAVY · 75 = HEAVY · 80 = ASSAULT · 100 = ASSAULT', () => {
        expect(weightClassOf(20)).toBe('LIGHT');
        expect(weightClassOf(35)).toBe('LIGHT');
        expect(weightClassOf(40)).toBe('MEDIUM');
        expect(weightClassOf(50)).withContext('a 50 t machine is MEDIUM — the S66 report').toBe('MEDIUM');
        expect(weightClassOf(55)).toBe('MEDIUM');
        expect(weightClassOf(60)).toBe('HEAVY');
        expect(weightClassOf(75)).toBe('HEAVY');
        expect(weightClassOf(80)).toBe('ASSAULT');
        expect(weightClassOf(100)).toBe('ASSAULT');
    });
    it('no tonnage → no class (never a default LIGHT)', () => {
        for (const bad of [null, undefined, 0, -5, NaN]) expect(weightClassOf(bad as number)).withContext(String(bad)).toBeNull();
    });
});

describe('P8 · manifestLoadState — the walk says what it waits for', () => {
    const all = (s: ManifestParts['fleet']): ManifestParts => ({ fleet: s, shop: s, catalog: s, equipment: s });
    it('every part ready → ready, no failure', () => {
        const r = manifestLoadState(all('ready'), false);
        expect(r.ready).toBeTrue(); expect(r.failure).toBeNull(); expect(r.parts).toBe('fleet ✓ · shop ✓ · catalog ✓ · equipment ✓');
    });
    it('loading inside the clock → not ready, NO failure line, the parts readout names what is pending', () => {
        const r = manifestLoadState({ fleet: 'ready', shop: 'ready', catalog: 'loading', equipment: 'loading' }, false);
        expect(r.ready).toBeFalse(); expect(r.failure).toBeNull(); expect(r.parts).toBe('fleet ✓ · shop ✓ · catalog … · equipment …');
    });
    it('a failed part → the failure line names it with its status, at once (no clock needed)', () => {
        const r = manifestLoadState({ fleet: 'failed: fleet.json 403', shop: 'ready', catalog: 'loading', equipment: 'loading' }, false);
        expect(r.ready).toBeFalse(); expect(r.failure).toBe('fleet fleet.json 403'); expect(r.parts).toContain('fleet ✗');
        const two = manifestLoadState({ fleet: 'failed: fleet.json 403', shop: 'failed: shop.json 0', catalog: 'ready', equipment: 'ready' }, true);
        expect(two.failure).toBe('fleet fleet.json 403 · shop shop.json 0');
    });
    it('the clock ran out with parts still loading → a timeout failure naming them (never a silent wait)', () => {
        const r = manifestLoadState({ fleet: 'ready', shop: 'ready', catalog: 'loading', equipment: 'loading' }, true);
        expect(r.ready).toBeFalse();
        expect(r.failure).toBe(`timeout after ${WALK_MANIFEST_TIMEOUT_MS / 1000} s — still loading: catalog, equipment`);
        expect(WALK_MANIFEST_TIMEOUT_MS).toBe(10_000);
    });
    it('ready beats a stale clock — a late catalog is not a failure', () => {
        expect(manifestLoadState(all('ready'), true).failure).toBeNull();
    });
});
