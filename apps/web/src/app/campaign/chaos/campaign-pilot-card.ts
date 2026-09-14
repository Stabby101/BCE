/*
 * DIRECTIVE-125 — the Campaign Pilot Card (Hot Spots fork; Draconis Reach p.159). A per-named-pilot SP progression
 * card: Gunnery/Piloting/AS-Skill/BV/Handicap/Wounds/careerSP + the four SP-priced ladders (buy-next, disabled below
 * cost), a wound track + Heal, and the Formation-Commander / Command-Abilities block. Every purchase is a Warchest
 * debit via CampaignPilotService. HS-only (the host gates on campaignSystem()==='hotspots'); OnPush.
 */
import { Component, ChangeDetectionStrategy, computed, signal, inject, input, effect, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignPilotService } from './campaign-pilot.service';
import { PilotService } from '../barracks/pilot.service'; // PD3 P4 — the D-070 rename path
import { CampaignSaveStore } from '../campaign-save-store'; // PD3 P4 — persist after a rename
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { PILOT_ABILITIES } from '../barracks/pilot-abilities';
import { initCampaignPilot, gunneryLadder, pilotingLadder, edgeLadder, abilityLadder, nextGunneryRung, nextPilotingRung, nextEdgeRung, nextAbilityRung, nextCommandAbilityCost, PILOT_CARD_PRICES, COMMAND_ABILITIES } from './pilot-card';

