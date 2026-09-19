import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { TableModeService } from '../gm/table-mode.service';
import { sideLabelsOf } from '../gm/side-labels';
import { CampaignSaveStore } from '../campaign-save-store';
import { deployedSet } from '../force/deployed';
import type { ProtoInstance } from '../force/force-generator';
import { ClaimRealtimeService } from './claim-realtime.service';
import { engagementKeyOf, engagementFrozen } from './engagement-key';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
import { OpforBuilderComponent } from './opfor-builder';

@Component({
    selector: 'bce-claims-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent, OpforBuilderComponent],
    templateUrl: './claims-panel.html',
    styleUrl: './claims-panel.scss',
})
export class ClaimsPanelComponent {
    private readonly state = inject(NewCampaignState);
    protected readonly table = inject(TableModeService);
    private readonly store = inject(CampaignSaveStore);
    protected readonly rt = inject(ClaimRealtimeService);

    protected readonly deployed = computed(() => deployedSet(this.state.startingForce()));
    protected readonly opfor = computed<ProtoInstance[]>(() => this.state.missionSpec()?.opforForce ?? []);

    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly missionSpec = this.state.missionSpec; // the entry button greys out until a track is generated
    /** The OpFor faction the mission was generated for, for the builder's default gate. NB: MissionForge does not
     *  persist the per-track opforFaction, so we reconstruct from the accepted (synthetic) offer's target — which is
     *  exactly what generateOpFor received (mission-generator:179 `opforFaction = seed?.opforFaction ?? ac.target`) —
     *  falling back to the active chaos contract's enemyFaction. Advisory anyway (the off-list toggle overrides). */
    protected readonly opforFaction = computed(() =>
        this.state.offerFor()?.target ?? this.state.contractFor()?.enemyFaction ?? '');
    protected readonly playerBv = computed(() => this.state.missionSpec()?.playerBv ?? 0);
    protected readonly builderOpen = signal(false);
    protected openBuilder(): void { if (this.isHotspots() && this.state.missionSpec()) this.builderOpen.set(true); }
    protected closeBuilder(): void { this.builderOpen.set(false); }
    protected saveOpFor(rebuilt: ProtoInstance[]): void {
        const spec = this.state.missionSpec();
        if (!spec) return;
        const opforForce = rebuilt;
        const opforBv = opforForce.reduce((a, b) => a + (b.bv ?? 0), 0);
        this.state.setMissionSpec({ ...spec, opforForce, opforBv, opforManual: true });
        void this.store.persistCurrent();
        this.builderOpen.set(false);
    }
    // every side gate stay BLUFOR/OPFOR — null falls back to today's labels byte-identically).
    private readonly sideNames = computed(() => sideLabelsOf(this.state));
    protected readonly sides = computed(() => [
        { key: 'blufor', label: this.sideNames() ? `SIDE A — ${this.sideNames()!.a}` : 'BLUFOR', sub: this.sideNames() ? 'side A' : 'deployed company', units: this.deployed() },
        { key: 'opfor', label: this.sideNames() ? `SIDE B — ${this.sideNames()!.b}` : 'OPFOR', sub: this.sideNames() ? 'side B' : 'mission OpFor', units: this.opfor() },
    ]);
    protected readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    protected readonly frozen = computed(() => engagementFrozen(this.state.missionTree()));
    protected readonly online = this.store.online;
    protected readonly connected = this.rt.connected;
    protected readonly lobby = this.rt.lobby;

    protected readonly connectedCount = computed(() => this.lobby().filter((p) => p.connected).length);
    protected readonly bluforCount = computed(() => this.lobby().filter((p) => p.side === 'BLUFOR').length);
    protected readonly opforCount = computed(() => this.lobby().filter((p) => p.side === 'OPFOR').length);
    // Players who joined but hold NO claim — the slim spectator list under the board (reassign / kick survive).
    protected readonly unclaimedPlayers = computed(() => {
        const held = new Set(Object.values(this.rt.claims()).map((c) => c.holderToken));
        return this.lobby().filter((p) => !held.has(p.token));
    });

    constructor() {
        // (re)join the room + OBSERVE the lobby whenever the campaign/engagement changes (idempotent with the
        // lobby panel — same socket, same room). observeLobby brings in the roster/presence fan.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.observeLobby(); }
        });
    }

    protected label(i: { chassis: string; model: string; tons: number }): string {
        return `${i.chassis} ${i.model}`.trim() + ` · ${i.tons}t`;
    }
    protected holder(instanceId: string): string | null {
        return this.rt.claims()[instanceId]?.holderName || null;
    }
    /** Presence of a claimed unit's holder: true = connected (green), false = claim held but device gone (red),
     *  null = unclaimed (no dot). */
    protected presence(instanceId: string): boolean | null {
        const token = this.rt.claims()[instanceId]?.holderToken;
        if (!token) return null;
        return this.lobby().find((p) => p.token === token)?.connected ?? false;
    }
    /** REBASE-1 P3 item 1b — the un-ended-pick count of a claimed unit's holder (the pin fans damage only at END PHASE,
     *  so this is the GM's "who still has unshared damage before Resolve" signal). 0 = nothing pending / no dot. */
    protected pendingFor(instanceId: string): number {
        const token = this.rt.claims()[instanceId]?.holderToken;
        if (!token) return 0;
        return this.lobby().find((p) => p.token === token)?.pendingPhase ?? 0;
    }
    /** REBASE-1 P3 item 1b — how many JOINED participants still have un-ended picks (the header/Resolve warning). */
    protected readonly pendingPlayers = computed(() => this.lobby().filter((p) => (p.pendingPhase ?? 0) > 0).length);
    /** Kick a claimed unit's holder: release the unit back to UNCLAIMED + remove the player (one confirm). */
    protected kickClaim(instanceId: string): void {
        const c = this.rt.claims()[instanceId];
        if (!c?.holderToken) return;
        if (!confirm(`Kick ${c.holderName || 'this player'}? Their unit returns to unclaimed.`)) return;
        this.rt.release(instanceId);
        this.rt.kick(c.holderToken);
    }
    protected reassign(token: string, side: string): void { this.rt.reassign(token, side); }
    protected kick(token: string): void { this.rt.kick(token); }
}
