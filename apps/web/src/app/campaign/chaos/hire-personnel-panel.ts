/*
 * DIRECTIVE-IMPORT-3 Part 2 — the "Special personnel — for hire" panel, mounted at the deploy / track-setup step
 * (§17.1 track prep 3/4). Book order: hire happens BEFORE the battle. Each hire debits Support Points through the
 * Warchest ledger (non-silent → the D-139 toast), mints the merc's named pilot + 'Mech onto the deployed roster,
 * and is charged PER TRACK by default (or ONCE per contract when oneTimeHire). Can't-afford is blocked. HS-only,
 * additive; the merc renders on the deploy cell + pilot card like any pilot (D-125). Player brief stays read-only.
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { WarchestService } from './warchest.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { MissionTreeService } from '../mission/mission-tree.service';
import { HotSpotsCatalogService, type HotSpotHireable } from './hotspots-catalog';
import { mercHireCharge, canAffordHire, buildMercInstance, buildMercPilot, hiredWithYouRows } from './hire-personnel'; // IMPORT-6 FOLLOWUPS — hiredWithYouRows (results-only stamp)

@Component({
    selector: 'bce-hire-personnel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (hireables().length) {
            <div class="hp">
                <div class="hp-hd">Special personnel — for hire <span class="hp-sp">{{ sp() }} SP</span></div>
                <div class="hp-note">Hire named mercenaries for this track (Support Points). Charged per track unless one-time; released mercs are refunded.</div>
                @for (h of hireables(); track h.name) {
                    <div class="hp-row" [class.on]="isHired(h)">
                        <div class="hp-who"><b>{{ h.name }}</b> <span class="hp-role">{{ h.role }}</span></div>
                        <div class="hp-stat">G {{ h.gunnery }} · P {{ h.piloting }}@if (h.edge) { · Edge {{ h.edge }} }@if (h.chassis) { · {{ h.chassis }}@if (h.model) { {{ h.model }} } }</div>
                        <div class="hp-cost">{{ chargeFor(h) === 0 ? 'paid' : '−' + chargeFor(h) + ' SP' }}{{ h.oneTimeHire ? ' · one-time' : ' · per track' }}</div>
                        @if (isHired(h)) {
                            <button type="button" class="cc-btn small" (click)="release(h)" data-testid="cc-release-merc">Release</button>
                        } @else {
                            <button type="button" class="cc-btn small go" [disabled]="!canAfford(h)" (click)="hire(h)" data-testid="cc-hire-merc">Hire</button>
                        }
                    </div>
                }
                @if (msg()) { <div class="hp-msg">{{ msg() }}</div> }
            </div>
        }
    `,
    styles: [`
        .hp { border:1.3px solid var(--ink); background:var(--paper); padding:10px; margin-top:10px; }
        .hp-hd { font-family:var(--type); font-weight:700; font-size:13px; display:flex; justify-content:space-between; align-items:baseline; }
        .hp-sp { font-family:var(--mono); font-size:12px; color:var(--ink2); }
        .hp-note { font-family:var(--type); font-size:11px; color:var(--ink2); margin:4px 0 8px; font-style:italic; }
        .hp-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:6px 0; border-top:1px dotted var(--ink2); }
        .hp-row.on { background:rgba(0,0,0,.03); }
        .hp-who { flex:1 1 160px; font-family:var(--type); font-size:13px; }
        .hp-role { color:var(--ink2); font-size:11px; }
        .hp-stat { font-family:var(--mono); font-size:11px; color:var(--ink); flex:1 1 200px; }
        .hp-cost { font-family:var(--mono); font-size:11px; color:var(--ink2); }
        .hp-msg { font-family:var(--type); font-size:12px; color:var(--ink); margin-top:6px; }
    `],
})
export class HirePersonnelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly warchest = inject(WarchestService);
    private readonly store = inject(CampaignSaveStore);
    private readonly tree = inject(MissionTreeService);
    private readonly catalog = inject(HotSpotsCatalogService);

    /** Hot-spot-level personnel from the CATALOG (works for any track source, incl. a universal-library pick). */
    protected readonly hireables = computed<HotSpotHireable[]>(() => {
        const id = this.state.activeChaosContract()?.hotspotId;
        return id ? (this.catalog.hotSpotById(id)?.hireable ?? []) : [];
    });
    protected readonly hired = this.state.hiredMercs;
    protected readonly sp = computed(() => this.state.warchestSP() ?? 0);
    protected readonly msg = signal('');

    protected isHired(h: HotSpotHireable): boolean { return (this.hired() ?? []).some((m) => m.key === h.name); }
    protected chargeFor(h: HotSpotHireable): number { return mercHireCharge(h, this.state.contractHiredKeys()); }
    protected canAfford(h: HotSpotHireable): boolean { return canAffordHire(this.sp(), this.chargeFor(h)); }

    protected hire(h: HotSpotHireable): void {
        if (this.isHired(h)) return;
        const charge = this.chargeFor(h);
        if (!canAffordHire(this.sp(), charge)) { this.msg.set(`Not enough SP to hire ${h.name} (need ${charge}).`); return; }
        const inst = buildMercInstance(h); // bv/model from the hireable data (author-provided); no catalog auto-resolve
        const pilot = buildMercPilot(h, inst.instanceId);
        this.state.setStartingForce([...(this.state.startingForce() ?? []), inst]);
        this.state.setPilots([...(this.state.pilots() ?? []), pilot]);
        if (charge > 0) {
            this.warchest.post(`Hired ${h.name}`, charge, 0); // positive = spend; non-silent → D-139 toast
            if (h.oneTimeHire) this.state.addContractHiredKey(h.name);
        }
        this.state.addHiredMerc({ key: h.name, name: h.name, instanceId: inst.instanceId, pilotId: pilot.pilotId, charged: charge, oneTimeHire: !!h.oneTimeHire, branchId: this.tree.activeBranch()?.branchId ?? null, role: h.role });
        this.msg.set(charge > 0 ? `Hired ${h.name} · −${charge} SP` : `Fielded ${h.name} (already paid this contract)`);
        this.stampHiredWithYou(); // IMPORT-6 FOLLOWUPS — RESULTS ONLY onto the persisted spec (players see who is fielding with them)
        void this.store.persistCurrent();
    }

    protected release(h: HotSpotHireable): void {
        const m = (this.hired() ?? []).find((x) => x.key === h.name);
        if (!m) return;
        this.state.setStartingForce((this.state.startingForce() ?? []).filter((i) => i.instanceId !== m.instanceId));
        this.state.setPilots((this.state.pilots() ?? []).filter((p) => p.pilotId !== m.pilotId));
        if (m.charged > 0) {
            this.warchest.post(`Released ${m.name}`, -m.charged, 0); // refund income
            if (m.oneTimeHire) this.state.removeContractHiredKey(m.key); // un-pay the one-time so a later re-hire charges again
        }
        this.state.removeHiredMerc(m.instanceId);
        this.msg.set(`Released ${h.name}${m.charged > 0 ? ' · +' + m.charged + ' SP' : ''}`);
        this.stampHiredWithYou(); // IMPORT-6 FOLLOWUPS — keep the persisted-spec results line in step
        void this.store.persistCurrent();
    }

    /** IMPORT-6 FOLLOWUPS — RESULTS ONLY: stamp the special personnel actually FIELDED (from the hire lifecycle records, never
     *  the offer list) onto the CURRENT mission spec's forge.hiredWithYou, so the player brief renders them from the persisted
     *  record (the same setMissionSpec spread-patch seam claims-panel / mission-package use). Key absent when none. */
    private stampHiredWithYou(): void {
        const spec = this.state.missionSpec();
        if (!spec?.forge) return;
        const rows = hiredWithYouRows(this.state.hiredMercs(), this.state.startingForce(), this.state.pilots());
        const { hiredWithYou: _drop, ...forge } = spec.forge; void _drop;
        this.state.setMissionSpec({ ...spec, forge: rows.length ? { ...forge, hiredWithYou: rows } : forge });
    }
}
