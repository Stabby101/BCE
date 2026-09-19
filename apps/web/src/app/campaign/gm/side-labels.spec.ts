import { sideLabelsOf, anonIdWeb, sha256HexFallback } from './side-labels';
import { signal } from '@angular/core';
import type { PresentedHotspot } from './presented-hotspot';
import type { ChaosContract, ContractSummary } from '../chaos/chaos-contract';

const stateOf = (gm: boolean, contract: Partial<ChaosContract> | null, presented: Partial<PresentedHotspot> | null) => ({
    gmSession: signal(gm),
    activeChaosContract: signal(contract as ChaosContract | null),
    contractSummary: signal(null as ContractSummary | null),
    presentedHotspot: signal(presented as PresentedHotspot | null),
});

describe('sideLabelsOf (P4 — the mapping law)', () => {
    it('is null outside a gmSession, and null with nothing signed or presented', () => {
        expect(sideLabelsOf(stateOf(false, { side: 'a', employer: 'FS' }, null))).toBeNull();
        expect(sideLabelsOf(stateOf(true, null, null))).toBeNull();
        expect(sideLabelsOf(stateOf(true, { employer: 'FS' }, null))).toBeNull(); // legacy no-side contract
    });
    it('a SIGNED contract maps WIRE-side-independently: a = the signing company, b = the enemy (side "a" signed)', () => {
        const l = sideLabelsOf(stateOf(true, { side: 'a', employer: 'Federated Suns', sideRole: 'attacker', enemyFaction: 'Draconis Combine' }, null));
        expect(l).toEqual({ a: 'Federated Suns (attacker)', b: 'Draconis Combine' });
    });
    it('signing the authored side "b" does NOT flip the labels (the panel catch): BLUFOR is still the signer', () => {
        const l = sideLabelsOf(stateOf(true, { side: 'b', employer: 'Draconis Combine', sideRole: 'defender', enemyFaction: 'Federated Suns' }, null));
        expect(l).toEqual({ a: 'Draconis Combine (defender)', b: 'Federated Suns' });
    });
    it('pre-sign, the PRESENTED pair maps by its authored keys (side-A players default to BLUFOR)', () => {
        const l = sideLabelsOf(stateOf(true, null, { sides: [{ key: 'a', employer: 'FS', role: 'attacker', vs: 'DC' }, { key: 'b', employer: 'DC', role: 'defender', vs: 'FS' }] } as Partial<PresentedHotspot>));
        expect(l).toEqual({ a: 'FS (attacker)', b: 'DC (defender)' });
    });
});

describe('sha256HexFallback + anonIdWeb (P4 — the insecure-origin fallback)', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    it('matches the FIPS 180-4 vectors', () => {
        expect(sha256HexFallback(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256HexFallback(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256HexFallback(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });
    it('handles multi-block input (>55 bytes forces a second padding block)', () => {
        expect(sha256HexFallback(enc('a'.repeat(64)))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
    });
    it('anonIdWeb agrees with crypto.subtle when available AND yields the server format (anon- + 16 hex)', async () => {
        const id = await anonIdWeb('tok-abc');
        expect(id).toMatch(/^anon-[0-9a-f]{16}$/);
        // the fallback must agree with the subtle path byte-for-byte
        const viaFallback = 'anon-' + sha256HexFallback(enc('tok-abc')).slice(0, 16);
        expect(id).toBe(viaFallback);
    });
});

describe('sideLabelsOf — P2a: the player device holds only the player-safe summary (H14)', () => {
    it('yields the SAME labels from contractSummary alone as from the full contract', () => {
        const full = stateOf(true, { side: 'b', employer: 'Draconis Combine', sideRole: 'defender', enemyFaction: 'Federated Suns' }, null);
        const summaryOnly = { ...stateOf(true, null, null), contractSummary: signal({ side: 'b', employer: 'Draconis Combine', sideRole: 'defender', enemyFaction: 'Federated Suns' } as unknown as ContractSummary) };
        expect(sideLabelsOf(summaryOnly)).toEqual(sideLabelsOf(full));
        expect(sideLabelsOf(summaryOnly)).toEqual({ a: 'Draconis Combine (defender)', b: 'Federated Suns' });
    });
});
