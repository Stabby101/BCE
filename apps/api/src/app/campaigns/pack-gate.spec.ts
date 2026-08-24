/*
 * DIRECTIVE-ODM-1 Phase 1 — pins the pure pack gate (the IMPORT-1 gate-spec shape): who may persist a
 * pack-tagged snapshot, and that plain campaigns + dev/LAN are never touched.
 */
import { packRefused, snapshotPackId } from './pack-gate';

describe('snapshotPackId', () => {
    it('duck-reads the additive packId defensively', () => {
        expect(snapshotPackId({ packId: 'odm' })).toBe('odm');
        expect(snapshotPackId({ packId: '' })).toBeNull();
        expect(snapshotPackId({ packId: 42 })).toBeNull();
        expect(snapshotPackId({})).toBeNull();
        expect(snapshotPackId(null)).toBeNull();
        expect(snapshotPackId('junk')).toBeNull();
    });
});

describe('packRefused', () => {
    const odm = { packId: 'odm' };
    it('dev/LAN (auth off) never gates — single-tenant unchanged', () => {
        expect(packRefused('guest', false, false, odm)).toBe(false);
        expect(packRefused(undefined, false, false, odm)).toBe(false);
    });
    it('a plain campaign is never gated here', () => {
        expect(packRefused('guest', true, false, {})).toBe(false);
        expect(packRefused('gm', true, false, { packId: null })).toBe(false);
    });
    it('an entitled gm persists a pack campaign', () => {
        expect(packRefused('gm', true, true, odm)).toBe(false);
    });
    it('an UNentitled gm is refused; a guest is refused (guests hold no grants)', () => {
        expect(packRefused('gm', true, false, odm)).toBe(true);
        expect(packRefused('guest', true, false, odm)).toBe(true);
        expect(packRefused(undefined, true, false, odm)).toBe(true);
    });
    it('admin bypasses regardless of grant', () => {
        expect(packRefused('admin', true, false, odm)).toBe(false);
    });
});
