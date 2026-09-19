import { vJoin, vClaim, vRelease, vLobbyJoin, vLobbyMut, vBattle, vFavorite, vSidePref, vImportForce, vOdmIntent, ODM_INTENT_VERBS, MAX_BATTLE_STATE_BYTES, MAX_IMPORT_FORCE_BYTES, MAX_IMPORT_UNITS, vSeat } from './ws-validate';
import { vSignContract, vEngagementClose, vHandTable } from './ws-validate';

const ok = (v: { ok: boolean }) => expect(v.ok).toBe(true);
const bad = (v: { ok: boolean; reason?: string }) => { expect(v.ok).toBe(false); expect(typeof v.reason).toBe('string'); };
const STR501 = 'x'.repeat(501);
const STR201 = 'x'.repeat(201);

describe('vJoin / vResync', () => {
    it('accepts { campaignId, engagementKey } and an absent/empty engagementKey', () => {
        ok(vJoin({ campaignId: 'c', engagementKey: 'e' }));
        ok(vJoin({ campaignId: 'c' }));               // engagementKey optional
        ok(vJoin({ campaignId: 'c', engagementKey: '' })); // empty key allowed (pre-engagement)
    });
    it('rejects a missing/blank/oversized campaignId and a non-object payload', () => {
        bad(vJoin({}));
        bad(vJoin({ campaignId: '' }));
        bad(vJoin({ campaignId: STR501 }));
        bad(vJoin(null));
        bad(vJoin([]));            // array is not a valid payload object
        bad(vJoin('nope'));
        bad(vJoin({ campaignId: 'c', engagementKey: 42 })); // wrong type
    });
});

describe('vClaim', () => {
    it('accepts a full claim (holderName/holderToken/at optional)', () => {
        ok(vClaim({ campaignId: 'c', engagementKey: 'e', instanceId: 'u1', holderName: 'P', holderToken: 't', at: 1 }));
        ok(vClaim({ campaignId: 'c', instanceId: 'u1' })); // optionals absent
    });
    it('rejects missing campaignId/instanceId, wrong-typed at, over-bound name/token', () => {
        bad(vClaim({ engagementKey: 'e', instanceId: 'u1' }));   // no campaignId
        bad(vClaim({ campaignId: 'c', engagementKey: 'e' }));    // no instanceId
        bad(vClaim({ campaignId: 'c', instanceId: 42 }));        // instanceId wrong type
        bad(vClaim({ campaignId: 'c', instanceId: 'u1', at: 'soon' }));
        bad(vClaim({ campaignId: 'c', instanceId: 'u1', holderName: STR201 })); // > MAX_NAME
        bad(vClaim({ campaignId: 'c', instanceId: 'u1', holderToken: STR501 })); // > MAX_STR
    });
});

describe('vRelease', () => {
    it('accepts { campaignId, instanceId } (+ optional engagementKey/holderToken)', () => {
        ok(vRelease({ campaignId: 'c', engagementKey: 'e', instanceId: 'u1', holderToken: 't' }));
        ok(vRelease({ campaignId: 'c', instanceId: 'u1' }));
    });
    it('rejects missing instanceId / wrong-typed holderToken', () => {
        bad(vRelease({ campaignId: 'c' }));
        bad(vRelease({ campaignId: 'c', instanceId: 'u1', holderToken: 7 }));
    });
});

describe('vLobbyJoin', () => {
    it('accepts { campaignId, token } (+ optional name/side)', () => {
        ok(vLobbyJoin({ campaignId: 'c', token: 't', name: 'P', side: 'BLUFOR' }));
        ok(vLobbyJoin({ campaignId: 'c', token: 't' }));
    });
    it('rejects missing campaignId/token, over-bound name, wrong-typed side', () => {
        bad(vLobbyJoin({ token: 't' }));
        bad(vLobbyJoin({ campaignId: 'c' }));
        bad(vLobbyJoin({ campaignId: 'c', token: 't', name: STR201 }));
        bad(vLobbyJoin({ campaignId: 'c', token: 't', side: 9 }));
    });
});

describe('vLobbyMut(needSide)', () => {
    it('reassign (needSide=true) requires a non-empty side; kick/leave (false) do not', () => {
        ok(vLobbyMut({ campaignId: 'c', token: 't', side: 'OPFOR' }, true));  // reassign
        bad(vLobbyMut({ campaignId: 'c', token: 't' }, true));                // reassign without side
        bad(vLobbyMut({ campaignId: 'c', token: 't', side: '' }, true));      // reassign blank side
        ok(vLobbyMut({ campaignId: 'c', token: 't' }, false));               // kick/leave
        ok(vLobbyMut({ campaignId: 'c', token: 't', side: 'BLUFOR' }, false));
    });
    it('always requires campaignId + token', () => {
        bad(vLobbyMut({ token: 't' }, false));
        bad(vLobbyMut({ campaignId: 'c' }, false));
        bad(vLobbyMut(null, true));
    });
});

