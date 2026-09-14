/*
 * PlayerSessionService.retainOrReapply — DIRECTIVE-PD3 P2 (PD3-11), the FAST mutation-kill for the H17 yield.
 *
 * ORDER-3 H17 retains the last OpFor-bearing spec on the player's mirror and re-applies it while the live snapshot has
 * none (an OPFOR device's roster + sheet must not empty after a resolve). PD3 P2 makes that retention YIELD once the
 * contract is COMPLETE (sessionPhase 'complete'): the re-applied spec was the brief that outlived its contract on the
 * phone, and a dead spec left in place poisons the NEXT contract's lobby (hasGeneratedTrackOf reads the spec → 'committed'
 * where the pick should be live).
 *
 * The E2E harness (verify-pd3-phone-phase) proves the phone's SURFACES; its device joins BLUFOR, so H17's OpFor-only
 * retention never runs there and a kill of the yield line SURVIVED it (2026-09-12). This spec is the witness that line
 * needs: it drives the retention directly, in milliseconds, under `nx test web` — the ORDER-9 "faster spec" shape.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PlayerSessionService } from './player-session.service';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import type { CampaignSnapshot } from '../campaign/campaign-persistence.service';
import type { MissionSpec } from '../campaign/mission/mission-spec';

describe('PlayerSessionService — ORDER-3 H17 retention YIELDS at PD3 P2 sessionPhase "complete"', () => {
    let svc: PlayerSessionService;
    let state: NewCampaignState;
    const rt = { campaignSnapshot: signal<unknown>(null), engagementClosed: signal(false), token: signal('t-1') };

    beforeEach(() => {
        rt.campaignSnapshot.set(null);
        TestBed.configureTestingModule({
            providers: [
                PlayerSessionService,
                NewCampaignState, // the real signal store — no constructor dependencies
                { provide: CampaignSaveStore, useValue: { campaignId: signal('c1'), hydrateFromSocket: (s: CampaignSnapshot) => TestBed.inject(NewCampaignState).hydrate(s) } },
                { provide: ClaimRealtimeService, useValue: rt },
            ],
        });
        state = TestBed.inject(NewCampaignState);
        svc = TestBed.inject(PlayerSessionService);
    });

    const opforSpec = { contractId: 'c-1', opforForce: [{ instanceId: 'op-1', chassis: 'Atlas', model: 'AS7-D', tons: 100, bv: 1897 }] } as unknown as MissionSpec;
    const snap = (over: Record<string, unknown>): unknown => ({
        version: 1, savedAt: 1, era: null, startDate: { y: 3151, m: 2, d: 1 }, currentDate: { y: 3151, m: 2, d: 1 }, force: null, faction: null, unit: null, unitSize: null, capital: null, resources: null,
        hotSpotCampaign: 'generic', gmSession: true, presentedHotspot: { title: 'x', sides: [] }, missionSpec: null, contractSummary: null, completedChaosContract: null, missionTree: [], ...over,
    });
    const fan = (over: Record<string, unknown>): void => { rt.campaignSnapshot.set(snap(over)); TestBed.tick(); };

    it('retains an OpFor-bearing spec, re-applies it after the resolve while the contract is LIVE (H17), and DROPS it at "complete" — the next lobby starts clean', () => {
        // a track is live: the spec carries an OpFor → retained, nothing re-applied
        fan({ missionSpec: opforSpec, contractSummary: { status: 'active' }, missionTree: [{ branchId: 'b1', state: 'ACTIVE' }] });
        expect(svc.specRetained()).toBeFalse();
        expect(state.missionSpec()?.opforForce?.length).toBe(1);
        // the GM resolved the track: the fan carries no spec, the contract is still live (more tracks) → H17 re-applies the last OpFor view
        fan({ missionSpec: null, contractSummary: { status: 'active' }, missionTree: [{ branchId: 'b1', state: 'RESOLVED' }] });
        expect(svc.specRetained()).toBeTrue();
        expect(state.missionSpec()?.opforForce?.length).toBe(1);
        // the contract COMPLETED (the terminal record, no live contract) → the retention YIELDS: nothing re-applied, the mirror's spec is null
        fan({ missionSpec: null, contractSummary: null, completedChaosContract: { status: 'completed' }, missionTree: [{ branchId: 'b1', state: 'RESOLVED' }] });
        expect(svc.specRetained()).toBeFalse();
        expect(state.missionSpec()).toBeNull();
        // the GM presents the NEXT hot spot: a live contract, nothing generated — the dead spec must NOT come back (it was dropped, not skipped)
        fan({ missionSpec: null, contractSummary: { status: 'active' }, missionTree: [{ branchId: 'b2', state: 'AVAILABLE' }] });
        expect(svc.specRetained()).toBeFalse();
        expect(state.missionSpec()).toBeNull();
    });

    it('a brief with NO contract and NO terminal record (the pre-P2 completion) also yields', () => {
        fan({ missionSpec: opforSpec, contractSummary: { status: 'active' }, missionTree: [{ branchId: 'b1', state: 'ACTIVE' }] });
        fan({ missionSpec: null, contractSummary: null, completedChaosContract: null, missionTree: [{ branchId: 'b1', state: 'RESOLVED' }] });
        expect(svc.specRetained()).toBeFalse();
        expect(state.missionSpec()).toBeNull();
    });
});
