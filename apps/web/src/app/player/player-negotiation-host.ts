/*
 * GM-2 P2b — the PLAYER-side NegotiationHost: a player's accept never starts the tree (the GM's does), so the three
 * tree calls are no-ops and hasGeneratedTrack reads true (no back-out is ever offered here); the participant's signing
 * goes to the GM device as a `sign-contract` intent (validated server-side, applied through the GM's own setters — the
 * one-writer law). The receipt lands on rt.lastSignResult for the brief's honest note.
 */
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
