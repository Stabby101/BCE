import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriterTokenService, writerDecision } from './writer-token.service';
import { CampaignsService, type Viewer, type SaveRecord } from './campaigns.service';

describe('writerDecision (the pure baton gate — per DEVICE)', () => {
    const HOLD = { userId: 'o', deviceId: 'dev-desk' };
    it('admin always writes (support / break-glass)', () => {
        expect(writerDecision({ userId: 'x', deviceId: 'dev-x', ownerId: 'o', holder: { userId: 'someone-else', deviceId: 'dev-y' }, admin: true })).toBe(true);
    });
    it('NO holder ⇒ nobody writes — not even the owner (the take happens at join / on the first write, Q1)', () => {
        expect(writerDecision({ userId: 'o', deviceId: 'dev-desk', ownerId: 'o', holder: null, admin: false })).toBe(false);
        expect(writerDecision({ userId: 'other', deviceId: 'dev-o', ownerId: 'o', holder: null, admin: false })).toBe(false);
    });
    it('the holder DEVICE writes; the same account on ANOTHER device does not; a third party does not', () => {
        expect(writerDecision({ userId: 'o', deviceId: 'dev-desk', ownerId: 'o', holder: HOLD, admin: false })).toBe(true);
        expect(writerDecision({ userId: 'o', deviceId: 'dev-tablet', ownerId: 'o', holder: HOLD, admin: false })).toBe(false);
        expect(writerDecision({ userId: 'cogm', deviceId: 'dev-desk', ownerId: 'o', holder: HOLD, admin: false })).toBe(false);
    });
    it('a co-GM handed the table writes on THAT device; the owner (now not the holder) does NOT', () => {
        const ryan = { userId: 'cogm', deviceId: 'dev-ryan' };
        expect(writerDecision({ userId: 'cogm', deviceId: 'dev-ryan', ownerId: 'o', holder: ryan, admin: false })).toBe(true);
        expect(writerDecision({ userId: 'o', deviceId: 'dev-desk', ownerId: 'o', holder: ryan, admin: false })).toBe(false);
    });
    it('a null owner AND no holder ⇒ nobody writes here (a legacy unowned row)', () => {
        expect(writerDecision({ userId: 'anyone', deviceId: 'dev-a', ownerId: null, holder: null, admin: false })).toBe(false);
    });
});

