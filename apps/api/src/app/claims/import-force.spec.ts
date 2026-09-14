/*
 * GM-1 P3 — pins the pure import-mint helpers: server-authority id re-mint (collision-proof, pilot links
 * remapped in the same pass), the anonId-only ownership stamp, and the cap arithmetic (default 4).
 */
import { remintImport, countOwnedImports, importCapOf } from './import-force';

const U = (instanceId: string, over: Record<string, unknown> = {}) => ({ instanceId, unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897, ...over });

describe('remintImport (GM-1 P3)', () => {
    it('re-mints EVERY instance id under imp-<ownerTag>-<seq>-<i> and never keeps a caller id', () => {
        const out = remintImport([U('pi-1-999'), U('pi-2-999')] as never, [], 'anon-deadbeefcafe0123', 42);
        expect(out.instanceIds).toEqual(['imp-deadbeef-42-0', 'imp-deadbeef-42-1']);
        expect(out.units.map((u) => u.instanceId)).toEqual(out.instanceIds);
    });
    it('remaps pilot.assignedInstanceId to the RE-MINTED id; an unknown link is dropped (spare)', () => {
        const out = remintImport([U('orig-a')] as never, [
            { name: 'Sasha Weaver', gunnery: 3, piloting: 4, assignedInstanceId: 'orig-a' },
            { name: 'Ghost', gunnery: 4, piloting: 5, assignedInstanceId: 'not-imported' },
        ], 'anon-cafe', 7);
        expect(out.pilots[0].assignedInstanceId).toBe(out.instanceIds[0]);
        expect('assignedInstanceId' in out.pilots[1]).toBe(false);
    });
    it("stamps condition 'Deployed' + provenance {origin:'player-import', owner:<anonId>} — the anonId, never a raw token", () => {
        const out = remintImport([U('x')] as never, [], 'anon-abc123', 1);
        expect(out.units[0].condition).toBe('Deployed');
        // GM-2 P1: the fixture unit carries its home instanceId, so the mint now ALSO records it as originInstanceId (no sourceCampaignId — none was passed)
        expect(out.units[0].provenance).toEqual({ origin: 'player-import', owner: 'anon-abc123', originInstanceId: out.units[0].provenance.originInstanceId });
        expect(typeof out.units[0].provenance.originInstanceId).toBe('string');
    });
    // ── GM-2 P1 — the identity cut: the origin ids + the home campaign survive the mint ──
    it('GM-2 P1: preserves the HOME campaign id and each unit\'s ORIGIN instance id on provenance (the minted id stays server-authored)', () => {
        const out = remintImport([U('h-1'), U('h-2')], [], 'anon-abc123', 42, 'home-pen');
        expect(out.units[0].instanceId).toBe('imp-abc123-42-0');
        expect(out.units[0].provenance).toEqual({ origin: 'player-import', owner: 'anon-abc123', sourceCampaignId: 'home-pen', originInstanceId: 'h-1' });
        expect(out.units[1].provenance.originInstanceId).toBe('h-2');
    });
    it('GM-2 P1: preserves the ORIGIN pilot id (originPilotId) beside the re-minted pilotId, and the remapped unit link', () => {
        const out = remintImport([U('h-1')], [{ pilotId: 'hp-1', name: 'Kerensky Jr', gunnery: 3, piloting: 4, assignedInstanceId: 'h-1' }], 'anon-abc123', 42, 'home-pen');
        expect(out.pilots[0].pilotId).toBe('impp-abc123-42-0');
        expect(out.pilots[0].originPilotId).toBe('hp-1');
        expect(out.pilots[0].assignedInstanceId).toBe('imp-abc123-42-0');
    });
    it('GM-2 P1: a pre-P1 payload (no ids, no source) mints exactly as before — no origin keys appear', () => {
        const bare = { unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897 }; // no instanceId: a pre-P1 client
        const out = remintImport([bare], [{ name: 'Sasha', gunnery: 3, piloting: 4 }], 'anon-abc123', 42);
        expect(out.units[0].provenance).toEqual({ origin: 'player-import', owner: 'anon-abc123' });
        expect('originPilotId' in out.pilots[0]).toBe(false);
    });
    it('carries damage verbatim when present, omits when absent', () => {
        const dmg = { crits: [], locations: { CT: { armor: 3 } } };
        const out = remintImport([U('a', { damage: dmg }), U('b')] as never, [], 'anon-z', 2);
        expect(out.units[0].damage).toEqual(dmg);
        expect('damage' in out.units[1]).toBe(false);
    });
});

describe('countOwnedImports + importCapOf (GM-1 P3)', () => {
    const snap = {
        playerUnitCap: 6,
        startingForce: [
            { instanceId: 'a', provenance: { origin: 'player-import', owner: 'anon-p1' } },
            { instanceId: 'b', provenance: { origin: 'player-import', owner: 'anon-p2' } },
            { instanceId: 'c', provenance: { origin: 'gm-added' } },
            { instanceId: 'd' }, // legacy — no provenance
        ],
    };
    it('counts ONLY this owner\'s player-import instances', () => {
        expect(countOwnedImports(snap, 'anon-p1')).toBe(1);
        expect(countOwnedImports(snap, 'anon-p3')).toBe(0);
        expect(countOwnedImports({}, 'anon-p1')).toBe(0);
        expect(countOwnedImports(null, 'anon-p1')).toBe(0);
    });
    it('reads the GM-set cap; absent/malformed → the default lance of 4; bounded 1..24', () => {
        expect(importCapOf(snap)).toBe(6);
        expect(importCapOf({})).toBe(4);
        expect(importCapOf(null)).toBe(4);
        expect(importCapOf({ playerUnitCap: 'nope' })).toBe(4);
        expect(importCapOf({ playerUnitCap: 0 })).toBe(1);
        expect(importCapOf({ playerUnitCap: 99 })).toBe(24);
    });
});

describe('GM-2 P2b — the home reputation rides the mint', () => {
    it('provenance.homeReputation is recorded (rounded, clamped 0..99) when the handshake carries it, absent otherwise', () => {
        const withRep = remintImport([U('h-1')], [], 'anon-x', 1, 'home-a', 4);
        expect(withRep.units[0].provenance.homeReputation).toBe(4);
        const clamped = remintImport([U('h-1')], [], 'anon-x', 1, 'home-a', 250.4);
        expect(clamped.units[0].provenance.homeReputation).toBe(99);
        const without = remintImport([U('h-1')], [], 'anon-x', 1, 'home-a');
        expect('homeReputation' in without.units[0].provenance).toBe(false);
    });
});

describe('GM-2 P3 — a brought pilot is a NAMED pilot', () => {
    it('a pilot minted with a home pilotId carries named: true (the career-SP earn side fires); one without stays un-named', () => {
        const withId = remintImport([U('h-1')], [{ name: 'Lead', gunnery: 3, piloting: 4, assignedInstanceId: 'h-1', pilotId: 'hp-1' }], 'anon-x', 1, 'home-a');
        expect(withId.pilots[0].named).toBe(true); expect(withId.pilots[0].originPilotId).toBe('hp-1');
        const without = remintImport([U('h-1')], [{ name: 'Lead', gunnery: 3, piloting: 4, assignedInstanceId: 'h-1' }], 'anon-x', 1, 'home-a');
        expect('named' in without.pilots[0]).toBe(false);
    });
});
