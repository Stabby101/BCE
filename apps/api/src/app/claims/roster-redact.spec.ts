import { anonId, redactLobby, redactClaims } from './roster-redact';

describe('anonId', () => {
    it('is stable (same token → same id)', () => {
        expect(anonId('tok-abc')).toBe(anonId('tok-abc'));
    });
    it('is prefixed anon- and never equals the raw token (non-reversible surface)', () => {
        const id = anonId('tok-abc');
        expect(id.startsWith('anon-')).toBe(true);
        expect(id).not.toBe('tok-abc');
        expect(id).not.toContain('tok-abc');
    });
    it('distinguishes different tokens', () => {
        expect(anonId('a')).not.toBe(anonId('b'));
    });
});

describe('redactLobby', () => {
    const roster = [
        { token: 'p1', name: 'One', side: 'BLUFOR', connected: true },
        { token: 'p2', name: 'Two', side: 'OPFOR', connected: false },
        { token: 'p3', name: 'Three', side: 'BLUFOR', connected: true },
    ];
    it('replaces OTHER players\' token with anonId, leaves the recipient\'s OWN token intact', () => {
        const out = redactLobby(roster, 'p1');
        expect(out[0].token).toBe('p1');              // own — untouched
        expect(out[1].token).toBe(anonId('p2'));       // other — redacted
        expect(out[2].token).toBe(anonId('p3'));
        // non-token fields are preserved verbatim
        expect(out[1]).toMatchObject({ name: 'Two', side: 'OPFOR', connected: false });
    });
    it('redacts ALL when the recipient owns none (e.g. an observer with no bound token)', () => {
        const out = redactLobby(roster, undefined);
        expect(out.map((r) => r.token)).toEqual([anonId('p1'), anonId('p2'), anonId('p3')]);
    });
    it('does not mutate the input roster', () => {
        const copy = JSON.parse(JSON.stringify(roster));
        redactLobby(roster, 'p1');
        expect(roster).toEqual(copy);
    });
    const prefRoster = [
        { token: 'p1', name: 'One', side: 'BLUFOR', connected: true, sidePref: 'a' as string | null },
        { token: 'p2', name: 'Two', side: 'OPFOR', connected: false, sidePref: 'b' as string | null },
    ];
    it("strips OTHER players' sidePref to null, keeps the recipient's OWN preference ", () => {
        const out = redactLobby(prefRoster, 'p1');
        expect(out[0].sidePref).toBe('a');   // own — kept
        expect(out[1].sidePref).toBeNull();  // other — stripped (advisory prefs fan to the GM, never to players)
        expect(out[1].name).toBe('Two');     // everything else preserved
    });
    it('rows WITHOUT a sidePref field stay byte-identical under redaction (the pre-shape)', () => {
        const out = redactLobby(roster, 'p1');
        expect('sidePref' in out[1]).toBe(false);
    });
    it('does not mutate the input roster when stripping prefs', () => {
        const copy = JSON.parse(JSON.stringify(prefRoster));
        redactLobby(prefRoster, 'p1');
        expect(prefRoster).toEqual(copy);
    });
});

describe('redactClaims', () => {
    const set = [
        { instanceId: 'u1', holderName: 'One', holderToken: 'p1', at: 1 },
        { instanceId: 'u2', holderName: 'Two', holderToken: 'p2', at: 2 },
        { instanceId: 'u3', holderName: '', holderToken: '', at: 3 }, // unclaimed/legacy — blank holderToken
    ];
    it('replaces OTHER holders\' holderToken with anonId, keeps the recipient\'s OWN holderToken', () => {
        const out = redactClaims(set, 'p1');
        expect(out[0].holderToken).toBe('p1');             // own claim — untouched
        expect(out[1].holderToken).toBe(anonId('p2'));      // other holder — redacted
        expect(out[0]).toMatchObject({ instanceId: 'u1', holderName: 'One', at: 1 });
    });
    it('leaves a blank holderToken as-is (an unclaimed row is not redacted to a handle)', () => {
        const out = redactClaims(set, 'p1');
        expect(out[2].holderToken).toBe('');
    });
    it('does not mutate the input set', () => {
        const copy = JSON.parse(JSON.stringify(set));
        redactClaims(set, 'p1');
        expect(set).toEqual(copy);
    });
});
