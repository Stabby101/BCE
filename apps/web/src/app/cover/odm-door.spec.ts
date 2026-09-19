import { odmDoorDecision, type OdmDoorAccount } from './odm-door';

describe('odmDoorDecision — P3b (the co-GM door prefers THE record; the picker is the owner’s)', () => {
    const row = (id: string, ownerId: string | null, odmRecord?: boolean) => (odmRecord ? { id, ownerId, odmRecord } : { id, ownerId });
    const gm = (id: string): OdmDoorAccount => ({ authRequired: true, id, role: 'gm' });
    const THE = row('autosave-THE-record', 'james', true);

    it('a co-GM with NO rows of its own enters THE record', () => {
        expect(odmDoorDecision([THE], gm('ryan'))).toEqual({ kind: 'enter', rec: THE, coGm: true });
    });
    it('a co-GM owning ONE stale odm row still enters THE record — no picker, the stray is not offered', () => {
        const stray = row('autosave-ryan-stray', 'ryan');
        expect(odmDoorDecision([stray, THE], gm('ryan'))).toEqual({ kind: 'enter', rec: THE, coGm: true });
        expect(odmDoorDecision([THE, stray], gm('ryan'))).toEqual({ kind: 'enter', rec: THE, coGm: true }); // order-independent
    });
    it('a co-GM owning MANY stale rows still enters THE record — never the picker', () => {
        const d = odmDoorDecision([row('s1', 'ryan'), row('s2', 'ryan'), THE, row('s3', 'ryan')], gm('ryan'));
        expect(d).toEqual({ kind: 'enter', rec: THE, coGm: true });
    });
    it('THE OWNER is unchanged: none → create · one → enter · 2+ → the picker with every row', () => {
        expect(odmDoorDecision([], gm('james'))).toEqual({ kind: 'create' });
        expect(odmDoorDecision([THE], gm('james'))).toEqual({ kind: 'enter', rec: THE, coGm: false });
        const fork = row('autosave-fork', 'james');
        expect(odmDoorDecision([THE, fork], gm('james'))).toEqual({ kind: 'picker', recs: [THE, fork] });
    });
    it('an UN-PINNED host marks nothing — a foreign odm row reroutes NOBODY (the owner is never walked into a stranger’s stray)', () => {
        const mine = row('mine', 'james'), foreign = row('ryan-stray', 'ryan');
        expect(odmDoorDecision([mine, foreign], gm('james'))).toEqual({ kind: 'picker', recs: [mine, foreign] });
        expect(odmDoorDecision([foreign], gm('james'))).toEqual({ kind: 'enter', rec: foreign, coGm: false }); // P0’s single-row resume, unchanged
    });
    it('a GM whose list holds only ITS OWN rows is the owner of those rows — the routing (its alarm is its own)', () => {
        const a = row('a', 'ryan'), b = row('b', 'ryan');
        expect(odmDoorDecision([a, b], gm('ryan'))).toEqual({ kind: 'picker', recs: [a, b] });
    });
    it('admin and dev/LAN are never co-GMs: THE record in the list does not reroute them', () => {
        const mine = row('mine', 'root');
        expect(odmDoorDecision([mine, THE], { authRequired: true, id: 'root', role: 'admin' })).toEqual({ kind: 'picker', recs: [mine, THE] });
        expect(odmDoorDecision([mine, THE], { authRequired: false, id: null, role: null }).kind).toBe('picker');
    });
    it('a marked record with NO owner is nobody’s table — it never makes a GM a co-GM', () => {
        const legacy = row('legacy', null, true), own = row('own', 'ryan');
        expect(odmDoorDecision([legacy, own], gm('ryan'))).toEqual({ kind: 'picker', recs: [legacy, own] });
    });
    it('the decision never mutates the list it was given', () => {
        const rows = [THE, row('fork', 'james')];
        const d = odmDoorDecision(rows, gm('james'));
        expect(d.kind === 'picker' && d.recs !== rows).toBeTrue();
    });
});
