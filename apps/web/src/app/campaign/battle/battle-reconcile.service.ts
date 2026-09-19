import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { neutralizeHeat } from './battle-damage';
import type { CBTSerializedState } from '../../models/force-serialization';

/** PD3 P1 — what the reconcile did. `ok` = the host ANSWERED the sync (a clean "nobody damaged" is ok with applied 0);
 *  a timeout / no socket / exception is `ok:false` with the reason — LOUD at the call sites, never a silent 0. */
export interface ReconcileResult {
    applied: number;          // instances whose damage envelope was written from the host battle_state
    ok: boolean;
    reason?: 'no-campaign' | 'no-socket' | 'timeout' | 'error';
    applications?: string[];  // the instanceIds written (the harness witness + the modal line)
}

@Injectable({ providedIn: 'root' })
export class BattleReconcileService {
    private readonly rt = inject(ClaimRealtimeService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);

    /** Reconcile host battle_state -> inst.damage for the ACTIVE engagement (called BEFORE resolveBranch
     *  flips the branch to RESOLVED — so the key still matches what the players published under).
     *  Returns the ReconcileResult. Never throws (resolve must not be blocked). */
    async reconcileAtResolve(): Promise<ReconcileResult> {
        try {
            const campaignId = this.store.campaignId();
            if (!campaignId) return { applied: 0, ok: false, reason: 'no-campaign' };
            const engagementKey = engagementKeyOf(this.state.missionTree());
            const sync = await this.rt.syncBattleStatesTimed(campaignId, engagementKey);
            const states = sync.states;
            const ids = Object.keys(states || {});
            // PD3 P1 — a sync that never answered is a FAILURE even when a last-known map is lying around: the caller
            // must not mistake stale state for "the host said so". A connected, answered, EMPTY map is a clean zero.
            if (!sync.connected) return { applied: 0, ok: false, reason: 'no-socket' };
            if (sync.timedOut) return { applied: 0, ok: false, reason: 'timeout' };
            if (!ids.length) return { applied: 0, ok: true, applications: [] };
            const blufor = this.state.startingForce() ?? [];
            const opfor = this.state.missionSpec()?.opforForce ?? [];
            const applications: string[] = [];
            for (const id of ids) {
                const inst = blufor.find((u) => u.instanceId === id) ?? opfor.find((u) => u.instanceId === id);
                const raw = states[id]?.state as CBTSerializedState | undefined;
                if (!inst || !raw) continue;
                inst.damage = neutralizeHeat(raw);
                applications.push(id);
            }
            if (applications.length) await this.store.persistCurrent(); // the GM is the snapshot authority
            return { applied: applications.length, ok: true, applications };
        } catch {
            return { applied: 0, ok: false, reason: 'error' }; // best-effort — a reconcile failure must never block the GM from resolving; it is REPORTED, not swallowed
        }
    }
}
