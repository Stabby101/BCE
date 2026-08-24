/*
 * DIRECTIVE-HARDEN-6 Part B — pins the shipped WS payload guards (ws-validate.ts). Every mutating message's
 * shape/type rules, the string bounds, and — specifically — the battle-state gate (non-object/null, non-
 * serializable, and the 256 KB size bound). These lock HARDEN-5 Part A: a legit client payload passes; only
 * malformed is rejected. If one fails after a refactor, the refactor changed a validation rule — do not loosen
 * the guard to match; compare against the shipped behavior.
 */
import { vJoin, vClaim, vRelease, vLobbyJoin, vLobbyMut, vBattle, vFavorite, MAX_BATTLE_STATE_BYTES } from './ws-validate';

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
