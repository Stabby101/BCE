/*
 * GM-2 P2b — the NEGOTIATION HOST (R0.4's cut). The D-128 negotiation service used to inject MissionTreeService for the
 * three tree calls a PRIMARY signing needs (mint the root, close the tree, "has a track been generated"). The player
 * bundle must host the same modal and a player's accept never starts the tree — so the tree edge moves behind this
 * token: the GM hosts (the Contracts tab, the GM panel) supply the real tree + the GM's sign path; the player brief
 * supplies no-ops + the phone's sign path (a `sign-contract` intent to the GM device). The service keeps the D-128 math
 * verbatim and never names the tree again.
 */
import { InjectionToken } from '@angular/core';
import type { ContractOffer } from '../contract/contract-market';
import type { ChaosContract } from './chaos-contract';

export interface NegotiationHost {
    mintRoot(off: ContractOffer, root?: { seedId: string; name: string; trackType?: string }): void;
    closeTree(off?: ContractOffer): void;
    hasGeneratedTrack(): boolean;
    /** A PARTICIPANT's signing: the GM host writes the map + persists; the player host sends the intent. */
    signParticipant(key: string, contract: ChaosContract): void;
}
export const NEGOTIATION_HOST = new InjectionToken<NegotiationHost>('bce.negotiation.host');
