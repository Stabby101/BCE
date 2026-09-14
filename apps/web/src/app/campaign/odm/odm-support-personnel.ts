/*
 * FORKED FROM campaign/personnel/support-personnel.ts @ 02c88a1 — DIRECTIVE-ODM-13 Phase 3 (a DRIFT SURFACE).
 * The SURVIVAL barracks roster: the STAFFING summary (6:1 have-vs-need) + the named roster stay; the monthly
 * PAYROLL block, the per-person salary column, and the dismiss control are GONE — nobody is paid and nobody
 * can be replaced, so nobody is dismissed. Render-only (DATA-003): reads the stored PersonnelState.
 * NB: comments AND strings here reach the served GM bundle — never name pack content (the odm2 leak-net).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { BAND_LABEL, ROLE_LABEL, ROLE_SKILL, type SupportPerson, type SupportRole } from '../personnel/starting-personnel';

const ROLE_ORDER: SupportRole[] = ['mek_tech', 'astech', 'doctor', 'medic', 'admin'];

@Component({
    selector: 'bce-odm-support-personnel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pn(); as p) {
            <div class="ph flat" style="margin-top:22px">Support Personnel <span class="scaf">{{ p.roster.length }}</span></div>

            <!-- STAFFING SUMMARY — the 6:1 ratio gate (unchanged from Classic; the ratio is about hands, not wages) -->
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

            <!-- ODM-13 P3 — the survival muster line: these people are the company. -->
            <div class="muster" data-kind="muster">
                <b>{{ activeCount() }}</b> on the active muster · every name on this roster is irreplaceable — no replacements arrive on this world
            </div>

            <!-- THE NAMED ROSTER — grouped by role, collapsible, START COLLAPSED (the Classic HF-016 pattern). -->
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
                                <span class="sr-status" [class.warn]="s.status !== 'active'">{{ s.status }}</span>
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
        .muster { font-family: var(--type); font-size: 13px; color: var(--ink); margin: 12px 0; padding: 8px 10px; border-left: 3px solid var(--ink); background: var(--panel); }
        .muster b { font-family: var(--mono); font-weight: 700; }
        .role-head { font-family: var(--label); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; font-size: 11px; color: var(--ink2); margin: 12px 0 5px; }
        .role-head.rh-btn { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--paper); border: none; border-bottom: 1.2px solid color-mix(in srgb, var(--ink2) 35%, transparent); padding: 7px 4px; cursor: pointer; text-align: left; }
        .role-head.rh-btn:hover { background: var(--paper2); }
        .role-head .caret { display: inline-block; transition: transform .12s; color: var(--ink2); font-size: 10px; }
        .role-head .caret.open { transform: rotate(90deg); }
        .support-rows { display: flex; flex-direction: column; }
        .support-row { display: grid; grid-template-columns: 1.4fr 1.3fr 90px; align-items: baseline; gap: 10px; font-family: var(--type); font-size: 13px; padding: 5px 9px; border-bottom: 1px solid color-mix(in srgb, var(--ink2) 25%, transparent); }
        .sr-name { font-weight: 600; color: var(--ink); }
        .sr-band { color: var(--ink2); font-size: 12px; }
        .sr-status { font-family: var(--label); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink2); text-align: right; }
        .sr-status.warn { color: #c2622a; }
        .support-row.inj { background: color-mix(in srgb, #c79a23 7%, transparent); }
        .support-row.kia { opacity: .6; }
    `],
})
export class OdmSupportPersonnelComponent {
    private readonly state = inject(NewCampaignState);
    protected readonly pn = this.state.personnel;

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
            .map((role) => ({ role, label: ROLE_LABEL[role] + 's', people: roster.filter((s) => s.role === role) }))
            .filter((g) => g.people.length > 0);
    });

    protected band(b: SupportPerson['experienceBand']): string { return BAND_LABEL[b]; }
    protected role(r: SupportRole): string { return ROLE_LABEL[r]; }
    protected skill(r: SupportRole): string { return ROLE_SKILL[r]; }
}