describe('vBattle — the state gate (shape + non-serializable + 256 KB bound)', () => {
    const base = { campaignId: 'c', engagementKey: 'e', instanceId: 'u1' };
    it('accepts a normal JSON-object state (+ optional at)', () => {
        ok(vBattle({ ...base, state: { armorHits: 3 }, at: 1 }));
        ok(vBattle({ ...base, state: [1, 2, 3] })); // arrays are objects — allowed
    });
    it('rejects missing required fields + wrong-typed at', () => {
        bad(vBattle({ campaignId: 'c', engagementKey: 'e', state: {} }));   // no instanceId
        bad(vBattle({ campaignId: 'c', instanceId: 'u1', state: {} }));     // no engagementKey (required non-empty)
        bad(vBattle({ ...base, engagementKey: '', state: {} }));            // empty engagementKey NOT allowed for battle
        bad(vBattle({ ...base, state: {}, at: 'x' }));
    });
    it('rejects a non-object / null / undefined / primitive state', () => {
        bad(vBattle({ ...base, state: 'not-an-object' }));
        bad(vBattle({ ...base, state: null }));
        bad(vBattle({ ...base }));           // state undefined
        bad(vBattle({ ...base, state: 42 }));
    });
    it('rejects a non-serializable (circular) state', () => {
        const circular: Record<string, unknown> = {}; circular['self'] = circular;
        bad(vBattle({ ...base, state: circular }));
    });
    it('rejects a state serializing OVER 256 KB but accepts one just under', () => {
        const over = { blob: 'x'.repeat(MAX_BATTLE_STATE_BYTES) };           // ~256 KB of payload alone → over once wrapped
        bad(vBattle({ ...base, state: over }));
        const under = { blob: 'x'.repeat(MAX_BATTLE_STATE_BYTES - 100) };    // comfortably under after JSON wrapping
        ok(vBattle({ ...base, state: under }));
    });
    it('the bound constant is 256 KB', () => {
        expect(MAX_BATTLE_STATE_BYTES).toBe(256 * 1024);
    });
});

