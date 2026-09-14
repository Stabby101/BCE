/*
 * ODM-18 P2 — the checkpoint history + restore pins, against a REAL CampaignsService on a temp SQLite
 * file (BCE_DB_PATH override; node:sqlite is synchronous, so no Nest bootstrap is needed). Pins:
 * capture-on-save for pack campaigns only · no-change saves mint nothing · 30-day prune · the
 * NON-NEGOTIABLE pre-restore checkpoint · the GM-attributed log line · owner-scoping (cross-tenant
 * reads the same not-found the campaign itself would) · D-0b (plain campaigns accumulate NO rows).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampaignsService, type SaveRecord, type Viewer } from './campaigns.service';

describe('checkpoints (ODM-18 P2 — history + GM rollback)', () => {
    let svc: CampaignsService;
    let dir: string;
    const owner: Viewer = { ownerId: 'gm-1', admin: false };
    const stranger: Viewer = { ownerId: 'gm-2', admin: false };
    const rec = (id: string, snapshot: unknown): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot });
    const odmSnap = (n: number): Record<string, unknown> => ({ packId: 'odm', startingForce: [], counter: n, currentDate: { y: 2767, m: 1, d: n }, campaignLog: [] });

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bce-chk-spec-'));
        process.env['BCE_DB_PATH'] = join(dir, 'spec.db');
        svc = new CampaignsService();
        svc.onModuleInit();
    });
    afterEach(() => {
        delete process.env['BCE_DB_PATH'];
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* held handles on win are fine — temp dir */ }
    });

    it('N saves → N dated checkpoints (the create itself records nothing — no prior state exists)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        expect(svc.listCheckpoints('c1', owner).length).toBe(0);
        for (let i = 1; i <= 3; i++) svc.upsert(rec('c1', odmSnap(i)), owner);
        const list = svc.listCheckpoints('c1', owner);
        expect(list.length).toBe(3);
        expect(list[0].bytes).toBeGreaterThan(0);
    });

    it('a byte-identical save mints NO duplicate row (the no-change PUT)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(0)), owner);
        expect(svc.listCheckpoints('c1', owner).length).toBe(0);
    });

    it('D-0b — a campaign WITHOUT packId accumulates no history rows, ever', () => {
        svc.upsert(rec('plain', { startingForce: [] }), owner);
        svc.upsert(rec('plain', { startingForce: [], x: 1 }), owner);
        svc.upsert(rec('plain', { startingForce: [], x: 2 }), owner);
        expect(svc.listCheckpoints('plain', owner).length).toBe(0);
    });

    it('rows past the 30-day window are pruned on the next capture — by CAPTURE age, not state age', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        // reach into the row and age its CAPTURE past the window (the spec owns its DB)
        const db = (svc as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
        db.prepare('UPDATE checkpoints SET capturedAt = ?').run(Date.now() - 31 * 24 * 60 * 60 * 1000);
        svc.upsert(rec('c1', odmSnap(2)), owner); // capture + prune
        const list = svc.listCheckpoints('c1', owner);
        expect(list.length).toBe(1); // the aged row is gone; only the fresh capture remains
    });

    it('an IDLE campaign (last save 31 days ago) still keeps its just-minted checkpoints — capture age governs (the panel finding: prune-on-`at` self-deleted the NON-NEGOTIABLE pre-restore capture)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const db = (svc as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
        // the campaign went quiet: its row's updatedAt (the next capture's `at` stamp) is 31 days old
        db.prepare('UPDATE campaigns SET updatedAt = ? WHERE id = ?').run(Date.now() - 31 * 24 * 60 * 60 * 1000, 'c1');
        const chk = svc.listCheckpoints('c1', owner)[0]; // the one prior state (the create minted nothing)
        const n = svc.listCheckpoints('c1', owner).length;
        svc.restoreCheckpoint('c1', chk.id, owner);
        // the pre-restore capture carries at=31d-old but capturedAt=now → it SURVIVES its own prune
        expect(svc.listCheckpoints('c1', owner).length).toBe(n + 1);
    });

    it('DELETE purges the history with the campaign — a re-created id inherits NOTHING (the id is public via the join URL)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        expect(svc.listCheckpoints('c1', owner).length).toBe(1);
        expect(svc.remove('c1', owner)).toBe(true);
        // the ex-player's own GM account re-creates the well-known id — and owns a CLEAN slate
        svc.upsert(rec('c1', { plain: true }), stranger);
        expect(svc.listCheckpoints('c1', stranger).length).toBe(0);
    });

    it('PURGE-ON-TAKEDOWN (the PM rider, IP-002): a DMCA takedown deletes the history — zero rows, the restore list is empty, nothing can resurrect the removed content', () => {
        const withHotspot = (n: number): Record<string, unknown> => ({ ...odmSnap(n), customHotSpots: [{ id: 'hs-x', title: 'Infringing' }] });
        svc.upsert(rec('c1', withHotspot(0)), owner);
        svc.upsert(rec('c1', withHotspot(1)), owner);
        svc.upsert(rec('c1', withHotspot(2)), owner);
        expect(svc.listCheckpoints('c1', owner).length).toBe(2); // the history holds the infringing content
        expect(svc.removeCustomHotspot('c1', 'hs-x')).toBe(true); // the admin lever fires
        expect(svc.listCheckpoints('c1', owner).length).toBe(0); // → zero history rows → restore list empty
    });

    it('restore DROPS the campaign battle_state rows (the live channel must not outlive the state it was scored against)', () => {
        const db = (svc as unknown as { db: { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown } } }).db;
        db.exec(`CREATE TABLE IF NOT EXISTS battle_state (campaignId TEXT NOT NULL, engagementKey TEXT NOT NULL, instanceId TEXT NOT NULL, state TEXT NOT NULL, at INTEGER, PRIMARY KEY (campaignId, engagementKey, instanceId))`);
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        db.prepare('INSERT INTO battle_state VALUES (?, ?, ?, ?, ?)').run('c1', 'e1', 'u1', '{}', 1);
        db.prepare('INSERT INTO battle_state VALUES (?, ?, ?, ?, ?)').run('other', 'e1', 'u1', '{}', 1);
        const chk = svc.listCheckpoints('c1', owner)[0];
        svc.restoreCheckpoint('c1', chk.id, owner);
        expect((db.prepare('SELECT COUNT(*) AS n FROM battle_state WHERE campaignId = ?').get('c1') as { n: number }).n).toBe(0);
        expect((db.prepare('SELECT COUNT(*) AS n FROM battle_state WHERE campaignId = ?').get('other') as { n: number }).n).toBe(1); // scoped — other campaigns untouched
    });

    it('restore ROUND-TRIPS: the live snapshot becomes the checkpoint content, with the GM-attributed log line appended', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner); // checkpoint #1 = state 0
        const chk = svc.listCheckpoints('c1', owner)[0];
        const out = svc.restoreCheckpoint('c1', chk.id, owner);
        const snap = out.snapshot as Record<string, unknown>;
        expect(snap['counter']).toBe(0); // the restored state
        const log = snap['campaignLog'] as { text: string; kind: string }[];
        expect(log.some((l) => /GM rollback — campaign restored/.test(l.text) && l.kind === 'admin')).toBe(true);
    });

    it('the NON-NEGOTIABLE pre-restore checkpoint: the pre-restore state is captured FIRST and restores back', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const before = svc.listCheckpoints('c1', owner);
        const restored = svc.restoreCheckpoint('c1', before[0].id, owner); // back to state 0
        const after = svc.listCheckpoints('c1', owner);
        expect(after.length).toBe(before.length + 1); // + the automatic pre-restore checkpoint (state 1)
        expect((restored.snapshot as Record<string, unknown>)['counter']).toBe(0);
        // …and the rollback rolls back: restore the NEWEST checkpoint (the pre-restore capture of state 1)
        const back = svc.restoreCheckpoint('c1', after[0].id, owner);
        expect((back.snapshot as Record<string, unknown>)['counter']).toBe(1);
    });

    it('owner-scoping: a stranger sees not-found on list, read, and restore (no existence leak); admin passes', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const chk = svc.listCheckpoints('c1', owner)[0];
        expect(() => svc.listCheckpoints('c1', stranger)).toThrow();
        expect(() => svc.getCheckpointSnapshot('c1', chk.id, stranger)).toThrow();
        expect(() => svc.restoreCheckpoint('c1', chk.id, stranger)).toThrow();
        expect(svc.listCheckpoints('c1', { ownerId: null, admin: true }).length).toBe(1);
    });

    // ── ODM-26 option 1 — THE PIN: exempt from AGE, never from DELETION FOR CAUSE ────────────────────────
    //
    // The pin exists at exactly ONE of the four `DELETE FROM checkpoints` statements. These specs are the
    // structure that keeps it there: the first proves the exemption works, the mutation-kill proves the
    // clause is what does the work, and the three that follow drive every deletion-for-cause path and
    // require the pinned row gone every time. A guard maintained by remembering is the thing this repo
    // spent 2026-08-30/31 proving does not hold.
    const age = (svc: CampaignsService, ms = 31 * 24 * 60 * 60 * 1000): void => {
        const db = (svc as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
        db.prepare('UPDATE checkpoints SET capturedAt = ?').run(Date.now() - ms);
    };

    it('PIN-CURRENT captures the LIVE state in ONE STEP — not the prior state, and not two saves later', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(7)), owner); // live state = 7; the ordinary capture holds state 0
        const pin = svc.pinCurrent('c1', owner);
        expect(pin.pinned).toBe(true);
        // THE POINT: the pin holds what is on screen right now, not what was there before the last save.
        expect((svc.getCheckpointSnapshot('c1', pin.id, owner) as Record<string, unknown>)['counter']).toBe(7);
    });

    it('pinning TWICE with no change in between is ONE canon, not two (the no-change-save rule, applied to pins)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const a = svc.pinCurrent('c1', owner);
        const b = svc.pinCurrent('c1', owner);
        expect(b.id).toBe(a.id);
        expect(svc.listCheckpoints('c1', owner).filter((c) => c.pinned).length).toBe(1);
    });

    it('a PINNED checkpoint SURVIVES the 30-day sweep while its unpinned siblings are pruned', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        svc.upsert(rec('c1', odmSnap(2)), owner);
        const pin = svc.pinCurrent('c1', owner);
        expect(svc.listCheckpoints('c1', owner).length).toBe(3); // 2 ordinary + the pin
        age(svc); // every row, pin included, is now 31 days old by CAPTURE age
        svc.upsert(rec('c1', odmSnap(3)), owner); // capture + prune
        const list = svc.listCheckpoints('c1', owner);
        expect(list.filter((c) => c.pinned).map((c) => c.id)).toEqual([pin.id]); // the pin stands
        expect(list.filter((c) => !c.pinned).length).toBe(1); // only the fresh capture; the aged ones are gone
    });

    it('MUTATION-KILL — unpin the same row and the very next sweep takes it (the clause is what saves it, not luck)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const pin = svc.pinCurrent('c1', owner);
        age(svc);
        svc.upsert(rec('c1', odmSnap(2)), owner);
        expect(svc.listCheckpoints('c1', owner).some((c) => c.id === pin.id)).toBe(true); // pinned → survived
        svc.setCheckpointPinned('c1', pin.id, false, owner); // ← the only thing that changes
        age(svc);
        svc.upsert(rec('c1', odmSnap(3)), owner);
        expect(svc.listCheckpoints('c1', owner).some((c) => c.id === pin.id)).toBe(false); // unpinned → swept
    });

    it('DELETION FOR CAUSE 1/3 — a DMCA takedown (removeCustomHotspot) deletes a PINNED checkpoint too: a compliance lever a pin could survive is not a lever', () => {
        const withHotspot = (n: number): Record<string, unknown> => ({ ...odmSnap(n), customHotSpots: [{ id: 'hs-x', title: 'Infringing' }] });
        svc.upsert(rec('c1', withHotspot(0)), owner);
        svc.upsert(rec('c1', withHotspot(1)), owner);
        const pin = svc.pinCurrent('c1', owner);
        expect(svc.listCheckpoints('c1', owner).some((c) => c.id === pin.id && c.pinned)).toBe(true);
        expect(svc.removeCustomHotspot('c1', 'hs-x')).toBe(true);
        expect(svc.listCheckpoints('c1', owner).length).toBe(0); // the pin went with everything else
    });

    it('DELETION FOR CAUSE 2/3 — a GM-composed-mission takedown (removeGmMission) deletes a PINNED checkpoint too', () => {
        const withMission = (n: number): Record<string, unknown> => ({ ...odmSnap(n), odmGmMissions: [{ id: 'gm-x', title: 'Infringing prose' }] });
        svc.upsert(rec('c1', withMission(0)), owner);
        svc.upsert(rec('c1', withMission(1)), owner);
        const pin = svc.pinCurrent('c1', owner);
        expect(svc.listCheckpoints('c1', owner).some((c) => c.id === pin.id && c.pinned)).toBe(true);
        expect(svc.removeGmMission('c1', 'gm-x')).toBe(true);
        expect(svc.listCheckpoints('c1', owner).length).toBe(0);
    });

    it('DELETION FOR CAUSE 3/3 — deleting the campaign deletes a PINNED checkpoint too, so a re-created id inherits NOTHING (the cross-tenant leak)', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        svc.pinCurrent('c1', owner);
        expect(svc.remove('c1', owner)).toBe(true);
        // the well-known id is re-created by someone else — and inherits no pinned history
        svc.upsert(rec('c1', { plain: true }), stranger);
        expect(svc.listCheckpoints('c1', stranger).length).toBe(0);
    });

    it('pin/unpin are OWNER-SCOPED — a stranger gets the same not-found the campaign itself would', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const pin = svc.pinCurrent('c1', owner);
        expect(() => svc.pinCurrent('c1', stranger)).toThrow();
        expect(() => svc.setCheckpointPinned('c1', pin.id, false, stranger)).toThrow();
        expect(svc.listCheckpoints('c1', { ownerId: null, admin: true }).some((c) => c.pinned)).toBe(true);
    });

    it('the pinned row SORTS FIRST — the canon is not something you scroll for', () => {
        svc.upsert(rec('c1', odmSnap(0)), owner);
        svc.upsert(rec('c1', odmSnap(1)), owner);
        const pin = svc.pinCurrent('c1', owner);
        svc.upsert(rec('c1', odmSnap(2)), owner);
        svc.upsert(rec('c1', odmSnap(3)), owner);
        expect(svc.listCheckpoints('c1', owner)[0].id).toBe(pin.id);
    });

    it('checkpoint blobs are COMPRESSED at rest (bytes records the raw length; storage is smaller)', () => {
        const fat = { ...odmSnap(0), pad: 'x'.repeat(50_000) };
        svc.upsert(rec('c1', fat), owner);
        svc.upsert(rec('c1', { ...fat, counter: 1 }), owner);
        const chk = svc.listCheckpoints('c1', owner)[0];
        expect(chk.bytes).toBeGreaterThan(50_000); // raw JSON length recorded
        const db = (svc as unknown as { db: { prepare(sql: string): { get(...a: unknown[]): unknown } } }).db;
        const row = db.prepare('SELECT length(snapshot) AS n FROM checkpoints WHERE id = ?').get(chk.id) as { n: number };
        expect(row.n).toBeLessThan(chk.bytes / 2); // gzip at rest (measured 5× on real ODM JSON)
        // and the round-trip is lossless
        const snap = svc.getCheckpointSnapshot('c1', chk.id, owner) as Record<string, unknown>;
        expect((snap['pad'] as string).length).toBe(50_000);
    });
});
