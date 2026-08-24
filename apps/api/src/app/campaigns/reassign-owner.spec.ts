/*
 * DIRECTIVE-LINK-1 — CampaignsService.reassignOwner (the lossless guest→account re-own), at the DB seam
 * (a real temp DB, deleted after). Pins: additive re-own, MERGE into an existing owner, idempotency, the
 * "last" pointer transfer (keep the target's own), and the no-op/fail-safe edge cases.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampaignsService, type Viewer, type SaveRecord } from './campaigns.service';

describe('CampaignsService.reassignOwner (LINK-1)', () => {
    let svc: CampaignsService;
    let dbFile: string;
    let prevPath: string | undefined;
    const guest: Viewer = { ownerId: 'gst-1', admin: false };
    const gm: Viewer = { ownerId: 'usr-1', admin: false };
    const rec = (id: string): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot: { v: 1 } });

    beforeEach(() => {
        prevPath = process.env.BCE_DB_PATH;
        dbFile = join(tmpdir(), `bce-reassign-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        svc = new CampaignsService();
        svc.onModuleInit();
    });
    afterEach(() => {
        if (prevPath === undefined) delete process.env.BCE_DB_PATH; else process.env.BCE_DB_PATH = prevPath;
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* best-effort */ } }
    });

    it('re-owns ALL of the guest\'s campaigns to the account (guest ends with none)', () => {
        svc.upsert(rec('c1'), guest);
        svc.upsert(rec('c2'), guest);
        expect(svc.reassignOwner('gst-1', 'usr-1')).toBe(2);
        expect(svc.list(gm).map((r) => r.id).sort()).toEqual(['c1', 'c2']);
        expect(svc.list(guest)).toEqual([]);
    });

    it('MERGES into an existing account — its own campaigns stay, gains the guest\'s', () => {
        svc.upsert(rec('own-1'), gm);      // the returning OAuth user's existing campaign
        svc.upsert(rec('guest-1'), guest); // the guest's campaign
        expect(svc.reassignOwner('gst-1', 'usr-1')).toBe(1);
        expect(svc.list(gm).map((r) => r.id).sort()).toEqual(['guest-1', 'own-1']); // both, no collision
    });

    it('is idempotent + a no-op on missing/equal owners (fail-safe: never throws, never loses)', () => {
        svc.upsert(rec('c1'), guest);
        expect(svc.reassignOwner('gst-1', 'usr-1')).toBe(1);
        expect(svc.reassignOwner('gst-1', 'usr-1')).toBe(0);   // nothing left under the guest → no-op
        expect(svc.reassignOwner('usr-1', 'usr-1')).toBe(0);   // equal owners → no-op
        expect(svc.reassignOwner('', 'usr-1')).toBe(0);        // empty from → no-op
        expect(svc.reassignOwner('nobody', 'usr-1')).toBe(0);  // unknown owner → no-op
        expect(svc.list(gm).map((r) => r.id)).toEqual(['c1']); // data intact throughout
    });

    it('transfers the guest\'s "last" pointer when the account has none, and clears the guest\'s', () => {
        svc.upsert(rec('c1'), guest);
        svc.setLast('c1', guest);
        svc.reassignOwner('gst-1', 'usr-1');
        expect(svc.getLast(gm)).toBe('c1');    // adopted
        expect(svc.getLast(guest)).toBeNull();  // cleared
    });

    it('KEEPS the account\'s own "last" pointer on merge (does not clobber it)', () => {
        svc.upsert(rec('own-1'), gm);
        svc.upsert(rec('guest-1'), guest);
        svc.setLast('own-1', gm);
        svc.setLast('guest-1', guest);
        svc.reassignOwner('gst-1', 'usr-1');
        expect(svc.getLast(gm)).toBe('own-1');  // the returning user's own last is preserved
        expect(svc.getLast(guest)).toBeNull();
    });
});
