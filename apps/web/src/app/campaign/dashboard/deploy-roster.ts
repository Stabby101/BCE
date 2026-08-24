/*
 * BCE — DIRECTIVE-118: the INLINE DEPLOY ROSTER shown in the "Prepare & deploy" brief box (both tab sets). A
 * compact, dense list of the player's force with a deploy checkbox per unit — so the GM deploys to the track
 * RIGHT THERE in the contract flow, not by hopping to the Roster tab (the dead-end this directive kills).
 *
 * PRESENTATIONAL + single-source-of-truth: it READS instances from state.startingForce() and WRITES through
 * state.setStartingForce condition updates ONLY (check → 'Deployed', uncheck → 'Active'). There is NO parallel
 * deploy state — the same `condition === 'Deployed'` marker every surface already reads (roster, deployedCount,
 * the HOTFIX-029 lobby gate, the market) reflects instantly. No new persisted fields (condition IS the record).
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
import { GameSystem } from '../../models/common.model';
import type { Pilot } from '../barracks/pilot-generator';

/** Conditions a unit can be deployed FROM (and toggled between). In repair / Cold storage can't take the field. */
const ELIGIBLE = new Set(['Active', 'Reserve', 'Deployed']);

@Component({
    selector: 'bce-deploy-roster',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent],
    template: `
        <div class="dr">
            <div class="dr-head">
                <label class="dr-all" [class.dis]="!eligibleCount()">
                    <input type="checkbox" [checked]="allEligibleDeployed()" [disabled]="!eligibleCount()"
                           (change)="toggleAll($any($event.target).checked)" />
                    Deploy all
                </label>
                <span class="dr-count">{{ deployedCount() }}/{{ eligibleCount() }} deployed · {{ fmt(deployedBv()) }} BV</span>
            </div>
            @if (deployedCount() === 0) {
                <div class="dr-note">No units deployed — check units to deploy them to this track.</div>
            }
            <div class="dr-list">
                @for (r of rows(); track r.id) {
                    <label class="dr-row" [class.on]="r.deployed" [class.dis]="!r.eligible">
                        <input type="checkbox" [checked]="r.deployed" [disabled]="!r.eligible"
                               (change)="toggle(r.id, $any($event.target).checked)"
                               [attr.aria-label]="'Deploy ' + r.name" />
                        <bce-unit-sprite class="dr-sprite" [unit]="r.sprite" [size]="22"></bce-unit-sprite>
                        <span class="dr-name">{{ r.name }}@if (r.commander) { <span class="dr-cmd" title="Commanding unit">★</span> }</span>
                        <span class="dr-pilot">{{ r.pilotName || '— no pilot —' }}</span>
                        @if (r.eligible) {
                            <span class="dr-skills">{{ r.skills }}</span>
                        } @else {
                            <span class="dr-cond" [title]="r.condTag + ' — can\\'t deploy from here'">{{ r.condTag }}</span>
                        }
                        <span class="dr-bv">{{ fmt(r.bv) }}</span>
                    </label>
                }
            </div>
        </div>
    `,
    styles: [`
        :host { display:block; }
        .dr { border:1px solid var(--line, #2a3340); background:var(--paper2, #141a21); border-radius:8px; padding:8px 10px; margin:8px 0 4px; }
        .dr-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; }
        .dr-all { display:flex; align-items:center; gap:7px; font-family:var(--label, inherit); font-weight:600; letter-spacing:.06em; font-size:11px; text-transform:uppercase; cursor:pointer; }
        .dr-all.dis { opacity:.45; cursor:not-allowed; }
        .dr-count { font-family:var(--mono, monospace); font-size:11.5px; color:var(--ink2, #9fb2c4); white-space:nowrap; }
        .dr-note { font-family:var(--type, inherit); font-size:12.5px; color:var(--ink2, #9fb2c4); border-left:3px solid var(--stamp, #e7a86b); padding:4px 9px; margin:2px 0 6px; }
        .dr-list { display:flex; flex-direction:column; gap:2px; max-height:392px; overflow-y:auto; }
        .dr-row { display:grid; grid-template-columns:18px 24px minmax(90px,1.3fr) minmax(70px,1fr) auto auto; align-items:center; gap:9px;
                  min-height:28px; padding:2px 6px; border-radius:5px; cursor:pointer; border:1px solid transparent; }
        .dr-row:hover { background:var(--paper, #10151b); }
        .dr-row.on { border-color:var(--ok, #2f6b46); background:color-mix(in srgb, var(--ok, #2f6b46) 10%, transparent); }
        .dr-row.dis { opacity:.5; cursor:not-allowed; }
        .dr-row input { width:15px; height:15px; cursor:inherit; margin:0; }
        .dr-sprite { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; overflow:hidden; }
        .dr-name { font-family:var(--type, inherit); font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dr-cmd { color:var(--stamp, #e7a86b); margin-left:3px; }
        .dr-pilot { font-family:var(--type, inherit); font-size:12px; color:var(--ink2, #9fb2c4); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dr-skills { font-family:var(--mono, monospace); font-size:11px; color:var(--ink2, #9fb2c4); white-space:nowrap; }
        .dr-cond { font-family:var(--label, inherit); font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--stamp, #e7a86b); border:1px solid var(--stamp, #e7a86b); padding:1px 5px; border-radius:3px; white-space:nowrap; }
        .dr-bv { font-family:var(--mono, monospace); font-size:11px; color:var(--ink, #cdd8e3); white-space:nowrap; text-align:right; }
    `],
})
export class DeployRosterComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);

    protected readonly isAs = computed(() => this.state.gameSystem() === GameSystem.ALPHA_STRIKE);

    /** The compact deploy rows, projected from the instances + pilots + the resolved catalog sprite. */
    protected readonly rows = computed(() => {
        const force = this.state.startingForce() ?? [];
        const pilots = new Map<string, Pilot>();
        for (const p of this.state.pilots() ?? []) { if (p.assignedInstanceId) pilots.set(p.assignedInstanceId, p); }
        const as = this.isAs();
        return force.map((i) => {
            const pilot = pilots.get(i.instanceId) ?? null;
            const eligible = ELIGIBLE.has(i.condition);
            return {
                id: i.instanceId,
                sprite: this.data.getUnitByName(i.unitRef) ?? { chassis: i.chassis, model: i.model, tons: i.tons },
                name: `${i.chassis} ${i.model}`.trim(),
                commander: !!i.isCommander,
                bv: i.bv,
                pilotName: pilot?.name ?? '',
                skills: pilot ? (as ? `AS ${pilot.gunnery}` : `G${pilot.gunnery} · P${pilot.piloting}`) : '',
                deployed: i.condition === 'Deployed',
                eligible,
                condTag: eligible ? '' : i.condition, // 'In repair' / 'Cold storage'
            };
        });
    });

    protected readonly eligibleRows = computed(() => this.rows().filter((r) => r.eligible));
    protected readonly deployedCount = computed(() => this.rows().filter((r) => r.deployed).length);
    protected readonly eligibleCount = computed(() => this.eligibleRows().length);
    protected readonly allEligibleDeployed = computed(() => this.eligibleCount() > 0 && this.eligibleRows().every((r) => r.deployed));
    protected readonly deployedBv = computed(() => (this.state.startingForce() ?? []).filter((i) => i.condition === 'Deployed').reduce((s, i) => s + (i.bv || 0), 0));

    /** Toggle one unit: check → 'Deployed', uncheck → 'Active'. The single condition marker, nothing else. */
    protected toggle(id: string, deploy: boolean): void {
        const force = this.state.startingForce() ?? [];
        this.state.setStartingForce(force.map((i) => (i.instanceId === id ? { ...i, condition: deploy ? 'Deployed' : 'Active' } : i)));
        void this.store.persistCurrent();
    }
    /** Deploy-all: every ELIGIBLE unit → 'Deployed' (or revert eligible → 'Active'); repair/freezer untouched. */
    protected toggleAll(deploy: boolean): void {
        const force = this.state.startingForce() ?? [];
        this.state.setStartingForce(force.map((i) => (ELIGIBLE.has(i.condition) ? { ...i, condition: deploy ? 'Deployed' : 'Active' } : i)));
        void this.store.persistCurrent();
    }
    protected fmt(n: number): string { return (n ?? 0).toLocaleString('en-US'); }
}
