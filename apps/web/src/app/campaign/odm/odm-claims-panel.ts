/*
 * FORKED FROM campaign/claims/claims-panel.ts @ 1ab399b — DIRECTIVE-ODM-9 Part C (a DRIFT SURFACE).
 * Divergences: the OPFOR empty-state copy (Classic's advice is wrong in ODM) + the D-130 builder member
 * block stripped (ODM-9 removed its button/modal; ODM-10 removed the orphaned members incl. saveOpFor).
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { deployedSet } from '../force/deployed';
import type { ProtoInstance } from '../force/force-generator';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf, engagementFrozen } from '../claims/engagement-key';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
// ODM-9 FORK: the D-130 OpFor builder STRIPPED (HS-only at runtime AND engine-hs-scoped — the fence caught the inherited import; ODM's OpFor is the authored ODM-7 roll)

@Component({
    selector: 'bce-odm-claims-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent],
    templateUrl: './odm-claims-panel.html',
    styleUrl: '../claims/claims-panel.scss' /* SHARED */,
})
export class OdmClaimsPanelComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    protected readonly rt = inject(ClaimRealtimeService);

    protected readonly deployed = computed(() => deployedSet(this.state.startingForce()));
    protected readonly opfor = computed<ProtoInstance[]>(() => this.state.missionSpec()?.opforForce ?? []);

    // ODM-10 FORK STRIP: the whole D-130 builder member block (isHotspots/missionSpec alias/opforFaction/
    // playerBv/builderOpen/openBuilder/closeBuilder/saveOpFor) removed — ODM-9 stripped the button + modal
    // that called it, leaving saveOpFor() an orphaned opforForce writer (the ODM-9b Part 2 residue class).
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
