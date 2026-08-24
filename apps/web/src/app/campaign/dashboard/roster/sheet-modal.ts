/*
 * BCE retool — explode modal for the Classic record sheet (DIRECTIVE-010).
 * Full-size READ-ONLY view of the same MekBay-rendered damaged sheet (via sheet-view).
 * Closes on ✕, Esc, and click-outside. No edit affordances. Field-dossier theme tokens
 * (inherited from the dashboard .theme-dossier host).
 */
import { Component, ChangeDetectionStrategy, HostListener, input, output, inject, ApplicationRef, EnvironmentInjector } from '@angular/core';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { SheetViewComponent } from './sheet-view';
import { printSheets } from './sheet-print';
import { NewCampaignState } from '../../new-campaign-state';

@Component({
    selector: 'bce-sheet-modal',
    standalone: true,
    imports: [SheetViewComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="backdrop" (click)="onBackdrop($event)">
            <div class="modal" role="dialog" aria-modal="true">
                <div class="mhead">
                    <span class="mt">{{ title() }} <span class="ro">read-only · Classic record sheet</span></span>
                    <div class="macts">
                        <!-- D-071 (A): print the currently-shown composed sheet (MekBay SVG + the D-070 pilot box + SPAs) -->
                        <button type="button" class="pr" (click)="print()" aria-label="Print this record sheet">⎙ Print</button>
                        <button type="button" class="x" (click)="close.emit()" aria-label="Close">&#10005;</button>
                    </div>
                </div>
                <div class="mbody">
                    <bce-sheet-view [fu]="fu()" [abilities]="abilities()"></bce-sheet-view>
                </div>
                <div class="mfoot">Esc · ✕ · click outside to close</div>
            </div>
        </div>
    `,
    styles: `
        /* HOTFIX-019: above the gated GM account pill (z-index 9000) so the exploded sheet's ✕ + ⎙ print are never covered. */
        .backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(15, 14, 9, .82); display: flex; align-items: center; justify-content: center; padding: 22px 22px calc(22px + var(--bce-footer-h, 0px)); } /* IMPORT-7 A — clear the legal footer */
        .modal { background: var(--paper); border: 2px solid var(--ink); width: 100%; max-width: 720px; max-height: 92vh; display: flex; flex-direction: column; }
        .mhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 2px solid var(--ink); padding: 9px 14px; }
        .mt { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 14px; color: var(--ink); }
        .ro { font-family: var(--mono); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 10px; color: var(--ink2); margin-left: 6px; }
        .macts { display: flex; align-items: center; gap: 8px; }
        .pr { font-family: var(--label); font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 11px; background: var(--paper2); color: var(--ink); border: 1.6px solid var(--ink); padding: 5px 12px; cursor: pointer; min-height: 40px; }
        .pr:hover, .pr:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .x { font-family: var(--mono); font-size: 16px; line-height: 1; background: var(--paper2); color: var(--stamp); border: 1.6px solid var(--stamp); padding: 5px 10px; cursor: pointer; min-height: 40px; min-width: 40px; }
        .x:hover, .x:focus-visible { background: var(--stamp); color: var(--paper); outline: none; }
        .mbody { overflow: auto; padding: 12px 14px; background: var(--paper2); }
        .mfoot { font-family: var(--mono); font-size: 10px; letter-spacing: 1px; color: var(--ink2); border-top: 1.5px solid var(--ink); padding: 7px 14px; text-align: right; }
    `,
})
export class SheetModalComponent {
    private readonly state = inject(NewCampaignState);
    private readonly appRef = inject(ApplicationRef);
    private readonly envInjector = inject(EnvironmentInjector);
    readonly fu = input<CBTForceUnit | null>(null);
    readonly title = input<string>('');
    readonly abilities = input<string[]>([]); // D-070 (E): the SPA overlay, forwarded to the cloned sheet
    readonly close = output<void>();

    @HostListener('document:keydown.escape')
    onEsc(): void {
        this.close.emit();
    }

    onBackdrop(e: MouseEvent): void {
        if ((e.target as HTMLElement).classList.contains('backdrop')) this.close.emit();
    }

    /** D-071 (A): print THIS sheet — composed full-page (pilot box + SPAs), no app chrome. D-083: AS routes
     *  to the alpha-strike-card print; CBT (default) is byte-identical. */
    print(): void {
        printSheets([{ fu: this.fu(), abilities: this.abilities() }], { gameSystem: this.state.gameSystem(), appRef: this.appRef, environmentInjector: this.envInjector });
    }
}
