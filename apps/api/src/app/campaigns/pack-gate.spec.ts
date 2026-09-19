import { packRefused, snapshotPackId, odmRecordAccess, planOdmMigration, odmFlipRefused } from './pack-gate';

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

describe('P0 — odmRecordAccess (co-GM = the odm grant AND role gm; no new feature)', () => {
    it('the owner and admin WRITE', () => {
        expect(odmRecordAccess({ admin: false, isOwner: true, role: 'gm', features: [] })).toBe('write');
        expect(odmRecordAccess({ admin: true, isOwner: false, role: 'admin', features: [] })).toBe('write');
    });
    it('a co-GM — the odm grant AND role gm — READS (THE WRITER: its verbs are intents to the owner)', () => {
        expect(odmRecordAccess({ admin: false, isOwner: false, role: 'gm', features: ['odm'] })).toBe('read');
    });
    it('the odm grant WITHOUT role gm is NOT a co-GM (reaches the record only via the player join path — a LATER phase)', () => {
        expect(odmRecordAccess({ admin: false, isOwner: false, role: 'guest', features: ['odm'] })).toBe('none');
        expect(odmRecordAccess({ admin: false, isOwner: false, role: null, features: ['odm'] })).toBe('none');
    });
    it('role gm WITHOUT the odm grant is nothing here (it is refused upstream at the pack gate)', () => {
        expect(odmRecordAccess({ admin: false, isOwner: false, role: 'gm', features: [] })).toBe('none');
        expect(packRefused('gm', true, false, { packId: 'odm' })).toBe(true); // gm without the odm grant → refused at the pack gate
    });
});

describe('Brick 0 — planOdmMigration (THE record is a PINNED config constant, never inferred)', () => {
    it('an ABSENT pin does nothing (skipped) — no record, no anomalies', () => {
        expect(planOdmMigration(null, ['a', 'b'])).toEqual({ status: 'skipped', recordId: null, anomalies: [], message: expect.stringContaining('not set') });
        expect(planOdmMigration('   ', ['a']).status).toBe('skipped'); // whitespace = unset
    });
    it('a pin that matches NO row is a LOUD ERROR and NO change (never guess a record)', () => {
        const p = planOdmMigration('rec-x', ['a', 'b']);
        expect(p.status).toBe('error');
        expect(p.recordId).toBeNull();
        expect(p.anomalies).toEqual([]);
        expect(p.message).toContain('matches no campaign row');
    });
    it('a pin that matches → THAT row is THE record; every OTHER odm row is an anomaly (never the record)', () => {
        const p = planOdmMigration('rec-1', ['rec-1', 'stray-2', 'stray-3']);
        expect(p.status).toBe('ok');
        expect(p.recordId).toBe('rec-1');
        expect(p.anomalies).toEqual(['stray-2', 'stray-3']);
    });
    it('a pin with no other odm rows flags nothing', () => {
        expect(planOdmMigration('rec-1', ['rec-1'])).toEqual({ status: 'ok', recordId: 'rec-1', anomalies: [], message: expect.any(String) });
    });
});

describe('L1 — odmFlipRefused (the singleton covers UPDATE: a plain campaign can never BECOME ODM)', () => {
    const odm = { packId: 'odm' }, plain = { v: 1 };
    it('a PLAIN row rewritten with an ODM snapshot is REFUSED', () => {
        expect(odmFlipRefused(true, null, odm)).toBe(true);
    });
    it('a row of ANOTHER pack rewritten as ODM is refused too', () => {
        expect(odmFlipRefused(true, 'some-other-pack', odm)).toBe(true);
    });
    it('THE ODM record updating itself is never refused; a plain row staying plain is never refused', () => {
        expect(odmFlipRefused(true, 'odm', odm)).toBe(false);
        expect(odmFlipRefused(true, null, plain)).toBe(false);
        expect(odmFlipRefused(true, null, null)).toBe(false);
    });
    it('ODM → plain is not this rule\'s business', () => {
        expect(odmFlipRefused(true, 'odm', plain)).toBe(false);
    });
    it('dev/LAN (auth off) is exempt — the singleton\'s own posture', () => {
        expect(odmFlipRefused(false, null, odm)).toBe(false);
    });
});
