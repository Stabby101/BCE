/*
 * DIRECTIVE-IMPORT-1 — privacy + takedown, at the CampaignsService seam (a real temp DB, deleted after).
 * Proves the non-negotiable: a custom hotspot in one owner's campaign never reaches another owner (owner-scoping
 * is authoritative), and the admin takedown removes a named custom hotspot from a campaign's snapshot.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampaignsService, type Viewer, type SaveRecord } from './campaigns.service';

describe('custom-hotspot privacy + takedown (CampaignsService)', () => {
    let svc: CampaignsService;
    let dbFile: string;
    let prevPath: string | undefined;
    const ownerA: Viewer = { ownerId: 'user-A', admin: false };
    const ownerB: Viewer = { ownerId: 'user-B', admin: false };
    const withCustom = { customHotSpots: [{ id: 'hs-custom-0-0', title: 'My Homebrew Mission', custom: true }] };
    const rec = (id: string, snapshot: unknown): SaveRecord => ({ id, name: id, savedAt: 1, version: 1, summary: '', snapshot });

    beforeEach(() => {
        prevPath = process.env.BCE_DB_PATH;
        dbFile = join(tmpdir(), `bce-hs-privacy-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        svc = new CampaignsService();
        svc.onModuleInit();
    });
    afterEach(() => {
        if (prevPath === undefined) delete process.env.BCE_DB_PATH; else process.env.BCE_DB_PATH = prevPath;
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* best-effort */ } }
    });

    it("owner A's custom-hotspot campaign is INVISIBLE to owner B (list + get)", () => {
        svc.upsert(rec('camp-A', withCustom), ownerA);
        expect(svc.list(ownerA).some((r) => r.id === 'camp-A')).toBe(true); // A sees its own
        expect(svc.list(ownerB)).toEqual([]);                              // B's list excludes A's campaign
        expect(svc.get('camp-A', ownerB)).toBeNull();                      // B can't read A's campaign at all
    });

    it('a fresh (different) campaign never inherits another campaign\'s custom hotspots', () => {
        svc.upsert(rec('camp-A', withCustom), ownerA);
        svc.upsert(rec('camp-A2', { customHotSpots: [] }), ownerA); // same owner, different campaign
        const other = svc.get('camp-A2', ownerA)!;
        expect((other.snapshot as { customHotSpots: unknown[] }).customHotSpots).toEqual([]); // isolated per-campaign
    });

    it('admin takedown removes a NAMED custom hotspot from the campaign snapshot', () => {
        svc.upsert(rec('camp-A', withCustom), ownerA);
        expect(svc.removeCustomHotspot('camp-A', 'hs-custom-0-0')).toBe(true);
        const after = svc.get('camp-A', ownerA)!;
        expect((after.snapshot as { customHotSpots: unknown[] }).customHotSpots).toEqual([]); // removed
        expect(svc.get('camp-A', ownerA)).not.toBeNull();                                     // campaign survives
    });

    it('takedown of a non-existent hotspot / campaign is a no-op (false)', () => {
        svc.upsert(rec('camp-A', withCustom), ownerA);
        expect(svc.removeCustomHotspot('camp-A', 'no-such-id')).toBe(false);
        expect(svc.removeCustomHotspot('no-such-campaign', 'hs-custom-0-0')).toBe(false);
    });

    // ── GM-1 P2 — the takedown reaches the gmOnly layout (a GM session's chamber; the panel's dead-lever catch) ──
    it('admin takedown removes a custom hotspot stored UNDER gmOnly (a GM-session campaign)', () => {
        svc.upsert(rec('camp-GM', { gmSession: true, gmOnly: { customHotSpots: [{ id: 'hs-custom-9', title: 'Infringing', custom: true }] } }), ownerA);
        expect(svc.removeCustomHotspot('camp-GM', 'hs-custom-9')).toBe(true);
        const after = svc.get('camp-GM', ownerA)!;
        expect(((after.snapshot as { gmOnly: { customHotSpots: unknown[] } }).gmOnly).customHotSpots).toEqual([]);
        expect((after.snapshot as { gmSession?: boolean }).gmSession).toBe(true); // the rest of the snapshot intact
    });
    it('takedown searches BOTH layouts without short-circuiting (a duplicated id dies everywhere)', () => {
        svc.upsert(rec('camp-Dup', { customHotSpots: [{ id: 'hs-dup', custom: true }], gmOnly: { customHotSpots: [{ id: 'hs-dup', custom: true }] } }), ownerA);
        expect(svc.removeCustomHotspot('camp-Dup', 'hs-dup')).toBe(true);
        const after = svc.get('camp-Dup', ownerA)!;
        expect((after.snapshot as { customHotSpots: unknown[] }).customHotSpots).toEqual([]);
        expect(((after.snapshot as { gmOnly: { customHotSpots: unknown[] } }).gmOnly).customHotSpots).toEqual([]);
    });
});
