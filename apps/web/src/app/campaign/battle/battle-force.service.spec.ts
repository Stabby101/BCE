import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BattleForceService, BattleEntry, Side } from './battle-force.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from '../barracks/pilot.service';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';

describe('BattleForceService.entryFor — ORDER-9 Commit 1: a terminal entry is never resurrected', () => {
    let svc: BattleForceService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                BattleForceService,
                // getUnitByName/getUnits return "nothing" so the MUTATED path resolves to a fresh 'missing'
                // entry (a clean assertion failure) instead of throwing on an empty stub.
                { provide: DataService, useValue: { getUnitByName: () => undefined, getUnits: () => [] } },
                { provide: LoggerService, useValue: { warn: () => undefined, info: () => undefined } },
                { provide: UnitInitializerService, useValue: {} },
                { provide: NewCampaignState, useValue: {} },
                { provide: CampaignSaveStore, useValue: {} },
                { provide: PilotService, useValue: {} },
                { provide: ClaimRealtimeService, useValue: { onBattle: () => () => undefined } },
            ],
        });
        svc = TestBed.inject(BattleForceService);
    });

    const KEY = 'blufor:x';
    const inst: Record<string, unknown> = { instanceId: 'x', chassis: 'Atlas', model: 'AS7-D', tons: 100, unitRef: 'Atlas AS7-D' };
    const cache = () => (svc as unknown as { cache: Map<string, BattleEntry> }).cache;
    const seed = (status: BattleEntry['status']): BattleEntry => {
        const e: BattleEntry = { side: 'blufor' as Side, instanceId: 'x', name: 'Atlas', model: 'AS7-D', tons: 100, status, ...(status === 'error' ? { error: 'boom' } : {}) };
        cache().set(KEY, e);
        return e;
    };
    const entryFor = (): BattleEntry => (svc as unknown as { entryFor: (s: Side, i: object, n: number) => BattleEntry }).entryFor('blufor', inst as object, 0);

    it("returns a cached 'error' entry UNCHANGED — never re-creates it 'pending' (the H20 loop cannot form)", () => {
        const e = seed('error');
        const got = entryFor();
        expect(got).toBe(e); // the SAME object — not a fresh entry
        expect(got.status).toBe('error');
        expect(got.error).toBe('boom');
    });

    it("returns a cached 'missing' entry UNCHANGED", () => {
        const e = seed('missing');
        const got = entryFor();
        expect(got).toBe(e);
        expect(got.status).toBe('missing');
    });

    it("still returns a cached 'ok' entry unchanged (byte-identical to before the fix)", () => {
        const e = seed('ok');
        expect(entryFor()).toBe(e);
    });

    it("still returns a cached 'loading' entry unchanged", () => {
        const e = seed('loading');
        expect(entryFor()).toBe(e);
    });

    it('retrySheet(side, id) drops the cached entry — the ONLY path back to a fresh load', () => {
        seed('error');
        expect(cache().has(KEY)).toBe(true);
        svc.retrySheet('blufor', 'x');
        expect(cache().has(KEY)).toBe(false); // next derivation rebuilds it 'pending'
    });
});

/*
 * TABLE-2 T2-3 Layer 1 — the FAST mutation-kill for the crew-fan trigger. A crew/pilot hit is a plain property
 * (not a signal), so before the fix the mirror effect never re-fired on a pilot hit alone: the hit reached the
 * host only as a passenger on an armor/crit edit or at END PHASE, and a hit recorded without either was lost
 * (the SHORT COUNT pilot injury). The fix bumps CBTForceUnit.crewTrigger on every crew change and the mirror
 * tracks it, so a pilot hit FANS ON ITS OWN. This spec pins that in ms with no build; reverting
 * battle-force.service.ts's `fu.crewTrigger()` from the tracked set fails it directly. The E2E witnesses the
 * server-observable layers (verify-t2injury.js: L3 gate, L2 injury→infirmary).
 */
describe('TABLE-2 T2-3 — the battle mirror fans a pilot hit on its own (crewTrigger)', () => {
    let svc: BattleForceService;
    let publishBattle: jasmine.Spy;
    beforeEach(() => {
        publishBattle = jasmine.createSpy('publishBattle');
        TestBed.configureTestingModule({
            providers: [
                BattleForceService,
                { provide: DataService, useValue: { getUnitByName: () => undefined, getUnits: () => [] } },
                { provide: LoggerService, useValue: { warn: () => undefined, info: () => undefined, error: () => undefined } },
                { provide: UnitInitializerService, useValue: {} },
                { provide: NewCampaignState, useValue: {} },
                { provide: CampaignSaveStore, useValue: {} },
                { provide: PilotService, useValue: {} },
                { provide: ClaimRealtimeService, useValue: { onBattle: () => () => undefined, publishBattle } },
            ],
        });
        svc = TestBed.inject(BattleForceService);
    });

    // a minimal fake fu: the mirror tracks these six getters; liveState/extractDamage read serialize().state.
    const mkFu = (crewHits: () => number, ct: ReturnType<typeof signal<number>>) => ({
        getLocations: signal({}), getCritSlots: signal([]), getInventory: signal([]), getHeat: signal({}),
        phaseTrigger: signal(0), crewTrigger: ct,
        serialize: () => ({ state: { crew: [{ hits: crewHits() }], locations: {}, crits: [], inventory: [] } }),
    });

    it('a crew-hit change (crewTrigger bump) fans the unit ON ITS OWN — no armor edit, no END PHASE', () => {
        const crewHits = signal(0);
        const ct = signal(0);
        (svc as unknown as { instById: Map<string, unknown> }).instById.set('blufor:x', { instanceId: 'x', damage: {} });
        (svc as unknown as { authoritative: boolean }).authoritative = false;
        (svc as unknown as { registerMirror: (s: string, i: string, fu: unknown) => void }).registerMirror('blufor', 'x', mkFu(crewHits, ct));
        TestBed.tick(); // the priming run (captures the initial state, publishes nothing)
        expect(publishBattle).not.toHaveBeenCalled();
        crewHits.set(2);
        ct.update((v) => v + 1); // a pilot hit — bumps ONLY crewTrigger (locations/crits/inventory/heat/phase unchanged)
        TestBed.tick();
        expect(publishBattle).toHaveBeenCalled(); // KILLS the "crewTrigger untracked" mutation
        const args = publishBattle.calls.mostRecent().args as [string, { crew: { hits: number }[] }];
        expect(args[1].crew[0].hits).toBe(2); // and the fanned payload carries the pilot hit
    });
});
