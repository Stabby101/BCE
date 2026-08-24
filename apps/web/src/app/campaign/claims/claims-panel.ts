/*
 * BCE ENGINE — the GM CLAIM BOARD (D-042 claims). HOTFIX-030: the board IS the roster. Claiming happens on
 * PLAYER devices only — the GM board has NO claim/release affordance; it just shows, per deployed/OpFor unit,
 * who holds it, whether that device is currently connected (green/red presence dot), and a Kick. Unclaimed
 * units read a muted UNCLAIMED. The header carries the counts (N connected · X BLUFOR · Y OPFOR) that used to
 * live in a separate Joined panel; joined-but-unclaimed players (spectators) render as a slim list under the
 * board. The GM sees BOTH sides (ROLE-002 — players stay side-gated). BCE layer only.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { deployedSet } from '../force/deployed';
import type { ProtoInstance } from '../force/force-generator';
import { ClaimRealtimeService } from './claim-realtime.service';
import { engagementKeyOf, engagementFrozen } from './engagement-key';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
import { OpforBuilderComponent } from './opfor-builder'; // D-130 — GM manual OpFor builder (HS-only)

@Component({
    selector: 'bce-claims-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent, OpforBuilderComponent],
    templateUrl: './claims-panel.html',
    styleUrl: './claims-panel.scss',
})
export class ClaimsPanelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    protected readonly rt = inject(ClaimRealtimeService);

    protected readonly deployed = computed(() => deployedSet(this.state.startingForce()));
    protected readonly opfor = computed<ProtoInstance[]>(() => this.state.missionSpec()?.opforForce ?? []);

    // ── DIRECTIVE-130 — the GM manual OpFor builder (Hot Spots only) ──
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly missionSpec = this.state.missionSpec; // the entry button greys out until a track is generated
    /** The OpFor faction the mission was generated for, for the builder's default gate. NB: MissionForge does not
     *  persist the per-track opforFaction, so we reconstruct from the accepted (synthetic) offer's target — which is
     *  exactly what generateOpFor received (mission-generator:179 `opforFaction = seed?.opforFaction ?? ac.target`) —
     *  falling back to the active chaos contract's enemyFaction. Advisory anyway (the off-list toggle overrides). */
    protected readonly opforFaction = computed(() =>
        this.state.acceptedContract()?.target ?? this.state.activeChaosContract()?.enemyFaction ?? '');
    protected readonly playerBv = computed(() => this.state.missionSpec()?.playerBv ?? 0);
    protected readonly builderOpen = signal(false);
    protected openBuilder(): void { if (this.isHotspots() && this.state.missionSpec()) this.builderOpen.set(true); }
    protected closeBuilder(): void { this.builderOpen.set(false); }
    /** D-130 write-back: replace the current mission's OpFor with the hand-built roster (immutable spec replace) +
     *  recompute opforBv; persist. The Lobby + joined players read missionSpec().opforForce reactively and the
     *  persist→snapshot fan already propagates the spec (D-127/HOTFIX-029) — no extra sync wiring. */
    protected saveOpFor(rebuilt: ProtoInstance[]): void {
        const spec = this.state.missionSpec();
        if (!spec) return;
        const opforForce = rebuilt;
        const opforBv = opforForce.reduce((a, b) => a + (b.bv ?? 0), 0);
        this.state.setMissionSpec({ ...spec, opforForce, opforBv });
        void this.store.persistCurrent();
        this.builderOpen.set(false);
    }
    protected readonly sides = computed(() => [
        { key: 'blufor', label: 'BLUFOR', sub: 'deployed company', units: this.deployed() },
        { key: 'opfor', label: 'OPFOR', sub: 'mission OpFor', units: this.opfor() },
    ]);
    protected readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));
    protected readonly frozen = computed(() => engagementFrozen(this.state.missionTree()));
    protected readonly online = this.store.online;
    protected readonly connected = this.rt.connected;
    protected readonly lobby = this.rt.lobby;

    // HOTFIX-030 — header counts (the removed Joined panel's info now lives on the board header).
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
