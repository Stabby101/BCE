/*
 * SeatLedgerService — ORDER-13 (2026-09-18). The server-written seat ledger at the DB seam (a real temp DB, deleted after):
 * append-only, oldest-first listing bounded to the newest tail, per-campaign isolation, counts, and the purge that lets the
 * history die with the campaign.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeatLedgerService, SEAT_LEDGER_FAN } from './seat-ledger.service';

describe('SeatLedgerService — ORDER-13 (every seat change is one server-written line)', () => {
    let svc: SeatLedgerService;
    let dir: string;
    const line = (ts: number, verb: 'seat' | 'unseat' | 'claim' | 'release', seat: string, was: string | null, now: string | null) =>
        ({ ts, verb, seat, seatLabel: `label ${seat}`, was, now, actor: 'Owner (GM)', actorKey: 'gm-abc', role: 'owner' as const });

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bce-seatledger-spec-'));
        process.env['BCE_DB_PATH'] = join(dir, 'spec.db');
        svc = new SeatLedgerService();
        svc.onModuleInit();
    });
    afterEach(() => {
        delete process.env['BCE_DB_PATH'];
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* held handles on win are fine — temp dir */ }
    });

    it('nothing recorded → an empty list, a zero count', () => {
        expect(svc.list('c1')).toEqual([]);
        expect(svc.count('c1')).toBe(0);
    });
    it('record returns the stored entry (an id, field "seat", outcome "applied") and list returns it oldest-first with every field intact', () => {
        const a = svc.record('c1', line(100, 'seat', 'u-A', null, 'Alpha'));
        const b = svc.record('c1', line(200, 'claim', 'u-B', null, 'Bravo'));
        expect(a.id).toBeGreaterThan(0);
        expect(b.id).toBeGreaterThan(a.id);
        expect(a).toMatchObject({ field: 'seat', outcome: 'applied', verb: 'seat', seat: 'u-A', seatLabel: 'label u-A', was: null, now: 'Alpha', actor: 'Owner (GM)', actorKey: 'gm-abc', role: 'owner', ts: 100 });
        expect(svc.list('c1')).toEqual([a, b]);
        expect(svc.count('c1')).toBe(2);
    });
    it('campaigns are isolated: another campaign\'s lines never appear', () => {
        svc.record('c1', line(100, 'seat', 'u-A', null, 'Alpha'));
        svc.record('c2', line(100, 'seat', 'u-A', null, 'Zulu'));
        expect(svc.list('c1').map((e) => e.now)).toEqual(['Alpha']);
        expect(svc.list('c2').map((e) => e.now)).toEqual(['Zulu']);
    });
    it('list is bounded to the NEWEST tail (the fan size), still oldest-first; the DB keeps everything (count)', () => {
        for (let i = 1; i <= SEAT_LEDGER_FAN + 5; i++) svc.record('c1', line(i, 'claim', 'u-A', null, `P${i}`));
        const l = svc.list('c1');
        expect(l.length).toBe(SEAT_LEDGER_FAN);
        expect(l[0].ts).toBe(6);
        expect(l[l.length - 1].ts).toBe(SEAT_LEDGER_FAN + 5);
        expect(svc.list('c1', 2).map((e) => e.ts)).toEqual([SEAT_LEDGER_FAN + 4, SEAT_LEDGER_FAN + 5]);
        expect(svc.count('c1')).toBe(SEAT_LEDGER_FAN + 5);
    });
    it('purge removes one campaign\'s history and nothing else (the history dies with the campaign)', () => {
        svc.record('c1', line(100, 'seat', 'u-A', null, 'Alpha'));
        svc.record('c2', line(100, 'seat', 'u-A', null, 'Zulu'));
        svc.purge('c1');
        expect(svc.count('c1')).toBe(0);
        expect(svc.count('c2')).toBe(1);
    });
});
