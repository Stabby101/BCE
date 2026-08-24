/*
 * BCE — the GM LOBBY (DIRECTIVE-048, phase A). The host's view of who has joined: a join QR (players
 * scan it to land on the port-isolated player app) and the live roster fanned from the host over the
 * D-042 socket (ClaimRealtimeService.lobby). The GM can reassign a player's side or kick them; both
 * fan back to every device. Side is a social/visibility signal this slice (ROLE-002), not enforced
 * server-side. The QR encodes the player port on THIS host's address — if the GM opened the dashboard
 * on localhost, players can't reach it, so we say so. BCE campaign-layer only (no MekBay core import).
 */
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, output, signal, viewChild, type WritableSignal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from './claim-realtime.service';
import { engagementKeyOf } from './engagement-key';
import { sessionCodeOf } from './session-code';
import { deployedSet } from '../force/deployed';

const PLAYER_PORT = 4300; // serve-player (project.json) — the LAN default; cloud overrides via 'bce.player.url'.
const PLAYER_URL_KEY = 'bce.player.url'; // DEPLOY-002 P4: the PUBLIC player-app base (e.g. Cloudflare Pages) for the hosted join
const ENGINE_URL_KEY = 'bce.engine.url'; // carried on the join link so a cloud player hits the same API

@Component({
    selector: 'bce-lobby-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="lob">
            <!-- HOTFIX-029 — session identity + connection truth. Green ONLY when the socket is connected (GM
                 observes the room). The same code shows on the player side-pick window; matching = same session. -->
            <div class="lsession" [class.on]="connected()" [title]="campaignId() || ''">
                <span class="ls-dot" aria-hidden="true">●</span> SESSION {{ sessionCode() }} — {{ connected() ? 'live' : 'offline' }}
                <!-- D-118 — re-read the active engagement's order (D-117 TRACK / Traditional package) from the lobby. -->
                <button type="button" class="lbtn ltrack" [disabled]="!viewTrackEnabled()"
                        [title]="viewTrackEnabled() ? 'Open the active track order (printable)' : 'No active mission — generate and activate one to view its track.'"
                        (click)="viewTrack.emit()">▦ View track</button>
            </div>

            <!-- DIRECTIVE-119 — Hot Spots: RESOLVE the mission where the battle was actually run; on resolve the button
                 is replaced by a ✓ confirmation (so "goals met" no longer leaves an unchanged screen). HS-only. -->
            @if (isHotspots()) {
                @if (hasActiveEngagement()) {
                    <button type="button" class="lresolve" (click)="resolveMission.emit()" title="Resolve this engagement — enter the objectives met">▸ Resolve mission</button>
                } @else if (recentlyResolved()) {
                    <div class="lresolved">✓ Resolved — read the AAR, then <b>Advance phase</b> (Flow rail) for the next contract.</div>
                }
            }

            <div class="lqr">
                <div class="lqrwrap">
                    <div #qrBox class="lqrbox" [class.gated]="!gateOpen()" [innerHTML]="qr()"></div>
                    @if (!gateOpen()) {
                        <div class="lgate-overlay"><span>{{ gateCue() }}</span></div>
                    }
                </div>
                <div class="lqrinfo">
                    <div class="lqrlabel">Players scan to join</div>
                    @if (gateOpen()) {
                        <code #urlEl class="lqrurl">{{ joinUrl() }}</code>
                    } @else {
                        <code #urlEl class="lqrurl gated">{{ joinUrl() }}</code>
                        <div class="lgate-cue">{{ gateCue() }}</div>
                    }
                    <div class="lqracts">
                        <button type="button" class="lbtn" [disabled]="!gateOpen()" (click)="copyLink()">{{ copyLinkLabel() }}</button>
                        <button type="button" class="lbtn" [disabled]="!gateOpen()" (click)="copyQr()">{{ qrLabel() }}</button>
                        @if (canShare) {
                            <button type="button" class="lbtn" [disabled]="!gateOpen()" (click)="shareLink()">Share</button>
                        }
                    </div>
                    @if (isLocalhost()) {
                        <div class="lwarn">You opened the dashboard on <b>localhost</b>. Players on other devices
                            can’t reach that — re-open it via your LAN IP (e.g. http://192.168.x.x:4200) so this QR points at a reachable host.</div>
                    }
                    <div class="lconn" [class.on]="connected()">{{ connected() ? '● lobby live' : '○ host offline' }}</div>
                </div>
            </div>
            <!-- HOTFIX-030 — the Joined roster panel moved into the claim board (which now carries the counts +
                 per-device presence + kick, and a spectator list). No chip row under the QR — the board is the info. -->
        </div>
    `,
    styles: [`
        :host { display:block; }
        .lob { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start; }
        /* HOTFIX-029 — session identity header (full width above the QR + roster). */
        /* HOTFIX-037 — the SESSION line sits on the tan dossier field; it is a PRIMARY status → strong ink
           (was faint #7f8a96/#cdd8e3, ~1-2:1 on tan). The ● dot keeps the green semantic via --ok (readable). */
        .lsession { flex-basis:100%; font-family:var(--mono,monospace); font-size:13px; letter-spacing:.08em;
                    color:var(--ink); display:flex; align-items:center; gap:6px; }
        .lsession .ls-dot { color:var(--ink2); }
        .lsession.on { color:var(--ink); }
        .lsession.on .ls-dot { color:var(--ok); }
        /* D-118 — the View-track button rides the session header line.
           HOTFIX-037 — dark ink + tan line so it reads on the tan field (the shared .lbtn base is light-on-navy). */
        .lsession .ltrack { margin-left:auto; font-size:12px; padding:5px 11px; color:var(--ink); border-color:var(--line); }
        /* DIRECTIVE-119 — the Hot Spots RESOLVE action + the post-resolve confirmation (full-width, above the QR). */
        .lresolve { flex-basis:100%; font-family:var(--label,inherit); font-weight:700; letter-spacing:.08em; text-transform:uppercase;
                    font-size:13px; padding:12px 16px; border:1.6px solid var(--ok); background:var(--ok); color:var(--paper); border-radius:8px; cursor:pointer; }
        .lresolve:hover { filter:brightness(1.08); }
        .lresolved { flex-basis:100%; font-family:var(--type,inherit); font-size:13px; color:var(--ink); border-left:3px solid var(--ok);
                     background:var(--paper2); padding:10px 12px; border-radius:6px; }
        .lresolved b { color:var(--ink); }
        .lqr { display:flex; gap:16px; align-items:center; padding:16px; border:1px solid var(--bce-line,#2a3340);
               border-radius:12px; background:var(--bce-panel,#141a21); }
        .lqrwrap { position:relative; flex-shrink:0; }
        .lqrbox { width:200px; height:200px; flex-shrink:0; background:#fff; border-radius:8px; padding:8px; box-sizing:border-box; transition:filter .2s, opacity .2s; }
        .lqrbox.gated { filter:blur(5px) grayscale(.5); opacity:.4; }
        .lqrbox :is(svg) { width:100%; height:100%; display:block; }
        /* HOTFIX-029 — the gate: dimmed QR + honest cue naming what's missing; copy/share disabled. */
        .lgate-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                         text-align:center; padding:10px; box-sizing:border-box; }
        .lgate-overlay span { font-size:12px; color:#1a1a1a; background:rgba(255,255,255,.82); border-radius:8px;
                              padding:8px 10px; font-weight:600; line-height:1.35; }
        .lgate-cue { margin-top:8px; font-size:12px; color:#e7a86b; line-height:1.4; }
        .lqrurl.gated { opacity:.5; }
        .lnudge { margin:2px 0 8px; font-size:13px; color:#e7a86b; font-weight:600; }
        .lqrinfo { max-width:280px; }
        /* HOTFIX-037 — "Players scan to join" sits on the dark navy QR panel; it inherited the dossier dark --ink
           (~1.2:1, near-invisible). Cream (--paper) reads ~10:1 on the navy. The URL/buttons/●-live were already light. */
        .lqrlabel { font-weight:700; letter-spacing:.04em; margin-bottom:6px; color:var(--paper); }
        /* HOTFIX-027: beat the global user-select:none (styles.scss) on the element so the GM can hand-select the link. */
        .lqrurl { display:inline-block; font-size:13px; color:var(--bce-accent,#7fb0e6); word-break:break-all;
                  user-select:text; -webkit-user-select:text; cursor:text; }
        .lqracts { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
        .lqracts .lbtn { padding:7px 12px; }
        .lwarn { margin-top:10px; font-size:12px; color:#e7a86b; line-height:1.4; }
        .lconn { margin-top:12px; font-size:12px; color:#7f8a96; }
        .lconn.on { color:#7fe3a0; }
        .lroster { flex:1; min-width:280px; }
        .lrhead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;
                  font-weight:700; letter-spacing:.04em; }
        .lcounts { font-size:12px; color:#7f8a96; font-weight:400; }
        .lempty { color:#7f8a96; font-style:italic; padding:18px 4px; }
        .llist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .lcard { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;
                 background:var(--bce-panel,#141a21); border:1px solid var(--bce-line,#2a3340); border-left-width:4px; }
        .lcard.blu { border-left-color:#3d6ea5; }
        .lcard.opf { border-left-color:#a5483d; }
        .lname { flex:1; font-weight:700; }
        .lside { font-size:12px; letter-spacing:.08em; color:#9fb2c4; }
        .lacts { display:flex; gap:6px; }
        .lbtn { border:1px solid var(--bce-line,#2a3340); background:transparent; color:#cdd8e3;
                border-radius:7px; padding:6px 10px; font-size:12px; cursor:pointer; }
        .lbtn:disabled { opacity:.45; cursor:not-allowed; }
        .lbtn.kick { color:#e08b7a; border-color:#6b3a2f; }
    `],
})
export class LobbyPanelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly sanitizer = inject(DomSanitizer);

    protected readonly connected = this.rt.connected;
    protected readonly qr = signal<SafeHtml | string>('');
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));

    // HOTFIX-027 — join-link copy / QR / share. Platform capability flags are read ONCE (they don't change
    // within a session): navigator.share (mobile sheet) and ClipboardItem+clipboard.write (image copy — absent
    // on Firefox and on insecure LAN http, where the whole clipboard API is missing). The QR button becomes
    // "Download QR" when image-copy is unsupported so every context ends in a working affordance.
    private readonly urlEl = viewChild<ElementRef<HTMLElement>>('urlEl');
    private readonly qrBox = viewChild<ElementRef<HTMLElement>>('qrBox');
    protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    private readonly qrClipboardSupported = typeof ClipboardItem !== 'undefined'
        && typeof navigator !== 'undefined' && typeof navigator.clipboard?.write === 'function';
    protected readonly copyLinkLabel = signal('Copy link');
    protected readonly qrLabel = signal(this.qrClipboardSupported ? 'Copy QR' : 'Download QR');
    private readonly qrDefaultLabel = this.qrClipboardSupported ? 'Copy QR' : 'Download QR';

    // HOTFIX-029 — the DEPLOYMENT GATE. The join affordance (QR + URL + copy/share) opens only when an ACTIVE
    // engagement exists AND ≥1 unit is marked Deployed, so a player can never join into an empty session. All
    // reactive: generating a mission + deploying a unit opens it live; undeploying to zero re-dims it.
    protected readonly deployedCount = computed(() => deployedSet(this.state.startingForce()).length);
    protected readonly hasActiveEngagement = computed(() => (this.state.missionTree() ?? []).some((b) => b.state === 'ACTIVE'));
    // D-118 — "▦ View track": the dashboard re-opens the active engagement's order via the existing package path.
    // Enabled only when there's an active engagement carrying a forge package (else the overlay has nothing to show).
    readonly viewTrack = output<void>();
    protected readonly viewTrackEnabled = computed(() => this.hasActiveEngagement() && !!this.state.missionSpec()?.forge?.seedId);
    // DIRECTIVE-119 — Hot Spots: RESOLVE MISSION on the lobby (the battle was run here) drives the dashboard resolve
    // modal; after resolve the button is replaced by a ✓ confirmation. HS-gated — the Traditional lobby shows neither.
    readonly resolveMission = output<void>();
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly recentlyResolved = computed(() => this.isHotspots() && !this.hasActiveEngagement()
        && (this.state.missionTree() ?? []).some((b) => b.state === 'RESOLVED' && b.resolution && !b.resolution.advanced));
    protected readonly gateOpen = computed(() => this.hasActiveEngagement() && this.deployedCount() > 0);
    protected readonly gateCue = computed(() =>
        this.hasActiveEngagement() ? 'No units deployed — mark units Deployed on the roster to open the lobby.'
            : 'No active mission — generate one to open the lobby.');
    // Session identity — the same code the player sees (last 6 alphanumerics of the campaignId, uppercased).
    protected readonly campaignId = this.store.campaignId;
    protected readonly sessionCode = computed(() => sessionCodeOf(this.store.campaignId()));

    /** The PUBLIC player base. HOTFIX-010: a cloud visitor (non-localhost/non-LAN — mirrors the index.html
     *  bce.engine.url auto-set) joins the SAME-ORIGIN public player app at `${origin}/player/` (deployed into
     *  the Pages output), NOT the dead `:4300` LAN port. LAN/dev is unchanged (localhost/private-LAN →
     *  `:4300` serve-player). An explicit `bce.player.url` still overrides everything. */
    private playerBase(): string {
        const override = localStorage.getItem(PLAYER_URL_KEY);
        if (override) return override;
        const h = location.hostname;
        const localOrLan = h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
            || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
        if (localOrLan) return `${location.protocol}//${h}:${PLAYER_PORT}/`; // LAN/dev: serve-player port
        return `${location.origin}/player/`; // cloud: the same-origin public player app
    }
    /** DEPLOY-002 P4 — the hosted join target: the public player app carrying THIS campaign (so the player
     *  lands in the right room, not the host "last") + the engine URL (so a cloud player reaches the same
     *  Railway API). Replaces the old bare LAN http://<ip>:4300/. Recomputes when campaignId resolves. */
    protected readonly joinUrl = computed(() => {
        const id = this.store.campaignId();
        let u: URL;
        try { u = new URL(this.playerBase()); } catch { return this.playerBase(); }
        if (id) u.searchParams.set('campaign', id);
        const engine = localStorage.getItem(ENGINE_URL_KEY);
        if (engine) u.searchParams.set('engine', engine);
        return u.toString();
    });
    /** Warn only when the QR would point at an unreachable LAN host (localhost AND no public override). */
    protected readonly isLocalhost = computed(() =>
        !localStorage.getItem(PLAYER_URL_KEY) && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'),
    );

    constructor() {
        // Connect + join the room and OBSERVE the lobby (not register as a player). Idempotent with the
        // claims panel — same socket, same room.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.observeLobby(); }
        });
        // Render the join QR once (the URL is host-stable for the session).
        effect(() => {
            const url = this.joinUrl();
            void this.renderQr(url);
        });
    }

    private async renderQr(url: string): Promise<void> {
        try {
            // qrcode is CommonJS — toString may live on the namespace or .default (mirror the print util).
            const mod = await import('qrcode');
            const m = mod as unknown as { toString?: (t: string, o: object) => Promise<string>; default?: { toString?: (t: string, o: object) => Promise<string> } };
            const toSvg = typeof m.toString === 'function' ? m.toString.bind(m)
                : typeof m.default?.toString === 'function' ? m.default.toString.bind(m.default)
                : null;
            if (!toSvg) { this.qr.set(''); return; }
            const svg = await toSvg(url, { type: 'svg', margin: 1 });
            this.qr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
        } catch {
            this.qr.set(''); // QR is a convenience — the URL text below it still works
        }
    }

    // ── HOTFIX-027 — copy link / copy (or download) QR / native share; honest degradation, never dead-ended ──
    /** Briefly flash a button label, then restore it (OnPush-safe: a signal write triggers CD). */
    private flash(sig: WritableSignal<string>, msg: string, restore: string, ms = 1500): void {
        sig.set(msg);
        setTimeout(() => sig.set(restore), ms);
    }

    /** Copy the join URL. Secure context → the Clipboard API; insecure LAN http (no API) → select the text +
     *  execCommand; if even that fails, leave it selected and tell the GM to press Ctrl-C (one keystroke away). */
    protected async copyLink(): Promise<void> {
        const url = this.joinUrl();
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
                await navigator.clipboard.writeText(url);
                this.flash(this.copyLinkLabel, '✓ Copied', 'Copy link');
                return;
            }
            throw new Error('clipboard API unavailable');
        } catch {
            const ok = this.selectUrl() && this.tryExecCopy();
            this.flash(this.copyLinkLabel, ok ? '✓ Copied' : 'Press Ctrl-C', 'Copy link', ok ? 1500 : 4000);
        }
    }

    /** Select the URL text (Range + Selection) so a manual Ctrl-C works even when scripted copy is blocked. */
    private selectUrl(): boolean {
        const el = this.urlEl()?.nativeElement;
        if (!el || typeof window === 'undefined') return false;
        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            return true;
        } catch { return false; }
    }
    private tryExecCopy(): boolean {
        try { return document.execCommand('copy'); } catch { return false; }
    }

    /** Copy the QR as a PNG (image-copy) where supported; otherwise download the identical PNG. */
    protected async copyQr(): Promise<void> {
        let blob: Blob | null = null;
        try { blob = await this.renderQrPng(); } catch { /* fall through to the null guard */ }
        if (!blob) { this.flash(this.qrLabel, 'QR unavailable', this.qrDefaultLabel, 2500); return; }
        if (this.qrClipboardSupported) {
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                this.flash(this.qrLabel, '✓ Copied', 'Copy QR');
                return;
            } catch (e) {
                if ((e as Error)?.name !== 'NotAllowedError') console.warn('[lobby] QR clipboard write failed, downloading instead', e);
                // fall through to download so the GM still gets the image
            }
        }
        this.downloadBlob(blob, 'bce-join-qr.png');
        this.flash(this.qrLabel, '✓ Saved', this.qrDefaultLabel);
    }

    /** Rasterize the live QR SVG onto a 512×512 white canvas with a quiet-zone margin (scanners need it). */
    private renderQrPng(): Promise<Blob | null> {
        return new Promise((resolve) => {
            const svg = this.qrBox()?.nativeElement.querySelector('svg');
            if (!svg || typeof document === 'undefined') { resolve(null); return; }
            let src: string;
            try {
                const xml = new XMLSerializer().serializeToString(svg);
                src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
            } catch { resolve(null); return; }
            const img = new Image();
            img.onload = () => {
                const size = 512, margin = 32;
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(null); return; }
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, size, size);
                ctx.drawImage(img, margin, margin, size - 2 * margin, size - 2 * margin);
                canvas.toBlob((b) => resolve(b), 'image/png');
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }
    private downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /** Native share sheet (URL only, v1). Only wired when navigator.share exists; a user-cancelled sheet
     *  (AbortError) is expected and swallowed. */
    protected async shareLink(): Promise<void> {
        try {
            await navigator.share({ title: 'Join the battle — BCE', url: this.joinUrl() });
        } catch (e) {
            if ((e as Error)?.name !== 'AbortError') console.warn('[lobby] share failed', e);
        }
    }

    // HOTFIX-030 — reassign/kick moved to the claim board (bce-claims-panel), which is now the roster.
}
