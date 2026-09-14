/*
 * GM-1 P2 — pins the gmOnly strip (the P0 architectural ruling): GM recipients get the key, non-GM
 * recipients provably do not, and the shared parsed snapshot is never mutated (the fan parses once).
 */
import { shapeSnapshot, ownContractOf, ownCompanyKeysOf, ownVoidOf } from './snapshot-shape';

describe('shapeSnapshot (GM-1 — the gmOnly strip)', () => {
    const snap = { name: 'Alpha', hotSpotCampaign: 'x', gmOnly: { hotSpotOffer: ['hs-1', 'hs-2'], reckoningBegun: true } };

    it('a GM recipient keeps gmOnly intact (same reference — nothing copied, nothing lost)', () => {
        expect(shapeSnapshot(snap, true)).toBe(snap);
    });

    it('a non-GM recipient gets a snapshot WITHOUT gmOnly — every other key intact', () => {
        const out = shapeSnapshot(snap, false) as Record<string, unknown>;
        expect('gmOnly' in out).toBe(false);
        expect(out['name']).toBe('Alpha');
        expect(out['hotSpotCampaign']).toBe('x');
    });

    it('never mutates the input (the fan shares ONE parsed object across recipients)', () => {
        const copy = JSON.parse(JSON.stringify(snap));
        shapeSnapshot(snap, false);
        expect(snap).toEqual(copy);
    });

    it('a snapshot with NO gmOnly key passes through by reference (legacy/plain campaigns cost nothing)', () => {
        const plain = { name: 'Beta', hotSpotOffer: ['hs-9'] };
        expect(shapeSnapshot(plain, false)).toBe(plain);
    });

    it('non-object payloads pass through untouched (null / array / primitive)', () => {
        expect(shapeSnapshot(null, false)).toBeNull();
        const arr = [1, 2];
        expect(shapeSnapshot(arr, false)).toBe(arr);
        expect(shapeSnapshot('s', false)).toBe('s');
    });

    it('the strip does not parse gmOnly — any shape (string, number, null) is deleted the same way', () => {
        for (const weird of ['secret', 42, null, [1]]) {
            const s = { a: 1, gmOnly: weird };
            const out = shapeSnapshot(s, false) as Record<string, unknown>;
            expect('gmOnly' in out).toBe(false);
            expect(out['a']).toBe(1);
        }
    });

    // ── ODM-18 P1 — the LEGACY pilots[].gmNotes strip (panel finding: a pre-migration ODM snapshot at
    //    rest still carries GM notes on the pilot rows; the fan must not wait for the GM-device migration).
    describe('the legacy pilots[].gmNotes strip (ODM-18 P1)', () => {
        const legacy = { name: 'Ghosts', pilots: [{ pilotId: 'p1', callsign: 'Beacon', gmNotes: 'SECRET' }, { pilotId: 'p2', callsign: 'Fog' }] };

        it('non-GM: gmNotes is stripped from every pilot row; every other pilot field intact', () => {
            const out = shapeSnapshot(legacy, false) as { pilots: Record<string, unknown>[] };
            expect(out.pilots.some((p) => 'gmNotes' in p)).toBe(false);
            expect(out.pilots[0]['callsign']).toBe('Beacon');
            expect(out.pilots[1]).toBe(legacy.pilots[1]); // untouched rows pass by reference
        });

        it('GM: the whole record including gmNotes, same reference', () => {
            expect(shapeSnapshot(legacy, true)).toBe(legacy);
        });

        it('never mutates the shared input', () => {
            const copy = JSON.parse(JSON.stringify(legacy));
            shapeSnapshot(legacy, false);
            expect(legacy).toEqual(copy);
        });

        it('pilots WITHOUT gmNotes still pass the whole snapshot through by reference (no copy cost)', () => {
            const clean = { name: 'X', pilots: [{ pilotId: 'p1' }] };
            expect(shapeSnapshot(clean, false)).toBe(clean);
        });

        it('gmNotes strips even when gmOnly is absent (the pre-ODM-18 wire shape)', () => {
            const out = shapeSnapshot({ pilots: [{ gmNotes: 'x', a: 1 }] }, false) as { pilots: Record<string, unknown>[] };
            expect('gmNotes' in out.pilots[0]).toBe(false);
            expect(out.pilots[0]['a']).toBe(1);
        });
    });
});

