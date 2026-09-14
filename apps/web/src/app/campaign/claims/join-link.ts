/*
 * BCE — the JOIN LINK (DIRECTIVE-GM-1b): the HOTFIX-027 join block — the QR, the URL, and the Copy link /
 * Copy (or Download) QR / Share row — extracted VERBATIM out of <bce-lobby-panel> so it can be mounted at
 * TWO doors: the Lobby (the battle room, HOTFIX-029-gated on an active engagement + ≥1 deployed unit) and
 * the GM tab (the SESSION door, un-gated: players join before any track exists — Pendragon's ask). ONE
 * URL, ONE renderer, two doors. The gate is the parent's decision and arrives as an input; the URL carries
 * only the campaign + engine (never an engagement), so a pre-track join lands in the same room.
 * Markup, classes and behaviour are byte-preserved from the lobby (verify-gm1b-styles pins the computed
 * styles + rects + normalized markup of the lobby panel across HS-gated / HS-open / Classic); the host is
 * `display:contents` so `.lqr` stays a direct flex child of the lobby's `.lob` exactly as before.
 * The `.lbtn` base is a deliberate LOCKSTEP duplicate of lobby-panel's (emulated encapsulation scopes styles
 * per component; HARDEN-4 warned off hoisting generic class names to the global sheet).
 * BCE campaign-layer only (no MekBay core import); the player bundle never imports this (GM surfaces only).
 */
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, viewChild, type WritableSignal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from './claim-realtime.service';

const PLAYER_PORT = 4300; // serve-player (project.json) — the LAN default; cloud overrides via 'bce.player.url'.
const PLAYER_URL_KEY = 'bce.player.url'; // DEPLOY-002 P4: the PUBLIC player-app base (e.g. Cloudflare Pages) for the hosted join
const ENGINE_URL_KEY = 'bce.engine.url'; // carried on the join link so a cloud player hits the same API

@Component({
    selector: 'bce-join-link',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
            <div class="lqr">
                <div class="lqrwrap">
                    <div #qrBox class="lqrbox" [class.gated]="gated()" [innerHTML]="qr()"></div>
                    @if (gated()) {
                        <div class="lgate-overlay"><span>{{ gateCue() }}</span></div>
                    }
                </div>
                <div class="lqrinfo">
                    <div class="lqrlabel">{{ door() === 'session' ? 'Players scan to join the session' : 'Players scan to join' }}</div>
                    @if (!gated()) {
                        <code #urlEl class="lqrurl">{{ joinUrl() }}</code>
                    } @else {
                        <code #urlEl class="lqrurl gated">{{ joinUrl() }}</code>
                        <div class="lgate-cue">{{ gateCue() }}</div>
                    }
                    <div class="lqracts">
                        <button type="button" class="lbtn" [disabled]="gated()" (click)="copyLink()">{{ copyLinkLabel() }}</button>
                        <button type="button" class="lbtn" [disabled]="gated()" (click)="copyQr()">{{ qrLabel() }}</button>
                        @if (canShare) {
                            <button type="button" class="lbtn" [disabled]="gated()" (click)="shareLink()">Share</button>
                        }
                    </div>
                    @if (isLocalhost()) {
                        <div class="lwarn">You opened the dashboard on <b>localhost</b>. Players on other devices
                            can’t reach that — re-open it via your LAN IP (e.g. http://192.168.x.x:4200) so this QR points at a reachable host.</div>
                    }
                    <div class="lconn" [class.on]="connected()">{{ connected() ? (door() === 'session' ? '● session live' : '● lobby live') : '○ host offline' }}</div>
                </div>
            </div>
    `,
    styles: [`
        :host { display:contents; }
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
        /* LOCKSTEP with lobby-panel's .lbtn base (the same two rules; a scoped duplicate, not a hoist). */
        .lbtn { border:1px solid var(--bce-line,#2a3340); background:transparent; color:#cdd8e3;
                border-radius:7px; padding:6px 10px; font-size:12px; cursor:pointer; }
        .lbtn:disabled { opacity:.45; cursor:not-allowed; }
    `],
})
export class JoinLinkComponent {
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly sanitizer = inject(DomSanitizer);

    /** The parent's gate (HOTFIX-029 on the lobby: active engagement + ≥1 deployed; the GM-tab door passes false). */
    readonly gated = input(false);
    /** What the gate is waiting for — rendered in the overlay + under the dimmed URL while gated. */
    readonly gateCue = input('');
    /** Which door this is — the wording only: the Lobby (default, verbatim strings) or the GM tab's SESSION door
     *  ("Players scan to join the session" / "● session live"). A session door labelled "lobby" is the confusion
     *  Pendragon reported, one screen over. */
    readonly door = input<'lobby' | 'session'>('lobby');

    protected readonly connected = this.rt.connected;
    protected readonly qr = signal<SafeHtml | string>('');

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
     *  Railway API). Replaces the old bare LAN http://<ip>:4300/. Recomputes when campaignId resolves.
     *  GM-1b: no engagement rides the URL — a join binds to the campaign (the session), never a track. */
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
}
