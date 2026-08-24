/*
 * BCE Personnel (DIRECTIVE-058, T-040 slice 1) — the Support Personnel Barracks section (GM surface).
 *
 * A self-contained, render-only view of the stored PersonnelState (DATA-003: renders from structure, never
 * re-rolls). Three reads: (1) the STAFFING summary (6:1 have-vs-need + the short-staffed penalty band), (2) the
 * monthly PAYROLL total (the recurring burn the T-037 ledger projects), (3) the named support ROSTER grouped by
 * role. Embedded in the dashboard Barracks section beside the combat-pilot grid. Mirrors inventory-tab.ts.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { PersonnelService } from './personnel.service';
import { BAND_LABEL, ROLE_LABEL, ROLE_SKILL, type SupportPerson, type SupportRole } from './starting-personnel';

const ROLE_ORDER: SupportRole[] = ['mek_tech', 'astech', 'doctor', 'medic', 'admin'];

@Component({
    selector: 'bce-support-personnel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pn(); as p) {
            <div class="ph flat" style="margin-top:22px">Support Personnel <span class="scaf">{{ p.roster.length }}</span></div>

            <!-- STAFFING SUMMARY — the 6:1 ratio gate (display this slice; repair-wiring later) -->
            <div class="staffing">
                @for (s of p.staffing; track s.label) {
                    <div class="staffing-line" [class.short]="s.shortMod > 0">
                        <span class="sl-label">{{ s.label }}</span>
                        <span class="sl-hn">{{ s.have }} / {{ s.need }}</span>
                        <span class="sl-mod" [class.ok]="s.shortMod === 0">{{ s.shortMod > 0 ? 'SHORT-STAFFED +' + s.shortMod : 'ADEQUATE' }}</span>
                        <span class="sl-note">{{ s.note }}</span>
                    </div>
                }
            </div>

            <!-- MONTHLY PAYROLL — the recurring burn (also fed to the inventory ledger projection) -->
            <div class="payroll" data-kind="payroll">
                Monthly payroll <b>{{ money(p.monthlyPayroll) }}</b> C-bills/mo · {{ activeCount() }} on staff
                <span class="prov">· CamOps / MekHQ salary scale</span>
            </div>

            <!-- THE NAMED ROSTER (layer 1) — grouped by role. HF-016: collapsible, START COLLAPSED (header +
                 count, expand on click) — mirrors the inventory-tab cat-head pattern. -->
            @for (g of groups(); track g.role) {
                <button type="button" class="role-head rh-btn" (click)="toggleGroup(g.role)" [attr.aria-expanded]="isOpen(g.role)">
                    <span class="caret" [class.open]="isOpen(g.role)">▸</span>
                    {{ g.label }} <span class="scaf">{{ g.people.length }}</span>
                </button>
                @if (isOpen(g.role)) {
                    <div class="support-rows">
                        @for (s of g.people; track s.id) {
                            <div class="support-row" [class]="'role-' + s.role" [class.inj]="s.status === 'injured'" [class.kia]="s.status === 'kia'">
                                <span class="sr-name">{{ s.name }}</span>
                                <span class="sr-band">{{ band(s.experienceBand) }}@if (s.skillLevel) { · {{ skill(s.role) }} {{ s.skillLevel }} }</span>
                                <span class="sr-salary">{{ money(s.salary) }} C-bills/mo</span>
                                <span class="sr-status" [class.warn]="s.status !== 'active'">{{ s.status }}</span>
                                <button type="button" class="sr-fire" (click)="fire(s.id)" title="Dismiss from the roster (D-059)">✕</button>
                            </div>
                        }
                    </div>
                }
            }
        }
    `,
    styles: [`
        :host { display: block; }
        .ph.flat { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; font-size: 13px; text-transform: uppercase; border-bottom: 1.4px solid var(--ink); padding-bottom: 5px; }
        .scaf { font-family: var(--mono); font-size: 11px; color: var(--ink2); margin-left: 6px; }
        .staffing { display: flex; flex-direction: column; gap: 5px; margin: 10px 0; }
        .staffing-line { display: grid; grid-template-columns: 130px 70px 130px 1fr; align-items: baseline; gap: 10px; font-family: var(--type); font-size: 12.5px; padding: 5px 9px; border: 1.2px solid color-mix(in srgb, var(--ink2) 35%, transparent); background: var(--paper); }
        .staffing-line.short { border-color: #c2622a; background: color-mix(in srgb, #c2622a 7%, var(--paper)); }
        .sl-label { font-weight: 600; color: var(--ink); }
        .sl-hn { font-family: var(--mono); color: var(--ink2); text-align: right; }
        .sl-mod { font-family: var(--label); font-weight: 700; letter-spacing: .5px; font-size: 10.5px; color: #c2622a; }
        .sl-mod.ok { color: var(--ok, #3a7d44); }
        .sl-note { color: var(--ink2); font-size: 11px; }
        .payroll { font-family: var(--type); font-size: 13px; color: var(--ink); margin: 12px 0; padding: 8px 10px; border-left: 3px solid var(--ink); background: var(--panel); }
        .payroll b { font-family: var(--mono); font-weight: 700; }
        .payroll .prov { color: var(--ink2); font-style: italic; font-size: 11px; }
        .role-head { font-family: var(--label); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; font-size: 11px; color: var(--ink2); margin: 12px 0 5px; }
        .role-head.rh-btn { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--paper); border: none; border-bottom: 1.2px solid color-mix(in srgb, var(--ink2) 35%, transparent); padding: 7px 4px; cursor: pointer; text-align: left; }
        .role-head.rh-btn:hover { background: var(--paper2); }
        .role-head .caret { display: inline-block; transition: transform .12s; color: var(--ink2); font-size: 10px; }
        .role-head .caret.open { transform: rotate(90deg); }
        .support-rows { display: flex; flex-direction: column; }
        .support-row { display: grid; grid-template-columns: 1.4fr 1.3fr 1fr 70px 26px; align-items: baseline; gap: 10px; font-family: var(--type); font-size: 13px; padding: 5px 9px; border-bottom: 1px solid color-mix(in srgb, var(--ink2) 25%, transparent); }
        .sr-fire { border: none; background: none; color: color-mix(in srgb, var(--ink2) 60%, transparent); cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
        .sr-fire:hover { color: #c2622a; }
        .sr-name { font-weight: 600; color: var(--ink); }
        .sr-band { color: var(--ink2); font-size: 12px; }
        .sr-salary { font-family: var(--mono); font-size: 12px; color: var(--ink2); text-align: right; }
        .sr-status { font-family: var(--label); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink2); text-align: right; }
        .sr-status.warn { color: #c2622a; }
        .support-row.inj { background: color-mix(in srgb, #c79a23 7%, transparent); }
        .support-row.kia { opacity: .6; }
    `],
})
export class SupportPersonnelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly svc = inject(PersonnelService);
    protected readonly pn = this.state.personnel;

    protected fire(id: string): void { this.svc.fire(id); }

    // HF-016: per-role open state — the set holds the EXPANDED roles, so an empty set = ALL COLLAPSED at start.
    private readonly openRoles = signal<Set<string>>(new Set());
    protected isOpen(role: string): boolean { return this.openRoles().has(role); }
    protected toggleGroup(role: string): void {
        this.openRoles.update((s) => { const n = new Set(s); if (n.has(role)) n.delete(role); else n.add(role); return n; });
    }

    protected readonly activeCount = computed(() => (this.pn()?.roster ?? []).filter((s) => s.status === 'active').length);
    protected readonly groups = computed<{ role: SupportRole; label: string; people: SupportPerson[] }[]>(() => {
        const roster = this.pn()?.roster ?? [];
        return ROLE_ORDER
            .map((role) => ({ role, label: ROLE_LABEL[role] + (role === 'mek_tech' ? 's' : 's'), people: roster.filter((s) => s.role === role) }))
            .filter((g) => g.people.length > 0);
    });

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected band(b: SupportPerson['experienceBand']): string { return BAND_LABEL[b]; }
    protected role(r: SupportRole): string { return ROLE_LABEL[r]; }
    protected skill(r: SupportRole): string { return ROLE_SKILL[r]; }
}