@Component({
    selector: 'bce-campaign-pilot-card',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe],
    template: `
        @if (pilot(); as p) { @if (card(); as c) {
        <section class="cpc">
            <div class="cpc-h">
                <div class="cpc-tag">CAMPAIGN PILOT CARD</div>
                @if (renaming()) {
                    <!-- PD3 P4 (PD3-5) — the card's name is EDITABLE (pilot.service.rename, the D-070 path); the overlay's "edit" link stays -->
                    <div class="cpc-name"><input class="cpc-name-in" [value]="nameDraft()" (input)="nameDraft.set($any($event.target).value)" (keydown.enter)="saveRename()" (keydown.escape)="renaming.set(false)" maxlength="40" aria-label="Pilot name" data-testid="cpc-rename-input" /> <button type="button" class="cpc-ren save" (click)="saveRename()" data-testid="cpc-rename-save" aria-label="Save name">✓</button> <button type="button" class="cpc-ren" (click)="renaming.set(false)" aria-label="Cancel rename">✕</button></div>
                } @else {
                    <div class="cpc-name">{{ p.name }}@if (p.callsign) { <span class="cpc-cs">“{{ p.callsign }}”</span> } <span class="cpc-type">{{ c.type }}</span> @if (p.status !== 'KIA') { <button type="button" class="cpc-ren" (click)="startRename()" data-testid="cpc-rename" aria-label="Rename pilot" title="Rename pilot">✎</button> }</div>
                }
            </div>
            <div class="cpc-stats">
                <div class="cpc-stat"><span>Gunnery</span><b>{{ p.gunnery }}</b></div>
                <div class="cpc-stat"><span>Piloting</span><b>{{ p.piloting }}</b></div>
                <div class="cpc-stat"><span>AS Skill</span><b>{{ p.gunnery }}</b></div>
                <div class="cpc-stat"><span>BV</span><b>{{ effBv() | number }}</b></div>
                <div class="cpc-stat"><span>Handicap</span><b>{{ c.handicap }}</b></div>
                <div class="cpc-stat"><span>Career SP</span><b>{{ c.careerSP | number }}</b></div>
                <div class="cpc-stat"><span>Warchest</span><b>{{ sp() | number }} SP</b></div>
            </div>

            <!-- Wounds -->
            <div class="cpc-block">
                <div class="cpc-bh">Wounds</div>
                <div class="cpc-wounds">
                    @for (i of [1,2,3,4,5,6]; track i) { <span class="cpc-box" [class.hit]="i <= (p.hits ?? 0)"></span> }
                    <button type="button" class="cpc-btn" [disabled]="(p.hits ?? 0) <= 0 || !can(heal)" (click)="doHeal()">Heal 1 box (−{{ heal }} SP)</button>
                </div>
            </div>

            <!-- Ladders -->
            <div class="cpc-ladders">
                <div class="cpc-ladder">
                    <div class="cpc-bh">Gunnery</div>
                    @for (r of gunLadder(); track r.rung.to) { <span class="cpc-rung" [class.owned]="r.owned">→{{ r.rung.to }}</span> }
                    @if (nextGun(); as n) { <button type="button" class="cpc-btn go" [disabled]="!can(n.sp)" (click)="svc.raiseGunnery(pilotId())">Improve to {{ n.to }} (−{{ n.sp }} SP)</button> } @else { <span class="cpc-max">maxed</span> }
                </div>
                <div class="cpc-ladder">
                    <div class="cpc-bh">Piloting</div>
                    @for (r of pilLadder(); track r.rung.to) { <span class="cpc-rung" [class.owned]="r.owned">→{{ r.rung.to }}</span> }
                    @if (nextPil(); as n) { <button type="button" class="cpc-btn go" [disabled]="!can(n.sp)" (click)="svc.raisePiloting(pilotId())">Improve to {{ n.to }} (−{{ n.sp }} SP)</button> } @else { <span class="cpc-max">maxed</span> }
                </div>
                <div class="cpc-ladder">
                    <div class="cpc-bh">Edge tokens <b class="cpc-count">{{ c.edgeTokens }}</b></div>
                    @for (r of edgLadder(); track r.rung.n) { <span class="cpc-rung" [class.owned]="r.owned">{{ r.rung.n }}</span> }
                    @if (nextEdge(); as n) { <button type="button" class="cpc-btn go" [disabled]="!can(n.sp)" (click)="svc.buyEdge(pilotId())">Buy token {{ n.n }} (−{{ n.sp }} SP)</button> } @else { <span class="cpc-max">maxed</span> }
                </div>
                <div class="cpc-ladder">
                    <div class="cpc-bh">Edge Abilities / SPAs <b class="cpc-count">{{ c.learnedAbilities.length }}</b></div>
                    @for (r of abiLadder(); track r.rung.n) { <span class="cpc-rung" [class.owned]="r.owned">{{ r.rung.n }}</span> }
                    @if (nextAbi(); as n) {
                        <div class="cpc-learn">
                            <select class="cpc-sel" (change)="selAbility.set($any($event.target).value)" aria-label="SPA to learn">
                                <option value="">— pick a SPA —</option>
                                @for (a of learnable(); track a.id) { <option [value]="a.id" [selected]="selAbility() === a.id">{{ a.name }}</option> }
                            </select>
                            <button type="button" class="cpc-btn go" [disabled]="!selAbility() || !can(n.sp)" (click)="doLearn(n.sp)">Learn (−{{ n.sp }} SP)</button>
                        </div>
                    } @else { <span class="cpc-max">maxed</span> }
                    @if (c.learnedAbilities.length) { <div class="cpc-held">@for (id of c.learnedAbilities; track id) { <span class="cpc-chip">{{ abilityName(id) }}</span> }</div> }
                </div>
            </div>

            <!-- Formation Commander / Command Abilities -->
            <div class="cpc-block">
                <div class="cpc-bh">Formation Command</div>
                @if (!c.formationCommander) {
                    <button type="button" class="cpc-btn go" [disabled]="!can(fcCost)" (click)="svc.trainFormationCommander(pilotId())">Train as Formation Commander (−{{ fcCost }} SP)</button>
                } @else {
                    <div class="cpc-fc">Formation Commander ✓</div>
                    @if (c.commandAbilities.length) { <div class="cpc-held">@for (a of c.commandAbilities; track a) { <span class="cpc-chip">{{ a }}</span> }</div> }
                    @if (nextCmd() != null) {
                        <div class="cpc-learn">
                            <select class="cpc-sel" (change)="selCmd.set($any($event.target).value)" aria-label="Command ability">
                                <option value="">— command ability —</option>
                                @for (a of learnableCmd(); track a) { <option [value]="a" [selected]="selCmd() === a">{{ a }}</option> }
                            </select>
                            <button type="button" class="cpc-btn go" [disabled]="!selCmd() || !can(nextCmd()!)" (click)="doLearnCmd()">Learn (−{{ nextCmd() }} SP)</button>
                        </div>
                    } @else { <span class="cpc-max">3 command abilities learned</span> }
                }
            </div>
        </section>
        } }
    `,
    styles: [`
        .cpc-ren { border: none; background: transparent; color: inherit; opacity: .7; font-size: 13px; line-height: 1; padding: 2px 6px; cursor: pointer; min-width: 28px; min-height: 28px; } .cpc-ren:hover { opacity: 1; } .cpc-ren.save { opacity: 1; font-weight: 700; } /* PD3 P4 */
        .cpc-name-in { font: inherit; padding: 3px 6px; max-width: 18ch; } /* PD3 P4 */
        .cpc { border: 1.6px solid var(--ink); background: var(--paper2, var(--paper)); padding: 12px 14px; margin-top: 14px; font-family: var(--type); color: var(--ink); }
        .cpc-tag { font-family: var(--label); font-weight: 700; letter-spacing: 2px; font-size: 10px; text-transform: uppercase; color: var(--stamp); }
        .cpc-name { font-family: var(--stencil, var(--label)); font-size: 18px; margin-top: 2px; }
        .cpc-cs { color: var(--ink2); font-size: 14px; } .cpc-type { font-family: var(--mono); font-size: 11px; border: 1px solid var(--ink2); color: var(--ink2); padding: 0 5px; margin-left: 6px; }
        .cpc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px 12px; margin: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 8px 0; }
        .cpc-stat { display: flex; flex-direction: column; }
        .cpc-stat span { font-family: var(--label); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink2); }
        .cpc-stat b { font-family: var(--mono); font-size: 16px; }
        .cpc-block, .cpc-ladder { margin: 10px 0; }
        .cpc-bh { font-family: var(--label); font-weight: 600; letter-spacing: 1px; font-size: 10px; text-transform: uppercase; color: var(--ink2); margin-bottom: 5px; }
        .cpc-count { font-family: var(--mono); color: var(--ink); margin-left: 4px; }
        .cpc-wounds { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
        .cpc-box { width: 15px; height: 15px; border: 1.4px solid var(--ink2); background: var(--paper); display: inline-block; }
        .cpc-box.hit { background: var(--stamp); border-color: var(--stamp); }
        .cpc-ladders { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .cpc-rung { font-family: var(--mono); font-size: 11px; border: 1.2px solid var(--ink2); color: var(--ink2); padding: 1px 6px; margin-right: 4px; border-radius: 3px; }
        .cpc-rung.owned { border-color: var(--ok); color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--paper)); font-weight: 700; }
        .cpc-btn { font-family: var(--label); font-weight: 600; letter-spacing: .5px; font-size: 11px; text-transform: uppercase; border: 1.4px solid var(--stamp); background: transparent; color: var(--stamp); padding: 5px 11px; cursor: pointer; min-height: 32px; margin-top: 6px; }
        .cpc-btn.go { display: block; }
        .cpc-btn:hover:not(:disabled) { background: var(--stamp); color: var(--paper); }
        .cpc-btn:disabled { opacity: .38; cursor: not-allowed; }
        .cpc-max { font-family: var(--mono); font-size: 10.5px; color: var(--ink2); display: block; margin-top: 6px; }
        .cpc-learn { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
        .cpc-sel { font-family: var(--type); font-size: 12px; padding: 5px 7px; border: 1.3px solid var(--ink); background: var(--paper); color: var(--ink); min-height: 32px; max-width: 220px; }
        .cpc-held { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
        .cpc-chip { font-family: var(--type); font-size: 11px; border: 1px solid var(--ink2); color: var(--ink); padding: 1px 6px; }
        .cpc-fc { font-family: var(--label); font-weight: 600; color: var(--ok); font-size: 12px; }
    `],
})
export class CampaignPilotCardComponent {
    readonly pilotId = input.required<string>();
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    protected readonly svc = inject(CampaignPilotService);
    // PD3 P4 (PD3-5) — the rename affordance ON the card (the D-070 rename path; KIA names are the memorial and stay fixed)
    private readonly pilots = inject(PilotService);
    private readonly store = inject(CampaignSaveStore);
    protected readonly renaming = signal(false);
    protected readonly nameDraft = signal('');
    protected startRename(): void { const p = this.pilot(); if (!p || p.status === 'KIA') return; this.nameDraft.set(p.name); this.renaming.set(true); }
    protected saveRename(): void { this.pilots.rename(this.pilotId(), this.nameDraft()); this.renaming.set(false); void this.store.persistCurrent(); }

