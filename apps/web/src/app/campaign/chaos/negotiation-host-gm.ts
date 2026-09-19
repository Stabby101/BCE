import { inject } from '@angular/core';
import { MissionTreeService } from '../mission/mission-tree.service';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { NEGOTIATION_HOST, type NegotiationHost } from './negotiation-host';

export function gmNegotiationHost(): NegotiationHost {
    const tree = inject(MissionTreeService); const state = inject(NewCampaignState); const store = inject(CampaignSaveStore);
    return {
        mintRoot: (off, root) => tree.mintRoot(off, root),
        closeTree: (off) => tree.closeTree(off),
        hasGeneratedTrack: () => tree.hasGeneratedTrack(),
        signParticipant: (key, contract) => { state.setParticipantContract(key, { ...contract, signedBy: 'gm', repSettled: false }); void store.persistCurrent(); },
    };
}
export const GM_NEGOTIATION_HOST_PROVIDER = { provide: NEGOTIATION_HOST, useFactory: gmNegotiationHost };
