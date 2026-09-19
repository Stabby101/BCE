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
