/*
 * BCE retool — LOAD browser (DIRECTIVE-013). Cover option 02 opens this: a list of ALL
 * saved campaigns (name · summary · savedAt, newest first). Pick one to load; per-entry
 * Delete (with confirm) so autosaves don't accumulate. Esc / click-out cancel. Theme
 * tokens (inherited from the cover .theme-dossier host). MekBay components unedited.
 */
import { Component, ChangeDetectionStrategy, HostListener, inject, output, signal } from '@angular/core';
import { CampaignSaveStore, campaignProgress, type SaveRecord } from '../campaign/campaign-save-store';

@Component({
    selector: 'bce-load-browser',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="backdrop" (click)="onBackdrop($event)">
            <div class="modal" role="dialog" aria-modal="true" aria-label="Load a campaign">
                <div class="mhead">Load a campaign <span class="cnt">{{ saves().length }} saved</span></div>
                <div class="mbody">
                    @if (saves().length === 0) {
                        <p class="empty">No saved campaigns.</p>
                    }
                    @for (s of saves(); track s.id) {
                        <div class="row">
                            <button type="button" class="pick" (click)="pick.emit(s)" [attr.aria-label]="'Load ' + s.name">
                                <span class="nm">{{ s.name }}</span>
                                <span class="sum">{{ s.summary }}</span>
                                <span class="prog">{{ progress(s) }}</span>
                                <span class="when">{{ fmt(s.savedAt) }}</span>
                            </button>
                            @if (confirmId() === s.id) {
                                <span class="del-confirm">
                                    <button type="button" class="del yes" (click)="doDelete(s.id)">Delete</button>
                                    <button type="button" class="del no" (click)="confirmId.set(null)">Keep</button>
                                </span>
                            } @else {
                                <button type="button" class="del" (click)="confirmId.set(s.id)" [attr.aria-label]="'Delete ' + s.name">&#10005;</button>
                            }
                        </div>
                    }
                </div>
                <div class="mfoot">
                    <button type="button" class="cbtn" (click)="cancel.emit()">Close</button>
                </div>
            </div>
        </div>
    `,
    styles: `
        .backdrop { position: fixed; inset: 0; z-index: 1100; background: rgba(15, 14, 9, .82); display: flex; align-items: center; justify-content: center; padding: 22px; }
        .modal { background: var(--paper); border: 2px solid var(--ink); width: 100%; max-width: 560px; max-height: 88vh; display: flex; flex-direction: column; }
        .mhead { font-family: var(--label); font-weight: 600; letter-spacing: 2px; text-transform: uppercase; font-size: 12px; color: var(--ink2); background: var(--panel); border-bottom: 2px solid var(--ink); padding: 8px 14px; display: flex; justify-content: space-between; align-items: baseline; }
        .cnt { font-family: var(--mono); font-size: 10px; color: var(--ink2); }
        .mbody { padding: 10px 12px; overflow: auto; }
        .empty { font-family: var(--type); font-size: 13px; color: var(--ink2); text-align: center; padding: 16px; }
        .row { display: flex; align-items: stretch; gap: 6px; margin-bottom: 6px; }
        .pick { flex: 1; min-width: 0; text-align: left; background: var(--paper2); border: 1.4px solid var(--ink); color: var(--ink); padding: 8px 11px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
        .pick:hover, .pick:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .nm { font-family: var(--label); font-weight: 600; letter-spacing: .5px; font-size: 14px; text-transform: uppercase; }
        .sum { font-family: var(--mono); font-size: 11px; color: var(--stamp); }
        .pick:hover .sum, .pick:focus-visible .sum { color: var(--paper); }
        .prog { font-family: var(--label); font-weight: 700; letter-spacing: .5px; font-size: 11.5px; color: var(--ink); } /* D-053: specific "where am I" — Day N · M missions */
        .pick:hover .prog, .pick:focus-visible .prog { color: var(--paper); }
        .when { font-family: var(--mono); font-size: 10px; color: var(--ink2); }
        .pick:hover .when, .pick:focus-visible .when { color: var(--paper); }
        .del { font-family: var(--mono); font-size: 14px; background: var(--paper2); border: 1.4px solid var(--ink2); color: var(--ink2); cursor: pointer; padding: 0 11px; min-width: 40px; }
        .del:hover, .del:focus-visible { background: var(--stamp); color: var(--paper); border-color: var(--stamp); outline: none; }
        .del-confirm { display: flex; gap: 4px; align-items: stretch; }
        .del.yes { border-color: var(--stamp); color: var(--stamp); font-family: var(--label); font-weight: 600; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 0 8px; }
        .del.yes:hover { background: var(--stamp); color: var(--paper); }
        .del.no { font-family: var(--label); font-weight: 600; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 0 8px; }
        .mfoot { display: flex; justify-content: flex-end; border-top: 1.5px solid var(--ink); padding: 11px 14px; }
        .cbtn { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 12px; text-transform: uppercase; border: 1.6px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 9px 14px; cursor: pointer; min-height: 40px; }
        .cbtn:hover, .cbtn:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
    `,
})
export class LoadBrowserComponent {
    private readonly store = inject(CampaignSaveStore);
    readonly pick = output<SaveRecord>();
    readonly cancel = output<void>();

    protected readonly saves = signal<SaveRecord[]>([]);
    protected readonly confirmId = signal<string | null>(null);

    constructor() {
        void this.refresh();
    }

    private async refresh(): Promise<void> {
        this.saves.set(await this.store.list());
    }

    protected async doDelete(id: string): Promise<void> {
        await this.store.remove(id);
        this.confirmId.set(null);
        await this.refresh();
    }

    /** D-053: the specific progress label (Day N · M missions), derived from the record's own snapshot
     *  — so existing autosaves get it with no migration. */
    protected progress(s: SaveRecord): string {
        return s.snapshot ? campaignProgress(s.snapshot) : '';
    }

    protected fmt(ts: number): string {
        try {
            return new Date(ts).toLocaleString();
        } catch {
            return '';
        }
    }

    @HostListener('document:keydown.escape')
    onEsc(): void {
        this.cancel.emit();
    }
    onBackdrop(e: MouseEvent): void {
        if ((e.target as HTMLElement).classList.contains('backdrop')) this.cancel.emit();
    }
}
