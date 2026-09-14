/*
 * ODM-18 P2 — the GM ROLLBACK panel (ODM-only; mounted beside the SHARED settings tab in the fork-local
 * odm-dashboard.html — Classic ships no restore surface and is untouched). Lists the server's dated
 * checkpoints (every save, 30-day window) and restores one via POST /campaigns/:id/restore — the server
 * checkpoints the CURRENT state first (a rollback you can roll back; the ruled law), appends the
 * GM-attributed log line, and fans. On success this device HARD-RELOADS: the boot path is the one
 * sanctioned full-hydrate, and an in-memory GM state left standing would clobber the restore on its next
 * debounced persist. The floor entry states the locked start honestly — the ODM start IS the authored
 * packs; there is no day-zero blob.
 */
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CampaignSaveStore } from '../campaign-save-store';
import { formatDate, type CampaignDate } from '../clock/campaign-clock';

interface CheckpointRow { id: number; at: number; bytes: number; gameDate?: string | null; pinned?: boolean; }
/** The host's campaign record, as GET /campaigns/:id returns it (the snapshot rides opaque — blob-first). */
interface SaveRecord { id: string; name: string; savedAt: number; version: number; summary: string; snapshot: unknown; }

/** ODM-26 — hand the browser a file. Same shape as the IMPORT-2 hotspot template download; the object URL
 *  is revoked either way, so a refused save does not leak one. */
function downloadJson(text: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    } finally {
        URL.revokeObjectURL(url);
    }
}

