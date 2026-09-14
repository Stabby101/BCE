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
 *
 * DIRECTIVE-PD3 P1 (PD3-12) — the reconcile REPORTS. Before P1 it returned a bare count that both call sites
 * discarded, and an exception or the 3 s socket timeout collapsed to a silent 0 — indistinguishable from "nobody
 * took damage" (the plausible-result-no-witness disease). It now returns a ReconcileResult: the applied count AND
 * whether the sync actually answered. Still never throws — the resolve must not be blocked — but a failure is
 * a FAILURE the caller can say out loud (toast + ledger line), never a 0.
 */
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
                inst.damage = neutralizeHeat(raw); // in-place (the D-030 mirror pattern); the walk reads these objects live
                applications.push(id);
            }
            if (applications.length) await this.store.persistCurrent(); // the GM is the snapshot authority
            return { applied: applications.length, ok: true, applications };
        } catch {
            return { applied: 0, ok: false, reason: 'error' }; // best-effort — a reconcile failure must never block the GM from resolving; it is REPORTED, not swallowed
        }
    }
}
