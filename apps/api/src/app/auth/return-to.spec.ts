import { frontendOrigins, oauthLanding, safeReturnTo } from './return-to';

const PROD = ['https://bcengine.org'];
const TWO = ['https://bcengine.org', 'https://preview.bce.pages.dev'];

describe('frontendOrigins', () => {
    it('splits the comma list, trims, drops trailing slashes and empties', () => {
        expect(frontendOrigins('https://bcengine.org/, https://preview.bce.pages.dev ,,')).toEqual(TWO);
        expect(frontendOrigins(undefined)).toEqual([]);
        expect(frontendOrigins('')).toEqual([]);
    });
});

describe('safeReturnTo — the shapes that survive', () => {
    it('a same-site path lands on the canonical (first) origin with its query string intact', () => {
        expect(safeReturnTo('/player/?campaign=abc-123&engine=https%3A%2F%2Fapi.example%2Fapi', PROD))
            .toBe('https://bcengine.org/player/?campaign=abc-123&engine=https%3A%2F%2Fapi.example%2Fapi');
    });
    it('a path keeps an unencoded engine URL inside its query (the QR form)', () => {
        expect(safeReturnTo('/player/?campaign=x&engine=http://localhost:3000/api', PROD))
            .toBe('https://bcengine.org/player/?campaign=x&engine=http://localhost:3000/api');
    });
    it('a path with no configured origin stays relative (the dev/LAN posture, relative to the api as today)', () => {
        expect(safeReturnTo('/player/?campaign=x', [])).toBe('/player/?campaign=x');
    });
    it('drops a fragment from a path (the session fragment is appended by the landing, never carried in)', () => {
        expect(safeReturnTo('/player/?campaign=x#bce_auth=stolen', PROD)).toBe('https://bcengine.org/player/?campaign=x');
    });
    it('an absolute URL on an allow-listed origin round-trips (origin + path + search, fragment dropped)', () => {
        expect(safeReturnTo('https://preview.bce.pages.dev/player/?campaign=x#h', TWO)).toBe('https://preview.bce.pages.dev/player/?campaign=x');
        expect(safeReturnTo('https://bcengine.org/player/?campaign=x', TWO)).toBe('https://bcengine.org/player/?campaign=x');
    });
});

describe('safeReturnTo — the shapes that must NOT redirect off-site', () => {
    const rejected: unknown[] = [
        'https://evil.example/player/?campaign=x', // foreign origin
        'https://bcengine.org.evil.example/x', // origin suffix trick
        'https://bcengine.org:8443/x', // same host, different port = a different origin
        'http://bcengine.org/x', // scheme downgrade = a different origin
        '//evil.example/x', // protocol-relative
        '/\\evil.example', // backslash (some parsers treat it as '/')
        '\\\\evil.example', // UNC-ish
        'javascript:alert(1)', // scheme
        'data:text/html,hi',
        'player/?campaign=x', // bare relative (no leading slash)
        '/player/?c=x\nSet-Cookie: a=b', // header injection chars
        '/player/?c=x y', // whitespace
        '', // empty
        undefined, null, 42, ['/x'], { returnTo: '/x' }, // non-strings
        '#only-a-fragment',
        '/'.padEnd(2049, 'a'), // over the cap
    ];
    for (const r of rejected) {
        it(`rejects ${JSON.stringify(r)?.slice(0, 40)}`, () => {
            expect(safeReturnTo(r, TWO)).toBeNull();
        });
    }
});

describe('oauthLanding', () => {
    it('lands on the validated target with the JWT on the fragment', () => {
        expect(oauthLanding(PROD, '/player/?campaign=x&engine=e', 'tok.en')).toBe('https://bcengine.org/player/?campaign=x&engine=e#bce_auth=tok.en');
    });
    it('falls back to the root — byte-identical to the pre-redirect — when the target is missing or rejected', () => {
        expect(oauthLanding(PROD, undefined, 't')).toBe('https://bcengine.org/#bce_auth=t');
        expect(oauthLanding(PROD, 'https://evil.example/', 't')).toBe('https://bcengine.org/#bce_auth=t');
        expect(oauthLanding([], undefined, 't')).toBe('/#bce_auth=t');
    });
    it('URL-encodes the token', () => {
        expect(oauthLanding(PROD, '/p', 'a b&c')).toBe('https://bcengine.org/p#bce_auth=a%20b%26c');
    });
});
