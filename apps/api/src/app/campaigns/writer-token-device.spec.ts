import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WriterTokenService, writerDecision, writerFallbackDecision } from './writer-token.service';
import { handTableDecision } from '../claims/ws-authz';
import { seatActorOf } from '../claims/odm-seats';

const DESIGN = 'directives/_overnight/DESIGN-BATON-PER-DEVICE.md';

describe(`P5 · writerDecision per DEVICE (${DESIGN} §3, §7 #1)`, () => {
    const OWNER = 'u-owner', DESK = 'dev-desk', TAB = 'dev-tablet';
    it('the holder DEVICE writes; the SAME account on ANOTHER device does not (the desktop + tablet case)', () => {
        expect(writerDecision({ userId: OWNER, deviceId: DESK, ownerId: OWNER, holder: { userId: OWNER, deviceId: DESK }, admin: false })).toBe(true);
        expect(writerDecision({ userId: OWNER, deviceId: TAB, ownerId: OWNER, holder: { userId: OWNER, deviceId: DESK }, admin: false })).toBe(false);
    });
    it('NO holder ⇒ nobody writes (ruling 1: the first owner device TAKES it on join / first write — a take, not a default)', () => {
        expect(writerDecision({ userId: OWNER, deviceId: DESK, ownerId: OWNER, holder: null, admin: false })).toBe(false);
    });
    it('a legacy account-level row (deviceId null) means "any DEVICE of that account" — the migration window (§8)', () => {
        expect(writerDecision({ userId: OWNER, deviceId: DESK, ownerId: OWNER, holder: { userId: OWNER, deviceId: null }, admin: false })).toBe(true);
        expect(writerDecision({ userId: OWNER, deviceId: TAB, ownerId: OWNER, holder: { userId: OWNER, deviceId: null }, admin: false })).toBe(true);
        expect(writerDecision({ userId: 'u-ryan', deviceId: TAB, ownerId: OWNER, holder: { userId: OWNER, deviceId: null }, admin: false })).toBe(false);
    });
    it('a PUT with NO device id (a cached bundle) is REFUSED from day one — even against a legacy row (ruling 8; the design had a window)', () => {
        expect(writerDecision({ userId: OWNER, deviceId: null, ownerId: OWNER, holder: { userId: OWNER, deviceId: null }, admin: false })).toBe(false);
        expect(writerDecision({ userId: OWNER, deviceId: null, ownerId: OWNER, holder: { userId: OWNER, deviceId: DESK }, admin: false })).toBe(false);
        expect(writerDecision({ userId: OWNER, ownerId: OWNER, holder: { userId: OWNER, deviceId: DESK }, admin: false })).toBe(false); // absent altogether
    });
    it('admin always writes (support / break-glass) — unchanged', () => {
        expect(writerDecision({ userId: 'u-adm', deviceId: 'dev-x', ownerId: OWNER, holder: { userId: OWNER, deviceId: DESK }, admin: true })).toBe(true);
        expect(writerDecision({ userId: 'u-adm', deviceId: null, ownerId: OWNER, holder: null, admin: true })).toBe(true);
    });
});

describe(`P5 · handTableDecision per DEVICE (${DESIGN} §3 "Take it here", §7 #3)`, () => {
    const OWNER = 'u-owner', RYAN = 'u-ryan';
    const readers = [{ userId: OWNER, deviceId: 'dev-tablet' }, { userId: RYAN, deviceId: 'dev-ryan-phone' }];
    it('the OWNER takes the table to ANY of its connected devices — "take" (it can never be locked out)', () => {
        expect(handTableDecision({ toUserId: OWNER, toDeviceId: 'dev-tablet', callerId: OWNER, ownerId: OWNER, holder: { userId: RYAN, deviceId: 'dev-ryan-phone' }, readers })).toBe('take');
        expect(handTableDecision({ toUserId: OWNER, toDeviceId: 'dev-tablet', callerId: OWNER, ownerId: OWNER, holder: null, readers })).toBe('take'); // nobody holds it — still a take
    });
    it('the HOLDER account moves the baton between its OWN connected devices — "move"; a stranger cannot', () => {
        expect(handTableDecision({ toUserId: RYAN, toDeviceId: 'dev-ryan-phone', callerId: RYAN, ownerId: OWNER, holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, readers })).toBe('move');
        expect(handTableDecision({ toUserId: RYAN, toDeviceId: 'dev-ryan-phone', callerId: 'u-stranger', ownerId: OWNER, holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: OWNER, toDeviceId: 'dev-tablet', callerId: RYAN, ownerId: OWNER, holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, readers })).toBe('deny'); // a holder cannot hand it to the owner — the owner takes
    });
    it('the owner hands to a co-GM\'s SPECIFIC connected device — "hand"; an unconnected device or an unknown account — "deny"', () => {
        expect(handTableDecision({ toUserId: RYAN, toDeviceId: 'dev-ryan-phone', callerId: OWNER, ownerId: OWNER, holder: { userId: OWNER, deviceId: 'dev-desk' }, readers })).toBe('hand');
        expect(handTableDecision({ toUserId: RYAN, toDeviceId: 'dev-ryan-desk', callerId: OWNER, ownerId: OWNER, holder: { userId: OWNER, deviceId: 'dev-desk' }, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: 'u-nobody', toDeviceId: 'dev-z', callerId: OWNER, ownerId: OWNER, holder: { userId: OWNER, deviceId: 'dev-desk' }, readers })).toBe('deny');
    });
    it('an ADMIN caller acts like the owner (callerIsGm); an empty target or caller is denied', () => {
        expect(handTableDecision({ toUserId: 'u-adm', toDeviceId: 'dev-adm', callerId: 'u-adm', ownerId: OWNER, holder: null, readers: [...readers, { userId: 'u-adm', deviceId: 'dev-adm' }], callerIsGm: true })).toBe('take');
        expect(handTableDecision({ toUserId: RYAN, toDeviceId: 'dev-ryan-phone', callerId: 'u-adm', ownerId: OWNER, holder: null, readers, callerIsGm: true })).toBe('hand');
        expect(handTableDecision({ toUserId: '', toDeviceId: 'dev-tablet', callerId: OWNER, ownerId: OWNER, holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: OWNER, toDeviceId: null, callerId: OWNER, ownerId: OWNER, holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: OWNER, toDeviceId: 'dev-tablet', callerId: undefined, ownerId: OWNER, holder: null, readers })).toBe('deny');
    });
});

