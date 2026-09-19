import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { AuthService } from '../../auth/auth.service';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';

@Component({
    selector: 'bce-odm-seats',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="seats" data-testid="odm-seats">
            <h3 class="ph">Seats <span class="sp-sub">who may edit which unit from their own console — kept between missions</span></h3>
            @if (note(); as n) { <p class="sp-note" data-testid="odm-seats-note">{{ n }}</p> }
            @if (!units().length) {
                <p class="sp-empty">No units in the company yet.</p>
            } @else {
                <ul class="sp-list">
                    @for (u of units(); track u.instanceId) {
                        @let seat = seatOf(u.instanceId);
                        <li class="sp-row" [attr.data-instance]="u.instanceId" [class.held]="!!seat" data-testid="odm-seat-row">
                            <span class="sp-unit">{{ u.chassis }} {{ u.model }}</span>
                            <span class="sp-crew">{{ crewOf(u.instanceId) || '— no crew —' }}</span>
                            @if (seat) {
                                <span class="sp-dot" [class.on]="presenceOf(seat.holderToken) === true" [class.off]="presenceOf(seat.holderToken) === false"></span>
                                <span class="sp-holder" data-testid="odm-seat-holder">{{ seat.holderName || 'a player' }}</span>
                            } @else {
                                <span class="sp-open" data-testid="odm-seat-open">unclaimed — GM only</span>
                            }
                            @if (canSeat()) {
                                <!-- NG-SELECT: [selected] per option — a [value] on the select never tracks a rendered @for. -->
                                <select class="sp-sel" (change)="onPick(u.instanceId, $any($event.target).value)" [disabled]="busy() === u.instanceId" data-testid="odm-seat-select" [attr.data-instance]="u.instanceId" aria-label="Seat a player">
                                    <option value="" [selected]="!seat">— unseated —</option>
                                    @for (p of players(); track p.token) {
                                        <option [value]="p.token" [selected]="seat?.holderToken === p.token">{{ p.name }}{{ p.side === 'OPFOR' ? ' (OPFOR)' : '' }}{{ p.connected ? '' : ' · offline' }}</option>
                                    }
                                    @if (seat && !players().some((p) => p.token === seat.holderToken)) {
                                        <option [value]="seat.holderToken" selected>{{ seat.holderName || 'a player' }} · not in the lobby</option>
                                    }
                                </select>
                            }
                        </li>
                    }
                </ul>
            }
        </section>
    `,
    styles: [`
        .seats { margin-top:14px; }
        .sp-sub { font-family:var(--type); font-size:12px; font-weight:400; letter-spacing:0; text-transform:none; color:var(--ink2); margin-left:8px; }
        .sp-note { font-family:var(--type); font-size:12.5px; color:var(--stamp); margin:4px 0 8px; }
        .sp-empty { font-family:var(--type); font-size:12.5px; color:var(--ink2); font-style:italic; }
        .sp-list { list-style:none; margin:0; padding:0; }
        .sp-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:6px 0; border-top:1px dotted var(--rule, rgba(0,0,0,.18)); font-family:var(--mono); font-size:12px; }
        .sp-row.held .sp-unit { font-weight:700; }
        .sp-unit { flex:1 1 180px; min-width:0; }
        .sp-crew { flex:1 1 140px; min-width:0; color:var(--ink2); }
        .sp-dot { width:8px; height:8px; border-radius:50%; background:var(--ink2); opacity:.35; }
        .sp-dot.on { background:var(--ok, #3a7d44); opacity:1; }
        .sp-dot.off { background:var(--stamp); opacity:1; }
        .sp-holder { font-weight:700; }
        .sp-open { color:var(--ink2); font-style:italic; }
        .sp-sel { font:inherit; font-size:11.5px; min-height:32px; padding:3px 6px; border:1.2px solid var(--ink2); background:var(--paper); color:var(--ink); max-width:220px; }
    `],
})
export class OdmSeatsPanelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly auth = inject(AuthService);
    private readonly rt = inject(ClaimRealtimeService);

    protected readonly units = computed(() => this.state.startingForce() ?? []);
    protected readonly players = computed(() => this.rt.lobby());
    private readonly seatMap = computed(() => new Map(this.rt.seats().map((s) => [s.instanceId, s])));
    protected seatOf(instanceId: string): { holderName: string; holderToken?: string } | null { return this.seatMap().get(instanceId) ?? null; }
    protected readonly canSeat = computed(() => !this.auth.authRequired() || this.store.isRecordOwner() || this.auth.user()?.role === 'admin' || !this.store.readOnly());
    protected readonly busy = signal<string | null>(null);
    protected readonly note = signal<string | null>(null);

    constructor() {
        // the same room + observer join the claim board uses (idempotent); the seat map arrives on the observer rejoin
        effect(() => {
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) { this.rt.ensure(id, key); this.rt.observeLobby(); this.rt.seatSync(); }
        });
    }

    protected crewOf(instanceId: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
        return p ? (p.callsign || p.name) : null;
    }
    protected presenceOf(token: string | undefined): boolean | null {
        if (!token) return null;
        return this.players().find((p) => p.token === token)?.connected ?? false;
    }
    protected async onPick(instanceId: string, toToken: string): Promise<void> {
        if (this.busy()) return;
        this.busy.set(instanceId); this.note.set(null);
        const r = await this.rt.seatPlayer(instanceId, toToken);
        this.busy.set(null);
        if (!r.ok) { this.note.set(`Not applied — ${r.reason ?? 'denied'}.`); return; }
        // ORDER-13 — the ledger line is the SERVER's (recorded in the `seat` handler, fanned back in `seats.ledger`); the client
        // writes none. The campaign-LOG notice stays the writer device's (a read-only owner persists nothing).
        if (this.store.readOnly()) return;
        const u = this.units().find((x) => x.instanceId === instanceId);
        this.state.logNotice(r.now ? `GM seated ${r.now} on ${u ? `${u.chassis} ${u.model}`.trim() : instanceId}` : `GM cleared the seat on ${u ? `${u.chassis} ${u.model}`.trim() : instanceId}${r.was ? ` (was ${r.was})` : ''}`, null, 'admin');
        void this.store.persistCurrent();
    }
}
