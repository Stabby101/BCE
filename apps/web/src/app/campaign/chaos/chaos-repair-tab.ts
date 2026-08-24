import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { WarchestService } from './warchest.service';
import { repairSP, rearmSP, healMechWarriorSP, type RepairLevel } from './chaos-sp-costs';
import { resolved, supportCoverFraction } from './chaos-contract'; // D-110 — employer Cover under a Support term
import { hasMechDamage } from '../repair/repair-bays'; // PURE module helper (NOT the Traditional service)
import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';

/**
 * DIRECTIVE-111 — the Chaos "Repair & Refit" tab (first Chaos economy tab, Hot Spots fork only). Clean-room:
 * spends Support Points via WarchestService.post() at the flat SP Activity Cost Table rates (§8); it does NOT
 * touch or import the Traditional bay/tech-time economy (repair-bays.service / acquisition / personnel) — only
 * the PURE hasMechDamage predicate + the chaos-sp-costs helpers. Three actions: Repair (by damage level), Rearm
 * (spent ammo), Heal (wounded pilots). Any action costing more than the current Warchest is disabled (no debt).
 */
// D-110d review — compile-time guard: ProtoInstance.chaosDamage's inlined union (force-generator.ts, decoupled to
// keep force free of a chaos dependency) MUST equal the canonical RepairLevel. If either union gains/renames a
// member, one of these assignments fails to compile. Type-only — no runtime effect.
const _chaosDamageSubsetOfRepairLevel: RepairLevel = 'armor' as NonNullable<ProtoInstance['chaosDamage']>;
const _repairLevelSubsetOfChaosDamage: NonNullable<ProtoInstance['chaosDamage']> = 'armor' as RepairLevel;
void _chaosDamageSubsetOfRepairLevel; void _repairLevelSubsetOfChaosDamage;

interface RepairRow { inst: ProtoInstance; level: RepairLevel; cost: number; }
interface RearmRow { inst: ProtoInstance; tons: number; cost: number; }
interface HealRow { pilot: Pilot; hits: number; cost: number; }

