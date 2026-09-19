import { Injectable, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService, type SignRequest } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { repBudgetFor } from '../chaos/chaos-contract-steps';
import { minimalRepCost, type Steps } from '../chaos/chaos-chain-cost'; // P2b-fix — the PATH check
import { HotSpotsCatalogService, resolveSides } from '../chaos/hotspots-catalog';
import type { ChaosContract } from '../chaos/chaos-contract';

export function signRefusal(contract: ChaosContract, primary: ChaosContract | null, homeRep: number, seed?: Steps | null): string | null {
    if (!primary) return 'no session contract is signed';
    if (contract.hotspotId !== primary.hotspotId) return 'not the session\'s hot spot';
    if (contract.steps?.command !== primary.steps.command) return 'Command Rights are locked to the session\'s contract';
    if (contract.scale !== 1 && contract.scale !== 2 && contract.scale !== 3) return 'Scale must be 1, 2 or 3';
    const spent = Math.max(0, Math.round(contract.repSpent ?? 0));
    if (spent > repBudgetFor(homeRep, contract.scale)) return `rep spent (${spent}) exceeds the company's budget (${repBudgetFor(homeRep, contract.scale)})`;
    if (seed !== undefined) {
        if (!seed) return 'the session\'s hot spot is not in this device\'s catalog — the path cannot be checked';
        const chain = minimalRepCost({ ...seed, command: primary.steps.command }, contract.steps, contract.scale, { lockCommand: true });
        if (!chain.ok) return `off the chain: ${chain.reason}`;
        if (spent < chain.minimalRep) return `rep spent (${spent}) is below the chain's minimal cost (${chain.minimalRep}) for these terms`;
    }
    return null;
}

@Injectable({ providedIn: 'root' })
export class ContractSignService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly catalog = inject(HotSpotsCatalogService); // P2b-fix — the authored seed the path check re-derives from

    constructor() {
        effect(() => { // the GM device must be IN the room (the ForceImportService ensure pattern)
            if (!this.state.gmSession()) return;
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) this.rt.ensure(id, key);
        });
        effect(() => {
            if (!this.rt.signRequests().length) return;
            if (!this.state.gmSession()) return; // GM sessions only — the fan is GM-scoped, this is the belt
            const req = this.rt.consumeSignRequest();
            if (req) this.apply(req);
        });
    }

    private homeRepOf(key: string): number {
        const u = (this.state.startingForce() ?? []).find((i) => i.provenance?.origin === 'player-import' && i.provenance.sourceCampaignId === key);
        return u?.provenance?.homeReputation ?? 1;
    }
    private log(text: string): void {
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 3151, m: 0, d: 1 };
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text, kind: 'admin' as const }]);
    }
    /** The authored side's steps the phone's chain started from (the primary's hot spot, the contract's side); null when unknown. */
    private seedOf(contract: ChaosContract, primary: ChaosContract | null): Steps | null {
        const h = primary?.hotspotId ? this.catalog.hotSpotById(primary.hotspotId) : undefined;
        if (!h) return null;
        const sides = resolveSides(h);
        const s = sides[contract.side ?? 'a'] ?? sides['a'];
        return s ? { ...s.contract.steps } : null;
    }
    private apply(req: SignRequest): void {
        const contract = req.contract as unknown as ChaosContract;
        const primary = this.state.activeChaosContract();
        const why = signRefusal(contract, primary, this.homeRepOf(req.key), this.seedOf(contract, primary));
        if (why) { this.log(`Contract signing refused — ${req.name || 'Player'} (${req.key}): ${why}`); void this.store.persistCurrent(); return; }
        this.state.setParticipantContract(req.key, { ...contract, signedBy: 'player', repSettled: false, tracksDone: 0, status: 'active' });
        this.log(`Contract signed — ${req.name || 'Player'} signed their company's own terms on the session's hot spot (Scale ${contract.scale}, ${Math.max(0, Math.round(contract.repSpent ?? 0))} Rep spent)`);
        void this.store.persistCurrent(); // → the fan carries the contract to ITS device only (the P2a attach)
    }
}
