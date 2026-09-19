import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CampaignSaveStore } from '../campaign-save-store';
import { BUILD_COMMIT_HASH } from '../../build-meta';
import { NewCampaignState } from '../new-campaign-state';
import { formatDate } from '../clock/campaign-clock';

@Component({
    selector: 'bce-odm-gm-facts',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="gf">
            <div class="gf-h">Campaign facts — for support and corrections</div>
            <div class="gf-sub">Quote these when reporting a problem. The id is what identifies this campaign on the server.</div>
            <div class="gf-row">
                <span class="gf-k">Campaign id</span>
                <span class="gf-v" data-testid="odm-gm-facts-id">{{ id() ?? '—' }}</span>
                @if (id()) {
                    <button type="button" class="gf-btn" (click)="copy(id()!)" data-testid="odm-gm-facts-copy">{{ copied() === id() ? 'Copied' : 'Copy' }}</button>
                }
            </div>
            <div class="gf-row"><span class="gf-k">Command</span><span class="gf-v">{{ name() || '—' }}</span></div>
            <div class="gf-row"><span class="gf-k">Campaign date</span><span class="gf-v" data-testid="odm-gm-facts-date">{{ dateText() }}</span></div>
            <div class="gf-row"><span class="gf-k">Started</span><span class="gf-v">{{ startText() }}</span></div>
            <div class="gf-row"><span class="gf-k">Pack</span><span class="gf-v">{{ pack() ?? '—' }}</span></div>
            <div class="gf-row"><span class="gf-k">App build</span><span class="gf-v" data-testid="odm-gm-facts-app-build">{{ appBuild }}</span></div>
            <div class="gf-row"><span class="gf-k">Server build</span><span class="gf-v" data-testid="odm-gm-facts-srv-build">{{ serverBuild() ?? '…' }}</span></div>
            <div class="gf-row"><span class="gf-k">Builds</span><span class="gf-v" data-testid="odm-gm-facts-build-match">{{ buildMatch() }}</span></div>
        </div>
    `,
    styles: [`
        .gf { border: 1px solid #2a3340; border-radius: 6px; padding: 12px 14px; margin-top: 14px; }
        .gf-h { font-weight: 700; letter-spacing: .04em; margin-bottom: 2px; }
        .gf-sub { font-size: 12px; opacity: .75; margin-bottom: 8px; }
        .gf-row { display: flex; gap: 10px; align-items: baseline; padding: 3px 0; border-top: 1px dashed #222b36; }
        .gf-k { font-size: 11px; opacity: .6; min-width: 110px; }
        .gf-v { font-family: var(--mono, monospace); font-size: 12px; word-break: break-all; }
        .gf-btn { font-size: 11px; padding: 2px 10px; cursor: pointer; margin-left: auto; }
    `],
})
export class OdmGmFactsComponent {
    constructor() {
        const base = localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; // the store's own convention
        this.http.get<{ commit?: string }>(`${base}/version`).subscribe({
            next: (v) => this.serverBuild.set(v?.commit ?? ''),
            error: () => this.serverBuild.set(''), // honest empty — reported as "cannot compare", never as a match
        });
    }

    private readonly http = inject(HttpClient);
    private readonly store = inject(CampaignSaveStore);
    private readonly state = inject(NewCampaignState);

    protected readonly id = this.store.campaignId;
    protected readonly copied = signal<string | null>(null);
    protected readonly name = computed(() => this.state.commandName() ?? ''); // the named command — the fork's own identity
    protected readonly pack = computed(() => this.state.packId());
    protected readonly dateText = computed(() => { const d = this.state.currentDate(); return d ? formatDate(d) : '—'; });
    protected readonly startText = computed(() => { const d = this.state.startDate(); return d ? formatDate(d) : '—'; });

    /* THE BUILD PAIR. serverVersion on ClaimRealtimeService is NOT reusable here: it is set only on a
       MISMATCH (the handshake early-returns when the two agree), so on the healthy path it stays null and the
       card would show nothing. This reads /api/version directly so a value is always present to compare. */
    // `: string` deliberately — BUILD_COMMIT_HASH is a generated const, so TS narrows it to THIS build's
    // literal and then rejects comparing it to 'unknown' as impossible. It is only impossible in this build.
    protected readonly appBuild: string = BUILD_COMMIT_HASH || 'unknown';
    protected readonly serverBuild = signal<string | null>(null);
    protected readonly buildMatch = computed(() => {
        const srv = this.serverBuild(), app = this.appBuild;
        if (srv === null) return 'checking…';
        // NEVER claim a match against an unknown: a local/dev api reports "unknown" when the deploy SHA is
        // absent, and calling that agreement would be the card concluding something it does not know.
        if (!srv || srv === 'unknown' || !app || app === 'unknown') return 'cannot compare — one side reports no build id';
        return srv === app ? 'identical' : 'DIFFERENT — the app bundle and the server are not the same build';
    });

    protected copy(v: string): void {
        // navigator.clipboard is https-only; the prompt fallback still lets a GM select-and-copy on a LAN host.
        void navigator.clipboard?.writeText(v).then(() => this.copied.set(v)).catch(() => window.prompt('Campaign id', v));
    }
}
