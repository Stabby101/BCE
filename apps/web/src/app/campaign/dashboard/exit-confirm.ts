import { Component, ChangeDetectionStrategy, HostListener, input, output } from '@angular/core';

@Component({
    selector: 'bce-exit-confirm',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="backdrop" (click)="onBackdrop($event)">
            <div class="modal" role="dialog" aria-modal="true" aria-label="Confirm exit">
                <div class="mhead">Confirm</div>
                <div class="mbody">
                    <p class="q">{{ question() }}</p>
                    <p class="act">Action: <b>{{ actionLabel() }}</b> — save your campaign first?</p>
                </div>
                <div class="mfoot">
                    <button type="button" class="cbtn" (click)="cancel.emit()">Cancel</button>
                    <button type="button" class="cbtn" (click)="saveAs.emit()">Save As…</button>
                    <button type="button" class="cbtn" (click)="quickSave.emit()">Quick Save</button>
                    <button type="button" class="cbtn go" (click)="proceed.emit()">{{ actionLabel() }} anyway &raquo;</button>
                </div>
            </div>
        </div>
    `,
    styles: `
        .backdrop { position: fixed; inset: 0; z-index: 1100; background: rgba(15, 14, 9, .82); display: flex; align-items: center; justify-content: center; padding: 22px 22px calc(22px + var(--bce-footer-h, 0px)); }
        .modal { background: var(--paper); border: 2px solid var(--ink); width: 100%; max-width: 520px; }
        .mhead { font-family: var(--label); font-weight: 600; letter-spacing: 2px; text-transform: uppercase; font-size: 12px; color: var(--ink2); background: var(--panel); border-bottom: 2px solid var(--ink); padding: 8px 14px; }
        .mbody { padding: 16px 14px; }
        .q { font-family: var(--type); font-size: 15px; color: var(--ink); margin: 0; line-height: 1.5; }
        .act { font-family: var(--mono); font-size: 12px; color: var(--ink2); margin: 10px 0 0; }
        .act b { color: var(--stamp); }
        .mfoot { display: flex; justify-content: flex-end; gap: 8px; border-top: 1.5px solid var(--ink); padding: 11px 14px; flex-wrap: wrap; }
        .cbtn { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 12px; text-transform: uppercase; border: 1.6px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 9px 14px; cursor: pointer; min-height: 40px; }
        .cbtn:hover, .cbtn:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .cbtn.go { border-color: var(--stamp); color: var(--stamp); }
        .cbtn.go:hover, .cbtn.go:focus-visible { background: var(--stamp); color: var(--paper); }
    `,
})
export class ExitConfirmComponent {
    readonly actionLabel = input<string>('Exit');
    readonly question = input<string>('Are you sure you want to exit or navigate away?');
    readonly saveAs = output<void>();
    readonly quickSave = output<void>();
    readonly proceed = output<void>();
    readonly cancel = output<void>();

    @HostListener('document:keydown.escape')
    onEsc(): void {
        this.cancel.emit();
    }
    onBackdrop(e: MouseEvent): void {
        if ((e.target as HTMLElement).classList.contains('backdrop')) this.cancel.emit();
    }
}
