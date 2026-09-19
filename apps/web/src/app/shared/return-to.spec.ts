import { safeTablePath } from './return-to';

describe('safeTablePath (P3 — the client Back-to-the-table gate)', () => {
    it('accepts a same-origin /player/ join path, query preserved, fragment dropped', () => {
        expect(safeTablePath('/player/?campaign=abc-123&engine=https%3A%2F%2Fapi%2Fapi')).toBe('/player/?campaign=abc-123&engine=https%3A%2F%2Fapi%2Fapi');
        expect(safeTablePath('/player/?campaign=x#bce_auth=stolen')).toBe('/player/?campaign=x');
        expect(safeTablePath('/player')).toBe('/player');
        expect(safeTablePath('/player/')).toBe('/player/');
    });
    it('refuses another origin, a protocol-relative host, and any non-/player path', () => {
        expect(safeTablePath('https://evil.example/player/?campaign=x')).toBeNull();
        expect(safeTablePath('//evil.example/player/')).toBeNull();
        expect(safeTablePath('http://bcengine.org/player/?campaign=x')).toBeNull(); // absolute → refused (same-origin only)
        expect(safeTablePath('/campaign?x=1')).toBeNull(); // the root app, not the table
        expect(safeTablePath('/playerx/?a=1')).toBeNull(); // prefix-spoof
        expect(safeTablePath('/')).toBeNull();
    });
    it('refuses backslash / whitespace / control chars / over-length / non-strings', () => {
        expect(safeTablePath('/player/\\..\\etc')).toBeNull();
        expect(safeTablePath('/player/ ?campaign=x')).toBeNull();
        expect(safeTablePath('/player/\t?c=x')).toBeNull();
        expect(safeTablePath('/player/?c=' + 'a'.repeat(3000))).toBeNull();
        expect(safeTablePath(null)).toBeNull();
        expect(safeTablePath(42 as unknown)).toBeNull();
        expect(safeTablePath('')).toBeNull();
    });
});