@Component({
    selector: 'bce-chaos-repair',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cr-head">
            <div class="cr-stat"><span class="l">Warchest</span><span class="v">{{ money(sp() ?? 0) }} <small>SP</small></span></div>
            <div class="cr-note">Chaos Campaign flat SP rates (§8) — repair by damage level, rearm spent ammo, heal wounds. No debt: an action you can't afford is disabled.</div>
        </div>

        <div class="ph">Repair <span class="scaf">{{ repairList().length }}</span></div>
        @if (repairList().length) {
            <div class="cr-list">
                @for (r of repairList(); track r.inst.instanceId) {
                    <div class="cr-row">
                        <span class="cr-n">{{ r.inst.chassis }} {{ r.inst.model }}</span>
                        <span class="cr-lvl" [attr.data-lvl]="r.level">{{ r.level }}</span>
                        <span class="cr-sub">{{ r.inst.tons }}t</span>
                        <span class="cr-cost">−{{ money(r.cost) }} SP@if (coverFor(r.cost); as cv) { <small class="cr-cov">cover −{{ money(cv) }}</small> }</span>
                        <button type="button" class="cr-btn" [disabled]="!affordable(r.cost)" (click)="repair(r)">Repair</button>
                    </div>
                }
            </div>
        } @else { <p class="cr-empty">No damaged units — the force is battle-ready.</p> }

        <div class="ph">Record battle damage <span class="scaf">tabletop</span></div>
        <p class="cr-note cr-recnote">Played on the table? Flag what got hit — set a level and the unit drops into <b>Repair</b> above at the §8 SP rate. Digitally-played units are pre-filled from their battle state; adjust as needed.</p>
        <div class="cr-list">
            @for (inst of force(); track inst.instanceId) {
                <div class="cr-row rec">
                    <span class="cr-n">{{ inst.chassis }} {{ inst.model }}</span>
                    <span class="cr-sub">{{ inst.tons }}t</span>
                    <select class="cr-sel" [attr.aria-label]="'Damage level — ' + inst.chassis + ' ' + inst.model" (change)="setChaosDamage(inst, $any($event.target).value)">
                        @for (lvl of levels; track lvl) { <option [value]="lvl" [selected]="lvl === recordedLevel(inst)">{{ levelLabel(lvl) }}</option> }
                    </select>
                </div>
            }
        </div>

        <div class="ph">Rearm <span class="scaf">{{ rearmList().length }}</span></div>
        @if (rearmList().length) {
            <div class="cr-list">
                @for (r of rearmList(); track r.inst.instanceId) {
                    <div class="cr-row">
                        <span class="cr-n">{{ r.inst.chassis }} {{ r.inst.model }}</span>
                        <span class="cr-sub">{{ r.tons }} ton{{ r.tons === 1 ? '' : 's' }} ammo</span>
                        <span class="cr-cost">−{{ money(r.cost) }} SP@if (coverFor(r.cost); as cv) { <small class="cr-cov">cover −{{ money(cv) }}</small> }</span>
                        <button type="button" class="cr-btn" [disabled]="!affordable(r.cost)" (click)="rearm(r)">Rearm</button>
                    </div>
                }
            </div>
        } @else { <p class="cr-empty">No spent ammo bins.</p> }

        <div class="ph">Infirmary <span class="scaf">{{ healList().length }}</span></div>
        @if (healList().length) {
            <div class="cr-list">
                @for (h of healList(); track h.pilot.pilotId) {
                    <div class="cr-row">
                        <span class="cr-n">{{ h.pilot.name }}@if (h.pilot.callsign) { <small>“{{ h.pilot.callsign }}”</small> }</span>
                        <span class="cr-sub">{{ h.hits }} wound{{ h.hits === 1 ? '' : 's' }}</span>
                        <span class="cr-cost">−{{ money(h.cost) }} SP@if (coverFor(h.cost); as cv) { <small class="cr-cov">cover −{{ money(cv) }}</small> }</span>
                        <button type="button" class="cr-btn" [disabled]="!affordable(h.cost)" (click)="heal(h)">Heal</button>
                    </div>
                }
            </div>
        } @else { <p class="cr-empty">No wounded pilots.</p> }

        <div class="ph">Record injuries <span class="scaf">tabletop</span></div>
        <p class="cr-note cr-recnote">Set a pilot's wound count after a tabletop track — Injured pilots drop into the <b>Infirmary</b> above at 30 SP/wound. KIA pilots are gone and never listed.</p>
        <div class="cr-list">
            @for (p of injuryList(); track p.pilotId) {
                <div class="cr-row rec">
                    <span class="cr-n">{{ p.name }}@if (p.callsign) { <small>“{{ p.callsign }}”</small> }</span>
                    <span class="cr-sub">{{ p.status }}</span>
                    <select class="cr-sel" [attr.aria-label]="'Wounds — ' + p.name" (change)="setWounds(p, +$any($event.target).value)">
                        @for (w of woundLevels; track w) { <option [value]="w" [selected]="w === (p.hits ?? 0)">{{ w }} wound{{ w === 1 ? '' : 's' }}</option> }
                    </select>
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display:block; }
        .cr-head { border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:10px 14px; margin-bottom:16px; }
        .cr-stat .l { font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); margin-right:8px; }
        .cr-stat .v { font-family:var(--stencil); font-size:22px; line-height:1; }
        .cr-stat .v small { font-family:var(--mono); font-size:11px; letter-spacing:1px; }
        .cr-note { font-family:var(--type); font-size:12px; color:var(--ink2); line-height:1.5; margin-top:6px; }
        .ph { font-family:var(--label); font-weight:600; letter-spacing:2.5px; font-size:13px; text-transform:uppercase; border-bottom:1.5px solid var(--ink); padding-bottom:6px; margin:0 0 10px; }
        .scaf { font-family:var(--mono); font-size:10px; letter-spacing:1px; color:var(--stamp); border:1px solid var(--stamp); padding:1px 6px; float:right; }
        .cr-list { display:flex; flex-direction:column; gap:6px; margin-bottom:18px; }
        .cr-row { display:grid; grid-template-columns:1fr auto auto auto auto; gap:12px; align-items:center; border:1.3px solid var(--ink2); background:var(--paper2, var(--paper)); padding:8px 12px; }
        .cr-n { font-family:var(--type); font-size:14px; overflow-wrap:anywhere; }
        .cr-n small { font-family:var(--type); color:var(--ink2); }
        .cr-lvl { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:10px; text-transform:uppercase; border:1.2px solid var(--ink2); color:var(--ink2); padding:2px 7px; }
        .cr-lvl[data-lvl="crippled"], .cr-lvl[data-lvl="destroyed"] { border-color:var(--stamp); color:var(--stamp); }
        .cr-sub { font-family:var(--mono); font-size:11px; color:var(--ink2); }
        .cr-cost { font-family:var(--mono); font-weight:700; font-size:13px; color:var(--warn, #c2622a); text-align:right; min-width:80px; }
        .cr-cov { display:block; font-weight:400; font-size:10px; color:var(--ok, #3a7d44); }
        .cr-btn { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:11.5px; text-transform:uppercase; border:1.5px solid var(--stamp); background:transparent; color:var(--stamp); padding:7px 14px; cursor:pointer; min-height:38px; }
        .cr-btn:hover:not(:disabled), .cr-btn:focus-visible:not(:disabled) { background:var(--stamp); color:var(--paper); outline:none; }
        .cr-btn:disabled { opacity:.4; cursor:not-allowed; }
        .cr-empty { font-family:var(--type); font-size:13px; color:var(--ink2); line-height:1.6; margin:0 0 18px; }
        .cr-recnote { margin:0 0 10px; }
        .cr-row.rec { grid-template-columns:1fr auto auto; }
        .cr-sel { font-family:var(--type); font-size:12.5px; padding:6px 8px; border:1.4px solid var(--ink); background:var(--paper); color:var(--ink); min-height:36px; }
        @media (max-width:640px) { .cr-row { grid-template-columns:1fr auto; gap:4px 10px; } .cr-lvl,.cr-sub { grid-column:1; } }
    `],
})
export class ChaosRepairComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);
    private readonly warchest = inject(WarchestService);

    protected readonly sp = this.state.warchestSP;

    constructor() {
        // OPT-IN test seam (only when localStorage['bce.test.d111'] is set — NEVER present in normal use), matching
        // the repo convention (see the hf024/d084 seams). Battle damage / wounds are out of the headless harness's
        // scope, so this injects spent ammo (Rearm) + a pilot wound (Heal) to drive those round-trips end-to-end.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d111')) {
            (window as unknown as Record<string, unknown>)['__d111'] = {
                ammo: (id: string): void => this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => i.instanceId === id
                    ? { ...i, damage: { ...(i.damage ?? { locations: {}, crits: [], heat: { current: 0, previous: 0 }, crew: [] }), inventory: [{ id: 'test-ammo', consumed: 2, totalAmmo: 20 }] } as ProtoInstance['damage'] } : i)),
                // D-110d — simulate a DIGITAL battle (reconcileAtResolve writes inst.damage): an internal breach → hasMechDamage + classifies to 'structure'.
                digitalDamage: (id: string): void => this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => i.instanceId === id
                    ? { ...i, damage: { locations: { CT: { internal: 1 } }, crits: [], heat: { current: 0, previous: 0 }, crew: [] } as unknown as ProtoInstance['damage'] } : i)),
                wound: (pilotId: string): void => this.state.setPilots((this.state.pilots() ?? []).map((p) => p.pilotId === pilotId ? { ...p, status: 'Injured', hits: 2 } : p)),
                kia: (pilotId: string): void => this.state.setPilots((this.state.pilots() ?? []).map((p) => p.pilotId === pilotId ? { ...p, status: 'KIA', hits: 6 } : p)),
                units: (): unknown => (this.state.startingForce() ?? []).map((i) => ({ id: i.instanceId, label: `${i.chassis} ${i.model}`.trim() })),
                pilots: (): unknown => (this.state.pilots() ?? []).map((p) => ({ id: p.pilotId, name: p.name })),
            };
        }
    }

    /** Units carrying repairable damage (mech crit/armor/internal, or a destroyed flag on any unit type). */
    protected readonly repairList = computed<RepairRow[]>(() =>
        (this.state.startingForce() ?? [])
            .filter((i) => hasMechDamage(i.damage) || !!i.damage?.destroyed || !!i.chaosDamage) // D-110d — tabletop-flagged too
            .map((inst) => {
                const level = this.chaosRepairLevel(inst);
                const unit = this.data.getUnitByName(inst.unitRef);
                const cost = repairSP(level, inst.tons, {
                    clanOrMixed: unit?.techBase === 'Clan' || unit?.techBase === 'Mixed',
                    vehicleOrBattleArmor: (inst.unitType ?? 'mech') !== 'mech',
                });
                return { inst, level, cost };
            }));

    /** Units with spent ammo bins (consumed > 0). Each bin ≈ 1 ton of ammo (BT ammo is stored per ton). */
    protected readonly rearmList = computed<RearmRow[]>(() =>
        (this.state.startingForce() ?? [])
            .map((inst) => ({ inst, tons: (inst.damage?.inventory ?? []).filter((b) => (b.consumed ?? 0) > 0).length }))
            .filter((r) => r.tons > 0)
            .map((r) => ({ ...r, cost: rearmSP(r.tons) })));

    /** Wounded pilots (Injured status or recorded hits). KIA are EXCLUDED — dead stays dead; a KIA pilot carries
     *  hits:6 as a memorial record, not a treatable wound (no control resurrects — the project-wide invariant). */
    protected readonly healList = computed<HealRow[]>(() =>
        (this.state.pilots() ?? [])
            .filter((p) => p.status !== 'KIA' && (p.status === 'Injured' || (p.hits ?? 0) > 0))
            .map((pilot) => { const hits = pilot.hits ?? 1; return { pilot, hits, cost: healMechWarriorSP(hits) }; }));

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    /** D-110 — the employer's reimbursement (Cover) for a cost under the active contract's Support term. */
    protected coverFor(cost: number): number {
        const c = this.state.activeChaosContract();
        if (!c || c.status !== 'active') return 0;
        return Math.round(cost * supportCoverFraction(resolved(c.steps).support));
    }
    /** Affordable = the player's NET share (cost − Cover) fits the Warchest. No debt this slice. */
    protected affordable(cost: number): boolean { return (this.sp() ?? 0) >= cost - this.coverFor(cost); }

    /** Self-contained Chaos repair-level classifier (§8) — a GM-recorded chaosDamage (D-110d) wins; else triage
     *  severity, else read the digital-battle envelope. */
    private chaosRepairLevel(inst: ProtoInstance): RepairLevel {
        if (inst.chaosDamage) return inst.chaosDamage; // D-110d — tabletop recorder / GM override
        if (inst.damage?.destroyed) return 'destroyed';
        switch (inst.triage) {
            case 'B': return 'destroyed';
            case 'R': return 'crippled';
            case 'Y': return 'structure';
            case 'G': return 'armor';
        }
        const d = inst.damage;
        const destroyedCrits = (d?.crits ?? []).filter((c) => c.destroyed != null).length;
        const internalBreach = Object.values(d?.locations ?? {}).some((l) => ((l.internal ?? 0) + (l.pendingInternal ?? 0)) > 0);
        if (destroyedCrits >= 3) return 'crippled';
        if (internalBreach || destroyedCrits >= 1) return 'structure';
        return 'armor';
    }

    protected repair(r: RepairRow): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.affordable(r.cost)) return;
        this.warchest.post(`Repair — ${r.inst.chassis} ${r.inst.model}`.trim(), r.cost, this.coverFor(r.cost));
        this.state.setStartingForce((this.state.startingForce() ?? []).map((i) =>
            i.instanceId === r.inst.instanceId ? { ...i, damage: undefined, condition: 'Active', triage: undefined, chaosDamage: undefined } : i)); // D-110d — clear the tabletop flag too
        void this.store.persistCurrent();
    }

    protected rearm(r: RearmRow): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.affordable(r.cost)) return;
        this.warchest.post(`Rearm — ${r.inst.chassis} ${r.inst.model}`.trim(), r.cost, this.coverFor(r.cost));
        this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => {
            if (i.instanceId !== r.inst.instanceId) return i;
            const clearedInv = (i.damage?.inventory ?? []).map((b) => ({ ...b, consumed: 0 }));
            const stillDamaged = hasMechDamage(i.damage) || !!i.damage?.destroyed; // keep other damage; drop the envelope if ammo was the only thing
            return { ...i, damage: stillDamaged ? { ...i.damage!, inventory: clearedInv } : undefined };
        }));
        void this.store.persistCurrent();
    }

    protected heal(h: HealRow): void {
        if (this.state.campaignSystem() !== 'hotspots' || h.pilot.status === 'KIA' || !this.affordable(h.cost)) return; // dead stays dead

        this.warchest.post(`Heal — ${h.pilot.name}`, h.cost, this.coverFor(h.cost));
        this.state.setPilots((this.state.pilots() ?? []).map((p) =>
            p.pilotId === h.pilot.pilotId ? { ...p, hits: 0, status: 'Active', recoveryDays: undefined } : p));
        void this.store.persistCurrent();
    }

    // ── D-110d — tabletop post-battle RECORDER: flag damage/wounds when a track was played on the table (no
    //    digital battle_state). SP-abstraction only (a level marker + a wound count); feeds the lists above. ──
    protected readonly force = computed<ProtoInstance[]>(() => this.state.startingForce() ?? []);
    protected readonly injuryList = computed<Pilot[]>(() => (this.state.pilots() ?? []).filter((p) => p.status !== 'KIA')); // KIA excluded — no resurrect
    protected readonly levels: readonly ('none' | RepairLevel)[] = ['none', 'armor', 'structure', 'crippled', 'destroyed'];
    protected readonly woundLevels: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

    protected levelLabel(lvl: 'none' | RepairLevel): string { return lvl === 'none' ? 'None' : lvl[0].toUpperCase() + lvl.slice(1); }

    /** The level the recorder control shows: a GM-recorded chaosDamage wins; else a digital battle's classified
     *  level (pre-fill so the GM adjusts, not double-enters); else None. */
    protected recordedLevel(inst: ProtoInstance): 'none' | RepairLevel {
        if (inst.chaosDamage) return inst.chaosDamage;
        if (hasMechDamage(inst.damage) || !!inst.damage?.destroyed) return this.chaosRepairLevel(inst);
        return 'none';
    }

    /** Record a unit's tabletop damage level (None → clear). Rides startingForce persistence; feeds repairList. */
    protected setChaosDamage(inst: ProtoInstance, level: string): void {
        if (this.state.campaignSystem() !== 'hotspots') return;
        const cd = level === 'none' ? undefined : (level as RepairLevel);
        this.state.setStartingForce((this.state.startingForce() ?? []).map((i) =>
            i.instanceId === inst.instanceId ? { ...i, chaosDamage: cd } : i));
        void this.store.persistCurrent();
    }

    /** Record a pilot's wound count (0–6). >0 → Injured (feeds the Infirmary at healMechWarriorSP); 0 → Active.
     *  KIA is never in injuryList, so this never resurrects. Rides pilots persistence. */
    protected setWounds(pilot: Pilot, n: number): void {
        if (this.state.campaignSystem() !== 'hotspots' || pilot.status === 'KIA') return;
        const hits = Math.max(0, Math.min(6, Math.floor(n)));
        this.state.setPilots((this.state.pilots() ?? []).map((p) => {
            if (p.pilotId !== pilot.pilotId) return p;
            // D-110d review — clearing wounds (0) returns the pilot to Active with NO stale recovery clock (mirror heal()).
            return hits > 0 ? { ...p, hits, status: 'Injured' } : { ...p, hits: 0, status: 'Active', recoveryDays: undefined };
        }));
        void this.store.persistCurrent();
    }
}