describe('WriterTokenService (real temp DB) — the holder is a PAIR', () => {
    let writer: WriterTokenService;
    let dbFile: string;
    let prev: string | undefined;
    beforeEach(() => {
        prev = process.env.BCE_DB_PATH;
        dbFile = join(tmpdir(), `bce-writer-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        writer = new WriterTokenService();
        writer.onModuleInit();
    });
    afterEach(() => {
        if (prev === undefined) delete process.env.BCE_DB_PATH; else process.env.BCE_DB_PATH = prev;
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* */ } }
    });

    it('defaults to NO holder, hand + release move the pair', () => {
        expect(writer.holderOf('c1')).toBeNull();
        writer.hand('c1', { userId: 'cogm', deviceId: 'dev-ryan' }, 1);
        expect(writer.holderOf('c1')).toEqual({ userId: 'cogm', deviceId: 'dev-ryan' });
        writer.release('c1');
        expect(writer.holderOf('c1')).toBeNull();
    });
    it('releaseHeldBy frees ONLY the campaigns that account holds (any device), and reports them', () => {
        writer.hand('c1', { userId: 'cogm', deviceId: 'dev-1' }, 1);
        writer.hand('c2', { userId: 'cogm', deviceId: 'dev-2' }, 1);
        writer.hand('c3', { userId: 'other', deviceId: 'dev-3' }, 1);
        expect(writer.releaseHeldBy('cogm').sort()).toEqual(['c1', 'c2']);
        expect(writer.holderOf('c1')).toBeNull();
        expect(writer.holderOf('c2')).toBeNull();
        expect(writer.holderOf('c3')).toEqual({ userId: 'other', deviceId: 'dev-3' }); // untouched
    });
    it('heldBy reports without releasing — by account, or by THIS device only (the disconnect path asks per device)', () => {
        writer.hand('c-held-1', { userId: 'cogm-h', deviceId: 'dev-a' }, 1);
        writer.hand('c-held-2', { userId: 'cogm-h', deviceId: 'dev-b' }, 2);
        writer.hand('c-other', { userId: 'cogm-x', deviceId: 'dev-a' }, 3);
        expect(writer.heldBy('cogm-h').sort()).toEqual(['c-held-1', 'c-held-2']);
        expect(writer.heldBy('cogm-h', 'dev-a')).toEqual(['c-held-1']);
        expect(writer.heldBy('cogm-h', 'dev-z')).toEqual([]);
        expect(writer.holderOf('c-held-1')).toEqual({ userId: 'cogm-h', deviceId: 'dev-a' }); // nothing moved
        expect(writer.heldBy('nobody')).toEqual([]);
    });
    it('the token PERSISTS — a fresh instance boot-loads the held pair', () => {
        writer.hand('c1', { userId: 'cogm', deviceId: 'dev-ryan' }, 7);
        const reboot = new WriterTokenService();
        reboot.onModuleInit();
        expect(reboot.holderOf('c1')).toEqual({ userId: 'cogm', deviceId: 'dev-ryan' });
    });
});

describe('CampaignsService.upsert — THE BATON write-fork (ODM-scoped, per DEVICE)', () => {
    let svc: CampaignsService;
    let writer: WriterTokenService;
    let dbFile: string;
    const prev: Record<string, string | undefined> = {};
    const owner: Viewer = { ownerId: 'owner-1', admin: false, role: 'gm', features: ['odm'], deviceId: 'dev-desk' };
    const ownerTablet: Viewer = { ...owner, deviceId: 'dev-tablet' };
    const ownerOldBundle: Viewer = { ...owner, deviceId: null }; // a cached bundle: no x-bce-device header
    const coGm: Viewer = { ownerId: 'cogm-1', admin: false, role: 'gm', features: ['odm'], deviceId: 'dev-ryan' };
    const admin: Viewer = { ownerId: 'admin-1', admin: true, role: 'admin', features: [], deviceId: 'dev-adm' };
    const odm = (id: string, name = id): SaveRecord => ({ id, name, savedAt: 1, version: 1, summary: '', snapshot: { packId: 'odm', v: 1 } });
    const plain = (id: string): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot: { v: 1 } });

    beforeEach(() => {
        for (const k of ['BCE_DB_PATH', 'BCE_AUTH_REQUIRED']) prev[k] = process.env[k];
        dbFile = join(tmpdir(), `bce-baton-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        process.env.BCE_AUTH_REQUIRED = '1';
        writer = new WriterTokenService();
        writer.onModuleInit();
        svc = new CampaignsService(writer);
        svc.onModuleInit();
        svc.upsert(odm('the-odm'), owner); // the owner mints THE record (a CREATE — no holder yet)
    });
    afterEach(() => {
        for (const k of ['BCE_DB_PATH', 'BCE_AUTH_REQUIRED']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* */ } }
    });

    it('THE TAKE ON FIRST WRITE (Q1): the record is created with NO holder; the owner\'s first write on it takes the table for THAT device', () => {
        expect(writer.holderOf('the-odm')).toBeNull();
        const seen: string[] = []; svc.writerChanges$.subscribe((id) => seen.push(id));
        expect(() => svc.upsert(odm('the-odm', 'by-desk'), owner)).not.toThrow();
        expect(writer.holderOf('the-odm')).toEqual({ userId: 'owner-1', deviceId: 'dev-desk' });
        expect(seen).toEqual(['the-odm']); // the gateway fans `writer` off this
        expect(svc.get('the-odm', owner)?.name).toBe('by-desk');
    });
    it('the SAME account on ANOTHER device is REFUSED once a device holds it (FACT B is impossible), and a co-GM cannot write', () => {
        svc.upsert(odm('the-odm', 'by-desk'), owner);
        expect(() => svc.upsert(odm('the-odm', 'by-tablet'), ownerTablet)).toThrow();
        expect(() => svc.upsert(odm('the-odm', 'by-cogm'), coGm)).toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('by-desk'); // unchanged
    });
    it('a cached bundle (no device id) NEVER takes and NEVER writes — refused from day one (ruling 8)', () => {
        expect(() => svc.upsert(odm('the-odm', 'old'), ownerOldBundle)).toThrow();
        expect(writer.holderOf('the-odm')).toBeNull(); // it did not take the table either
        svc.upsert(odm('the-odm', 'by-desk'), owner);
        expect(() => svc.upsert(odm('the-odm', 'old-2'), ownerOldBundle)).toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('by-desk');
    });
    it('HAND to the co-GM\'s device: that device writes, the OWNER (now not the holder) is REFUSED, the record stays the owner\'s', () => {
        writer.hand('the-odm', { userId: 'cogm-1', deviceId: 'dev-ryan' }, 1);
        expect(() => svc.upsert(odm('the-odm', 'by-cogm'), coGm)).not.toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('by-cogm');
        expect(svc.get('the-odm', owner)?.ownerId).toBe('owner-1');
        expect(() => svc.upsert(odm('the-odm', 'by-owner-2'), owner)).toThrow();
        expect(() => svc.upsert(odm('the-odm', 'by-cogm-phone'), { ...coGm, deviceId: 'dev-ryan-phone' })).toThrow(); // the co-GM's OTHER device, too
    });
    it('RELEASE (nobody holds it): the next owner device to write TAKES it; a co-GM still cannot', () => {
        writer.hand('the-odm', { userId: 'cogm-1', deviceId: 'dev-ryan' }, 1);
        writer.release('the-odm');
        expect(() => svc.upsert(odm('the-odm', 'nope'), coGm)).toThrow();
        expect(() => svc.upsert(odm('the-odm', 'tablet-takes'), ownerTablet)).not.toThrow();
        expect(writer.holderOf('the-odm')).toEqual({ userId: 'owner-1', deviceId: 'dev-tablet' });
        expect(svc.get('the-odm', owner)?.name).toBe('tablet-takes');
    });
    it('ADMIN always writes, even while a co-GM device holds the baton (break-glass); an admin\'s first write on a free record takes it', () => {
        writer.hand('the-odm', { userId: 'cogm-1', deviceId: 'dev-ryan' }, 1);
        expect(() => svc.upsert(odm('the-odm', 'by-admin'), admin)).not.toThrow();
        expect(svc.get('the-odm', owner)?.name).toBe('by-admin');
        expect(writer.holderOf('the-odm')).toEqual({ userId: 'cogm-1', deviceId: 'dev-ryan' }); // break-glass moves nothing
    });
    it('the fork is ODM-ONLY: a plain campaign is unchanged (owner writes on any device, a stranger cannot; the baton never applies)', () => {
        svc.upsert(plain('plainrec'), owner);
        writer.hand('plainrec', { userId: 'cogm-1', deviceId: 'dev-ryan' }, 1); // even a (nonsensical) baton on a plain row changes nothing
        expect(() => svc.upsert(plain('plainrec'), ownerTablet)).not.toThrow();  // the owner still writes, any device
        expect(() => svc.upsert(plain('plainrec'), ownerOldBundle)).not.toThrow(); // …and without a device id (no belt here)
        expect(() => svc.upsert(plain('plainrec'), coGm)).toThrow();              // a non-owner still cannot (canAccess)
    });
});
