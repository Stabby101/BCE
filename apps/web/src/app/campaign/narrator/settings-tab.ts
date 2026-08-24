/*
 * BCE — SETTINGS tab (DIRECTIVE-038). The narrator's controls: mode OFF / LOCAL (CLOUD greyed —
 * "arrives with the engine"), endpoint + model display, TEST CONNECTION (round-trip + latency),
 * per-function toggles (briefings / AARs), and a fuller live stats view. Hosts the D-036 SPA-cap
 * knob, migrated here from localStorage. Mode LOCAL POSTs /load (the sidecar spawns llama-server on
 * demand); OFF unloads immediately. All settings persist via NarratorService (localStorage).
 */
import { Component, ChangeDetectionStrategy, OnDestroy, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { NarratorService } from './narrator.service';
import type { NarratorStats } from './narrator-types';
import { AuthService } from '../../auth/auth.service';

@Component({
    selector: 'bce-settings-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './settings-tab.html',
    styleUrl: './settings-tab.scss',
})
export class SettingsTabComponent implements OnDestroy {
    private readonly narrator = inject(NarratorService);
    private readonly auth = inject(AuthService); // DEPLOY-009: re-display the guest recovery code
    private readonly sanitizer = inject(DomSanitizer);
    protected readonly mode = this.narrator.mode;
    protected readonly endpoint = this.narrator.endpoint;
    protected readonly briefingsOn = this.narrator.briefingsOn;
    protected readonly aarsOn = this.narrator.aarsOn;
    protected readonly capVariant = this.narrator.capVariant;
    protected readonly activeModel = this.narrator.activeModel;
    protected readonly cumulative = this.narrator.cumulative;

    protected readonly testing = signal(false);
    protected readonly testResult = signal<{ ok: boolean; ms: number; llama: string; model: string; error?: string } | null>(null);
    protected readonly stats = signal<NarratorStats | null>(null);
    private poll: ReturnType<typeof setInterval> | null = null;

    protected readonly capOptions = [
        { v: 'standard', l: 'Standard — 1 SPA pilot per 4 fielded (CamOps p.72)' },
        { v: 'formation', l: 'Formation rules — 1 per 12 (stricter)' },
        { v: 'off', l: 'Off — no force-wide cap (table call)' },
    ];

    // ── DEPLOY-009: "Your recovery code" — reads the device's LOCAL copy (the server never stores plaintext) ──
    protected readonly recCopied = signal(false);
    protected readonly recoveryQr = signal<SafeHtml | null>(null);
    protected isGuest(): boolean { return this.auth.isGuest(); }
    protected recoveryCode(): string { return this.auth.recoveryCode() ?? ''; }
    protected copyRecovery(): void {
        const c = this.recoveryCode();
        if (!c) return;
        try { void navigator.clipboard?.writeText(c); this.recCopied.set(true); setTimeout(() => this.recCopied.set(false), 1500); } catch { /* */ }
    }
    private async renderRecoveryQr(): Promise<void> {
        const code = this.recoveryCode();
        if (!code) { this.recoveryQr.set(null); return; }
        try {
            // qrcode is CommonJS — toString may live on the namespace or .default (mirror lobby-panel.renderQr).
            const mod = await import('qrcode');
            const m = mod as unknown as { toString?: (t: string, o: object) => Promise<string>; default?: { toString?: (t: string, o: object) => Promise<string> } };
            const toSvg = typeof m.toString === 'function' ? m.toString.bind(m) : typeof m.default?.toString === 'function' ? m.default.toString.bind(m.default) : null;
            if (!toSvg) { this.recoveryQr.set(null); return; }
            const svg = await toSvg(code, { type: 'svg', margin: 1 });
            this.recoveryQr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
        } catch { this.recoveryQr.set(null); /* QR is convenience — the code text still copies */ }
    }

    constructor() {
        this.poll = setInterval(async () => { if (this.mode() === 'local') this.stats.set(await this.narrator.stats()); else this.stats.set(null); }, 4000);
        void this.renderRecoveryQr(); // DEPLOY-009: render the recovery QR for a guest (no-op otherwise)
    }
    ngOnDestroy(): void { if (this.poll) clearInterval(this.poll); }

    protected setMode(m: 'off' | 'local'): void { this.narrator.setMode(m); this.testResult.set(null); }
    protected setModel(id: string): void { this.narrator.setModel(id); }
    protected setEndpoint(v: string): void { this.narrator.setEndpoint(v); }
    /** The registry rows from the sidecar; the selected id resolves to the user's pick or the live active. */
    protected models(): NarratorStats['models'] { return this.stats()?.models ?? []; }
    protected selectedId(): string { return this.activeModel() || this.stats()?.llama?.activeId || ''; }
    protected toggleBriefings(): void { this.narrator.setBriefings(!this.briefingsOn()); }
    protected toggleAars(): void { this.narrator.setAars(!this.aarsOn()); }
    protected setCap(v: string): void { this.narrator.setCapVariant(v); }

    protected async test(): Promise<void> {
        this.testing.set(true);
        this.testResult.set(await this.narrator.testConnection());
        this.testing.set(false);
    }
}
