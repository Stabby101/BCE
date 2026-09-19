import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

@Component({
    selector: 'bce-player-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ov-backdrop" (click)="onBackdrop($event)">
            <div class="ov-panel" role="dialog" aria-modal="true">
                <header class="ov-head">
                    <span class="ov-title">{{ title() }}</span>
                    <button type="button" class="ov-x" (click)="close.emit()" aria-label="Close">&#10005;</button>
                </header>
                <div class="ov-body"><ng-content></ng-content></div>
                <footer class="ov-foot">Esc · ✕ · tap outside to close</footer>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .ov-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(6, 8, 11, .86);
                       display: flex; align-items: center; justify-content: center; padding: 16px 16px calc(16px + var(--bce-footer-h, 0px));
                       font: 15px/1.4 system-ui, Segoe UI, Roboto, sans-serif; }
        .ov-panel { background: #11161c; border: 1px solid #2a3340; border-radius: 14px; width: 100%;
                    max-width: 760px; max-height: 94dvh; display: flex; flex-direction: column; color: #e7edf3; }
        .ov-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
                   padding: 12px 16px; border-bottom: 1px solid #232c37; }
        .ov-title { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 13px; color: #cdd8e3; }
        .ov-x { font-size: 16px; line-height: 1; background: #1c232c; color: #e08b7a; border: 1px solid #6b3a2f;
                border-radius: 8px; min-width: 40px; min-height: 40px; cursor: pointer; }
        .ov-x:hover, .ov-x:focus-visible { background: #6b3a2f; color: #fff; outline: none; }
        .ov-body { overflow: auto; padding: 14px 16px; }
        .ov-foot { font-size: 10px; letter-spacing: .1em; color: #6b7682; border-top: 1px solid #232c37;
                   padding: 8px 16px; text-align: right; }
    `],
})
export class PlayerOverlayComponent {
    readonly title = input<string>('');
    readonly close = output<void>();

    @HostListener('document:keydown.escape')
    onEsc(): void { this.close.emit(); }

    onBackdrop(e: MouseEvent): void {
        if ((e.target as HTMLElement).classList.contains('ov-backdrop')) this.close.emit();
    }
}
