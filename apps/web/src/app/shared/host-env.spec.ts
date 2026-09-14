/*
 * HOTFIX-028 / GM-1c — the host classification that decides hosted-vs-LAN behaviour, pinned. GM-1c's rule for the
 * join page: the per-host ("campaigns live on the host you joined") note is shown ONLY when the engine is NOT a
 * public host — never on the cloud host, where it reads as a technical failure. The browser harness can only stand
 * up a local engine (it proves the note renders there); this spec is the public branch.
 */
import { classifyHost, isLocalOrLanEngineUrl, perHostNoteApplies } from './host-env';

describe('classifyHost', () => {
    it('dev = localhost / loopback', () => {
        expect(classifyHost('localhost')).toBe('dev');
        expect(classifyHost('127.0.0.1')).toBe('dev');
        expect(classifyHost('[::1]')).toBe('dev');
    });
    it('lan = the private ranges', () => {
        expect(classifyHost('192.168.1.20')).toBe('lan');
        expect(classifyHost('10.0.0.5')).toBe('lan');
        expect(classifyHost('172.16.4.9')).toBe('lan');
        expect(classifyHost('172.31.255.1')).toBe('lan');
    });
    it('public = everything else (the prod api, Pages, a hostname)', () => {
        expect(classifyHost('bce-production.up.railway.app')).toBe('public');
        expect(classifyHost('bcengine.org')).toBe('public');
        expect(classifyHost('172.32.0.1')).toBe('public'); // just outside 172.16/12
    });
});

describe('perHostNoteApplies — GM-1c: the per-host note is never shown on the cloud host', () => {
    it('is FALSE for the production engine and any public host', () => {
        expect(perHostNoteApplies('https://bce-production.up.railway.app/api')).toBeFalse();
        expect(perHostNoteApplies('https://bcengine.org/api')).toBeFalse();
        expect(perHostNoteApplies('https://api.example.com:8443/api')).toBeFalse();
    });
    it('is TRUE for a dev or LAN engine (campaigns really do live per host there)', () => {
        expect(perHostNoteApplies('http://localhost:3000/api')).toBeTrue();
        expect(perHostNoteApplies('http://127.0.0.1:3000/api')).toBeTrue();
        expect(perHostNoteApplies('http://192.168.1.20:3000/api')).toBeTrue();
        expect(perHostNoteApplies('http://10.1.2.3:3000/api')).toBeTrue();
    });
    it('is TRUE for a malformed or empty engine URL (not a usable public value — say the note rather than hide it)', () => {
        expect(perHostNoteApplies('')).toBeTrue();
        expect(perHostNoteApplies('not a url')).toBeTrue();
        expect(perHostNoteApplies(null)).toBeTrue();
    });
    it('agrees with isLocalOrLanEngineUrl (one classification, two readers)', () => {
        for (const u of ['https://bcengine.org/api', 'http://localhost:3000/api', 'http://10.0.0.1/api', 'garbage', '']) {
            expect(perHostNoteApplies(u)).toBe(isLocalOrLanEngineUrl(u));
        }
    });
});
