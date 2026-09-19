import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampaignsService, type Viewer, type SaveRecord } from './campaigns.service';

describe('CampaignsService — the ONE ODM record by role (P0 · A2/A3)', () => {
    let svc: CampaignsService;
    let dbFile: string;
    const prev: Record<string, string | undefined> = {};

    const owner: Viewer = { ownerId: 'owner-1', admin: false, role: 'gm', features: ['odm'] };
    const coGm: Viewer = { ownerId: 'cogm-1', admin: false, role: 'gm', features: ['odm'] };
    const plain: Viewer = { ownerId: 'plain-1', admin: false, role: 'gm', features: [] };
    const other: Viewer = { ownerId: 'other-1', admin: false, role: 'gm', features: [] };
    const odmRec = (id: string): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot: { packId: 'odm', v: 1 } });
    const plainRec = (id: string): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot: { v: 1 } });

    beforeEach(() => {
        for (const k of ['BCE_DB_PATH', 'BCE_AUTH_REQUIRED', 'ODM_RECORD_ID']) prev[k] = process.env[k];
        dbFile = join(tmpdir(), `bce-odm26acc-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        process.env.BCE_AUTH_REQUIRED = '1'; // the tenancy boundary only exists when auth is required
        delete process.env.ODM_RECORD_ID;    // no pin by default (dev/scratch: any odm row is readable by a co-GM)
        svc = new CampaignsService();
        svc.onModuleInit();
    });
    afterEach(() => {
        for (const k of ['BCE_DB_PATH', 'BCE_AUTH_REQUIRED', 'ODM_RECORD_ID']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* best-effort */ } }
    });

    it('READ widens to a co-GM: get() returns THE record and list() includes it (A2)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(svc.get('the-odm', coGm)?.id).toBe('the-odm');
        expect(svc.list(coGm).map((r) => r.id)).toContain('the-odm');
    });

    it('the OWNER reads and writes THE record (unchanged)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(svc.get('the-odm', owner)?.id).toBe('the-odm');
        expect(() => svc.upsert({ ...odmRec('the-odm'), name: 'renamed' }, owner)).not.toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('renamed');
    });

    it('WRITE stays owner-only: a co-GM upsert of THE record is REFUSED (the one-writer law)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(() => svc.upsert({ ...odmRec('the-odm'), name: 'cogm-edit' }, coGm)).toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('the-odm'); // unchanged on the server
    });

    it('DELETE stays owner-only: a co-GM remove of THE record is a no-op', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(svc.remove('the-odm', coGm)).toBe(false);
        expect(svc.get('the-odm', owner)?.id).toBe('the-odm'); // still there
    });

    it('the odm grant WITHOUT role gm is NOT a co-GM read (reaches the record only via the player path — a LATER phase)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        const guestWithOdm: Viewer = { ownerId: 'g-1', admin: false, role: 'guest', features: ['odm'] };
        expect(svc.get('the-odm', guestWithOdm)).toBeNull();
        expect(svc.list(guestWithOdm).map((r) => r.id)).not.toContain('the-odm');
    });

    it('a PLAIN gm (no odm grant) cannot read THE record — 404-shaped null, and it is not in the list', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(svc.get('the-odm', plain)).toBeNull();
        expect(svc.list(plain).map((r) => r.id)).not.toContain('the-odm');
    });

    it('the widening is ODM-ONLY: a co-GM never reads another owner\'s PLAIN campaign', () => {
        svc.upsert(plainRec('someones-plain'), other);
        expect(svc.get('someones-plain', coGm)).toBeNull();
        expect(svc.list(coGm).map((r) => r.id)).not.toContain('someones-plain');
    });

    it('the ODM_RECORD_ID pin narrows a co-GM READ to THE record; an anomaly odm row is invisible to the co-GM, visible to its owner (A3)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        svc.upsert(odmRec('anomaly-odm'), owner, { forceNew: true }); // the owner's escape mints the stray second row
        process.env.ODM_RECORD_ID = 'the-odm';
        expect(svc.get('the-odm', coGm)?.id).toBe('the-odm');   // the pinned record — readable
        expect(svc.get('anomaly-odm', coGm)).toBeNull();        // the anomaly — NOT the record, invisible to a co-GM
        expect(svc.get('anomaly-odm', owner)?.id).toBe('anomaly-odm'); // the owner is never gated by the pin
    });

    it('P3b: a pinned host marks THE record `odmRecord` on list() + get() + the upsert reply — and NO other row', () => {
        svc.upsert(odmRec('the-odm'), owner);
        svc.upsert(odmRec('anomaly-odm'), owner, { forceNew: true });
        svc.upsert(plainRec('plain-1'), owner);
        process.env.ODM_RECORD_ID = 'the-odm';
        const marked = (rows: SaveRecord[]) => rows.filter((r) => r.odmRecord === true).map((r) => r.id);
        expect(marked(svc.list(owner))).toEqual(['the-odm']);
        expect(marked(svc.list(coGm))).toEqual(['the-odm']);      // what the co-GM's door keys on
        expect(svc.get('the-odm', coGm)?.odmRecord).toBe(true);
        expect(svc.get('anomaly-odm', owner)?.odmRecord).toBeUndefined(); // absent, never false
        expect(svc.upsert({ ...odmRec('the-odm'), name: 'again' }, owner).odmRecord).toBe(true);
    });
    it('P3b: a co-GM that OWNS a stale odm row lists its stray UNMARKED beside THE record MARKED (the door\'s fixture, at the seam)', () => {
        // A LEGACY stray predates the singleton, so it cannot be minted through it: seed both rows with the guard
        // off (it only applies auth-on; upsert still stamps each viewer as the owner), then turn auth back on.
        process.env.BCE_AUTH_REQUIRED = '0';
        svc.upsert(odmRec('cogm-stray'), coGm);
        svc.upsert(odmRec('the-odm'), owner);
        process.env.BCE_AUTH_REQUIRED = '1';
        process.env.ODM_RECORD_ID = 'the-odm';
        const rows = svc.list(coGm).filter((r) => (r.snapshot as { packId?: string })?.packId === 'odm');
        expect(rows.map((r) => r.id).sort()).toEqual(['cogm-stray', 'the-odm']); // the fixture is well-formed: both rows reach the co-GM
        const the = rows.find((r) => r.id === 'the-odm'), stray = rows.find((r) => r.id === 'cogm-stray');
        expect(the?.odmRecord).toBe(true);
        expect(the?.ownerId).toBe('owner-1');
        expect(stray?.odmRecord).toBeUndefined();
        expect(stray?.ownerId).toBe('cogm-1');
    });
    it('L1: a PLAIN campaign cannot be FLIPPED to ODM by an update — refused, and the stored row stays plain', () => {
        svc.upsert(odmRec('the-odm'), owner);
        svc.upsert(plainRec('cogm-plain'), coGm);
        expect(svc.get('cogm-plain', coGm)?.id).toBe('cogm-plain'); // the fixture is well-formed: the plain row exists and is the co-GM's
        expect(() => svc.upsert({ ...plainRec('cogm-plain'), snapshot: { packId: 'odm', v: 2 } }, coGm)).toThrow(/cannot be turned into an ODM campaign/);
        expect((svc.get('cogm-plain', coGm)?.snapshot as { packId?: string }).packId).toBeUndefined();
        expect(svc.list(owner).filter((r) => (r.snapshot as { packId?: string })?.packId === 'odm').map((r) => r.id)).toEqual(['the-odm']); // still ONE ODM in the world
        expect(() => svc.upsert({ ...plainRec('cogm-plain'), name: 'still plain' }, coGm)).not.toThrow(); // a plain update is untouched
    });
    it('L1: the flip is refused even when NO ODM exists yet (the rule is about the row, not the count) and for the owner of THE record too', () => {
        svc.upsert(plainRec('owner-plain'), owner);
        expect(() => svc.upsert({ ...plainRec('owner-plain'), snapshot: { packId: 'odm', v: 2 } }, owner)).toThrow(/cannot be turned into an ODM campaign/);
    });

    it('P3b: an UN-PINNED host marks nothing (the door keeps its routing)', () => {
        svc.upsert(odmRec('the-odm'), owner);
        expect(svc.list(owner).some((r) => 'odmRecord' in r)).toBe(false);
        expect(svc.get('the-odm', coGm)?.odmRecord).toBeUndefined();
    });
});
