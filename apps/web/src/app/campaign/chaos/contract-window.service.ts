/*
 * BCE — the active-contract MONTH WINDOW (D-131) + GM DIFFICULTY (D-124) facade. Extracted verbatim from the
 * chaos-contracts god file by DIRECTIVE-HARDEN-2 (pure move — the tab delegates; the reactive graph is the
 * same computeds over the same root state signals). A SERVICE rather than a child component on purpose: these
 * members render in four non-contiguous template spots (the Month tag amid the header tags, the difficulty
 * block in BOTH the active and offer views, the advance button in the actions row, the window warning) plus
 * the __d131 test seam — a child would shatter that markup. No local state lives here.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignClockService } from '../clock/campaign-clock.service'; // D-131 — advance a month (fires the existing monthly tick)
import { formatDate } from '../clock/campaign-clock';
import { sessionClockGmText } from '../gm/session-clock-notice'; // GM-3 P0 — tell the table (the GM device's words)
import type { ChaosContract } from './chaos-contract';

@Injectable({ providedIn: 'root' })
export class ContractWindowService {
    private readonly state = inject(NewCampaignState);
    private readonly clock = inject(CampaignClockService);
    private readonly active = computed(() => this.state.contractFor()); // GM-2 P2a — through the ONE accessor

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
    /** GM-3 P3 — this home campaign is bound to a GM's table (the table's clock is the GM's). Advance is withheld until the
     *  player leaves. Null on every plain campaign → the D-131 loop is byte-untouched there. */
    readonly tableBound = computed(() => this.state.tableBound());
    advanceMonth(): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.active()) return;
        if (this.state.tableBound()) return; // GM-3 P3 — a table-bound home campaign does not advance its own month
        this.clock.advance('month');
        // GM-3 P0 — TELL THE TABLE (PD2-4): the advance persisted → the api fans the snapshot to every joined device, which diffs
        // the session date and tells its player; the GM device says the same here. gmSession ONLY — a plain campaign sets
        // nothing, so neither GM surface renders a line (byte-identical there). Device-local, replaced by the next advance.
        if (this.state.gmSession()) { const d = this.state.currentDate(); this.sessionClockNotice.set(d ? sessionClockGmText(formatDate(d)) : null); }
    }
    /** GM-3 P0 — the GM device's own session-clock line after an advance (null on a plain campaign, always). Rendered by the
     *  GM panel's clock section and the Contracts tab's advance row — whichever button the GM pressed. */
    readonly sessionClockNotice = signal<string | null>(null);
}
