/*
 * BCE retool — read-only Classic record-sheet display (DIRECTIVE-010).
 * Clones the MekBay-rendered (and sample-damaged) SVG off a ForceUnit and attaches it
 * read-only + scaled — the same technique MekBay's own svg-viewer-lite uses, applied to
 * the ForceUnit's unit-svg.service output so the live damage shows. The SVG carries
 * class `mekbay-sheet`, so the global MekBay sheet styles (pips, .damaged red, etc.)
 * paint it. Pointer-events are off — not editable here. Used for both the cell
 * thumbnail and the explode modal (container controls the width).
 *
 * DIRECTIVE-083 — game-system fork (ADDITIVE, gated on gameSystem === 'as'): for an Alpha Strike campaign
 * this swaps the CBT record sheet for the existing <alpha-strike-card>, fed the unit's `as` stats. The CBT
 * branch (the @else block + the guarded effect) is byte-identical to before. AS stats are stripped from the
 * era slice (DEPLOY-005), so a unit whose `as` is absent DEGRADES gracefully (no crash, logged) — the card
 * shows full stats only once the full catalog is resident (post-market) / after the v2 slice-enrichment.
 */
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
    private readonly hostEl = inject(ElementRef<HTMLElement>); // D-084: clone counter lands on the host (data attr)
    private cloneCount = 0;
    readonly fu = input<CBTForceUnit | null>(null);
    // Re-clone trigger (D-020): crew is driven by mutating the live SVG's DOM in place, so the
    // fu.svg() signal does not re-emit. Bumping `rev` after a pilot reassignment forces a fresh
    // clone of the (now-repainted) live sheet so the thumbnail tracks the new pilot box.
    readonly rev = input(0);
    // D-070 (E): the crewing pilot's Special Pilot Ability display names — rendered as a small line in the
    // Warrior Data area, below the Hits-Taken / Consciousness boxes. Empty → nothing drawn.
    readonly abilities = input<string[]>([]);
    private readonly container = viewChild<ElementRef<HTMLDivElement>>('container');

    // D-083 — the game-system fork (CBT default → the unchanged path below).
    protected readonly isAs = computed(() => this.state.gameSystem() === GameSystem.ALPHA_STRIKE);
    // The unit carries `as` (PV/dmg/Arm/Str/specials) — but the per-era SLICE strips it (DEPLOY-005), so in v1
    // a campaign unit's `as` is absent and the card DEGRADES gracefully. The v2 slim-slice as-enrichment ships
    // `as` in the slice → this same getUnit() then has it and the card renders full stats with no other change.
    protected readonly asUnit = computed(() => this.fu()?.getUnit() ?? null);
    protected readonly asReady = computed(() => !!this.asUnit()?.as);

    constructor() {
        // D-083 — log the graceful AS degrade (slice-stripped `as`), once per unit.
        effect(() => { if (this.isAs() && this.fu() && !this.asReady()) console.warn(`[D-083] Alpha Strike stats unavailable for "${this.asUnit()?.name}" — slice-stripped (as); card degraded gracefully.`); });
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
            injectSheetAbilities(clone, abilities); // shared with the explode modal + the D-071 print path
            this.hostEl.nativeElement.dataset['cloneCount'] = String(++this.cloneCount); // D-084: per-card re-clone tally (proof seam; SVG output unchanged)
        });
    }
}
