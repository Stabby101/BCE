import { Component, ChangeDetectionStrategy, Injector, computed, effect, inject, input, untracked, viewChild, type ElementRef } from '@angular/core';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { SvgInteractionService } from '../../components/page-viewer/svg-interaction.service';
import type { ZoomPanServiceInterface } from '../../components/page-viewer/zoom-pan.interface';
import { PageInteractionOverlayComponent } from '../../components/page-viewer/overlay/page-interaction-overlay.component';
import { PageViewerStateService } from '../../components/page-viewer/internal/page-viewer-state.service'; // REBASE-1 P1 (e): SvgInteractionService + the overlay inject this component-scoped state; provided here (not the full <page-viewer>) so the standalone sheet has it
import { GameSystem } from '../../models/common.model';
import { NewCampaignState } from '../new-campaign-state';
import { AlphaStrikeCardComponent } from '../../components/alpha-strike-card/alpha-strike-card.component';

// the <alpha-strike-card> (read-only in v1 — AS in-sheet damage editing is a v2 task) instead of the editable
// CBT sheet. The CBT branch (@else + the guarded effect) is byte-identical to before. `as`-absent → degrade.
@Component({
    selector: 'bce-battle-sheet',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // REBASE-1 P1 (e): the pin's page-viewer refactor made SvgInteractionService + PageInteractionOverlayComponent
    // inject PageViewerStateService, a COMPONENT-scoped service the fork's page-viewer did not require here. bce-battle-sheet
    // uses those internals WITHOUT a <page-viewer> ancestor (which is the only other provider), so a player/battle sheet threw
    // NG0201 ("No provider found for PageViewerStateService", Source: PlayerSheetComponent) and never rendered its SVG. Provide
    // the one leaf state service here (it has no deps of its own) — a single instance shared by the interaction service and the
    // overlay child, exactly as PageViewerComponent shares it. One interaction service + one state per sheet (component-scoped).
    providers: [SvgInteractionService, PageViewerStateService],
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
    readonly phaseOverlay = input(false);

    private readonly container = viewChild<ElementRef<HTMLDivElement>>('container');
    private readonly interaction = inject(SvgInteractionService);
    private readonly injector = inject(Injector);
    // SvgInteractionService only reads these two flags off the zoom-pan service (picker gesture gating).
    // REBASE-1 P1 c: upstream added a required `cancelGesture()` to the interface; a no-op suffices here —
    // this stub feeds only the picker-gating flag reads, there is no real gesture to cancel on the sheet.
    private readonly zoomStub: ZoomPanServiceInterface = { pointerMoved: false, isPanning: false, cancelGesture: () => {} };
    private wired: SVGSVGElement | null = null;

    protected readonly isAs = computed(() => this.state.gameSystem() === GameSystem.ALPHA_STRIKE);
    protected readonly asUnit = computed(() => this.fu()?.getUnit() ?? null); // `as` is slice-stripped in v1 → degrades
    protected readonly asReady = computed(() => !!this.asUnit()?.as);

    // REBASE-1 P3 item 2 — the to-hit overlay. The pin's Targets button lives inside page-interaction-overlay, which
    // rides the player's .ps-zoom transform and slides off-screen after a pick/zoom (item-1's class). Expose the pin's
    // own openTargets so a viewport-PINNED trigger on player-sheet (outside the transform, like .ps-endphase) can reach
    // it. NO vendored edit: we call the overlay's unchanged openTargets(event) with a synthetic event anchored to the
    // pinned trigger — the WeaponTargetsMenu/TnCalculator open as CDK overlays at the document root, viewport-fixed.
    private readonly overlay = viewChild(PageInteractionOverlayComponent);
    /** True when the interactive to-hit path is live: a real CBT sheet (not AS) with the phase overlay mounted. */
    readonly toHitReady = computed(() => !this.isAs() && !!this.fu() && this.phaseOverlay());
    /** Open the pin's to-hit (weapon targets) overlay for this sheet's unit, anchored to `anchor` (the pinned trigger). */
    openTargetsAt(anchor: HTMLElement): void {
        this.overlay()?.openTargets({ stopPropagation: () => {}, currentTarget: anchor } as unknown as MouseEvent);
    }

    constructor() {
        effect(() => {
            if (this.isAs()) return;
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
