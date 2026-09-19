import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { PersonnelService } from './personnel.service';
import { BAND_LABEL, ROLE_LABEL, type ExperienceBand, type SupportRole } from './starting-personnel';

@Component({
    selector: 'bce-hiring-hall',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (market(); as m) {
            <div class="ph flat" style="margin-top:24px">Hiring Hall <span class="scaf">{{ m.pool.length }} available · refreshes monthly</span></div>
            <p class="hh-note">The personnel market for {{ m.periodKey }}. Seasoned hands are scarce and ask a signing bonus — the pool skews to your command's average.</p>
            @if (lastHired(); as h) {
                <p class="hh-hired" role="status">✓ Hired <b>{{ h.name }}</b> — {{ roleLabel(h.role) }}. Joined the Support Personnel roster above (open the {{ roleLabel(h.role) }} group to see them).</p>
            }
            @if (m.pool.length === 0) {
                <p class="hh-note thin">No candidates available this month.</p>
            } @else {
                <div class="hh-rows">
                    @for (c of m.pool; track c.id) {
                        <div class="hh-row" [class]="'role-' + c.role">
                            <span class="hh-name">{{ c.name }}</span>
                            <span class="hh-role">{{ roleLabel(c.role) }}</span>
                            <span class="hh-band">{{ bandLabel(c.experienceBand) }}@if (c.skillLevel) { · skill {{ c.skillLevel }} }</span>
                            <span class="hh-salary">{{ money(c.salary) }}/mo</span>
                            <span class="hh-bonus">@if (c.signingBonus) { <b class="bonus">+{{ money(c.signingBonus) }}</b> signing } @else { <span class="none">no bonus</span> }</span>
                            <button type="button" class="hh-hire" (click)="hire(c.id)">HIRE</button>
                        </div>
                    }
                </div>
            }
        } @else {
            <div class="ph flat" style="margin-top:24px">Hiring Hall</div>
            <p class="hh-note thin">Hiring Hall unavailable — no personnel market rolled for this period (it refreshes monthly; advance the clock to roll a fresh pool).</p>
        }
    `,
    styles: [`
        :host { display: block; }
        .ph.flat { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 13px; text-transform: uppercase; border-bottom: 1.4px solid var(--ink); padding-bottom: 5px; }
        .scaf { font-family: var(--mono); font-size: 11px; color: var(--ink2); margin-left: 6px; }
        .hh-note { font-family: var(--type); font-size: 12px; color: var(--ink2); margin: 6px 0; }
        .hh-note.thin { margin-left: 4px; }
        .hh-hired { font-family: var(--type); font-size: 12.5px; color: var(--ink); background: color-mix(in srgb, #2e7d32 12%, transparent); border-left: 2.5px solid #2e7d32; padding: 6px 9px; margin: 8px 0; }
        .hh-rows { display: flex; flex-direction: column; }
        .hh-row { display: grid; grid-template-columns: 1.3fr 1fr 1.1fr .9fr 1.1fr 64px; align-items: baseline; gap: 10px; font-family: var(--type); font-size: 13px; padding: 6px 9px; border-bottom: 1px solid color-mix(in srgb, var(--ink2) 25%, transparent); }
        .hh-name { font-weight: 600; color: var(--ink); }
        .hh-role { color: var(--ink); font-size: 12px; }
        .hh-band { color: var(--ink2); font-size: 12px; }
        .hh-salary { font-family: var(--mono); font-size: 12px; color: var(--ink2); text-align: right; }
        .hh-bonus { font-size: 11.5px; color: var(--ink2); }
        .hh-bonus .bonus { font-family: var(--mono); color: #c79a23; }
        .hh-bonus .none { color: color-mix(in srgb, var(--ink2) 70%, transparent); }
        .hh-hire { font-family: var(--label); font-weight: 700; letter-spacing: 1px; font-size: 10px; padding: 4px 0; border: 1.3px solid var(--ink); background: var(--panel); color: var(--ink); cursor: pointer; }
        .hh-hire:hover { background: var(--ink); color: var(--paper); }
    `],
})
export class HiringHallComponent {
    private readonly state = inject(NewCampaignState);
    private readonly svc = inject(PersonnelService);
    private readonly store = inject(CampaignSaveStore);
    protected readonly market = this.state.hiringMarket;
    protected readonly lastHired = signal<{ name: string; role: SupportRole } | null>(null);

    constructor() {
        // Lazy refresh: ensure the pool is current for the campaign MONTH on view AND whenever the clock advances
        // (tracking currentDate re-runs this on a month cross → clear-and-rebuild). No-op within the same month.
        effect(() => {
            this.state.currentDate(); // dependency: a clock advance re-evaluates the period
            if (this.svc.ensureHiringMarket()) void this.store.persistCurrent();
        });
    }

    protected hire(id: string): void {
        const cand = this.market()?.pool.find((c) => c.id === id); // capture before hire() removes it from the pool
        if (this.svc.hire(id) && cand) this.lastHired.set({ name: cand.name, role: cand.role });
    }
    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected roleLabel(r: SupportRole): string { return ROLE_LABEL[r]; }
    protected bandLabel(b: ExperienceBand): string { return BAND_LABEL[b]; }
}
