/*
 * DIRECTIVE-130 — the GM-side MANUAL OPFOR BUILDER (Hot Spots). A modal that lets the GM hand-pick the current
 * mission's OpFor roster from the unit catalog — so a group fields the minis they actually own — instead of (or
 * on top of) the auto-generated force. Two panes: a CATALOG PICKER (faction-legal by default — the D-127 MUL/era
 * gate — with an explicit "field any unit" off-list override) and the WORKING OPFOR ROSTER (preloaded from the
 * current opforForce; add/remove/clear/duplicates). Save emits a fresh ProtoInstance[] to the host (claims-panel
 * writes it to missionSpec.opforForce/opforBv). Units only + default pilot skills — parity with generated OpFor
 * (per-unit OpFor pilot-skill editing is a logged fast-follow). No BV cap (advisory readout only).
 *
 * Reuses the D-124e .cpv / D-128 .cng overlay pattern (fixed, viewport-capped, scroll, overscroll-behavior:contain).
 * Additive + HS-only (claims-panel gates the entry button on isHotspots()); Traditional never mounts it.
 */
import { Component, ChangeDetectionStrategy, computed, signal, inject, input, output, effect, untracked } from '@angular/core';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../force/force-generator.service';
import { MulAllowlistService } from '../chaos/mul-allowlist.service'; // D-127 — the OpFor faction MUL gate
import type { ProtoInstance } from '../force/force-generator';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';

interface PickRow { u: Unit; offList: boolean; }
const VISIBLE_CAP = 120; // mirror chaos-market-tab.ts

