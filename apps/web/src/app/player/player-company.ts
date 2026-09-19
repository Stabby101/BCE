import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore } from '../campaign/campaign-save-store';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import type { OdmSeatRequest } from '../campaign/odm/odm-ledger';
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
                @if (!holdsAnySeat()) {
                    <div class="co-ro" data-testid="pc-readonly">You hold no seat, so the company is <b>read-only</b> here. Claim your unit at the table (the roster) and it is yours to edit.</div>
                }

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
                        @let seat = seatOf(u.instanceId);
                        <div class="co-unit" [class.mine]="seat?.mine" [attr.data-instance]="u.instanceId" data-testid="pc-unit">
                            <span class="co-un">{{ u.chassis }} {{ u.model }}</span>
                            <span class="co-cond" [attr.data-c]="u.condition">{{ u.condition }}</span>
                            @if (seat?.mine) { <span class="co-seat mine" data-testid="pc-seat-mine">your seat</span> }
                            @else if (seat) { <span class="co-seat" data-testid="pc-seat-holder">held by {{ seat.holderName || 'a player' }}</span> }
                            @else { <span class="co-seat open" data-testid="pc-seat-open">unclaimed — GM only</span> }
                          @if (!seat?.mine) {
                            <span class="dim" data-testid="pc-crew-ro">crew: {{ crewLine(u.instanceId) }}</span>
                            @if (bayOf(u.instanceId); as bid) { <span class="dim">in {{ bid }}</span> }
                          } @else {
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
                            <div class="co-edit" data-testid="pc-seat-edit">
                                @if (pilotNameOf(u.instanceId); as pn) {
                                    <div class="co-edrow"><input #nm class="co-in" [value]="pn" maxlength="60" aria-label="Pilot name" data-testid="pc-rename-input" />
                                        <button type="button" class="co-btn" (click)="renamePilot(u.instanceId, nm.value)" data-testid="pc-rename">rename pilot</button></div>
                                }
                                <div class="co-edrow"><input #nt class="co-in" [value]="noteOf(u.instanceId)" maxlength="500" placeholder="a note on this seat" aria-label="Seat note" data-testid="pc-note-input" />
                                    <button type="button" class="co-btn" (click)="seatNote(u.instanceId, nt.value)" data-testid="pc-note-save">save note</button></div>
                                <div class="co-edrow"><select #rk class="co-sel" aria-label="Request kind" data-testid="pc-request-kind"><option value="repair">repair</option><option value="loadout">loadout</option></select>
                                    <input #rq class="co-in" maxlength="300" placeholder="what do you need from the GM?" aria-label="Request" data-testid="pc-request-input" />
                                    <button type="button" class="co-btn" (click)="seatRequest(u.instanceId, rk.value, rq.value); rq.value = ''" data-testid="pc-request-send">request</button></div>
                            </div>
                          }
                            <!-- the two-key donor strip is a COMPANY request: any device that holds a seat may raise it -->
                            @if (u.condition === 'Cold storage' && holdsAnySeat()) {
                                <button type="button" class="co-btn warn" (click)="stripRequest(u.instanceId)" data-testid="pc-strip-request">request donor strip</button>
                            }
                            @if (!seat?.mine && noteOf(u.instanceId); as n) { <div class="co-sub2 dim" data-testid="pc-note-text">note: {{ n }}</div> }
                            @for (r of requestsOf(u.instanceId); track r.id) {
                                <div class="co-sub2 dim" data-testid="pc-request-row" [attr.data-status]="r.status">{{ r.kind }} request — “{{ r.text }}” · {{ r.by }} · <b>{{ r.status }}</b></div>
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
                                {{ labelOf(b.occupantId) }} <span class="dim">prio {{ b.jobPriority ?? '—' }}</span>
                              @if (holdsAnySeat()) {
                                <select class="co-sel" (change)="bayPriority(b.id, $any($event.target).value); $any($event.target).value = ''" data-testid="pc-bay-priority" aria-label="Priority">
                                    <option value="">prio {{ b.jobPriority ?? '—' }}</option>
                                    <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                                </select>
                                <button type="button" class="co-btn" (click)="bayUnassign(b.id)" data-testid="pc-bay-clear">clear</button>
                              }
                            } @else {
                                <span class="dim">empty</span>
                              @if (holdsAnySeat()) {
                                <button type="button" class="co-btn" (click)="bayType(b.id, (b.type ?? 'GENERAL') === 'GENERAL' ? 'SALVAGE' : 'GENERAL')" data-testid="pc-bay-type">→ {{ (b.type ?? 'GENERAL') === 'GENERAL' ? 'SALVAGE' : 'GENERAL' }}</button>
                              }
                            }
                        </div>
                    }
                    <div class="co-h" style="margin-top:10px">The bench — queue</div>
                    @for (j of bench(); track j.id) {
                        <div class="co-row">{{ j.kind }} · {{ j.label }} ×{{ j.count }} · {{ j.hoursRemaining }} h left</div>
                    }
                    @for (r of rawLines(); track r.label) {
                        <div class="co-row">{{ r.label }} — {{ r.raw }} RAW awaiting assessment
                            @if (holdsAnySeat()) { <button type="button" class="co-btn" (click)="benchAssess(r.label, r.raw)" data-testid="pc-bench-assess">assess ×{{ r.raw }} → A</button> }
                        </div>
                    }
                    @for (q of quarantined(); track q.bin) {
                        <div class="co-row">{{ q.bin }} — {{ q.tons }} t quarantined
                            @if (holdsAnySeat()) { <button type="button" class="co-btn" (click)="benchAmmoClear(q.bin)" data-testid="pc-bench-ammo">bench-clear</button> }
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
        .co-ro { border:1px solid #3a4656; background:#141a21; color:#cdd8e3; border-radius:8px; padding:9px 12px; margin-bottom:10px; font-size:13px; }
        .co-unit.mine { border-left:3px solid #3d6ea5; padding-left:9px; }
        .co-seat { font-size:11px; border:1px solid #2a3340; border-radius:999px; padding:1px 8px; color:#9fb2c4; }
        .co-seat.mine { border-color:#3d6ea5; color:#9fc4ea; font-weight:700; }
        .co-seat.open { color:#7f8a96; font-style:italic; }
        .co-edit { flex:1 1 100%; display:flex; flex-direction:column; gap:6px; margin-top:4px; }
        .co-edrow { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .co-in { flex:1 1 160px; min-width:0; background:#0c0f13; border:1px solid #2a3340; color:#e7edf3; border-radius:7px; padding:6px 8px; font-size:13px; }
        .co-edit .co-btn { padding:6px 12px; min-height:34px; }
        .co-sub2 { flex:1 1 100%; font-size:12.5px; }
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
    // presentation only — the server's seatDecision refuses whatever the markup would not have offered.
    private readonly seatMap = computed(() => new Map(this.rt.seats().map((s) => [s.instanceId, s])));
    protected seatOf(instanceId: string): { holderName: string; mine: boolean } | null { return this.seatMap().get(instanceId) ?? null; }
    protected readonly holdsAnySeat = computed(() => this.rt.seats().some((s) => s.mine));
    /** the LIVING pilot riding this seat (null = empty seat, or the fallen — their names are the memorial) */
    protected pilotNameOf(instanceId: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
        return p && p.status !== 'KIA' ? p.name : null;
    }
    protected crewLine(instanceId: string): string {
        const p = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
        return p ? (p.callsign && p.callsign !== p.name ? `${p.callsign} · ${p.name}` : p.name) : '—';
    }
    protected noteOf(instanceId: string): string { return this.state.odmSeatNotes()[instanceId] ?? ''; }
    protected requestsOf(instanceId: string): OdmSeatRequest[] { return this.state.odmSeatRequests().filter((r) => r.instanceId === instanceId).slice(-3).reverse(); }

    constructor() {
        effect(() => {
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) { this.rt.ensure(id, key); this.rt.joinLobby(); }
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
    protected renamePilot(instanceId: string, name: string): void { const n = name.trim(); if (n && n !== this.pilotNameOf(instanceId)) void this.send('rename-pilot', { instanceId, name: n }); }
    protected seatNote(instanceId: string, text: string): void { const t = text.trim(); if (t !== this.noteOf(instanceId)) void this.send('seat-note', { instanceId, text: t }); }
    protected seatRequest(instanceId: string, kind: string, text: string): void { const t = text.trim(); if (t) void this.send('seat-request', { instanceId, kind: kind === 'loadout' ? 'loadout' : 'repair', text: t }); }
}