describe(`P5 · writerFallbackDecision (${DESIGN} §5, ruling 3)`, () => {
    const OWNER = 'u-owner', RYAN = 'u-ryan';
    it('the holder device is gone: (a) another connected device of the SAME account keeps the table', () => {
        expect(writerFallbackDecision({ holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, ownerId: OWNER, connected: [{ userId: OWNER, deviceId: 'dev-desk' }, { userId: RYAN, deviceId: 'dev-ryan-phone' }] })).toEqual({ userId: RYAN, deviceId: 'dev-ryan-phone' });
    });
    it('(b) else a connected OWNER device', () => {
        expect(writerFallbackDecision({ holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, ownerId: OWNER, connected: [{ userId: OWNER, deviceId: 'dev-tablet' }, { userId: 'u-other', deviceId: 'dev-o' }] })).toEqual({ userId: OWNER, deviceId: 'dev-tablet' });
    });
    it('(c) else RELEASED (null) — the next owner device to join takes it', () => {
        expect(writerFallbackDecision({ holder: { userId: RYAN, deviceId: 'dev-ryan-desk' }, ownerId: OWNER, connected: [{ userId: 'u-other', deviceId: 'dev-o' }] })).toBeNull();
        expect(writerFallbackDecision({ holder: { userId: OWNER, deviceId: 'dev-desk' }, ownerId: OWNER, connected: [] })).toBeNull();
    });
    it('the holder device itself, still named by a stale list, is never re-picked (it left — that is why the grace expired)', () => {
        expect(writerFallbackDecision({ holder: { userId: OWNER, deviceId: 'dev-desk' }, ownerId: OWNER, connected: [{ userId: OWNER, deviceId: 'dev-desk' }] })).toBeNull();
    });
});

describe(`P5 · WriterTokenService holds a PAIR (${DESIGN} §7 #13, §8)`, () => {
    let dbFile: string; let prev: string | undefined;
    beforeEach(() => { prev = process.env.BCE_DB_PATH; dbFile = join(tmpdir(), `bce-writer-dev-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`); process.env.BCE_DB_PATH = dbFile; });
    afterEach(() => { if (prev === undefined) delete process.env.BCE_DB_PATH; else process.env.BCE_DB_PATH = prev; for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* */ } } });
    it('hand stores { userId, deviceId }; holderOf returns the pair; release clears it; a reboot boot-loads the pair', () => {
        const w = new WriterTokenService(); w.onModuleInit();
        expect(w.holderOf('c1')).toBeNull();
        w.hand('c1', { userId: 'u-ryan', deviceId: 'dev-ryan-phone' }, 100);
        expect(w.holderOf('c1')).toEqual({ userId: 'u-ryan', deviceId: 'dev-ryan-phone' });
        const again = new WriterTokenService(); again.onModuleInit();
        expect(again.holderOf('c1')).toEqual({ userId: 'u-ryan', deviceId: 'dev-ryan-phone' });
        w.release('c1');
        expect(w.holderOf('c1')).toBeNull();
    });
    it('the boot migration adds deviceId to a pre-existing account-level table; the old row reads as deviceId null (§8)', () => {
        const db = new DatabaseSync(dbFile);
        db.exec('CREATE TABLE writer_token (campaignId TEXT NOT NULL PRIMARY KEY, holderId TEXT NOT NULL, at INTEGER);');
        db.prepare('INSERT INTO writer_token (campaignId, holderId, at) VALUES (?, ?, ?)').run('c-live', 'u-ryan', 1);
        db.close();
        const w = new WriterTokenService(); w.onModuleInit();
        expect(w.holderOf('c-live')).toEqual({ userId: 'u-ryan', deviceId: null });
        w.hand('c-live', { userId: 'u-ryan', deviceId: 'dev-ryan-phone' }, 2); // the next take sets a device
        expect(w.holderOf('c-live')).toEqual({ userId: 'u-ryan', deviceId: 'dev-ryan-phone' });
    });
});

describe(`P5 · a baton-holding co-GM SEATS (${DESIGN} §6, ruling 5)`, () => {
    const anon = (s: string) => `h(${s})`;
    it('seatActorOf names the writer-device co-GM with role "co-gm"', () => {
        expect(seatActorOf({ authRequired: true, gm: { userId: 'u-ryan', displayName: 'Ryan', admin: false }, ownerId: 'u-owner', isWriterDevice: true, player: null, anon })).toEqual({ actor: 'Ryan (GM)', actorKey: 'gm-h(u-ryan)', role: 'co-gm' });
    });
    it('the owner is "owner" on the writer device and "owner-reading" on any other (ruling 4 — it still seats, the ledger says which)', () => {
        const james = { userId: 'u-owner', displayName: 'James', admin: false };
        expect(seatActorOf({ authRequired: true, gm: james, ownerId: 'u-owner', isWriterDevice: true, player: null, anon }).role).toBe('owner');
        expect(seatActorOf({ authRequired: true, gm: james, ownerId: 'u-owner', isWriterDevice: false, player: null, anon }).role).toBe('owner-reading');
    });
});
