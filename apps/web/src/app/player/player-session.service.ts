/*
 * BCE PLAYER (DEPLOY-002 P4) — the HOSTED JOIN bridge. A player lands here from the GM Lobby's QR / share
 * link, which now points at the PUBLIC player URL carrying the campaign: `<player-url>/?campaign=<id>&engine=<api>`.
 * In cloud mode the player's REST is gated (no GM account), so this:
 *   1. adopts the campaignId from the URL (so the player joins the RIGHT room — not the host's "last");
 *   2. enables the socket snapshot-sync so the roster / OpFor arrive over the P3-confined socket, not REST.
 * On LAN (auth off) the player still rehydrates via REST exactly as before; a URL ?campaign simply takes
 * precedence (correct — the QR is for THIS campaign). Player-layer only → never enters the GM bundle.
 */
import { Injectable, effect, inject } from '@angular/core';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import type { CampaignSnapshot } from '../campaign/campaign-persistence.service';

@Injectable({ providedIn: 'root' })
export class PlayerSessionService {
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);

    constructor() {
        // Hydrate the roster/OpFor whenever the host snapshot arrives over the socket (cloud: REST is gated).
        // Set up here (constructor = injection context); start() below is called after the awaited init.
        effect(() => {
            const snap = this.rt.campaignSnapshot();
            if (snap) this.store.hydrateFromSocket(snap as CampaignSnapshot);
        });
    }

    /** Called AFTER the (possibly-skipped) rehydrate so the hosted-join URL's ?campaign is authoritative.
     *  HOTFIX-028: no ?campaign → leave campaignId null (the join screen prompts for the current QR; the
     *  initializer already skipped binding the stale "last" on a public origin — no zombie session). A
     *  ?campaign that DIFFERS from the currently-bound one is a switch → clear the prior campaign's residue
     *  (claims/lobby/roster/snapshot mirrors) BEFORE binding, keeping device token + player name. */
    start(): void {
        const params = new URLSearchParams(location.search);
        const id = params.get('campaign') || params.get('c');
        if (!id) return; // no hosted-join param → honest join prompt (campaignId null) or the LAN rehydrated state
        const current = this.store.campaignId();
        if (current && current !== id) this.rt.resetCampaignResidue(); // campaign switch → drop old-session residue
        this.store.setCampaignId(id); // the player components' effect joins THIS room over the socket
        this.rt.enableCampaignSync(); // pull the host snapshot over the P3-confined socket (cloud roster)
    }
}
