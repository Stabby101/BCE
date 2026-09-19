import { Injectable, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignClockService } from '../clock/campaign-clock.service';
import { formatDate } from '../clock/campaign-clock';
import { sessionClockGmText } from '../gm/session-clock-notice';
import type { ChaosContract } from './chaos-contract';

@Injectable({ providedIn: 'root' })
export class ContractWindowService {
    private readonly state = inject(NewCampaignState);
    private readonly clock = inject(CampaignClockService);
    private readonly active = computed(() => this.state.contractFor());

    readonly gmDifficulty = this.state.gmDifficulty; // slider-bound signal
    setDifficulty(v: number): void { this.state.setGmDifficulty(v); }
    difficultyLabel(v: number): string { return v <= 0.9 ? 'Green' : v <= 1.0 ? 'Standard' : v <= 1.3 ? 'Veteran' : 'Elite'; }

    /** Calendar months elapsed on the employer's clock (S72: groundDate — the arrival, once the first transit is booked — else the
     *  sign date → currentDate); 0 if either is null. */
    readonly monthsElapsed = computed(() => {
        const c = this.active(); const acc = c?.groundDate ?? c?.acceptedDate; const cur = this.state.currentDate();
        if (!c || !acc || !cur) return 0;
        return Math.max(0, (cur.y - acc.y) * 12 + (cur.m - acc.m));
    });
    /** The contract's month-window length (authored lengthMonths, else intensity for old saves). */
    windowMonths(c: ChaosContract): number { return c.lengthMonths ?? c.intensity; }
    /** The current month within the window (1-based; you're IN month X), capped at Y. */
    readonly monthX = computed(() => { const c = this.active(); return c ? Math.min(this.monthsElapsed() + 1, this.windowMonths(c)) : 0; });
    /** True once you're past the last authored month (monthsElapsed+1 > Y) — the soft window-elapsed state. */
    readonly windowElapsed = computed(() => { const c = this.active(); return c ? this.monthsElapsed() + 1 > this.windowMonths(c) : false; });
    readonly tableBound = computed(() => this.state.tableBound());
    advanceMonth(): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.active()) return;
        if (this.state.tableBound()) return;
        this.clock.advance('month');
        // the session date and tells its player; the GM device says the same here. gmSession ONLY — a plain campaign sets
        // nothing, so neither GM surface renders a line (byte-identical there). Device-local, replaced by the next advance.
        if (this.state.gmSession()) { const d = this.state.currentDate(); this.sessionClockNotice.set(d ? sessionClockGmText(formatDate(d)) : null); }
    }
    readonly sessionClockNotice = signal<string | null>(null);
}