@Component({
    selector: 'bce-odm-rollback',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="rb">
            <div class="rb-h">Campaign history — GM rollback</div>
            <div class="rb-sub">Every save is checkpointed on the company record for 30 days. Restoring checkpoints the current state first — a rollback you can roll back.
                <b>A pinned state is kept indefinitely</b> — it never ages out, so the official start of the campaign is still there in six months.</div>
            @if (note(); as n) { <div class="rb-note">{{ n }}</div> }
            <button type="button" class="rb-btn" (click)="load()" [disabled]="busy()" data-testid="odm-rb-refresh">↻ Refresh</button>
            <!-- ODM-26 option 1 — LOCK THE CANON. Captures the state that is on screen RIGHT NOW and pins it
                 in one step. Deliberately not "pin a row from the list below": a checkpoint holds the state
                 as it was BEFORE the save that minted it, so pinning from the list means saving twice and
                 picking the second capture — which a GM gets wrong once, silently, about the one record
                 every later session is measured against. -->
            <button type="button" class="rb-btn rb-pinnow" (click)="pinCurrent()" [disabled]="busy()" data-testid="odm-pin-current">★ Lock the current state as canon</button>
            <!-- ODM-26 option 3 — THE FILE. Everything above lives in the database: the 30-day window, the
                 restore, the campaign row itself. This is the one copy that survives the database. -->
            <button type="button" class="rb-btn" (click)="exportCampaign()" [disabled]="busy()" data-testid="odm-export">⬇ Export this campaign</button>
            <div class="rb-sub rb-exp">A complete copy of this company as a file on your machine — every unit, pilot,
                posting and log line. It is not a backup of the server; it is the copy that outlives it. Keep it somewhere
                that is not this computer.</div>
            @for (c of rows(); track c.id) {
                <div class="rb-row" [class.rb-pinned]="c.pinned" data-testid="odm-rb-row">
                    <span class="rb-date" data-testid="odm-rb-gamedate">{{ gameDate(c) }}</span>
                    @if (c.pinned) { <span class="rb-pin" data-testid="odm-rb-pinned" title="Pinned — kept indefinitely; the 30-day sweep does not touch it">★ CANON</span> }
                    <span class="rb-when">{{ when(c.at) }}</span>
                    <span class="rb-dim">{{ kb(c.bytes) }} KB</span>
                    <button type="button" class="rb-btn" (click)="togglePin(c)" [disabled]="busy()" data-testid="odm-rb-pintoggle"
                            [title]="c.pinned ? 'Unpin — returns this state to the 30-day window, where it will age out' : 'Pin — keep this state indefinitely'">{{ c.pinned ? 'Unpin' : 'Pin' }}</button>
                    <button type="button" class="rb-btn" (click)="restore(c.id)" [disabled]="busy()" data-testid="odm-rb-restore">Restore</button>
                </div>
            }
            <div class="rb-row rb-floor" data-testid="odm-rb-floor">
                <span class="rb-when">CAMPAIGN START — the authored state.</span>
                <span class="rb-dim">Re-create the campaign to return here.</span>
            </div>
        </div>
    `,
    styles: [`
        .rb { border: 1px solid #2a3340; border-radius: 6px; padding: 12px 14px; margin-top: 14px; }
        .rb-h { font-weight: 700; letter-spacing: .04em; margin-bottom: 2px; }
        .rb-sub { font-size: 12px; opacity: .75; margin-bottom: 8px; }
        .rb-note { font-size: 12px; color: #e0b070; margin-bottom: 6px; }
        .rb-row { display: flex; gap: 10px; align-items: center; padding: 4px 0; border-top: 1px dashed #222b36; }
        .rb-date { font-family: var(--mono, monospace); font-size: 12px; font-weight: 700; min-width: 12ch; }
        .rb-when { font-family: var(--mono, monospace); font-size: 12px; opacity: .7; }
        .rb-dim { font-size: 11px; opacity: .6; }
        .rb-btn { font-size: 11px; padding: 2px 10px; cursor: pointer; }
        .rb-floor { opacity: .7; font-style: italic; }
        .rb-exp { margin: 6px 0 2px; }
        .rb-pinned { background: rgba(224, 176, 112, .07); }
        .rb-pin { font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #e0b070; border: 1px solid #e0b070; padding: 1px 6px; }
        .rb-pinnow { font-weight: 700; }
    `],
})
export class OdmRollbackComponent {
    private readonly http = inject(HttpClient);
    private readonly store = inject(CampaignSaveStore);
    protected readonly rows = signal<CheckpointRow[]>([]);
    protected readonly busy = signal(false);
    protected readonly note = signal<string | null>(null);

    constructor() { this.load(); }

    // the store's own convention (localStorage-first engine base; the auth interceptor rides HttpClient)
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }
    protected when(at: number): string { return new Date(at).toLocaleString(); }
    /* ODM-22 — the CAMPAIGN date each checkpoint holds. Without it this list was wall-clock and KB only, so
       a GM could not tell which row held the date they wanted without restoring it to find out. Rows captured
       before ODM-22 carry no date and render an honest dash — never a guessed or back-filled value. */
    protected gameDate(c: CheckpointRow): string {
        if (!c.gameDate) return 'date not recorded';
        try { return formatDate(JSON.parse(c.gameDate) as CampaignDate); } catch { return 'date not recorded'; }
    }
    protected kb(n: number): string { return (n / 1024).toFixed(1); }

    protected load(): void {
        const id = this.store.campaignId();
        if (!id) { this.rows.set([]); return; }
        this.busy.set(true);
        this.http.get<CheckpointRow[]>(`${this.base()}/campaigns/${encodeURIComponent(id)}/checkpoints`).subscribe({
            next: (r) => { this.rows.set(r ?? []); this.busy.set(false); this.note.set(null); },
            error: () => { this.busy.set(false); this.note.set('History unavailable — the host did not answer.'); },
        });
    }

    /* ── ODM-26 option 1 — LOCK THE CANON. Capture-live-and-mark, one call. The pin is exempt from the
       30-day sweep and from NOTHING else: a takedown or a campaign delete takes it exactly as it takes any
       other row, because a compliance lever a rollback can undo is not a lever. ── */
    protected pinCurrent(): void {
        const id = this.store.campaignId();
        if (!id) return;
        this.busy.set(true);
        this.http.post<CheckpointRow>(`${this.base()}/campaigns/${encodeURIComponent(id)}/pin`, {}).subscribe({
            next: (r) => {
                this.busy.set(false);
                this.note.set(`Locked — the state of ${this.gameDate(r)} is kept indefinitely. Restore it from the list any time.`);
                this.load();
            },
            error: () => { this.busy.set(false); this.note.set('Could not lock this state — the host did not apply it.'); },
        });
    }

    /** Pin or unpin an existing row. UNPIN confirms, because its consequence is deferred and invisible:
     *  nothing happens today, and the state is quietly gone in thirty days. */
    protected togglePin(c: CheckpointRow): void {
        const id = this.store.campaignId();
        if (!id) return;
        const next = !c.pinned;
        if (!next && !confirm(`Unpin the state of ${this.gameDate(c)}?\n\nIt returns to the 30-day window and will be deleted once it ages out. Nothing happens today — which is exactly why this asks.`)) return;
        this.busy.set(true);
        this.http.post<CheckpointRow>(`${this.base()}/campaigns/${encodeURIComponent(id)}/checkpoints/${c.id}/pin`, { pinned: next }).subscribe({
            next: () => { this.busy.set(false); this.note.set(next ? 'Pinned — kept indefinitely.' : 'Unpinned — back in the 30-day window.'); this.load(); },
            error: () => { this.busy.set(false); this.note.set('The host did not apply that.'); },
        });
    }

    /* ── ODM-26 option 3 — THE PER-CAMPAIGN EXPORT. The server half already existed: GET /campaigns/:id
       returns the complete SaveRecord, owner-scoped, snapshot and all. Only the button was missing.
       This is the only durability that survives the DATABASE — the checkpoint window, the restore and the
       campaign row all die with it, and the Railway volume backups die with the volume. It is also the
       input the pack write-back needs: a proposed roster.json diff has to be computed against James's real
       state, and no session should ever be reaching into production to read it. ── */
    protected exportCampaign(): void {
        const id = this.store.campaignId();
        if (!id) { this.note.set('No campaign open to export.'); return; }
        this.busy.set(true);
        this.http.get<SaveRecord>(`${this.base()}/campaigns/${encodeURIComponent(id)}`).subscribe({
            next: (rec) => {
                this.busy.set(false);
                const name = this.exportName(rec);
                try {
                    downloadJson(JSON.stringify(rec, null, 2), name);
                    this.note.set(`Exported ${name} — keep it somewhere that is not this computer.`);
                } catch {
                    // An honest failure, not a silent one: the button that appears to work and writes nothing
                    // is the whole class this fork keeps paying for.
                    this.note.set('Could not write the file — the browser refused the download.');
                }
            },
            error: () => { this.busy.set(false); this.note.set('Export failed — the host did not answer.'); },
        });
    }

    /** COMPANY + CAMPAIGN DATE, because a folder of `campaign.json` files is the anomaly picker all over
     *  again: twenty near-identical rows and no way to tell which one is the night you wanted. The date is
     *  the campaign's own, not the wall clock — that is the one a GM recognises. Never guessed: a record
     *  with no date says so. */
    private exportName(rec: SaveRecord | null): string {
        const snap = (rec?.snapshot ?? null) as { commandName?: string | null; currentDate?: CampaignDate | null; startDate?: CampaignDate | null } | null;
        const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'campaign';
        const who = slug(snap?.commandName || rec?.name || 'campaign');
        const d = snap?.currentDate ?? snap?.startDate ?? null;
        const pad = (n: number): string => String(n).padStart(2, '0');
        const when = d && typeof d.y === 'number' ? `${d.y}-${pad((d.m ?? 0) + 1)}-${pad(d.d ?? 1)}` : 'date-not-recorded';
        return `bce-${who}-${when}.json`;
    }

    protected restore(checkpointId: number): void {
        const id = this.store.campaignId();
        if (!id) return;
        if (!confirm('Restore this checkpoint? The current state is checkpointed first — a rollback you can roll back.')) return;
        this.busy.set(true);
        this.http.post(`${this.base()}/campaigns/${encodeURIComponent(id)}/restore`, { checkpointId }).subscribe({
            next: () => { location.reload(); }, // the boot path is the one sanctioned full-hydrate (see header)
            error: () => { this.busy.set(false); this.note.set('Restore refused — the host did not apply it (entitlement or a missing checkpoint).'); },
        });
    }
}