    protected readonly heal = PILOT_CARD_PRICES.heal;
    protected readonly fcCost = PILOT_CARD_PRICES.formationCommander;

    constructor() {
        // Lazily create the card for a named HS pilot on mount (idempotent).
        effect(() => { const id = this.pilotId(); untracked(() => this.svc.ensure(id)); });
    }

    protected readonly pilot = computed(() => (this.state.pilots() ?? []).find((p) => p.pilotId === this.pilotId()) ?? null);
    protected readonly card = computed(() => { const p = this.pilot(); return p ? (p.campaignPilot ?? initCampaignPilot(p)) : null; });
    protected readonly sp = this.state.warchestSP;
    private readonly unit = computed(() => { const p = this.pilot(); const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === p?.assignedInstanceId); return inst ? this.data.getUnitByName(inst.unitRef) : undefined; });
    protected readonly effBv = computed(() => { const p = this.pilot(); const u = this.unit(); return p && u ? BVCalculatorUtil.calculateAdjustedBV(u, u.bv, p.gunnery, p.piloting) : 0; });

    protected readonly gunLadder = computed(() => gunneryLadder(this.pilot()?.gunnery ?? 4));
    protected readonly pilLadder = computed(() => pilotingLadder(this.pilot()?.piloting ?? 5));
    protected readonly edgLadder = computed(() => edgeLadder(this.card()?.edgeTokens ?? 1));
    protected readonly abiLadder = computed(() => abilityLadder(this.card()?.learnedAbilities.length ?? 0));
    protected readonly nextGun = computed(() => nextGunneryRung(this.pilot()?.gunnery ?? 4));
    protected readonly nextPil = computed(() => nextPilotingRung(this.pilot()?.piloting ?? 5));
    protected readonly nextEdge = computed(() => nextEdgeRung(this.card()?.edgeTokens ?? 1));
    protected readonly nextAbi = computed(() => nextAbilityRung(this.card()?.learnedAbilities.length ?? 0));
    protected readonly nextCmd = computed(() => nextCommandAbilityCost(this.card()?.commandAbilities.length ?? 0));

    protected readonly selAbility = signal<string>('');
    protected readonly selCmd = signal<string>('');
    protected readonly learnable = computed(() => { const held = new Set(this.card()?.learnedAbilities ?? []); return PILOT_ABILITIES.filter((a) => !held.has(a.id)); });
    protected readonly learnableCmd = computed(() => { const held = new Set(this.card()?.commandAbilities ?? []); return COMMAND_ABILITIES.filter((a) => !held.has(a)); });

    protected can(cost: number): boolean { return (this.sp() ?? 0) >= cost; }
    protected abilityName(id: string): string { return PILOT_ABILITIES.find((a) => a.id === id)?.name ?? id; }
    protected doHeal(): void { this.svc.healWound(this.pilotId()); }
    protected doLearn(_cost: number): void { const id = this.selAbility(); if (!id) return; this.svc.learnAbility(this.pilotId(), id, this.abilityName(id)); this.selAbility.set(''); }
    protected doLearnCmd(): void { const a = this.selCmd(); if (!a) return; this.svc.learnCommandAbility(this.pilotId(), a); this.selCmd.set(''); }
}
