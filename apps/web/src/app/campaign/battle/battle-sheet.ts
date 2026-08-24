/*
 * BCE — EDITABLE Classic record sheet (DIRECTIVE-030; D-049/052). It mounts the LIVE fu.svg() (not a
 * clone) so MekBay's unit-svg effects repaint edits in place, and wires MekBay's own
 * SvgInteractionService so armor/internal/crit/ammo clicks commit to the ForceUnit. The owning
 * BattleForceService mirrors those commits to the campaign instance + persists.
 *
 * D-049 — one OPTIONAL, player-scoped extra (default OFF, so the GM battle-view D-030 is unchanged):
 *   · phaseOverlay -> mount MekBay's own `page-interaction-overlay` over the sheet: the "COMMIT AND
 *     END PHASE" control + the turn/PSR tracker. It calls fu.endPhase() — MekBay's automation
 *     (move-for-critical + pilot skill rolls via TurnState). REUSED, not reimplemented.
 * (D-052 removed the D-049 on-sheet unit-name injection — James's live call: nothing above BATTLETECH;
 *  the unit is identified by the sheet's own 'MECH DATA "Type:" line + the player's Units drawer.)
 * MekBay-proper is untouched — we only instantiate its services + reuse its overlay component.
 */
import { Component, ChangeDetectionStrategy, Injector, computed, effect, inject, input, untracked, viewChild, type ElementRef } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { SvgInteractionService } from '../../components/page-viewer/svg-interaction.service';
import type { ZoomPanServiceInterface } from '../../components/page-viewer/zoom-pan.interface';
import { PageInteractionOverlayComponent } from '../../components/page-viewer/overlay/page-interaction-overlay.component';
import { GameSystem } from '../../models/common.model';
import { NewCampaignState } from '../new-campaign-state';
import { AlphaStrikeCardComponent } from '../../components/alpha-strike-card/alpha-strike-card.component';

// DIRECTIVE-083 — game-system fork (ADDITIVE, gated on gameSystem === 'as'): an Alpha Strike battle view shows
// the <alpha-strike-card> (read-only in v1 — AS in-sheet damage editing is a v2 task) instead of the editable
// CBT sheet. The CBT branch (@else + the guarded effect) is byte-identical to before. `as`-absent → degrade.
@Component({
    selector: 'bce-battle-sheet',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [SvgInteractionService], // one interaction service per sheet (component lifecycle cleans it up)
    imports: [PageInteractionOverlayComponent, AlphaStrikeCardComponent],
    template: `
        <div class="bsheet-wrap">
            @if (isAs()) {
                @if (asReady()) {
                    <div class="as-card-host"><alpha-strike-card [unit]="asUnit()!" /></div>
                } @else {
                    <div class="as-degraded">Alpha Strike data unavailable for <b>{{ asUnit()?.name || 'this unit' }}</b> — AS stats are stripped from the era slice (loads with the full catalog).</div>
                }
            } @else {
                <div #container class="bsheet-host"></div>
                @if (phaseOverlay() && fu(); as f) {
                    <page-interaction-overlay mode="fixed" [unit]="f"></page-interaction-overlay>
                }
            }
        </div>
    `,
    styles: `
        :host { display: block; width: 100%; }
        .bsheet-wrap { position: relative; width: 100%; } /* the phase overlay (absolute inset:0) overlays this */
        .bsheet-host { width: 100%; display: flex; align-items: flex-start; justify-content: center; }
        .as-card-host { width: 100%; display: flex; align-items: flex-start; justify-content: center; }
        .as-card-host alpha-strike-card { width: 100%; max-width: 460px; }
        .as-degraded { font-family: var(--mono, monospace); font-size: 12px; line-height: 1.45; color: var(--ink2, #6e6347); padding: 12px; }
    `,
})
export class BattleSheetComponent {
    private readonly state = inject(NewCampaignState);
    readonly fu = input<CBTForceUnit | null>(null);
    /** D-049: mount MekBay's COMMIT/END-PHASE + turn/PSR overlay (player surface only — GM leaves it off). */
    readonly phaseOverlay = input(false);

    private readonly container = viewChild<ElementRef<HTMLDivElement>>('container');
    private readonly interaction = inject(SvgInteractionService);
    private readonly injector = inject(Injector);
    // SvgInteractionService only reads these two flags off the zoom-pan service (picker gesture gating).
    private readonly zoomStub: ZoomPanServiceInterface = { pointerMoved: false, isPanning: false };
    private wired: SVGSVGElement | null = null;

    // D-083 — the game-system fork (CBT default → the unchanged path below).
    protected readonly isAs = computed(() => this.state.gameSystem() === GameSystem.ALPHA_STRIKE);
    protected readonly asUnit = computed(() => this.fu()?.getUnit() ?? null); // `as` is slice-stripped in v1 → degrades
    protected readonly asReady = computed(() => !!this.asUnit()?.as);

    constructor() {
        effect(() => {
            if (this.isAs()) return; // D-083 — AS renders the card (no live CBT sheet to wire)
            const fu = this.fu();
            const host = this.container()?.nativeElement;
            if (!host) return;
            const svg = fu?.svg() ?? null;
            while (host.firstChild) host.removeChild(host.firstChild);
            if (!svg || !fu) { this.wired = null; return; }
            svg.style.width = '100%';
            svg.style.height = 'auto';
            svg.style.display = 'block';
            svg.style.background = '#fff';
            host.appendChild(svg);
            if (this.wired !== svg) {
                // initialize() creates an internal effect — call it OUTSIDE this reactive context (NG0602).
                untracked(() => {
                    this.interaction.initialize(this.container()!, this.injector, this.zoomStub);
                    this.interaction.updateUnit(fu);
                    this.interaction.setupInteractions(svg);
                });
                this.wired = svg;
            }
        });
    }
}
