/*
 * BCE — battle-state RECONCILE at resolve (DIRECTIVE-048 phase D). The carry-in: player-entered damage
 * lives in the host battle_state table during the engagement and fans to loaded sheets (phase B). But
 * if the GM never opened the MekBay tab, no sheet mirror ran, so the player damage never reached the
 * campaign snapshot (inst.damage) — the record the walk reads. This service pulls the host's current
 * battle_state for the active engagement at RESOLVE and writes it into inst.damage (heat-neutralized,
 * D-030 live-only-heat), ALWAYS — regardless of which tab the GM was on. It then persists (the GM is
 * authoritative, DATA-001). It does NOT touch walk/bays/AAR LOGIC — it only populates their input
 * (inst.damage). Best-effort: offline / no live battle → no-op, resolve proceeds on the local snapshot.
 * GM-only by use (the player surface has no resolve). Campaign-layer; wires around the core via the
 * battle-damage helpers (MERGE-002 one-way).
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { neutralizeHeat } from './battle-damage';
import type { CBTSerializedState } from '../../models/force-serialization';

@Injectable({ providedIn: 'root' })
export class BattleReconcileService {
    private readonly rt = inject(ClaimRealtimeService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);

    /** Reconcile host battle_state -> inst.damage for the ACTIVE engagement (called BEFORE resolveBranch
     *  flips the branch to RESOLVED — so the key still matches what the players published under).
     *  Returns the number of instances updated. Never throws (resolve must not be blocked). */
    async reconcileAtResolve(): Promise<number> {
        try {
            const campaignId = this.store.campaignId();
            if (!campaignId) return 0;
            const engagementKey = engagementKeyOf(this.state.missionTree());
            const states = await this.rt.syncBattleStatesNow(campaignId, engagementKey);
            const ids = Object.keys(states || {});
            if (!ids.length) return 0;
            const blufor = this.state.startingForce() ?? [];
            const opfor = this.state.missionSpec()?.opforForce ?? [];
            let applied = 0;
            for (const id of ids) {
                const inst = blufor.find((u) => u.instanceId === id) ?? opfor.find((u) => u.instanceId === id);
                const raw = states[id]?.state as CBTSerializedState | undefined;
                if (!inst || !raw) continue;
                inst.damage = neutralizeHeat(raw); // in-place (the D-030 mirror pattern); the walk reads these objects live
                applied++;
            }
            if (applied) await this.store.persistCurrent(); // the GM is the snapshot authority
            return applied;
        } catch {
            return 0; // best-effort — a reconcile failure must never block the GM from resolving
        }
    }
}
