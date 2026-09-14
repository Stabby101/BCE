/*
 * ODM-18 P1 — the PLAYER COMPANY CONSOLE: the Ghosts run by many hands, mastered by one. Joined player
 * devices see the company's state (snapshot-fed cards + the ruling-2 projection for the pack-401-walled
 * surfaces) and run its day-to-day through the INTENT spine — every verb passes through the GM's device,
 * applies there via the GM's own services, and leaves a named audit line (the log renders here too:
 * honesty is symmetric). WHAT THIS SURFACE NEVER CARRIES (pinned by the harness): clock advance · resolve ·
 * field walk · the Quartermaster depot (no steppers — the bench view is the QUEUE SLICE only) · write-off.
 * GM-absent intents are denied honestly ("the GM is not connected") — delivery before effect.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { engagementKeyOf } from '../campaign/claims/engagement-key';
import { canDeploy, deployBlocker } from '../campaign/force/deployed';
import { TRADE_LABEL } from '../campaign/odm/odm-trades';

@Component({
    selector: 'bce-player-company',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="co">
            <header class="co-head">
                <div class="co-brand">COMPANY CONSOLE</div>
                <div class="co-cmd">{{ commandName() || 'the company' }}</div>
                <button type="button" class="co-back" (click)="back()">&lsaquo; roster</button>
            </header>
            @if (!isOdm()) {
                <div class="co-note">This campaign has no company console.</div>
            } @else {
                @if (lastNote(); as n) { <div class="co-deny" data-testid="pc-note">{{ n }}</div> }

                <!-- ── STATE CARDS (snapshot-fed + the projection) ── -->
                <div class="co-cards" data-testid="pc-cards">
                    @if (stocks(); as st) {
                        <div class="co-card"><div class="l">Fuel</div><div class="v">{{ st.fuelTons }} / {{ st.fuelCapacityTons }} t</div></div>
                        <div class="co-card" [class.warn]="st.exposure !== 'LOW'"><div class="l">Exposure</div><div class="v">{{ st.exposure }}</div><div class="s">GM assessment</div></div>
                    }
                    <div class="co-card"><div class="l">Force</div><div class="v">{{ (force().length) }}</div><div class="s">irreplaceable</div></div>
                    <div class="co-card"><div class="l">Date</div><div class="v">{{ dateLabel() }}</div><div class="s">the GM advances the clock</div></div>
                </div>

                <!-- ── THE ACTIVE OPERATION — composed by the GM, published to the table (§R-1) ── -->
                @if (activeOrders(); as op) {
                    <section class="co-sec" data-testid="pc-orders">
                        <div class="co-h">Orders — {{ op.title }}</div>
                        @if (op.system) { <div class="co-row dim">{{ op.system }}</div> }
                        @if (op.brief) { <div class="co-row" style="white-space:pre-wrap" data-testid="pc-orders-brief">{{ op.brief }}</div> }
                        <div class="co-sub">Objectives</div>
                        <div class="co-row">{{ op.objectives.primary }}</div>
                        @if (op.objectives.secondary) { <div class="co-row">{{ op.objectives.secondary }}</div> }
                        @if (op.objectives.bonus) { <div class="co-row">{{ op.objectives.bonus }}</div> }
                    </section>
                }

                <!-- ── FLEET + POOLS + SUPPORT + CONTACTS (the ruling-2 projection; honest when absent) ── -->
                @if (projection(); as pj) {
                    <section class="co-sec" data-testid="pc-fleet">
                        <div class="co-h">Fleet</div>
                        @for (v of pj.fleet; track v.name) {
                            <div class="co-row"><b>{{ v.name }}</b> <span class="dim">{{ v.klass }}</span> · {{ v.status }}@if (v.fuelPct !== null) { · fuel {{ v.fuelPct }}% }@if (v.kf) { · {{ v.kf }} }</div>
                        }
                        <div class="co-h" style="margin-top:10px">Tech pools</div>
                        @for (ph of pj.poolHours; track ph.pool) {
                            <div class="co-row">{{ ph.label }} — {{ ph.committedPerDay }} h committed of {{ ph.perDay }} h/day</div>
                        }
                    </section>
                    <section class="co-sec" data-testid="pc-support">
                        <div class="co-h">Support register</div>
                        <div class="co-wrap">@for (s of pj.support; track s.id) { <span class="co-chip">{{ s.label }} ×{{ s.count }}</span> }</div>
                        <div class="co-h" style="margin-top:10px">Contacts</div>
                        <div class="co-wrap">@for (c of pj.contacts; track c.name) { <span class="co-chip">{{ c.name }}@if (c.status) { · {{ c.status }} }</span> }</div>
                    </section>
                } @else {
                    <div class="co-note">GM-linked data (fleet · pools · support · contacts) publishes when the GM's console is up.</div>
                }

                <!-- ── BARRACKS BY TRADE ── -->
                <section class="co-sec" data-testid="pc-barracks">
                    <div class="co-h">Barracks</div>
                    @for (g of barracks(); track g.trade) {
                        <div class="co-sub">{{ g.label }} <span class="dim">×{{ g.pilots.length }}</span></div>
                        @for (p of g.pilots; track p.pilotId) {
                            <!-- the fallen wear their marker (panel note): the GM dashboard separates them; here the chip keeps the row honest -->
                            <div class="co-row">{{ p.callsign || p.name }} <span class="dim">{{ p.gunnery }}/{{ p.piloting }}</span>@if (p.status === 'KIA') { · <span class="co-kia">KIA</span> } @else if (unitOf(p.pilotId); as u) { · {{ u }} } @else { · <span class="dim">unassigned</span> }</div>
                        }
                    }
                </section>

                <!-- ── ROSTER — conditions · deploy · crew · bays · the two-key strip ── -->
                <section class="co-sec" data-testid="pc-roster">
                    <div class="co-h">Unit roster</div>
                    @for (u of force(); track u.instanceId) {
                        <div class="co-unit">
                            <span class="co-un">{{ u.chassis }} {{ u.model }}</span>
                            <span class="co-cond" [attr.data-c]="u.condition">{{ u.condition }}</span>
                            @if (deployBlock(u.instanceId, u.condition); as blk) {
                                <span class="dim" data-testid="pc-deploy-blocked">{{ blk }}</span>
                            } @else {
                                <button type="button" class="co-btn" (click)="setDeploy(u.instanceId, u.condition !== 'Deployed')" data-testid="pc-deploy">
                                    {{ u.condition === 'Deployed' ? 'stand down' : 'deploy' }}
                                </button>
                            }
                            <!-- The selects RESET to their display option right after firing (panel finding — the
                                 NG-SELECT gotcha class): a denied/refused intent must not leave the picked value
                                 standing as if applied; the truth renders via the fan (option 0's text). -->
                            <select class="co-sel" (change)="reassign(u.instanceId, $any($event.target).value); $any($event.target).value = '__keep__'" data-testid="pc-crew" aria-label="Crew">
                                <option value="__keep__">{{ crewOf(u.instanceId) || '— crew —' }}</option>
                                @for (p of sparePilots(); track p.pilotId) { <option [value]="p.pilotId">{{ p.callsign || p.name }} ({{ p.gunnery }}/{{ p.piloting }})</option> }
                                @if (crewOf(u.instanceId)) { <option value="">stand crew down</option> }
                            </select>
                            @if (emptyBays().length && u.condition === 'In repair' && !bayOf(u.instanceId)) {
                                <select class="co-sel" (change)="bayAssign(u.instanceId, $any($event.target).value); $any($event.target).value = ''" data-testid="pc-bay-assign" aria-label="Assign to bay">
                                    <option value="">→ bay…</option>
                                    @for (b of emptyBays(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
                                </select>
                            }
                            @if (bayOf(u.instanceId); as bid) { <span class="dim">in {{ bid }}</span> }
                            @if (u.condition === 'Cold storage') {
                                <button type="button" class="co-btn warn" (click)="stripRequest(u.instanceId)" data-testid="pc-strip-request">request donor strip</button>
                            }
                        </div>
                    }
                </section>

                <!-- ── BAYS + THE BENCH QUEUE SLICE (jobs · hours · counts awaiting work — NO depot steppers) ── -->
                <section class="co-sec" data-testid="pc-bays">
                    <div class="co-h">Bays</div>
                    @for (b of bays(); track b.id) {
                        <div class="co-row">
                            <b>{{ b.name }}</b> <span class="dim">{{ b.type ?? 'GENERAL' }}</span> ·
                            @if (b.occupantId) {
                                {{ labelOf(b.occupantId) }}
                                <select class="co-sel" (change)="bayPriority(b.id, $any($event.target).value); $any($event.target).value = ''" data-testid="pc-bay-priority" aria-label="Priority">
                                    <option value="">prio {{ b.jobPriority ?? '—' }}</option>
                                    <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                                </select>
                                <button type="button" class="co-btn" (click)="bayUnassign(b.id)" data-testid="pc-bay-clear">clear</button>
                            } @else {
                                <span class="dim">empty</span>
                                <button type="button" class="co-btn" (click)="bayType(b.id, (b.type ?? 'GENERAL') === 'GENERAL' ? 'SALVAGE' : 'GENERAL')" data-testid="pc-bay-type">→ {{ (b.type ?? 'GENERAL') === 'GENERAL' ? 'SALVAGE' : 'GENERAL' }}</button>
                            }
                        </div>
                    }
                    <div class="co-h" style="margin-top:10px">The bench — queue</div>
                    @for (j of bench(); track j.id) {
                        <div class="co-row">{{ j.kind }} · {{ j.label }} ×{{ j.count }} · {{ j.hoursRemaining }} h left</div>
                    }
                    @for (r of rawLines(); track r.label) {
                        <div class="co-row">{{ r.label }} — {{ r.raw }} RAW awaiting assessment
                            <button type="button" class="co-btn" (click)="benchAssess(r.label, r.raw)" data-testid="pc-bench-assess">assess ×{{ r.raw }} → A</button>
                        </div>
                    }
                    @for (q of quarantined(); track q.bin) {
                        <div class="co-row">{{ q.bin }} — {{ q.tons }} t quarantined
                            <button type="button" class="co-btn" (click)="benchAmmoClear(q.bin)" data-testid="pc-bench-ammo">bench-clear</button>
                        </div>
                    }
                </section>

                <!-- ── THE COMPANY LOG — the audit, symmetric ── -->
                <section class="co-sec" data-testid="pc-log">
                    <div class="co-h">Company log</div>
                    @for (l of logTail(); track $index) { <div class="co-row dim">{{ l }}</div> }
                </section>
            }
        </div>
    `,
    styles: [`
        :host { display:block; height:calc(100dvh - var(--bce-footer-h, 0px)); background:#0c0f13; color:#e7edf3; font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;
                /* GM-1d-c — THIS host is the page's scroll container (the GM-1d roster / GM-1d-b join fix, same lock): the shared
                   stylesheet locks the document (body overflow:hidden), so an in-flow min-height console taller than the window
                   could not be scrolled by touch or wheel on ANY device. Ends above the reserved legal footer. */
                overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; }
        .co { max-width: 720px; margin: 0 auto; padding: 16px 14px 40px; }
        .co-head { display:flex; align-items:baseline; gap:12px; margin-bottom:14px; }
        .co-brand { font-weight:800; letter-spacing:.14em; font-size:12px; color:#9fb2c4; }
        .co-cmd { font-weight:700; }
        .co-back { margin-left:auto; background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:7px; padding:5px 11px; cursor:pointer; }
        .co-note { color:#7f8a96; font-style:italic; padding:10px 0; }
        .co-deny { border:1px solid #6b4a2f; color:#e7a86b; border-radius:8px; padding:8px 12px; margin-bottom:10px; font-size:13px; }
        .co-cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
        .co-card { flex:1 1 130px; border:1px solid #232c37; border-radius:10px; padding:10px 12px; background:#141a21; }
        .co-card.warn { border-color:#a5483d; }
        .co-card .l { font-size:11px; letter-spacing:.1em; color:#7f8a96; text-transform:uppercase; }
        .co-card .v { font-weight:800; font-size:18px; }
        .co-card .s { font-size:11px; color:#7f8a96; }
        .co-sec { border:1px solid #232c37; border-radius:10px; background:#141a21; padding:12px 14px; margin-bottom:12px; }
        .co-h { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9fb2c4; margin-bottom:6px; font-weight:700; }
        .co-sub { font-weight:700; margin-top:6px; }
        .co-row { padding:3px 0; font-size:13.5px; }
        .co-wrap { display:flex; flex-wrap:wrap; gap:6px; }
        .co-chip { border:1px solid #2a3340; border-radius:999px; padding:2px 10px; font-size:12px; }
        .co-unit { display:flex; flex-wrap:wrap; align-items:center; gap:8px; border-top:1px solid #1d242e; padding:7px 0; }
        .co-un { font-weight:700; }
        .co-cond { font-size:11.5px; border:1px solid #2a3340; border-radius:999px; padding:1px 8px; color:#9fb2c4; }
        .co-kia { font-size:10.5px; letter-spacing:.08em; border:1px solid #6b2f2f; border-radius:3px; padding:0 5px; color:#e07a7a; }
        .co-cond[data-c='Deployed'] { border-color:#2f6b46; color:#7fe3a0; }
        .co-cond[data-c='In repair'] { border-color:#6b4a2f; color:#e7a86b; }
        .co-btn { background:none; border:1px solid #3d6ea5; color:#9fc4ea; border-radius:7px; padding:3px 10px; font-size:12.5px; cursor:pointer; }
        .co-btn.warn { border-color:#a5483d; color:#f2c4bc; }
        .co-sel { background:#0c0f13; border:1px solid #2a3340; color:#cdd8e3; border-radius:7px; padding:3px 6px; font-size:12.5px; max-width:180px; }
        .dim { color:#7f8a96; }
    `],
})
export class PlayerCompanyComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly router = inject(Router);

    protected readonly isOdm = computed(() => this.state.packId() === 'odm');
    protected readonly commandName = this.state.commandName;
    protected readonly stocks = this.state.odmStocks;
    protected readonly projection = this.state.odmProjection;
    /** §R-1 — the ACTIVE composed operation, read from the top-level published record the fan already
     *  carries. Composed fields ONLY; no pack path is reachable from this component by construction. */
    protected readonly activeOrders = computed(() => {
        const id = this.state.odmActiveNodeId();
        return id ? (this.state.odmGmMissions().find((m) => m.id === id) ?? null) : null;
    });
    protected readonly force = computed(() => this.state.startingForce() ?? []);
    protected readonly bays = computed(() => this.state.bays() ?? []);
    protected readonly bench = computed(() => this.state.odmBench() ?? []);
    protected readonly lastNote = signal<string | null>(null);

    constructor() {
        effect(() => {
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) { this.rt.ensure(id, key); this.rt.joinLobby(); } // the intent identity binds here (D-048 ordering)
        });
    }

    protected back(): void { void this.router.navigate(['/roster']); }
    protected dateLabel(): string {
        const d = this.state.currentDate() ?? this.state.startDate();
        return d ? `${d.d} · ${d.m + 1} · ${d.y}` : '—';
    }
    protected readonly barracks = computed(() => {
        const groups = new Map<string, { trade: string; label: string; pilots: NonNullable<ReturnType<NewCampaignState['pilots']>> }>();
        for (const p of this.state.pilots() ?? []) {
            const trade = p.trade ?? 'unassigned';
            const label = (TRADE_LABEL as Record<string, string>)[trade] ?? 'Unassigned';
            const g = groups.get(trade) ?? { trade, label, pilots: [] };
            g.pilots.push(p);
            groups.set(trade, g);
        }
        return [...groups.values()];
    });
    protected unitOf(pilotId: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        if (!p?.assignedInstanceId) return null;
        return this.labelOf(p.assignedInstanceId);
    }
    protected labelOf(instanceId: string): string {
        const u = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
        return u ? `${u.chassis} ${u.model}`.trim() : instanceId;
    }
    protected crewOf(instanceId: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
        return p ? (p.callsign || p.name) : null;
    }
    protected readonly sparePilots = computed(() => (this.state.pilots() ?? []).filter((p) => !p.assignedInstanceId && p.status !== 'KIA'));
    protected canDeployU(condition: string): boolean { return canDeploy(condition); }
    /** TESTER-ODM-1 #2 — the SAME gate the GM checkbox uses: condition AND crew. Returns the honest reason
     *  to show in the button's place, or null when the machine may take the field. */
    protected deployBlock(instanceId: string, condition: string): string | null {
        return deployBlocker(condition, !!this.crewOf(instanceId));
    }
    protected readonly emptyBays = computed(() => (this.state.bays() ?? []).filter((b) => !b.occupantId));
    protected bayOf(instanceId: string): string | null {
        return (this.state.bays() ?? []).find((b) => b.occupantId === instanceId)?.id ?? null;
    }
    protected readonly rawLines = computed(() =>
        (this.state.inventory()?.lines ?? [])
            .filter((l) => l.category === 'component' && (l.grades?.raw ?? 0) > 0)
            .map((l) => ({ label: l.label, raw: l.grades!.raw })));
    protected readonly quarantined = computed(() =>
        Object.entries(this.state.odmStocks()?.bins ?? {})
            .filter(([, b]) => (b.quarantinedTons ?? 0) > 0)
            .map(([bin, b]) => ({ bin, tons: b.quarantinedTons ?? 0 })));
    protected readonly logTail = computed(() => {
        const log = this.state.campaignLog() ?? [];
        return log.slice(-15).reverse().map((l) => `${l.date.d}·${l.date.m + 1}·${l.date.y} — ${l.text}`);
    });

    // ── the intent senders (one-shot; a denial surfaces honestly) ──
    private async send(verb: string, payload: Record<string, unknown>): Promise<void> {
        this.lastNote.set(null);
        const r = await this.rt.sendOdmIntent(verb, payload);
        if (!r.ok) this.lastNote.set(`Not applied — ${r.reason ?? 'denied'}.`);
    }
    protected setDeploy(instanceId: string, deployed: boolean): void { void this.send('set-deploy', { instanceId, deployed }); }
    protected reassign(instanceId: string, pilotId: string): void {
        if (pilotId === '__keep__') return;
        void this.send('reassign-pilot', { instanceId, pilotId });
    }
    protected bayAssign(instanceId: string, bayId: string): void { if (bayId) void this.send('bay-assign', { instanceId, bayId }); }
    protected bayUnassign(bayId: string): void { void this.send('bay-unassign', { bayId }); }
    protected bayPriority(bayId: string, v: string): void { const p = Number(v); if (p >= 1 && p <= 4) void this.send('bay-priority', { bayId, p }); }
    protected bayType(bayId: string, type: 'GENERAL' | 'SALVAGE'): void { void this.send('bay-type', { bayId, type }); }
    protected benchAssess(label: string, n: number): void { void this.send('bench-assess', { label, outcome: { a: n, b: 0, c: 0 } }); }
    protected benchAmmoClear(bin: string): void { void this.send('bench-ammo-clear', { bin }); }
    protected stripRequest(instanceId: string): void { void this.send('donor-strip-request', { instanceId }); }
}
