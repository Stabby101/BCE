import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MulAllowlistService, commandMulKey, COMMAND_AFFILIATIONS, DEFAULT_AFFILIATION, hsFactionToMulFaction } from './mul-allowlist.service';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';

describe('ORDER-15 (a) · commandMulKey + the affiliation options', () => {
    it('Mercenary is the default and first; the options are exactly the canon keys', () => {
        expect(DEFAULT_AFFILIATION).toBe('Mercenary');
        expect(COMMAND_AFFILIATIONS[0]).toBe('Mercenary');
        expect(COMMAND_AFFILIATIONS.length).toBe(10);
        expect(new Set(COMMAND_AFFILIATIONS).size).toBe(10);
        for (const a of COMMAND_AFFILIATIONS) expect(hsFactionToMulFaction(a)).withContext(a).toBe(a);
    });
    it('a declared canon affiliation keys the lists; null / empty / unknown / a NAME → Mercenary (never an alias of a name)', () => {
        expect(commandMulKey('Federated Suns')).toBe('Federated Suns');
        expect(commandMulKey('Draconis Combine')).toBe('Draconis Combine');
        for (const bad of [null, undefined, '', '  ', 'Kurita’s Lancers', 'Davion Guards', 'davion']) expect(commandMulKey(bad)).withContext(String(bad)).toBe('Mercenary');
    });
});

describe('LANDING (3) · the MUL allow-list fails CLOSED, visibly', () => {
    const ASSET = '/mekbay/mul-ilclan/allowlist.json';
    const ILCLAN = { id: 257, name: 'ilClan', years: { from: 3151, to: 9999 } };
    let svc: MulAllowlistService; let http: HttpTestingController; let state: NewCampaignState;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), { provide: DataService, useValue: { getEras: () => [ILCLAN], getUnits: () => [], isDataReady: signal(true), catalogVersion: signal(0) } }],
        });
        svc = TestBed.inject(MulAllowlistService);
        http = TestBed.inject(HttpTestingController);
        state = TestBed.inject(NewCampaignState);
        state.campaignSystem.set('hotspots');
        state.era.set({ id: 12, name: 'ilClan', from: 3151, to: 9999 });
    });
    afterEach(() => http.verify());

    it('idle → loading on ensure() → ready when the asset lands; the surfaces read loading then ready; idsFor lands with it', async () => {
        expect(svc.status()).toBe('idle');
        expect(svc.gateState()).withContext('idle counts as loading — every surface calls ensure() on construction').toBe('loading');
        expect(svc.idsFor('Mercenary')).toBeNull();
        const p = svc.ensure();
        expect(svc.status()).toBe('loading');
        expect(svc.gateState()).toBe('loading');
        http.expectOne(ASSET).flush({ Mercenary: [1, 2, 3], 'Federated Suns': [2, 3, 4] });
        await p;
        expect(svc.status()).toBe('ready');
        expect(svc.gateState()).toBe('ready');
        expect([...(svc.idsFor('Federated Suns') ?? [])]).toEqual([2, 3, 4]);
        expect(svc.idsFor('Lyran Commonwealth')).withContext('no list for it → null (the no-list line, not a lock-out)').toBeNull();
        await svc.ensure(); // idempotent: no second request (http.verify() in afterEach)
    });

    it('a failed fetch → failed, said; idsFor stays null (generation unchanged); the failure is STICKY for ensure(); retry() fetches again', async () => {
        const p = svc.ensure();
        http.expectOne(ASSET).flush('nope', { status: 500, statusText: 'Server Error' });
        await p;
        expect(svc.status()).toBe('failed');
        expect(svc.gateState()).toBe('failed');
        expect(svc.idsFor('Mercenary')).withContext('a failed list is INERT for idsFor — the OpFor generator fails open exactly as before').toBeNull();
        await svc.ensure();
        http.expectNone(ASSET); // sticky — an awaiting generator never re-waits the timeout
        expect(svc.status()).toBe('failed');
        const r = svc.retry();
        expect(svc.status()).toBe('loading');
        expect(svc.gateState()).toBe('loading');
        http.expectOne(ASSET).flush({ Mercenary: [9] });
        await r;
        expect(svc.status()).toBe('ready');
        expect([...(svc.idsFor('Mercenary') ?? [])]).toEqual([9]);
        await svc.retry(); // ready → a no-op, no request
    });

    it('a malformed body (not an object of lists) → failed, never a silent "ready with nothing"', async () => {
        const p = svc.ensure();
        http.expectOne(ASSET).flush([1, 2, 3]);
        await p;
        expect(svc.status()).toBe('failed');
        expect(svc.gateState()).toBe('failed');
        expect(svc.idsFor('Mercenary')).toBeNull();
    });

    it('the 12 s timeout → failed (a slow asset is a failed one until Retry — never a silent wait)', async () => {
        jasmine.clock().install(); // zoneless app: no fakeAsync — the rxjs timeout rides the mocked timers
        try {
            const p = svc.ensure();
            http.expectOne(ASSET); // never flushed
            jasmine.clock().tick(11999);
            await Promise.resolve();
            expect(svc.status()).toBe('loading');
            jasmine.clock().tick(2);
            await p;
            expect(svc.status()).toBe('failed');
            expect(svc.gateState()).toBe('failed');
            expect(svc.idsFor('Mercenary')).toBeNull();
        } finally { jasmine.clock().uninstall(); }
    });

    it('outside a Hot Spots ilClan campaign the gate is INERT whatever the status — Traditional says nothing', async () => {
        state.campaignSystem.set('traditional');
        expect(svc.gateState()).toBe('inert');
        const p = svc.ensure();
        http.expectOne(ASSET).flush({ Mercenary: [1] });
        await p;
        expect(svc.status()).toBe('ready');
        expect(svc.gateState()).toBe('inert');
        expect(svc.idsFor('Mercenary')).toBeNull();
        state.campaignSystem.set('hotspots');
        state.era.set({ id: 3, name: 'Succession Wars', from: 2801, to: 3049 });
        expect(svc.gateState()).withContext('Hot Spots in a non-ilClan era: inert too').toBe('inert');
    });
});
