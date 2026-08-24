import { Component, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { WarchestService } from './warchest.service';
import { MulAllowlistService } from './mul-allowlist.service'; // D-127 — the MUL ilClan purchasable allow-list
import { purchaseSP, sellSP } from './chaos-sp-costs';
import { hasMechDamage } from '../repair/repair-bays'; // PURE module helper (NOT the Traditional service)
import type { ProtoInstance } from '../force/force-generator';
import type { Unit } from '../../models/units.model';

/**
 * DIRECTIVE-112 — the Chaos Market (buy/sell) tab, Hot Spots fork only. Clean-room: it spends Support Points via
 * WarchestService.post() and mints ProtoInstances DIRECTLY — it does NOT import or touch the Traditional
 * acquisition.service. Buyable units come from the era-legal unit catalog (DataService.getUnits() — NOT the
 * parts CatalogClientService); each priced at purchaseSP(bv) = BV. Sell = BV/2 income, undamaged units only.
 */
interface BuyRow { u: Unit; cost: number; }
interface SellRow { inst: ProtoInstance; cost: number; sellable: boolean; }
const VISIBLE_CAP = 120;

@Component({
    selector: 'bce-chaos-market',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cm-head">
            <div class="cm-stat"><span class="l">Warchest</span><span class="v">{{ money(sp() ?? 0) }} <small>SP</small></span></div>
            <div class="cm-note">Buy era-legal ’Mechs at BV-in-SP; sell owned undamaged units at BV/2. No debt: unaffordable buys are disabled.</div>
        </div>

        <div class="ph">Buy <span class="scaf">{{ buyList().length }} era-legal</span></div>
        <div class="cm-tools">
            <input type="search" class="cm-search" placeholder="Search chassis / model…" [value]="search()" (input)="search.set($any($event.target).value)" />
            <label class="cm-aff"><input type="checkbox" [checked]="affordableOnly()" (change)="affordableOnly.set($any($event.target).checked)" /> Affordable only</label>
        </div>
        @if (buyVisible().length) {
            <div class="cm-list">
                @for (r of buyVisible(); track r.u.name) {
                    <div class="cm-row">
                        <span class="cm-n">{{ r.u.chassis }} {{ r.u.model }}</span>
                        <span class="cm-sub">{{ r.u.tons }}t &middot; BV {{ money(r.u.bv) }}</span>
                        <span class="cm-cost">−{{ money(r.cost) }} SP</span>
                        <button type="button" class="cm-btn" [disabled]="!affordable(r.cost)" (click)="buy(r)">Buy</button>
                    </div>
                }
            </div>
            @if (buyList().length > buyVisible().length) { <p class="cm-more">Showing {{ buyVisible().length }} of {{ buyList().length }} — refine the search to narrow.</p> }
        } @else if (!catalogReady()) { <p class="cm-empty">Loading the unit catalog…</p> }
        @else { <p class="cm-empty">No era-legal units match.</p> }

        <div class="ph">Sell <span class="scaf">{{ sellList().length }}</span></div>
        @if (sellList().length) {
            <div class="cm-list">
                @for (r of sellList(); track r.inst.instanceId) {
                    <div class="cm-row">
                        <span class="cm-n">{{ r.inst.chassis }} {{ r.inst.model }}</span>
                        <span class="cm-sub">{{ r.inst.tons }}t &middot; BV {{ money(r.inst.bv) }}</span>
                        @if (r.sellable) { <span class="cm-cost pos">+{{ money(r.cost) }} SP</span> } @else { <span class="cm-cost warnlbl">repair first</span> }
                        <button type="button" class="cm-btn" [disabled]="!r.sellable" (click)="sell(r.inst)">Sell</button>
                    </div>
                }
            </div>
        } @else { <p class="cm-empty">No owned units.</p> }
    `,
    styles: [`
        :host { display:block; }
        .cm-head { border:1.5px solid var(--ink); background:var(--paper2, var(--paper)); padding:10px 14px; margin-bottom:16px; }
        .cm-stat .l { font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); margin-right:8px; }
        .cm-stat .v { font-family:var(--stencil); font-size:22px; line-height:1; }
        .cm-stat .v small { font-family:var(--mono); font-size:11px; letter-spacing:1px; }
        .cm-note { font-family:var(--type); font-size:12px; color:var(--ink2); line-height:1.5; margin-top:6px; }
        .ph { font-family:var(--label); font-weight:600; letter-spacing:2.5px; font-size:13px; text-transform:uppercase; border-bottom:1.5px solid var(--ink); padding-bottom:6px; margin:0 0 10px; }
        .scaf { font-family:var(--mono); font-size:10px; letter-spacing:1px; color:var(--stamp); border:1px solid var(--stamp); padding:1px 6px; float:right; }
        .cm-tools { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:10px; }
        .cm-search { flex:1 1 240px; font-family:var(--type); font-size:13px; padding:7px 10px; border:1.4px solid var(--ink); background:var(--paper); color:var(--ink); min-height:38px; }
        .cm-aff { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:11px; text-transform:uppercase; color:var(--ink2); display:flex; align-items:center; gap:6px; }
        .cm-list { display:flex; flex-direction:column; gap:5px; max-height:420px; overflow-y:auto; margin-bottom:18px; }
        .cm-row { display:grid; grid-template-columns:1fr auto auto auto; gap:12px; align-items:center; border:1.3px solid var(--ink2); background:var(--paper2, var(--paper)); padding:7px 12px; }
        .cm-n { font-family:var(--type); font-size:14px; overflow-wrap:anywhere; }
        .cm-sub { font-family:var(--mono); font-size:11px; color:var(--ink2); }
        .cm-cost { font-family:var(--mono); font-weight:700; font-size:13px; color:var(--warn, #c2622a); text-align:right; min-width:84px; }
        .cm-cost.pos { color:var(--ok, #3a7d44); }
        .cm-cost.warnlbl { font-weight:400; font-size:11px; color:var(--ink2); }
        .cm-btn { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:11.5px; text-transform:uppercase; border:1.5px solid var(--stamp); background:transparent; color:var(--stamp); padding:7px 14px; cursor:pointer; min-height:36px; }
        .cm-btn:hover:not(:disabled), .cm-btn:focus-visible:not(:disabled) { background:var(--stamp); color:var(--paper); outline:none; }
        .cm-btn:disabled { opacity:.4; cursor:not-allowed; }
        .cm-more, .cm-empty { font-family:var(--type); font-size:12.5px; color:var(--ink2); line-height:1.6; margin:0 0 18px; }
        @media (max-width:640px) { .cm-row { grid-template-columns:1fr auto; } .cm-sub { grid-column:1; } }
    `],
})
export class ChaosMarketComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);
    private readonly warchest = inject(WarchestService);
    private readonly mulAllow = inject(MulAllowlistService); // D-127

    constructor() {
        // D-127 — warm the MUL allow-list so the buyList computed re-runs once it lands (fire-and-forget; inert
        // outside a Hot Spots ilClan campaign). The idsFor() gate is null everywhere else → Traditional untouched.
        void this.mulAllow.ensure();
        // D-127 test seam (OPT-IN: localStorage['bce.test.d127']): read the REAL gated buyList unit ids so a headless
        // render proves the Market sells only units on the merc command's MUL list (off-list not purchasable).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d127')) {
            (window as unknown as Record<string, unknown>)['__d127market'] = (): unknown => this.buyList().map((r) => r.u.id);
        }
    }

    protected readonly sp = this.state.warchestSP;
    protected readonly search = signal<string>('');
    protected readonly affordableOnly = signal<boolean>(false);
    protected readonly catalogReady = computed(() => { this.data.isDataReady(); return this.data.getUnits().length > 0; });

    /** Era-legal combat 'Mechs from the loaded unit catalog, priced at purchaseSP(bv)=BV. An EXPLICIT era-ceiling
     *  gate (intro year ≤ era end) keeps this era-legal even if the FULL all-era catalog is resident from an
     *  earlier Traditional market in the same session — getUnits() is NOT assumed to be the era slice. */
    protected readonly buyList = computed<BuyRow[]>(() => {
        this.data.isDataReady(); // reactive: re-run when the catalog/slice loads
        const q = this.search().trim().toLowerCase();
        const affOnly = this.affordableOnly();
        const bal = this.sp() ?? 0;
        const eraCeil = this.state.era()?.to ?? Infinity; // future-era units (intro year > this) are excluded
        // DIRECTIVE-127 — Hot Spots ilClan: sell ONLY units on the merc command's MUL list (unit.id == MUL id).
        // null outside HS+ilClan → no gate (Traditional / other eras keep today's whole-catalog behavior).
        const allow = this.mulAllow.idsFor('Mercenary');
        return this.data.getUnits()
            .filter((u) => u.type === 'Mek' && u.bv > 0 && (u.year == null || u.year <= eraCeil) && (!allow || allow.has(u.id)))
            .map((u) => ({ u, cost: purchaseSP(u.bv) }))
            .filter((r) => (!q || `${r.u.chassis} ${r.u.model}`.toLowerCase().includes(q)) && (!affOnly || r.cost <= bal))
            .sort((a, b) => a.u.chassis.localeCompare(b.u.chassis) || a.u.model.localeCompare(b.u.model));
    });
    protected readonly buyVisible = computed(() => this.buyList().slice(0, VISIBLE_CAP));

    protected readonly sellList = computed<SellRow[]>(() =>
        (this.state.startingForce() ?? []).map((inst) => ({ inst, cost: sellSP(inst.bv), sellable: !hasMechDamage(inst.damage) && !inst.damage?.destroyed })));

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected affordable(cost: number): boolean { return (this.sp() ?? 0) >= cost; }
    private uid(): string { return (globalThis.crypto?.randomUUID?.() ?? 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }

    protected buy(r: BuyRow): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.affordable(r.cost)) return;
        // D-127 belt-and-suspenders — a forged/stale row off the MUL list can't be minted in a HS ilClan campaign.
        const allow = this.mulAllow.idsFor('Mercenary');
        if (allow && !allow.has(r.u.id)) return;
        const u = r.u;
        const inst: ProtoInstance = {
            instanceId: this.uid(), unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id > 0 ? u.id : 0 /* PLATFORM-1 — never persist the catalog's -1 sentinel */, tons: u.tons, bv: u.bv,
            unitType: u.type === 'Tank' || u.type === 'VTOL' ? 'vehicle' : 'mech',
            condition: 'Reserve', damage: undefined,
            provenance: { origin: 'purchased', acquiredDate: this.state.currentDate() ?? undefined },
        };
        this.state.setStartingForce([...(this.state.startingForce() ?? []), inst]);
        this.warchest.post(`Purchase — ${u.chassis} ${u.model}`.trim(), r.cost, 0);
        void this.store.persistCurrent();
    }

    protected sell(inst: ProtoInstance): void {
        if (this.state.campaignSystem() !== 'hotspots' || hasMechDamage(inst.damage) || inst.damage?.destroyed) return;
        this.warchest.post(`Sale — ${inst.chassis} ${inst.model}`.trim(), -sellSP(inst.bv), 0); // income = negative cost
        this.state.setStartingForce((this.state.startingForce() ?? []).filter((i) => i.instanceId !== inst.instanceId));
        const pilots = this.state.pilots();
        if (pilots?.some((p) => p.assignedInstanceId === inst.instanceId)) {
            this.state.setPilots(pilots.map((p) => (p.assignedInstanceId === inst.instanceId ? { ...p, assignedInstanceId: undefined } : p)));
        }
        void this.store.persistCurrent();
    }
}
