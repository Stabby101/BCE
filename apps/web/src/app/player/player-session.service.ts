/*
 * BCE PLAYER (DEPLOY-002 P4) — the HOSTED JOIN bridge. A player lands here from the GM Lobby's QR / share
 * link, which now points at the PUBLIC player URL carrying the campaign: `<player-url>/?campaign=<id>&engine=<api>`.
 * In cloud mode the player's REST is gated (no GM account), so this:
 *   1. adopts the campaignId from the URL (so the player joins the RIGHT room — not the host's "last");
 *   2. enables the socket snapshot-sync so the roster / OpFor arrive over the P3-confined socket, not REST.
 * On LAN (auth off) the player still rehydrates via REST exactly as before; a URL ?campaign simply takes
 * precedence (correct — the QR is for THIS campaign). Player-layer only → never enters the GM bundle.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { sessionPhase } from '../campaign/chaos/chaos-contract'; // PD3 P2 — the session phase (the retention yields at 'complete')
import { NewCampaignState } from '../campaign/new-campaign-state';
import type { CampaignSnapshot } from '../campaign/campaign-persistence.service';
import type { MissionSpec } from '../campaign/mission/mission-spec';
import { sessionClockNotice, type SessionClockNotice } from '../campaign/gm/session-clock-notice';

// slept through the fan is still told on reconnect). Written on the first sight (silently) and on dismiss.
const SEEN_DATE_KEY = (campaignId: string) => `bce.session.date.${campaignId}`;

// typed (name + side) in sessionStorage (per-tab, survives the redirect chain on the same origin); on return the
// stash is restored and consumed. A stash older than this is stale (an abandoned attempt) and is dropped unread.
const SIGNIN_STASH_KEY = 'bce.player.signin-stash';
const SIGNIN_STASH_TTL_MS = 10 * 60 * 1000;

// P5 (ORDER-2 b) — the device's LAST SUCCESSFUL JOIN (campaign + the engine it joined through), localStorage, same
// origin + key family as bce.auth.token. Written at the JOIN tap; read on any player boot that carries NO ?campaign
// (an in-place reload on /player/sheet, an iOS tab restore) so the device rebinds to its table instead of falling to
// "Scan the GM's QR code". A `bce.*` key → ?fresh=1 (freshReset) clears it. A ?campaign on the URL always wins.
const LAST_JOIN_KEY = 'bce.player.lastjoin';
const ENGINE_URL_KEY = 'bce.engine.url';
export interface LastJoin { campaign: string; engine: string | null; at: number }
/** Parse a persisted last-join record; null when absent or malformed (a device never rebinds to garbage). */
export function parseLastJoin(raw: string | null): LastJoin | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw) as { campaign?: unknown; engine?: unknown; at?: unknown };
        if (typeof v?.campaign !== 'string' || !v.campaign) return null;
        return { campaign: v.campaign, engine: typeof v.engine === 'string' && v.engine ? v.engine : null, at: typeof v.at === 'number' ? v.at : 0 };
    } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class PlayerSessionService {
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly state = inject(NewCampaignState);

    //    no branch is ACTIVE, so the fanned snapshot after a resolve carries NO spec and an OPFOR device's roster + sheet
    //    (missionSpec.opforForce) emptied. On the PLAYER's hydrate the last spec that carried an OpFor is kept and re-applied
    //    while the live snapshot has none — the same posture BLUFOR already has via deployedSet — marked "Resolved — awaiting
    //    the next deploy" (specRetained) until a NEW spec arrives (a live spec always wins and replaces the retained one) or
    //    the device switches campaign. Nothing about what the dashboard clears changes; the player's mirror is the only writer.
    private retainedSpec: MissionSpec | null = null;
    private retainedFor: string | null = null; // the campaign the retained spec belongs to
    /** True while the roster/sheet show the RETAINED spec (the live snapshot has none): the roster banner + the read-only sheet. */
    readonly specRetained = signal(false);
    /** ORDER-5 E-4 — the RESOLVED view: the client's inference (a retained spec) OR the SERVER's word (the ORDER-4 close, read off
     *  the battle-sync reply / the room event). The banner and the read-only gate read this; the text says which. */
    readonly resolvedView = computed(() => this.specRetained() || this.rt.engagementClosed());
    /** ORDER-5 E-4 — the server's flag alone (for the surfaces' data attributes — a harness reads WHICH path lit the banner). */
    readonly serverClosed = computed(() => this.rt.engagementClosed());
    /** The banner line: the server's word when it has spoken, else the client's inference. */
    readonly resolvedLine = computed(() => this.rt.engagementClosed()
        ? 'Resolved — the GM closed this engagement. Your last roster is shown read-only.'
        : 'Resolved — awaiting the next deploy. Your last roster is shown read-only.');
    private retainOrReapply(snap: CampaignSnapshot): void {
        const id = untracked(() => this.store.campaignId());
        const live = snap.missionSpec ?? null;
        if (live && (live.opforForce?.length ?? 0) > 0) { this.retainedSpec = live; this.retainedFor = id; this.specRetained.set(false); return; }
        if (live) { this.specRetained.set(false); return; } // a live spec without an OpFor (pre-roll) is the truth — nothing to retain over it
        if (sessionPhase({ presented: snap.presentedHotspot, contract: snap.contractSummary ?? snap.activeChaosContract, completed: snap.completedChaosContract, tree: snap.missionTree, spec: live }) === 'complete') { this.dropRetained(); return; }
        if (this.retainedSpec && this.retainedFor === id) { this.state.setMissionSpec(this.retainedSpec); this.specRetained.set(true); return; }
        this.specRetained.set(false);
    }
    private dropRetained(): void { this.retainedSpec = null; this.retainedFor = null; this.specRetained.set(false); }
    readonly returnedFromSignIn = signal(false);
    markSignInReturn(): void { this.returnedFromSignIn.set(true); }
    stashForSignIn(v: { name: string; side: string }): void {
        try { sessionStorage.setItem(SIGNIN_STASH_KEY, JSON.stringify({ ...v, ts: Date.now() })); } catch { /* no sessionStorage — the name is re-typed */ }
    }
    /** Read + consume the stash (null when absent, malformed, or stale). */
    takeSignInStash(): { name: string; side: string } | null {
        try {
            const raw = sessionStorage.getItem(SIGNIN_STASH_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(SIGNIN_STASH_KEY);
            const v = JSON.parse(raw) as { name?: unknown; side?: unknown; ts?: unknown };
            if (typeof v?.ts !== 'number' || Date.now() - v.ts > SIGNIN_STASH_TTL_MS) return null;
            return { name: typeof v.name === 'string' ? v.name : '', side: typeof v.side === 'string' ? v.side : '' };
        } catch { return null; }
    }

    readonly clockNotice = signal<SessionClockNotice | null>(null);
    private seenDateKey(campaignId: string): string | null { try { return localStorage.getItem(SEEN_DATE_KEY(campaignId)); } catch { return null; } }
    private ackDate(campaignId: string, key: string): void { try { localStorage.setItem(SEEN_DATE_KEY(campaignId), key); } catch { /* no storage — the notice re-shows next time, never lost */ } }
    /** The player read it: acknowledge the date it names and take the notice down. */
    dismissClockNotice(): void {
        const n = this.clockNotice(); const id = this.store.campaignId();
        if (n && id) this.ackDate(id, n.key);
        this.clockNotice.set(null);
    }

    constructor() {
        // Hydrate the roster/OpFor whenever the host snapshot arrives over the socket (cloud: REST is gated).
        // Set up here (constructor = injection context); start() below is called after the awaited init.
        effect(() => {
            const snap = this.rt.campaignSnapshot();
            if (snap) { this.store.hydrateFromSocket(snap as CampaignSnapshot); this.retainOrReapply(snap as CampaignSnapshot); }
            // gated on the snapshot's own gmSession flag (a plain campaign's device never notifies); the first sight acks silently.
            // Reads below are UNTRACKED so this effect's dependency stays the snapshot alone (a dismiss must not re-hydrate).
            const id = untracked(() => this.store.campaignId());
            if (snap && id) {
                const r = sessionClockNotice(snap as CampaignSnapshot, this.seenDateKey(id));
                if (r.ack) this.ackDate(id, r.ack);
                if (r.notice && r.notice.key !== untracked(() => this.clockNotice())?.key) this.clockNotice.set(r.notice);
            }
        });
    }

    // ── P5 (ORDER-2 b) — the persisted last join + the rebind ──
    /** The campaign this boot REBOUND to from the persisted last join (null when the URL carried ?campaign, or nothing
     *  was persisted). The join page reads it: "Resuming SESSION … · not you? Scan a new code" — a device that changed
     *  tables is told, never silently rebound. */
    readonly resumed = signal<string | null>(null);
    /** Persist the join the device just made (the JOIN tap): the bound campaign + the engine it reached it through. */
    rememberJoin(): void {
        const campaign = this.store.campaignId();
        if (!campaign) return;
        let engine: string | null = null;
        try { engine = localStorage.getItem(ENGINE_URL_KEY); } catch { /* no storage → engine null; the campaign alone still rebinds */ }
        const rec: LastJoin = { campaign, engine, at: Date.now() };
        try { localStorage.setItem(LAST_JOIN_KEY, JSON.stringify(rec)); } catch { /* no storage — a reload falls to the join prompt as before */ }
    }
    lastJoin(): LastJoin | null { try { return parseLastJoin(localStorage.getItem(LAST_JOIN_KEY)); } catch { return null; } }

    start(): void {
        const params = new URLSearchParams(location.search);
        const urlId = params.get('campaign') || params.get('c');
        const last = urlId ? null : this.lastJoin();
        const id = urlId ?? last?.campaign ?? null;
        if (!id) return; // no hosted-join param, nothing persisted → honest join prompt (campaignId null) or the LAN rehydrated state
        if (last) {
            // the engine the join went through, restored if the stored one drifted (the record is the join's own value, never a guess)
            try { if (last.engine && localStorage.getItem(ENGINE_URL_KEY) !== last.engine) localStorage.setItem(ENGINE_URL_KEY, last.engine); } catch { /* keep the stored value */ }
            this.resumed.set(id);
        }
        const current = this.store.campaignId();
        if (current && current !== id) { this.rt.resetCampaignResidue(); this.dropRetained(); }
        this.store.setCampaignId(id); // the player components' effect joins THIS room over the socket
        this.rt.enableCampaignSync(); // pull the host snapshot over the P3-confined socket (cloud roster)
    }
}
