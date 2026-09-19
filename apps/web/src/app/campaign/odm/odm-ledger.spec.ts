import { appendLedger, filterLedger, ledgerActors, mergeLedgers, ODM_LEDGER_CAP, type OdmLedgerEntry } from './odm-ledger';

describe('odm-ledger — P3 (the actor ledger)', () => {
    const e = (n: number, actor: string, actorKey: string): OdmLedgerEntry => ({ ts: n, actor, actorKey, seat: 'unit-A', seatLabel: 'Atlas', field: 'pilot name', was: 'a', now: 'b', verb: 'rename-pilot', outcome: 'applied' });

    it('appendLedger appends newest-last and never mutates its input', () => {
        const before = [e(1, 'Alpha', 'k-a')];
        const after = appendLedger(before, e(2, 'Bravo', 'k-b'));
        expect(after.map((x) => x.ts)).toEqual([1, 2]);
        expect(before.length).toBe(1);
        expect(appendLedger(null, e(1, 'Alpha', 'k-a')).length).toBe(1);
    });
    it('appendLedger is BOUNDED — the newest entries win', () => {
        let list: OdmLedgerEntry[] = [];
        for (let i = 1; i <= ODM_LEDGER_CAP + 3; i++) list = appendLedger(list, e(i, 'Alpha', 'k-a'));
        expect(list.length).toBe(ODM_LEDGER_CAP);
        expect(list[0].ts).toBe(4);
        expect(list[list.length - 1].ts).toBe(ODM_LEDGER_CAP + 3);
    });
    it('three intents from two players → three entries, correct actors; the filter returns each player’s own, newest first', () => {
        const list = [e(1, 'Alpha', 'k-a'), e(2, 'Bravo', 'k-b'), e(3, 'Alpha', 'k-a')];
        expect(filterLedger(list, null).map((x) => x.ts)).toEqual([3, 2, 1]);
        expect(filterLedger(list, 'k-a').map((x) => x.ts)).toEqual([3, 1]);
        expect(filterLedger(list, 'k-b').map((x) => x.actor)).toEqual(['Bravo']);
        expect(filterLedger(list, 'k-nobody')).toEqual([]);
    });
    it('ledgerActors keys on the HANDLE, not the name: two devices both called "Alpha" are two rows; a renamed device is one', () => {
        const list = [e(1, 'Alpha', 'k-1'), e(2, 'Alpha', 'k-2'), e(3, 'Alpha Prime', 'k-1')];
        expect(ledgerActors(list)).toEqual([{ key: 'k-1', name: 'Alpha Prime', count: 2 }, { key: 'k-2', name: 'Alpha', count: 1 }]);
        expect(ledgerActors(null)).toEqual([]);
    });
    // ORDER-13 — ONE view over two ledgers: the snapshot's (the writer device's) and the SERVER's seat ledger.
    it('mergeLedgers interleaves the two by time, stable on a tie (snapshot first), never mutating either input', () => {
        const snap = [e(1, 'Alpha', 'k-a'), e(5, 'Bravo', 'k-b')];
        const srv: OdmLedgerEntry[] = [{ ...e(3, 'James (GM)', 'gm-x'), verb: 'seat', field: 'seat', id: 7, role: 'owner-reading' }, { ...e(5, 'Alpha', 'k-a'), verb: 'claim', field: 'seat', id: 8, role: 'player' }];
        const m = mergeLedgers(snap, srv);
        expect(m.map((x) => [x.ts, x.verb])).toEqual([[1, 'rename-pilot'], [3, 'seat'], [5, 'rename-pilot'], [5, 'claim']]);
        expect(m[1].role).toBe('owner-reading');
        expect(snap.length).toBe(2); expect(srv.length).toBe(2);
        expect(mergeLedgers(null, undefined)).toEqual([]);
        expect(mergeLedgers(snap, null).map((x) => x.ts)).toEqual([1, 5]);
    });
    it('the merged list drives the existing view helpers unchanged: newest first, the per-player filter sees both sources', () => {
        const m = mergeLedgers([e(1, 'Alpha', 'k-a')], [{ ...e(2, 'Alpha', 'k-a'), verb: 'claim', field: 'seat', id: 1, role: 'player' }, { ...e(3, 'James (GM)', 'gm-x'), verb: 'seat', field: 'seat', id: 2, role: 'owner' }]);
        expect(filterLedger(m, 'k-a').map((x) => x.ts)).toEqual([2, 1]);
        expect(ledgerActors(m).map((a) => [a.key, a.count])).toEqual([['k-a', 2], ['gm-x', 1]]);
    });
});