describe('vOdmIntent (P1 — the allowlist LAW)', () => {
    const base = { campaignId: 'c', token: 't' };
    it('accepts every allowlisted verb with its shape', () => {
        ok(vOdmIntent({ ...base, verb: 'reassign-pilot', payload: { instanceId: 'u1', pilotId: 'p1' } }));
        ok(vOdmIntent({ ...base, verb: 'reassign-pilot', payload: { instanceId: 'u1', pilotId: '' } })); // '' = unassign
        ok(vOdmIntent({ ...base, verb: 'set-deploy', payload: { instanceId: 'u1', deployed: true } }));
        ok(vOdmIntent({ ...base, verb: 'bay-assign', payload: { instanceId: 'u1', bayId: 'b1' } }));
        ok(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1' } }));
        ok(vOdmIntent({ ...base, verb: 'bay-priority', payload: { bayId: 'b1', p: 2 } }));
        ok(vOdmIntent({ ...base, verb: 'bay-type', payload: { bayId: 'b1', type: 'SALVAGE' } }));
        ok(vOdmIntent({ ...base, verb: 'bench-assess', payload: { label: 'Medium Laser', outcome: { a: 1, b: 0, c: 0 } } }));
        ok(vOdmIntent({ ...base, verb: 'bench-inspect', payload: { label: 'Medium Laser', n: 2 } }));
        ok(vOdmIntent({ ...base, verb: 'bench-repair', payload: { label: 'Medium Laser', n: 1 } }));
        ok(vOdmIntent({ ...base, verb: 'bench-ammo-clear', payload: { bin: 'Narc' } }));
        ok(vOdmIntent({ ...base, verb: 'donor-strip-request', payload: { instanceId: 'u1' } }));
        ok(vOdmIntent({ ...base, verb: 'rename-pilot', payload: { instanceId: 'u1', name: 'Imara "Spire" Cross' } }));
        ok(vOdmIntent({ ...base, verb: 'seat-note', payload: { instanceId: 'u1', text: 'left knee actuator sticks' } }));
        ok(vOdmIntent({ ...base, verb: 'seat-note', payload: { instanceId: 'u1', text: '' } })); // '' clears the note
        ok(vOdmIntent({ ...base, verb: 'seat-request', payload: { instanceId: 'u1', kind: 'repair', text: 'armour, left torso' } }));
        ok(vOdmIntent({ ...base, verb: 'seat-request', payload: { instanceId: 'u1', kind: 'loadout', text: 'swap the SRM-4 for an MG array' } }));
        expect(ODM_INTENT_VERBS.length).toBe(14); // the pinned vocabulary — growth is a deliberate act
    });
    it('P5 — vSeat: { campaignId, instanceId, toToken } — the empty token is the unseat; a missing one is malformed', () => {
        ok(vSeat({ campaignId: 'c1', instanceId: 'u1', toToken: 'tok-a' }));
        ok(vSeat({ campaignId: 'c1', instanceId: 'u1', toToken: '', nonce: 'n1' }));
        bad(vSeat({ campaignId: 'c1', instanceId: 'u1' }));
        bad(vSeat({ campaignId: 'c1', toToken: 'tok-a' }));
        bad(vSeat({ instanceId: 'u1', toToken: 'tok-a' }));
        bad(vSeat({ campaignId: 'c1', instanceId: 'u1', toToken: 7 }));
        bad(vSeat({ campaignId: 'c1', instanceId: 'u1', toToken: 'tok-a', nonce: 'x'.repeat(41) }));
        bad(vSeat(null));
    });
    it('P2 — the seat verbs reject a blank name, an over-long note, an unknown request kind, a missing seat', () => {
        bad(vOdmIntent({ ...base, verb: 'rename-pilot', payload: { instanceId: 'u1', name: '   ' } }));
        bad(vOdmIntent({ ...base, verb: 'rename-pilot', payload: { instanceId: 'u1', name: 'x'.repeat(61) } }));
        bad(vOdmIntent({ ...base, verb: 'rename-pilot', payload: { name: 'No Seat' } }));
        bad(vOdmIntent({ ...base, verb: 'seat-note', payload: { instanceId: 'u1', text: 'x'.repeat(501) } }));
        bad(vOdmIntent({ ...base, verb: 'seat-note', payload: { instanceId: 'u1' } }));
        bad(vOdmIntent({ ...base, verb: 'seat-request', payload: { instanceId: 'u1', kind: 'write-off', text: 'scrap it' } }));
        bad(vOdmIntent({ ...base, verb: 'seat-request', payload: { instanceId: 'u1', kind: 'repair', text: ' ' } }));
    });
    it('THE NEGATIVE LAW: burnDays / writeOff / clock / resolve / QM verbs are NOT in the allowlist', () => {
        for (const verb of ['burn-days', 'burnDays', 'write-off', 'writeOff', 'advance-month', 'advance', 'resolve', 'stocks-adjust', 'depot-adjust', 'settle-attempt', 'donor-strip']) {
            bad(vOdmIntent({ ...base, verb, payload: { instanceId: 'u1' } }));
        }
    });
    it('rejects malformed payloads per verb + missing identity', () => {
        bad(vOdmIntent({ ...base, verb: 'set-deploy', payload: { instanceId: 'u1', deployed: 'yes' } }));
        bad(vOdmIntent({ ...base, verb: 'bay-priority', payload: { bayId: 'b1', p: 5 } }));
        bad(vOdmIntent({ ...base, verb: 'bench-assess', payload: { label: 'ML', outcome: { a: -1, b: 0, c: 0 } } }));
        bad(vOdmIntent({ ...base, verb: 'bay-type', payload: { bayId: 'b1', type: 'ENGINE' } }));
        bad(vOdmIntent({ token: 't', verb: 'set-deploy', payload: { instanceId: 'u1', deployed: true } }));
        bad(vOdmIntent({ ...base, verb: 'reassign-pilot', payload: null }));
        bad(vOdmIntent(null));
    });
    // ── the panel fixes (same-commit): integer bounds, the payload byte gate, the correlation nonce ──
    it('bench counts are INTEGERS 1..999 (2^31 wrapped negative through the apply-side |0 — bound at the door)', () => {
        bad(vOdmIntent({ ...base, verb: 'bench-repair', payload: { label: 'ML', n: 2 ** 31 } }));
        bad(vOdmIntent({ ...base, verb: 'bench-inspect', payload: { label: 'ML', n: 2.5 } }));
        bad(vOdmIntent({ ...base, verb: 'bench-inspect', payload: { label: 'ML', n: 1000 } }));
        bad(vOdmIntent({ ...base, verb: 'bench-assess', payload: { label: 'ML', outcome: { a: 2 ** 31, b: 0, c: 0 } } }));
        bad(vOdmIntent({ ...base, verb: 'bench-assess', payload: { label: 'ML', outcome: { a: 1.5, b: 0, c: 0 } } }));
        ok(vOdmIntent({ ...base, verb: 'bench-repair', payload: { label: 'ML', n: 999 } }));
    });
    it('the payload object is byte-gated at 32 KB (extra keys ride the GM fan verbatim — the vBattle posture)', () => {
        bad(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1', junk: 'x'.repeat(33 * 1024) } }));
        ok(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1', junk: 'x'.repeat(1024) } }));
    });
    it('nonce: optional string ≤40 (per-send ack correlation); anything else rejects', () => {
        ok(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1' }, nonce: 'abc123' }));
        bad(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1' }, nonce: 'x'.repeat(41) }));
        bad(vOdmIntent({ ...base, verb: 'bay-unassign', payload: { bayId: 'b1' }, nonce: 42 }));
    });
});

describe('vImportForce (P3)', () => {
    const unit = { unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897 };
    const base = { campaignId: 'c', token: 't', units: [unit] };
    it('accepts a well-formed import (units only; pilots + engagementKey + name optional)', () => {
        ok(vImportForce(base));
        ok(vImportForce({ ...base, engagementKey: '', name: 'Ravenscroft', pilots: [{ name: 'Sasha', gunnery: 3, piloting: 4, assignedInstanceId: 'x' }] }));
        ok(vImportForce({ ...base, units: [{ ...unit, unitType: 'vehicle', damage: { crits: [] } }] }));
    });
    it('rejects missing campaignId/token, empty/oversized unit lists, and malformed units', () => {
        ok(vImportForce({ ...base, sourceCampaignId: 'home-pen', units: [{ ...unit, instanceId: 'h-1' }], pilots: [{ pilotId: 'hp-1', name: 'Sasha', gunnery: 3, piloting: 4, assignedInstanceId: 'h-1' }] }));
        bad(vImportForce({ ...base, sourceCampaignId: 42 }));
        bad(vImportForce({ ...base, units: [{ ...unit, instanceId: { not: 'a string' } }] }));
        bad(vImportForce({ ...base, pilots: [{ pilotId: 7, name: 'Sasha', gunnery: 3, piloting: 4 }] }));
        bad(vImportForce({ token: 't', units: [unit] }));
        bad(vImportForce({ campaignId: 'c', units: [unit] }));
        bad(vImportForce({ ...base, units: [] }));
        bad(vImportForce({ ...base, units: Array.from({ length: MAX_IMPORT_UNITS + 1 }, () => unit) }));
        bad(vImportForce({ ...base, units: [{ ...unit, tons: 'heavy' }] }));
        bad(vImportForce({ ...base, units: [{ ...unit, unitType: 'aerospace' }] }));
        bad(vImportForce({ ...base, units: [{ ...unit, damage: 'broken' }] }));
        bad(vImportForce({ ...base, pilots: [{ name: 'X', gunnery: 'good', piloting: 4 }] }));
        bad(vImportForce(null));
    });
    it('gates the WHOLE {units, pilots} payload at 128 KB with a clean reject (never the silent frame drop)', () => {
        expect(MAX_IMPORT_FORCE_BYTES).toBe(128 * 1024);
        const fat = { ...unit, damage: { blob: 'x'.repeat(MAX_IMPORT_FORCE_BYTES) } };
        bad(vImportForce({ ...base, units: [fat] }));
        const under = { ...unit, damage: { blob: 'x'.repeat(1024) } };
        ok(vImportForce({ ...base, units: [under] }));
    });
});

describe('vSidePref (P2)', () => {
    it("accepts { campaignId, token, pref } with pref 'a' | 'b' | null", () => {
        ok(vSidePref({ campaignId: 'c', token: 't', pref: 'a' }));
        ok(vSidePref({ campaignId: 'c', token: 't', pref: 'b' }));
        ok(vSidePref({ campaignId: 'c', token: 't', pref: null }));
    });
    it('rejects missing campaignId/token and any pref outside the closed set (absent included)', () => {
        bad(vSidePref({ token: 't', pref: 'a' }));
        bad(vSidePref({ campaignId: 'c', pref: 'a' }));
        bad(vSidePref({ campaignId: 'c', token: 't' }));           // pref is REQUIRED (null = explicit clear)
        bad(vSidePref({ campaignId: 'c', token: 't', pref: 'x' }));
        bad(vSidePref({ campaignId: 'c', token: 't', pref: 1 }));
        bad(vSidePref(null));
    });
});

describe('vFavorite', () => {
    it('accepts { campaignId, token } with string|null instanceId/pilotId (or absent)', () => {
        ok(vFavorite({ campaignId: 'c', token: 't', instanceId: 'u1', pilotId: null }));
        ok(vFavorite({ campaignId: 'c', token: 't', instanceId: null, pilotId: 'p1' }));
        ok(vFavorite({ campaignId: 'c', token: 't' }));
    });
    it('rejects missing campaignId/token and wrong-typed instanceId/pilotId', () => {
        bad(vFavorite({ token: 't' }));
        bad(vFavorite({ campaignId: 'c' }));
        bad(vFavorite({ campaignId: 'c', token: 't', instanceId: 5 }));
        bad(vFavorite({ campaignId: 'c', token: 't', pilotId: {} }));
    });
});

describe('P2b — the reputation on the handshake + vSignContract', () => {
    const base = { campaignId: 'c1', token: 't1', units: [{ chassis: 'Atlas', model: 'AS7-D', unitRef: 'Atlas AS7-D', mulId: 31, tons: 100, bv: 1897 }], sourceCampaignId: 'home-a' };
    it('vImportForce: reputation optional, finite 0..99', () => {
        expect(vImportForce({ ...base, reputation: 4 }).ok).toBe(true);
        expect(vImportForce({ ...base }).ok).toBe(true);
        expect(vImportForce({ ...base, reputation: -1 }).ok).toBe(false);
        expect(vImportForce({ ...base, reputation: 'high' }).ok).toBe(false);
        expect(vImportForce({ ...base, reputation: Number.NaN }).ok).toBe(false);
    });
    const contract = { id: 'pc-home-a-hs', type: 'garrison', scale: 2, intensity: 2, steps: { basePay: 3, command: 1, salvage: 2, support: 1, transport: 2 }, status: 'active', acceptedDate: { y: 3151, m: 2, d: 1 }, tracksDone: 0, hotspotId: 'hs-1', side: 'a', sideRole: 'attacker', employer: 'FS', enemyFaction: 'DC', repSpent: 1, transportSp: 420 };
    const msg = { campaignId: 'c1', token: 't1', key: 'home-a', contract, nonce: 'n1' };
    it('accepts a well-formed signing', () => { expect(vSignContract(msg)).toEqual({ ok: true }); });
    it('rejects: missing key · bad scale · a tampered steps column · an unknown column · an unknown contract key · tracksDone ≠ 0 · repSpent out of range · over the byte bound', () => {
        expect(vSignContract({ ...msg, key: '' }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, scale: 4 } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, steps: { ...contract.steps, basePay: 99 } } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, steps: { ...contract.steps, bonus: 1 } } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, offerSnapshot: ['hs-9'] } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, tracksDone: 1 } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, repSpent: 21 } }).ok).toBe(false);
        expect(vSignContract({ ...msg, contract: { ...contract, employer: 'x'.repeat(40 * 1024) } }).ok).toBe(false);
    });
});

