import { Component, ChangeDetectionStrategy, HostListener, inject, output, signal } from '@angular/core';
import { CampaignSaveStore } from '../campaign-save-store';

@Component({
    selector: 'bce-save-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="backdrop" (click)="onBackdrop($event)">
            <div class="modal" role="dialog" aria-modal="true" aria-label="Save campaign">
                <div class="mhead">Save campaign</div>
                <div class="mbody">
                    <label class="fl" for="svname">Save as</label>
                    <input #nm id="svname" class="fi" type="text" [value]="name()" (input)="onName(nm.value)" placeholder="Campaign name" />
                    @if (pendingOverwrite()) {
                        <p class="warn">A save named <b>“{{ pendingOverwrite() }}”</b> already exists — overwrite it?</p>
                    } @else {
                        <p class="hint">Names overwrite a same-name save. Quick Save always writes a new autosave.</p>
                    }
                </div>
                <div class="mfoot">
                    <button type="button" class="cbtn" (click)="cancel.emit()">Cancel</button>
                    <button type="button" class="cbtn" [disabled]="busy()" (click)="quickSave()">Quick Save</button>
                    <button type="button" class="cbtn go" [disabled]="busy() || !name().trim()" (click)="saveAs()">
                        {{ pendingOverwrite() ? 'Overwrite' : 'Save As' }} &raquo;
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: `
        .backdrop { position: fixed; inset: 0; z-index: 1100; background: rgba(15, 14, 9, .82); display: flex; align-items: center; justify-content: center; padding: 22px 22px calc(22px + var(--bce-footer-h, 0px)); }
        .modal { background: var(--paper); border: 2px solid var(--ink); width: 100%; max-width: 480px; }
        .mhead { font-family: var(--label); font-weight: 600; letter-spacing: 2px; text-transform: uppercase; font-size: 12px; color: var(--ink2); background: var(--panel); border-bottom: 2px solid var(--ink); padding: 8px 14px; }
        .mbody { padding: 16px 14px; }
        .fl { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 11px; color: var(--ink2); display: block; margin-bottom: 5px; }
        .fi { font-family: var(--mono); font-size: 14px; background: var(--paper); border: 1.4px solid var(--ink); color: var(--ink); padding: 9px; width: 100%; min-height: 42px; }
        .hint { font-family: var(--type); font-size: 12px; color: var(--ink2); margin: 9px 0 0; line-height: 1.4; }
        .warn { font-family: var(--type); font-size: 12.5px; color: var(--stamp); margin: 9px 0 0; line-height: 1.4; }
        .mfoot { display: flex; justify-content: flex-end; gap: 8px; border-top: 1.5px solid var(--ink); padding: 11px 14px; flex-wrap: wrap; }
        .cbtn { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 12px; text-transform: uppercase; border: 1.6px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 9px 14px; cursor: pointer; min-height: 40px; }
        .cbtn:hover:not(:disabled), .cbtn:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .cbtn.go { border-color: var(--stamp); color: var(--stamp); }
        .cbtn.go:hover:not(:disabled), .cbtn.go:focus-visible { background: var(--stamp); color: var(--paper); }
        .cbtn:disabled { opacity: .45; cursor: not-allowed; }
    `,
})
export class SaveDialogComponent {
    private readonly store = inject(CampaignSaveStore);
    readonly saved = output<void>();
    readonly cancel = output<void>();

    protected readonly name = signal(this.store.defaultName());
    protected readonly pendingOverwrite = signal<string | null>(null);
    protected readonly busy = signal(false);

    protected onName(v: string): void {
        this.name.set(v);
        if (this.pendingOverwrite() && this.pendingOverwrite() !== v.trim()) this.pendingOverwrite.set(null);
    }

    protected async saveAs(): Promise<void> {
        const n = this.name().trim();
        if (!n || this.busy()) return;
        this.busy.set(true);
        try {
            if (this.pendingOverwrite() !== n) {
                const existing = await this.store.findByName(n);
                if (existing) {
                    this.pendingOverwrite.set(n); // require a second click to confirm overwrite
                    return;
                }
            }
            await this.store.saveAs(n);
            this.saved.emit();
        } finally {
            this.busy.set(false);
        }
    }

    protected async quickSave(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            await this.store.quickSave();
            this.saved.emit();
        } finally {
            this.busy.set(false);
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
