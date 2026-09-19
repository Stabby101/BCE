import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from './warchest.service';
import { hireSP } from './chaos-sp-costs';
import { PILOT_TUNABLES, type Pilot } from '../barracks/pilot-generator'; // name pools (data) — NOT the Traditional service

type HireKind = 'green' | 'crew' | 'named';
const NAMED_CAP = 4;

@Component({
    selector: 'bce-chaos-hiring',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ch-head">
            <div class="ch-stat"><span class="l">Warchest</span><span class="v">{{ money(sp() ?? 0) }} <small>SP</small></span></div>
            <div class="ch-stat"><span class="l">Roster</span><span class="v">{{ (pilots() ?? []).length }}</span></div>
            <div class="ch-stat"><span class="l">Named</span><span class="v">{{ namedCount() }}<small>/{{ cap }}</small></span></div>
        </div>

        <div class="ph">Hiring Hall</div>
        <div class="ch-hire">
            <div class="ch-card">
                <div class="ch-t">Green MechWarrior</div>
                <div class="ch-s">Gunnery 5 · Piloting 6 · arrives raw</div>
                <div class="ch-c free">FREE</div>
                <button type="button" class="ch-btn" (click)="hire('green')">Hire Green</button>
            </div>
            <div class="ch-card">
                <div class="ch-t">Regular Crew</div>
                <div class="ch-s">Gunnery 4 · Piloting 5 · seasoned</div>
                <div class="ch-c">−{{ money(costCrew) }} SP</div>
                <button type="button" class="ch-btn" [disabled]="!affordable(costCrew)" (click)="hire('crew')">Hire Regular</button>
            </div>
            <div class="ch-card">
                <div class="ch-t">Named Pilot</div>
                <div class="ch-s">Gunnery 4 · Piloting 5 · improvement-eligible</div>
                <div class="ch-c">−{{ money(costNamed) }} SP</div>
                <button type="button" class="ch-btn" [disabled]="namedCount() >= cap || !affordable(costNamed)" (click)="hire('named')">
                    @if (namedCount() >= cap) { Named cap ({{ cap }}) } @else { Hire Named }
                </button>
            </div>
        </div>

        <div class="ph">Roster <span class="scaf">{{ (pilots() ?? []).length }}</span></div>
        @if ((pilots() ?? []).length) {
            <div class="ch-list">
                @for (p of pilots(); track p.pilotId) {
                    <div class="ch-row" [class.dim]="p.status !== 'Active'">
                        <span class="ch-n">{{ p.name }}@if (p.callsign) { <small>“{{ p.callsign }}”</small> }</span>
                        @if (p.named) { <span class="ch-tag">named</span> }
                        <span class="ch-sk">G {{ p.gunnery }} / P {{ p.piloting }}</span>
                        <span class="ch-st">{{ p.status }}</span>
                    </div>
                }
            </div>
        } @else { <p class="ch-empty">No pilots yet.</p> }
    `,
    styles: [`
        :host { display:block; }
        .ch-head { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px; }
        .ch-stat { border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:8px 14px; min-width:110px; }
        .ch-stat .l { display:block; font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); }
        .ch-stat .v { display:block; font-family:var(--stencil); font-size:22px; line-height:1.1; margin-top:3px; }
        .ch-stat .v small { font-family:var(--mono); font-size:12px; letter-spacing:1px; color:var(--ink2); }
        .ph { font-family:var(--label); font-weight:600; letter-spacing:2.5px; font-size:13px; text-transform:uppercase; border-bottom:1.5px solid var(--ink); padding-bottom:6px; margin:0 0 12px; }
        .scaf { font-family:var(--mono); font-size:10px; letter-spacing:1px; color:var(--stamp); border:1px solid var(--stamp); padding:1px 6px; float:right; }
        .ch-hire { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:20px; }
        .ch-card { border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:12px 14px; display:flex; flex-direction:column; gap:6px; }
        .ch-t { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:14px; text-transform:uppercase; }
        .ch-s { font-family:var(--type); font-size:12px; color:var(--ink2); line-height:1.4; }
        .ch-c { font-family:var(--mono); font-weight:700; font-size:15px; color:var(--warn, #c2622a); }
        .ch-c.free { color:var(--ok, #3a7d44); }
        .ch-btn { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:12px; text-transform:uppercase; border:1.5px solid var(--stamp); background:transparent; color:var(--stamp); padding:9px 14px; cursor:pointer; min-height:40px; margin-top:2px; }
        .ch-btn:hover:not(:disabled), .ch-btn:focus-visible:not(:disabled) { background:var(--stamp); color:var(--paper); outline:none; }
        .ch-btn:disabled { opacity:.4; cursor:not-allowed; }
        .ch-list { display:flex; flex-direction:column; gap:4px; max-height:360px; overflow-y:auto; }
        .ch-row { display:grid; grid-template-columns:1fr auto auto auto; gap:12px; align-items:baseline; border-bottom:1px solid color-mix(in srgb, var(--ink2) 20%, transparent); padding:6px 4px; }
        .ch-row.dim { opacity:.5; }
        .ch-n { font-family:var(--type); font-size:13.5px; }
        .ch-n small { color:var(--ink2); }
        .ch-tag { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:9px; text-transform:uppercase; color:var(--stamp); border:1px solid var(--stamp); padding:1px 6px; }
        .ch-sk { font-family:var(--mono); font-size:11.5px; color:var(--ink2); }
        .ch-st { font-family:var(--mono); font-size:10.5px; color:var(--ink2); text-transform:uppercase; }
    `],
})
export class ChaosHiringComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);

    protected readonly cap = NAMED_CAP;
    protected readonly sp = this.state.warchestSP;
    protected readonly pilots = this.state.pilots;
    protected readonly namedCount = computed(() => (this.state.pilots() ?? []).filter((p) => p.named).length);
    protected readonly costCrew = hireSP('crew');
    protected readonly costNamed = hireSP('namedPilot');

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected affordable(cost: number): boolean { return (this.sp() ?? 0) >= cost; }
    private uid(): string { return (globalThis.crypto?.randomUUID?.() ?? 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }
    private pick<X>(arr: readonly X[]): X { return arr[Math.floor(Math.random() * arr.length)]; }

    protected hire(kind: HireKind): void {
        if (this.state.campaignSystem() !== 'hotspots') return;
        if (kind === 'named' && this.namedCount() >= NAMED_CAP) return; // max 4 named
        const cost = kind === 'green' ? 0 : kind === 'crew' ? hireSP('crew') : hireSP('namedPilot');
        if (cost > 0 && !this.affordable(cost)) return;
        const gunnery = kind === 'green' ? 5 : 4;
        const piloting = kind === 'green' ? 6 : 5;
        const name = `${this.pick(PILOT_TUNABLES.firstNames)} ${this.pick(PILOT_TUNABLES.lastNames)}`;
        const pilot: Pilot = {
            pilotId: this.uid(), name, gunnery, piloting, status: 'Active', assignedInstanceId: undefined,
            ...(kind === 'named' ? { named: true, callsign: this.pick(PILOT_TUNABLES.callsigns) } : {}),
        };
        this.state.setPilots([...(this.state.pilots() ?? []), pilot]);
        this.warchest.post(`Hire — ${name}`, cost, 0); // Green posts a 0-SP line (records the hire)
        void this.store.persistCurrent();
    }
}