describe('vEngagementClose — ORDER-4 H18', () => {
    it('accepts { campaignId, engagementKey } with both non-empty', () => {
        expect(vEngagementClose({ campaignId: 'c', engagementKey: 'PALE_CANDLE' }).ok).toBe(true);
    });
    it('rejects a missing/empty key, a missing campaign, and a non-object', () => {
        expect(vEngagementClose({ campaignId: 'c', engagementKey: '' }).ok).toBe(false);
        expect(vEngagementClose({ campaignId: 'c' }).ok).toBe(false);
        expect(vEngagementClose({ engagementKey: 'k' }).ok).toBe(false);
        expect(vEngagementClose('nope').ok).toBe(false);
        expect(vEngagementClose(null).ok).toBe(false);
    });
});

describe('vHandTable (P3b (b) → P5: the target is a DEVICE of that account)', () => {
    it('accepts { campaignId, toUserId, toDeviceId }; refuses a missing/empty/oversized toDeviceId (a cached bundle sends none)', () => {
        expect(vHandTable({ campaignId: 'c', toUserId: 'u-ryan', toDeviceId: 'dev-ryan-phone' }).ok).toBe(true);
        expect(vHandTable({ campaignId: 'c', toUserId: 'u-ryan' }).ok).toBe(false);
        expect(vHandTable({ campaignId: 'c', toUserId: 'u-ryan', toDeviceId: '' }).ok).toBe(false);
        expect(vHandTable({ campaignId: 'c', toUserId: 'u-ryan', toDeviceId: 'x'.repeat(65) }).ok).toBe(false);
        expect(vHandTable({ campaignId: 'c', toUserId: '', toDeviceId: 'dev' }).ok).toBe(false);
        expect(vHandTable(null).ok).toBe(false);
    });
});
