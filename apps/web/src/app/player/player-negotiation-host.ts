import { inject } from '@angular/core';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { NEGOTIATION_HOST, type NegotiationHost } from '../campaign/chaos/negotiation-host';

export function playerNegotiationHost(): NegotiationHost {
    const rt = inject(ClaimRealtimeService);
    return {
        mintRoot: () => { /* the GM's accept mints the tree; a player's never does */ },
        closeTree: () => { /* no tree on the player device */ },
        hasGeneratedTrack: () => true,
        signParticipant: (key, contract) => { void rt.sendSignContract(key, contract as unknown as Record<string, unknown>); },
    };
}
export const PLAYER_NEGOTIATION_HOST_PROVIDER = { provide: NEGOTIATION_HOST, useFactory: playerNegotiationHost };
