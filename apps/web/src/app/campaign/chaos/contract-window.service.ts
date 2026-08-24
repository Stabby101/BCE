/*
 * BCE — the active-contract MONTH WINDOW (D-131) + GM DIFFICULTY (D-124) facade. Extracted verbatim from the
 * chaos-contracts god file by DIRECTIVE-HARDEN-2 (pure move — the tab delegates; the reactive graph is the
 * same computeds over the same root state signals). A SERVICE rather than a child component on purpose: these
 * members render in four non-contiguous template spots (the Month tag amid the header tags, the difficulty
 * block in BOTH the active and offer views, the advance button in the actions row, the window warning) plus
 * the __d131 test seam — a child would shatter that markup. No local state lives here.
 */
import { Injectable, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignClockService } from '../clock/campaign-clock.service'; // D-131 — advance a month (fires the existing monthly tick)
import type { ChaosContract } from './chaos-contract';

@Injectable({ providedIn: 'root' })
export class ContractWindowService {
    private readonly state = inject(NewCampaignState);
    private readonly clock = inject(CampaignClockService);
    private readonly active = this.state.activeChaosContract;

    // ── D-124 — GM difficulty (persisted, HS-only; raises OpFor BV + pilot skill) ──
    readonly gmDifficulty = this.state.gmDifficulty; // slider-bound signal
    setDifficulty(v: number): void { this.state.setGmDifficulty(v); }
    difficultyLabel(v: number): string { return v <= 0.9 ? 'Green' : v <= 1.0 ? 'Standard' : v <= 1.3 ? 'Veteran' : 'Elite'; }

    // ── D-131 — the contract MONTH WINDOW (surface only; the per-month ledger is the existing monthlyWarchestTick). ──
    /** Calendar months elapsed since the contract was accepted (acceptedDate → currentDate); 0 if either is null. */
    readonly monthsElapsed = computed(() => {
        const c = this.active(); const acc = c?.acceptedDate; const cur = this.state.currentDate();
        if (!c || !acc || !cur) return 0;
        return Math.max(0, (cur.y - acc.y) * 12 + (cur.m - acc.m));
    });
    /** The contract's month-window length (authored lengthMonths, else intensity for old saves). */
    windowMonths(c: ChaosContract): number { return c.lengthMonths ?? c.intensity; }
    /** The current month within the window (1-based; you're IN month X), capped at Y. */
    readonly monthX = computed(() => { const c = this.active(); return c ? Math.min(this.monthsElapsed() + 1, this.windowMonths(c)) : 0; });
    /** True once you're past the last authored month (monthsElapsed+1 > Y) — the soft window-elapsed state. */
    readonly windowElapsed = computed(() => { const c = this.active(); return c ? this.monthsElapsed() + 1 > this.windowMonths(c) : false; });
    /** D-131 — advance the campaign one month INSIDE the contract → the existing monthlyWarchestTick posts Maintenance
     *  + Base Pay for the crossed boundary (no new ledger logic); Month X/Y + the ledger update reactively. HS-only. */
    advanceMonth(): void { if (this.state.campaignSystem() !== 'hotspots' || !this.active()) return; this.clock.advance('month'); }
}
