/*
 * BCE PLAYER — JOIN screen (DIRECTIVE-048, phase A). The first thing a player sees after scanning the
 * GM's QR: pick a name, pick a side (BLUFOR/OPFOR — the side gates which force you'll see, ROLE-002),
 * tap JOIN. Name + side persist to localStorage (survive a reload) and announce to the host lobby over
 * the D-042 socket; the GM lobby shows the join live. campaignId + the engagement key come from the
 * rehydrated host campaign (app.player.config). Offline degrades honestly — JOIN waits for the host.
 * This is campaign-layer only (no dashboard, no MekBay core import) — the port-isolation boundary.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { engagementKeyOf } from '../campaign/claims/engagement-key';
import { sessionCodeOf } from '../campaign/claims/session-code';
import { evictAndReload } from '../shared/app-reset';

@Component({
    selector: 'bce-player-join',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="join">
            <header class="jhead">
                <div class="jbrand">BCE · PLAYER</div>
                <div class="jconn" [class.on]="registered()" [class.off]="!registered()">
                    {{ statusText() }}
                </div>
            </header>
            <!-- HOTFIX-029 — SESSION CODE up top: the player eyeball-matches this against the GM lobby header.
                 Different codes = a stale/wrong QR (a different campaign), visible at a glance. -->
            <div class="jsession" [class.on]="registered()" [title]="campaignId() || ''">
                <span class="js-dot" aria-hidden="true">●</span> SESSION {{ sessionCode() }}
            </div>

            <div class="jcard">
                @if (ready()) {
                    <div class="jcamp">Host <strong>{{ hostLabel() }}</strong></div>
                } @else {
                    <!-- HOTFIX-028: no bound campaign (a between-sessions re-open) → honest prompt, never a zombie
                         "connecting" to a stale session. Scanning the CURRENT QR binds ?campaign and joins live. -->
                    <div class="jcamp jwait">Scan the GM's QR code for the current session to join. <span class="jhost">({{ hostLabel() }})</span></div>
                }

                <label class="jlabel" for="pname">Your name</label>
                <input id="pname" class="jinput" type="text" autocomplete="off" autocapitalize="words"
                       maxlength="24" placeholder="Callsign" [value]="name()" (input)="onName($event)" />

                <div class="jlabel">Your side</div>
                <div class="jsides">
                    <button type="button" class="jside blu" [class.sel]="side() === 'BLUFOR'"
                            (click)="pick('BLUFOR')">BLUFOR<small>your company</small></button>
                    <button type="button" class="jside opf" [class.sel]="side() === 'OPFOR'"
                            (click)="pick('OPFOR')">OPFOR<small>the opposition</small></button>
                </div>

                <button type="button" class="jjoin" [disabled]="!canJoin()" (click)="join()">
                    {{ canJoin() ? 'JOIN BATTLE' : 'Waiting for host…' }}
                </button>
                <div class="jhint">Side gates what you see. The GM can reassign you in the lobby.</div>
            </div>
            <!-- HOTFIX-030 — manual self-heal backstop (auto-heal reconnects a stuck socket after ~7s; this lets
                 an impatient player heal now). Reconnect = re-sync the socket; Reload = evict caches + reload. -->
            <div class="pheal">Stuck? <button type="button" (click)="reconnect()">Reconnect</button>
                <span>·</span> <button type="button" (click)="reloadApp()">Reload app</button></div>
        </div>
    `,
    styles: [`
        :host { display:block; min-height:calc(100dvh - var(--bce-footer-h, 0px)); /* IMPORT-7 A — minus the reserved legal-footer space */ background:#0c0f13; color:#e7edf3;
                font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; }
        .join { max-width:460px; margin:0 auto; padding:18px 16px 32px; }
        .jhead { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .jbrand { font-weight:700; letter-spacing:.12em; font-size:12px; color:#9fb2c4; }
        .jconn { font-size:11px; letter-spacing:.06em; padding:3px 8px; border-radius:999px; border:1px solid #2a3340; }
        .jconn.on { color:#7fe3a0; border-color:#2f6b46; }
        .jconn.off { color:#e7a86b; border-color:#6b4a2f; }
        /* HOTFIX-029 — session code up top (eyeball-match vs the GM lobby). */
        .jsession { display:flex; align-items:center; gap:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                    font-size:12px; letter-spacing:.1em; color:#7f8a96; margin:0 0 14px; }
        .jsession .js-dot { color:#6b7682; }
        .jsession.on { color:#cdd8e3; }
        .jsession.on .js-dot { color:#7fe3a0; }
        /* HOTFIX-030 — the self-heal backstop row. */
        .pheal { text-align:center; margin-top:16px; font-size:12px; color:#6b7682; }
        .pheal button { background:none; border:none; color:#7fb0e6; font-size:12px; cursor:pointer; text-decoration:underline; padding:0 2px; }
        .pheal span { color:#3a424c; }
        .jcard { background:#141a21; border:1px solid #232c37; border-radius:14px; padding:18px 16px; }
        .jcamp { font-size:14px; color:#b9c6d4; margin-bottom:16px; }
        .jcamp strong { color:#fff; }
        .jwait { color:#7f8a96; font-style:italic; }
        .jlabel { display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase;
                  color:#7f8a96; margin:14px 0 6px; }
        .jinput { width:100%; box-sizing:border-box; background:#0c0f13; border:1px solid #2a3340;
                  color:#fff; border-radius:9px; padding:12px 12px; font-size:16px; }
        .jinput:focus { outline:none; border-color:#3d6ea5; }
        .jsides { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .jside { display:flex; flex-direction:column; gap:3px; align-items:center; padding:14px 8px;
                 border-radius:10px; border:1px solid #2a3340; background:#0c0f13; color:#cdd8e3;
                 font-weight:700; letter-spacing:.06em; cursor:pointer; }
        .jside small { font-weight:400; letter-spacing:0; font-size:11px; color:#7f8a96; }
        .jside.sel.blu { border-color:#3d6ea5; background:#13243a; color:#bcd6f2; }
        .jside.sel.opf { border-color:#a5483d; background:#3a1714; color:#f2c4bc; }
        .jjoin { width:100%; margin-top:18px; padding:15px; border:none; border-radius:10px;
                 background:#2f6b46; color:#fff; font-size:16px; font-weight:700; letter-spacing:.06em;
                 cursor:pointer; }
        .jjoin:disabled { background:#222a33; color:#6b7682; cursor:not-allowed; }
        .jhint { margin-top:12px; font-size:12px; color:#6b7682; text-align:center; }
    `],
})
export class PlayerJoinComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly router = inject(Router);

    protected readonly name = signal(this.rt.playerName());
    protected readonly side = signal(this.rt.side());
    protected readonly connected = this.rt.connected;
    protected readonly registered = this.rt.registered; // HOTFIX-029: green ONLY when own token echoed in the roster
    protected readonly online = this.store.online;
    protected readonly ready = computed(() => !!this.store.campaignId());
    // HOTFIX-029 — session identity + honest connection truth. "connected" (green) means REGISTERED; a
    // socket-up-but-not-yet-in-roster state honestly reads "registering…", never a false green.
    protected readonly campaignId = this.store.campaignId;
    protected readonly sessionCode = computed(() => sessionCodeOf(this.store.campaignId()));
    protected readonly statusText = computed(() =>
        this.registered() ? 'connected'
            : this.connected() ? 'connected — registering…'
            : this.online() ? 'connecting…'
            : 'host offline');
    // The LAN host the player actually reached — confirms the engine URL (the #1 silent break is a
    // player device pointed at itself instead of the GM host). Friendly: strip protocol + /api.
    protected readonly hostLabel = computed(() => (localStorage.getItem('bce.engine.url') || 'localhost:3000').replace(/^https?:\/\//, '').replace(/\/api\/?$/, ''));
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    protected readonly canJoin = computed(() => this.ready() && this.name().trim().length > 0);

    constructor() {
        // Connect the socket + join the campaign room as soon as the host campaign is known (mirrors the
        // GM claims panel). The lobby announce waits for the explicit JOIN tap (joinLobby), but the socket
        // is up early so JOIN lands instantly.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) this.rt.ensure(id, key);
        });
    }

    /** HOTFIX-030 — manual heal backstop. Reconnect re-syncs the socket (registration + snapshot); Reload
     *  evicts caches + reloads for a stale bundle. Auto-heal already retries a stuck socket after ~7s. */
    protected reconnect(): void { this.rt.reconnect(); }
    protected reloadApp(): void { void evictAndReload(); }

    protected onName(e: Event): void {
        this.name.set((e.target as HTMLInputElement).value);
    }
    protected pick(s: 'BLUFOR' | 'OPFOR'): void {
        this.side.set(s);
    }
    protected join(): void {
        if (!this.canJoin()) return;
        this.rt.setName(this.name().trim());
        this.rt.setSide(this.side());
        this.rt.joinLobby(); // announce to the host lobby (the GM sees it live)
        this.router.navigate(['/roster']);
    }
}
