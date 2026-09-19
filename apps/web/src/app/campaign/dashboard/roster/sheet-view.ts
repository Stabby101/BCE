import { Component, ChangeDetectionStrategy, effect, input, viewChild, inject, computed, ElementRef } from '@angular/core';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { cloneSheetSvg, injectSheetAbilities } from './sheet-compose';
import { GameSystem } from '../../../models/common.model';
import { NewCampaignState } from '../../new-campaign-state';
import { AlphaStrikeCardComponent } from '../../../components/alpha-strike-card/alpha-strike-card.component';

@Component({
    selector: 'bce-sheet-view',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlphaStrikeCardComponent],
    template: `
        @if (isAs()) {
            @if (asReady()) {
                <div class="as-card-host"><alpha-strike-card [unit]="asUnit()!" /></div>
            } @else {
                <div class="as-degraded">Alpha Strike data unavailable for <b>{{ asUnit()?.name || 'this unit' }}</b> — its AS stats are stripped from the era slice. (Loads with the full catalog; the v2 slice-enrichment fixes this.)</div>
            }
        } @else {
            <div #container class="sheet-host"></div>
        }
    `,
    styles: `
        :host { display: block; width: 100%; }
        .sheet-host { width: 100%; display: flex; align-items: flex-start; justify-content: center; }
        .as-card-host { width: 100%; display: flex; align-items: flex-start; justify-content: center; }
        .as-card-host alpha-strike-card { width: 100%; max-width: 460px; }
        .as-degraded { font-family: var(--mono, monospace); font-size: 12px; line-height: 1.45; color: var(--ink2, #6e6347); padding: 12px; border: 1px dashed var(--line, #999); border-radius: 6px; background: rgba(0, 0, 0, .02); }
    `,
})
export class SheetViewComponent {
    private readonly state = inject(NewCampaignState);
    private readonly hostEl = inject(ElementRef<HTMLElement>);
    private cloneCount = 0;
    readonly fu = input<CBTForceUnit | null>(null);
    // fu.svg() signal does not re-emit. Bumping `rev` after a pilot reassignment forces a fresh
    // clone of the (now-repainted) live sheet so the thumbnail tracks the new pilot box.
    readonly rev = input(0);
    // Warrior Data area, below the Hits-Taken / Consciousness boxes. Empty → nothing drawn.
    readonly abilities = input<string[]>([]);
    private readonly container = viewChild<ElementRef<HTMLDivElement>>('container');

    protected readonly isAs = computed(() => this.state.gameSystem() === GameSystem.ALPHA_STRIKE);
    // The unit carries `as` (PV/dmg/Arm/Str/specials) — but the per-era SLICE strips it (DEPLOY-005), so in v1
    // a campaign unit's `as` is absent and the card DEGRADES gracefully. The v2 slim-slice as-enrichment ships
    // `as` in the slice → this same getUnit() then has it and the card renders full stats with no other change.
    protected readonly asUnit = computed(() => this.fu()?.getUnit() ?? null);
    protected readonly asReady = computed(() => !!this.asUnit()?.as);

    constructor() {
        effect(() => { if (this.isAs() && this.fu() && !this.asReady()) console.warn(`[] Alpha Strike stats unavailable for "${this.asUnit()?.name}" — slice-stripped (as); card degraded gracefully.`); });
        // CBT path — UNCHANGED. Guarded so it never runs for an AS campaign (no #container then).
        effect(() => {
            if (this.isAs()) return;
            const fu = this.fu();
            this.rev(); // depend on the re-clone trigger
            const abilities = this.abilities(); // re-inject when the pilot's SPAs change
            const host = this.container()?.nativeElement;
            if (!host) return;
            while (host.firstChild) host.removeChild(host.firstChild);
            const clone = cloneSheetSvg(fu);
            if (!clone) return;
            clone.style.pointerEvents = 'none';
            clone.style.width = '100%';
            clone.style.height = 'auto';
            clone.style.display = 'block';
            clone.style.background = '#fff';
            host.appendChild(clone);
            injectSheetAbilities(clone, abilities);
            this.hostEl.nativeElement.dataset['cloneCount'] = String(++this.cloneCount);
        });
    }
}