@Component({
    selector: 'bce-opfor-builder',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="opb-overlay" (click)="onClose()">
            <div class="opb" role="dialog" aria-modal="true" aria-label="Build OpFor" (click)="$event.stopPropagation()">
                <button type="button" class="opb-x" (click)="onClose()" aria-label="Close">✕</button>
                <div class="opb-h">
                    <div class="opb-title">Build / Edit OpFor</div>
                    <div class="opb-sub">vs {{ faction() || '—' }} &middot; {{ offList() ? 'off-list — any unit on your table' : 'faction-legal (MUL / era-gated)' }}</div>
                </div>

                <div class="opb-body">
                    <!-- CATALOG PICKER -->
                    <div class="opb-pane opb-pick">
                        <div class="opb-tools">
                            <input type="search" class="opb-search" placeholder="Search chassis / model…" [value]="search()" (input)="search.set($any($event.target).value)" aria-label="Search units" />
                            <label class="opb-off"><input type="checkbox" [checked]="offList()" (change)="offList.set($any($event.target).checked)" data-testid="opb-offlist" /> Field any unit (off-list)</label>
                        </div>
                        @if (!catalogReady()) {
                            <p class="opb-empty">Loading the unit catalog…</p>
                        } @else if (visible().length) {
                            <div class="opb-list">
                                @for (r of visible(); track r.u.id) {
                                    <div class="opb-row" [class.off]="r.offList">
                                        <span class="opb-n">{{ r.u.chassis }} {{ r.u.model }}@if (r.offList) { <span class="opb-tag">off-list</span> }</span>
                                        <span class="opb-sub2">{{ r.u.tons }}t &middot; BV {{ money(r.u.bv) }}</span>
                                        <button type="button" class="opb-add" (click)="add(r.u)">+ Add</button>
                                    </div>
                                }
                            </div>
                            @if (filtered().length > visible().length) { <p class="opb-more">Showing {{ visible().length }} of {{ filtered().length }} — refine the search to narrow.</p> }
                        } @else {
                            <p class="opb-empty">No {{ offList() ? '' : 'faction-legal ' }}units match@if (!offList()) { — toggle <b>Field any unit (off-list)</b> for the whole catalog}.</p>
                        }
                    </div>

                    <!-- WORKING OPFOR ROSTER -->
                    <div class="opb-pane opb-roster">
                        <div class="opb-rhead">
                            <span class="opb-rh">OpFor roster</span>
                            <button type="button" class="opb-clear" [disabled]="!roster().length" (click)="clearAll()">Clear all</button>
                        </div>
                        @if (roster().length) {
                            <ul class="opb-rlist">
                                @for (i of roster(); track i.instanceId) {
                                    <li class="opb-rrow" [attr.data-instance]="i.instanceId">
                                        <span class="opb-rn">{{ i.chassis }} {{ i.model }}</span>
                                        <span class="opb-rsub">{{ i.tons }}t &middot; BV {{ money(i.bv) }}</span>
                                        <button type="button" class="opb-rm" (click)="remove(i.instanceId)">Remove</button>
                                    </li>
                                }
                            </ul>
                        } @else {
                            <p class="opb-empty">No OpFor units — add from the list (or Cancel to keep the generated force).</p>
                        }
                        <div class="opb-readout" data-testid="opb-readout">
                            <b>{{ roster().length }}</b> unit{{ roster().length === 1 ? '' : 's' }} &middot; <b>{{ money(totalBv()) }}</b> BV
                            @if (playerBv()) { <span class="opb-ref">· player {{ money(playerBv()) }} BV (advisory)</span> }
                        </div>
                    </div>
                </div>

                <div class="opb-actions">
                    <button type="button" class="opb-btn ghost" (click)="onClose()">Cancel</button>
                    <button type="button" class="opb-btn go" (click)="onSave()" data-testid="opb-save">Save OpFor &rsaquo;</button>
                </div>
            </div>
        </div>
    `,
    styles: [`
        :host { display:contents; }
        .opb-overlay { position:fixed; inset:0; background:rgba(20,16,10,.55); display:flex; align-items:flex-start; justify-content:center; padding:32px 16px calc(32px + var(--bce-footer-h, 0px)); overflow-y:auto; overscroll-behavior:contain; z-index:60; } /* IMPORT-7 A — clear the legal footer */
        .opb { position:relative; width:min(860px,100%); max-height:calc(100dvh - 64px); overflow-y:auto; overscroll-behavior:contain; background:var(--paper2, var(--paper)); border:1.8px solid var(--ink); box-shadow:0 8px 30px rgba(0,0,0,.4); padding:18px 20px 16px; font-family:var(--type); color:var(--ink); }
        .opb-x { position:absolute; top:9px; right:11px; border:none; background:transparent; font-size:18px; color:var(--ink2); cursor:pointer; line-height:1; }
        .opb-h { border-bottom:1.5px solid var(--line); padding-bottom:9px; margin-bottom:12px; }
        .opb-title { font-family:var(--stencil, var(--label)); font-size:21px; }
        .opb-sub { font-family:var(--mono); font-size:11.5px; color:var(--ink2); margin-top:2px; }
        .opb-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .opb-pane { min-width:0; border:1.3px solid var(--ink2); background:var(--paper); padding:10px; }
        .opb-tools { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; margin-bottom:9px; }
        .opb-search { flex:1 1 160px; font-family:var(--type); font-size:13px; padding:6px 9px; border:1.3px solid var(--ink); background:var(--paper); color:var(--ink); min-height:36px; }
        .opb-off { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); display:flex; align-items:center; gap:6px; cursor:pointer; }
        .opb-list, .opb-rlist { display:flex; flex-direction:column; gap:4px; max-height:46vh; overflow-y:auto; overscroll-behavior:contain; margin:0; padding:0; list-style:none; }
        .opb-row { display:grid; grid-template-columns:1fr auto auto; gap:8px 10px; align-items:center; border:1.2px solid var(--ink2); background:var(--paper2, var(--paper)); padding:6px 9px; }
        .opb-row.off { border-style:dashed; opacity:.92; }
        .opb-n, .opb-rn { font-family:var(--type); font-size:13px; overflow-wrap:anywhere; }
        .opb-tag { font-family:var(--mono); font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--stamp); border:1px solid var(--stamp); padding:0 4px; margin-left:6px; }
        .opb-sub2, .opb-rsub { font-family:var(--mono); font-size:10.5px; color:var(--ink2); text-align:right; }
        .opb-add, .opb-rm, .opb-clear { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:10.5px; text-transform:uppercase; border:1.3px solid var(--stamp); background:transparent; color:var(--stamp); padding:5px 10px; cursor:pointer; min-height:30px; white-space:nowrap; }
        .opb-add:hover, .opb-rm:hover, .opb-clear:hover:not(:disabled) { background:var(--stamp); color:var(--paper); }
        .opb-clear:disabled { opacity:.35; cursor:not-allowed; }
        .opb-rhead { display:flex; justify-content:space-between; align-items:center; margin-bottom:9px; }
        .opb-rh { font-family:var(--label); font-weight:700; letter-spacing:1.5px; font-size:11px; text-transform:uppercase; color:var(--ink2); }
        .opb-rrow { display:grid; grid-template-columns:1fr auto auto; gap:8px 10px; align-items:center; border:1.2px solid var(--ink2); background:var(--paper2, var(--paper)); padding:6px 9px; }
        .opb-readout { font-family:var(--mono); font-size:12px; color:var(--ink); border-top:1px dashed var(--ink2); margin-top:9px; padding-top:8px; }
        .opb-readout b { color:var(--ink); }
        .opb-ref { color:var(--ink2); }
        .opb-more, .opb-empty { font-family:var(--type); font-size:12px; color:var(--ink2); line-height:1.5; margin:8px 2px 2px; }
        .opb-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:14px; }
        .opb-btn { font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:12px; text-transform:uppercase; border:1.6px solid var(--ink); background:var(--paper2, var(--paper)); color:var(--ink); padding:9px 16px; cursor:pointer; min-height:40px; }
        .opb-btn.ghost { background:transparent; }
        .opb-btn.go { border-color:var(--stamp); color:var(--stamp); }
        .opb-btn.go:hover, .opb-btn.go:focus-visible { background:var(--stamp); color:var(--paper); outline:none; }
        @media (max-width:720px) { .opb-body { grid-template-columns:1fr; } .opb-list, .opb-rlist { max-height:34vh; } }
    `],
})
export class OpforBuilderComponent {
    private readonly data = inject(DataService);
    private readonly forceGen = inject(ForceGeneratorService);
    private readonly mulAllow = inject(MulAllowlistService); // D-127

    /** The OpFor faction the mission was generated for (claims-panel resolves spec.forge.opforFaction ?? target ?? enemyFaction). */
    readonly faction = input<string>('');
    /** The current opforForce (preloads the working roster so the GM can tweak the RNG result). */
    readonly initial = input<ProtoInstance[]>([]);
    /** The player's fieldable BV, shown as an advisory reference in the footer (NOT enforced). */
    readonly playerBv = input<number>(0);
    /** Save the hand-built roster (fresh ProtoInstance[]) — the parent writes it to missionSpec. */
    readonly save = output<ProtoInstance[]>();
    /** Close without saving (✕ / overlay-click / Cancel). */
    readonly close = output<void>();

    protected readonly search = signal<string>('');
    protected readonly offList = signal<boolean>(false);
    /** The working OpFor roster (seeded from `initial` once the input binds). */
    protected readonly roster = signal<ProtoInstance[]>([]);
    private seeded = false;

    constructor() {
        // D-127 — warm the MUL allow-list so the gated list re-runs once it lands (fire-and-forget; inert outside a
        // Hot Spots ilClan campaign → idsFor() null → the faction×era set gates instead).
        void this.mulAllow.ensure();
        // Seed the working roster from the current opforForce ONCE (the modal is created fresh per open; signal inputs
        // are bound before the first effect flush, so this copies the real preload).
        effect(() => {
            const init = this.initial();
            if (this.seeded) return;
            this.seeded = true;
            untracked(() => this.roster.set(init.map((i) => ({ ...i }))));
        });
        // D-130 test seam (OPT-IN: localStorage['bce.test.d130']): drive the real builder so a headless render proves
        // the gate/off-list breadth, add/remove/clear, and the minted ProtoInstance shape (provenance gm-added).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d130')) {
            (window as unknown as Record<string, unknown>)['__d130'] = {
                faction: (): unknown => this.faction(),
                offList: (): unknown => this.offList(),
                setOffList: (v: boolean): void => this.offList.set(v),
                setSearch: (q: string): void => this.search.set(q),
                filteredCount: (): unknown => this.filtered().length,
                gatedCount: (): unknown => this.gatedIds().size,
                catalogCount: (): unknown => this.catalogFieldable().length,
                roster: (): unknown => this.roster().map((i) => ({ chassis: i.chassis, model: i.model, bv: i.bv, unitType: i.unitType, prov: i.provenance?.origin, id: i.mulId })),
                totalBv: (): unknown => this.totalBv(),
                addFirst: (): void => { const v = this.visible(); if (v.length) this.add(v[0].u); },
                clearAll: (): void => this.clearAll(),
                save: (): void => this.onSave(),
            };
        }
    }

    protected readonly catalogReady = computed(() => { this.data.isDataReady(); return this.data.getUnits().length > 0; });
    /** The whole catalog of fieldable (valued) units — the off-list source. */
    private readonly catalogFieldable = computed<Unit[]>(() => { this.data.isDataReady(); return this.data.getUnits().filter((u) => u.bv > 0); });
    /** The faction-legal id set (the default gate = D-127 MUL list when live, else the faction×era set) — used to tag
     *  off-list rows and as the default source. */
    private readonly gatedIds = computed<Set<number>>(() => {
        this.data.isDataReady();
        const mulIds = this.mulAllow.idsFor(this.faction());
        return new Set(this.forceGen.eligibleOpForUnits(this.faction(), mulIds ?? undefined).map((u) => u.id));
    });
    /** The filtered+sorted picker list: default = faction-legal pool; off-list = the whole catalog (rows not in the
     *  faction-legal set tagged "off-list"). */
    protected readonly filtered = computed<PickRow[]>(() => {
        this.data.isDataReady();
        const q = this.search().trim().toLowerCase();
        const off = this.offList();
        const gated = off ? this.gatedIds() : null;
        const mulIds = off ? undefined : (this.mulAllow.idsFor(this.faction()) ?? undefined);
        const source: Unit[] = off ? this.catalogFieldable() : this.forceGen.eligibleOpForUnits(this.faction(), mulIds);
        return source
            .filter((u) => !q || `${u.chassis} ${u.model}`.toLowerCase().includes(q))
            .sort((a, b) => a.chassis.localeCompare(b.chassis) || a.model.localeCompare(b.model))
            .map((u) => ({ u, offList: !!gated && !gated.has(u.id) }));
    });
    protected readonly visible = computed(() => this.filtered().slice(0, VISIBLE_CAP));
    protected readonly totalBv = computed(() => this.roster().reduce((a, b) => a + (b.bv ?? 0), 0));

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }

    /** Mint a ProtoInstance EXACTLY like generateOpFor (force-generator.ts:322) but provenance gm-added. u.type→unitType
     *  ('Mek'→mech, else vehicle) — the builder sources catalog Units (getUnits), which carry `type`, not `unitType`. */
    protected add(u: Unit): void {
        const n = this.roster().length;
        const inst: ProtoInstance = {
            instanceId: `op-${n + 1}-${Math.floor(Math.random() * 1e6)}`,
            unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv,
            condition: 'Active', unitType: u.type === 'Mek' ? 'mech' : 'vehicle',
            provenance: { origin: 'gm-added' },
        };
        this.roster.update((r) => [...r, inst]);
    }
    protected remove(instanceId: string): void { this.roster.update((r) => r.filter((i) => i.instanceId !== instanceId)); }
    protected clearAll(): void { this.roster.set([]); }
    protected onSave(): void { this.save.emit(this.roster().map((i) => ({ ...i }))); }
    protected onClose(): void { this.close.emit(); }
}