describe('shapeSnapshot — GM-2 P2a: the per-recipient contract ATTACH (H14)', () => {
    const pcA = { id: 'pc-home-a', scale: 2, steps: { basePay: 3, salvage: 4 } };
    const pcB = { id: 'pc-home-b', scale: 1, steps: { basePay: 1, salvage: 2 } };
    const snap = {
        name: 'Session', gmSession: true,
        startingForce: [
            { instanceId: 'imp-1', provenance: { origin: 'player-import', owner: 'anon-A', sourceCampaignId: 'home-a', originInstanceId: 'h-1' } },
            { instanceId: 'imp-2', provenance: { origin: 'player-import', owner: 'anon-B', sourceCampaignId: 'home-b', originInstanceId: 'b-1' } },
            { instanceId: 'imp-3', provenance: { origin: 'player-import', owner: 'anon-C', sourceCampaignId: 'home-c', originInstanceId: 'c-1' } },
            { instanceId: 'gm-1', provenance: { origin: 'generated' } },
        ],
        gmOnly: { hotSpotOffer: ['hs-1'], activeChaosContract: { id: 'primary', steps: { basePay: 9 } }, participantContracts: { 'home-a': pcA, 'home-b': pcB } },
    };
    const out = (anon: string | null) => shapeSnapshot(snap, false, anon) as Record<string, unknown>;

    it('device A gets ITS contract top-level, gmOnly stripped — and nothing of B\'s or the primary\'s terms', () => {
        const a = out('anon-A');
        expect(a['participantContract']).toEqual(pcA);
        expect('gmOnly' in a).toBe(false);
        expect(JSON.stringify(a)).not.toContain('pc-home-b');
        expect(JSON.stringify(a)).not.toContain('"primary"');
    });
    it('device B gets ITS contract, not A\'s', () => {
        expect(out('anon-B')['participantContract']).toEqual(pcB);
    });
    it('a company that signed nothing gets no attach; a stranger gets none; no recipient identity → none', () => {
        expect('participantContract' in out('anon-C')).toBe(false);
        expect('participantContract' in out('anon-Z')).toBe(false);
        expect('participantContract' in out(null)).toBe(false);
    });
    it('the GM gets the raw record (the map included) by reference', () => {
        expect(shapeSnapshot(snap, true, 'anon-A')).toBe(snap);
    });
    it('never mutates the shared parsed snapshot', () => {
        const copy = JSON.parse(JSON.stringify(snap));
        out('anon-A'); out('anon-B'); out(null);
        expect(snap).toEqual(copy);
    });
    it('ownContractOf tolerates malformed shapes (array map · missing force · non-object contract) → null', () => {
        expect(ownContractOf({ gmOnly: { participantContracts: [] }, startingForce: snap.startingForce }, 'anon-A')).toBeNull();
        expect(ownContractOf({ gmOnly: { participantContracts: { 'home-a': pcA } } }, 'anon-A')).toBeNull();
        expect(ownContractOf({ gmOnly: { participantContracts: { 'home-a': 'nope' } }, startingForce: snap.startingForce }, 'anon-A')).toBeNull();
        expect(ownContractOf({ gmOnly: null, startingForce: snap.startingForce }, 'anon-A')).toBeNull();
    });
    it('a snapshot whose gmOnly carries no map attaches nothing (the P1 wire, byte-identical)', () => {
        const p1 = { ...snap, gmOnly: { hotSpotOffer: ['hs-1'] } };
        const a = shapeSnapshot(p1, false, 'anon-A') as Record<string, unknown>;
        expect('participantContract' in a).toBe(false); expect('gmOnly' in a).toBe(false);
    });
});

describe('ownCompanyKeysOf — GM-2 P2b: the homes a device brought', () => {
    const force = [
        { provenance: { origin: 'player-import', owner: 'anon-A', sourceCampaignId: 'home-a' } },
        { provenance: { origin: 'player-import', owner: 'anon-A', sourceCampaignId: 'home-a' } },
        { provenance: { origin: 'player-import', owner: 'anon-B', sourceCampaignId: 'home-b' } },
        { provenance: { origin: 'generated' } },
    ];
    it('lists each owner\'s homes once, in roster order; a stranger gets none; malformed → []', () => {
        expect(ownCompanyKeysOf({ startingForce: force }, 'anon-A')).toEqual(['home-a']);
        expect(ownCompanyKeysOf({ startingForce: force }, 'anon-B')).toEqual(['home-b']);
        expect(ownCompanyKeysOf({ startingForce: force }, 'anon-Z')).toEqual([]);
        expect(ownCompanyKeysOf({}, 'anon-A')).toEqual([]);
    });
});

describe('shapeSnapshot — GM-3 P1: the per-recipient VOID attach (participantVoid)', () => {
    const force = [
        { instanceId: 'imp-1', provenance: { origin: 'player-import', owner: 'anon-A', sourceCampaignId: 'home-a' } },
        { instanceId: 'imp-2', provenance: { origin: 'player-import', owner: 'anon-B', sourceCampaignId: 'home-b' } },
    ];
    const voidA = { voidId: 'void-pc-home-a-1', contractId: 'pc-home-a-hs', repRefund: 1, at: 1 };
    const snap = { gmSession: true, startingForce: force, gmOnly: { activeChaosContract: null, participantContracts: {}, voidedContracts: { 'home-a': voidA } } };

    it('attaches the recipient OWN void top-level and strips gmOnly; a device with no void gets no key', () => {
        const a = shapeSnapshot(snap, false, 'anon-A') as Record<string, unknown>;
        expect(a['participantVoid']).toEqual(voidA);
        expect('gmOnly' in a).toBe(false);
        const b = shapeSnapshot(snap, false, 'anon-B') as Record<string, unknown>;
        expect('participantVoid' in b).toBe(false);
    });
    it('ownVoidOf: malformed shapes → null, never a throw; a GM recipient keeps the whole map by reference', () => {
        expect(ownVoidOf({ gmOnly: null } as never, 'anon-A')).toBeNull();
        expect(ownVoidOf({ gmOnly: { voidedContracts: [] }, startingForce: force }, 'anon-A')).toBeNull();
        expect(ownVoidOf({ gmOnly: { voidedContracts: { 'home-a': 'x' } }, startingForce: force }, 'anon-A')).toBeNull();
        expect(shapeSnapshot(snap, true)).toBe(snap);
    });
    it('never mutates the shared parsed snapshot', () => {
        const copy = JSON.parse(JSON.stringify(snap));
        shapeSnapshot(snap, false, 'anon-A');
        expect(snap).toEqual(copy);
    });
});
