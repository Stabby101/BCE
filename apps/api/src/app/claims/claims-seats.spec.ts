import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaimsService } from './claims.service';
import { SEAT_KEY } from './odm-seats';

describe('ClaimsService.seatHolders — P1 (the seat map is sticky across engagements)', () => {
    let svc: ClaimsService;
    let dir: string;
    const map = (campaignId: string) => Object.fromEntries(svc.seatHolders(campaignId).map((c) => [c.instanceId, c.holderToken]));

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bce-seats-spec-'));
        process.env['BCE_DB_PATH'] = join(dir, 'spec.db');
        svc = new ClaimsService();
        svc.onModuleInit();
    });
    afterEach(() => {
        delete process.env['BCE_DB_PATH'];
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* held handles on win are fine — temp dir */ }
    });

    it('nobody has ever claimed → nobody holds a seat', () => {
        expect(svc.seatHolders('c1')).toEqual([]);
    });
    it('a seat SURVIVES the next engagement: the new key starts empty, the seat map does not', () => {
        svc.claim('c1', 'PALE_CANDLE', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', 'PALE_CANDLE', 'unit-B', 'Bravo', 'tok-bravo', 110);
        expect(svc.list('c1', 'LAST_BEARING')).toEqual([]);                                  // the fixture is well-formed: a NEW engagement has no claims
        expect(map('c1')).toEqual({ 'unit-A': 'tok-alpha', 'unit-B': 'tok-bravo' });        // …yet both players still hold the seats they flew
    });
    it('the MOST RECENT claim wins: a later engagement re-seats the unit, whatever the key order', () => {
        svc.claim('c1', 'ZZ_FIRST', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', 'AA_LATER', 'unit-A', 'Bravo', 'tok-bravo', 200);
        expect(map('c1')).toEqual({ 'unit-A': 'tok-bravo' });
        expect(svc.seatHolders('c1')[0].holderName).toBe('Bravo');
    });
    it('a RELEASE deletes its row — the seat falls back to whoever held it before', () => {
        svc.claim('c1', 'M1', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', 'M2', 'unit-A', 'Bravo', 'tok-bravo', 200);
        svc.release('c1', 'M2', 'unit-A');
        expect(map('c1')).toEqual({ 'unit-A': 'tok-alpha' });
        svc.release('c1', 'M1', 'unit-A');
        expect(map('c1')).toEqual({});
    });
    it('P5: the GM SEATS a player between missions — one row under the reserved key, newer than any battle claim', () => {
        svc.claim('c1', 'M1', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', SEAT_KEY, 'unit-A', 'Bravo', 'tok-bravo', 200);
        expect(map('c1')).toEqual({ 'unit-A': 'tok-bravo' });
        expect(svc.list('c1', 'M1').map((c) => c.holderToken)).toEqual(['tok-alpha']); // the engagement's own record is untouched
        svc.claim('c1', SEAT_KEY, 'unit-A', 'Charlie', 'tok-charlie', 300);           // re-seating REPLACES the one reserved row
        expect(map('c1')).toEqual({ 'unit-A': 'tok-charlie' });
        expect(svc.list('c1', SEAT_KEY).length).toBe(1);
    });
    it('P5: the GM UNSEATS — a tombstone clears the seat as of its time; older claims do NOT resurface; a LATER claim re-seats', () => {
        svc.claim('c1', 'M1', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', 'M2', 'unit-A', 'Bravo', 'tok-bravo', 200);
        svc.claim('c1', SEAT_KEY, 'unit-A', '', '', 300);                              // the unseat
        expect(map('c1')).toEqual({});                                                 // NOT Bravo, NOT Alpha — the GM cleared it
        expect(svc.list('c1', 'M2').map((c) => c.holderToken)).toEqual(['tok-bravo']); // M2's record still says who flew it
        svc.claim('c1', 'M3', 'unit-A', 'Alpha', 'tok-alpha', 400);                    // the next lobby: Alpha claims it
        expect(map('c1')).toEqual({ 'unit-A': 'tok-alpha' });
    });
    it('P5: an empty-token row under an ORDINARY key is not a tombstone (only the reserved key clears a seat)', () => {
        svc.claim('c1', 'M1', 'unit-A', 'Alpha', 'tok-alpha', 100);
        svc.claim('c1', 'M2', 'unit-A', '', '', 200);
        expect(map('c1')).toEqual({ 'unit-A': 'tok-alpha' });
    });

    it('campaign-scoped: another campaign\'s claims never seat anyone here', () => {
        svc.claim('c-other', 'M1', 'unit-A', 'Stranger', 'tok-x', 100);
        expect(map('c1')).toEqual({});
    });
});
