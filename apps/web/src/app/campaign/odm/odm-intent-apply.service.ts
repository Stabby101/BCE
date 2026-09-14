/*
 * ODM-18 P1 — the GM-side INTENT APPLY (the GM-1 P3 merge pattern): consume the server-fanned queue and
 * apply each verb THROUGH THE SAME SERVICE METHODS the GM's own UI calls (the thin-adapter law — no
 * parallel logic, the belts live in-service). Every applied intent writes the AUDIT LINE (actor callsign ·
 * verb · subject · date — "Bravo reassigned Beacon → Manticore"); honesty is symmetric, players see the
 * log too. donor-strip-request is TWO-KEY (ruling 3): it queues a pending row for the GM panel; approve
 * executes (label resolved BEFORE the destructive call), decline writes the honest audit line — both fan.
 * Dashboard-lifetime, ODM-gated; persistCurrent no-ops unless this device owns the loaded campaign.
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService, type OdmIntent } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { OdmRepairBaysService } from './odm-repair-bays.service';
import { OdmReassignService } from './odm-reassign.service';
import { canDeploy } from '../force/deployed';

export interface PendingStrip { token: string; name: string; instanceId: string; label: string; at: number }

@Injectable({ providedIn: 'root' })
export class OdmIntentApplyService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly bays = inject(OdmRepairBaysService);
    private readonly crew = inject(OdmReassignService);

    /** The two-key queue: donor-strip requests awaiting the GM's approve/decline (session-ephemeral —
     *  a lost request is re-raised by the player; the audit line records every decision). */
    readonly pendingStrips = signal<PendingStrip[]>([]);

    constructor() {
        // The GM device must be IN the room from console-open (the force-import ensure pattern): the intent
        // fan reaches only joined sockets — without this, a GM parked on the ODM dashboard (never opening
        // GM/Lobby/Claims) leaves gmSocks empty and every player action bounces "the GM is not connected"
        // while the table is visibly up. packId() is read first so the effect tracks it (the untracked-guard
        // class); ODM-gated, not gmSession-gated — the ODM console's GM is the owner device.
        effect(() => {
            if (this.state.packId() !== 'odm') return;
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) this.rt.ensure(id, key);
        });
        effect(() => {
            if (!this.rt.odmIntents().length) return;
            if (this.state.packId() !== 'odm') return; // the fork gate — the belt behind the server's own check
            const it = this.rt.consumeOdmIntent();
            if (!it) return;
            this.apply(it);
        });
    }

    private label(instanceId: string): string {
        const u = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
        return u ? `${u.chassis} ${u.model}`.trim() : instanceId;
    }
    private pilotName(pilotId: string): string {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        return p ? (p.callsign || p.name) : pilotId;
    }
    private audit(text: string): void {
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
        const log = this.state.campaignLog() ?? [];
        this.state.setCampaignLog([...log, { date: today, text, kind: 'admin' as const }]);
    }

    private apply(it: OdmIntent): void {
        const p = it.payload;
        const who = it.name || 'Player';
        switch (it.verb) {
            case 'reassign-pilot': {
                const instanceId = String(p['instanceId']);
                const pilotId = String(p['pilotId'] ?? '');
                const label = this.label(instanceId); // resolve BEFORE (the crew move rewires links)
                if (this.crew.reassign(instanceId, pilotId)) {
                    this.audit(pilotId ? `${who} reassigned ${this.pilotName(pilotId)} → ${label}` : `${who} stood the crew down from ${label}`);
                } else if (pilotId) {
                    // ODM-25 — a REFUSED posting still leaves a line. The service now blocks cross-trade
                    // (ruling 3), and a player action that silently does nothing is indistinguishable from a
                    // broken button — the exact silent class this fork keeps paying for.
                    this.audit(`${who} tried to post ${this.pilotName(pilotId)} → ${label} — REFUSED (wrong trade, or the machine is gone)`);
                }
                break;
            }
            case 'set-deploy': {
                const instanceId = String(p['instanceId']);
                const deployed = p['deployed'] === true;
                const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
                if (!inst || !canDeploy(inst.condition)) break; // the SINGLE-SOURCED gate (ruling 5) — In repair/Cold storage never deploy
                const next = deployed ? 'Deployed' : 'Active';
                if (inst.condition === next) break;
                this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => (i.instanceId === instanceId ? { ...i, condition: next } : i)));
                this.audit(`${who} ${deployed ? 'deployed' : 'stood down'} ${this.label(instanceId)}`);
                break;
            }
            // Every bays arm gates its audit on the service's OWN belts (panel finding: an unconditional
            // line records an action that never happened — e.g. two consoles racing one free bay, or a
            // bench count the depot can't cover). A refused apply writes NOTHING: the log records only
            // what happened; the fan re-renders the truth on every console.
            case 'bay-assign': {
                const label = this.label(String(p['instanceId']));
                if (this.bays.assign(String(p['instanceId']), String(p['bayId']))) this.audit(`${who} assigned ${label} to ${String(p['bayId'])}`);
                break;
            }
            case 'bay-unassign':
                if (this.bays.unassign(String(p['bayId']))) this.audit(`${who} cleared ${String(p['bayId'])}`);
                break;
            case 'bay-priority':
                if (this.bays.setJobPriority(String(p['bayId']), p['p'] as 1 | 2 | 3 | 4)) this.audit(`${who} set ${String(p['bayId'])} priority ${String(p['p'])}`);
                break;
            case 'bay-type':
                if (this.bays.setBayType(String(p['bayId']), p['type'] as 'GENERAL' | 'SALVAGE')) this.audit(`${who} converted ${String(p['bayId'])} → ${String(p['type'])}`);
                break;
            case 'bench-assess': {
                const oc = p['outcome'] as { a: number; b: number; c: number };
                if (this.bays.benchAssess(String(p['label']), { a: oc.a | 0, b: oc.b | 0, c: oc.c | 0 })) this.audit(`${who} bench-assessed ${String(p['label'])} (A${oc.a | 0}/B${oc.b | 0}/C${oc.c | 0})`);
                break;
            }
            case 'bench-inspect':
                if (this.bays.benchInspect(String(p['label']), (p['n'] as number) | 0)) this.audit(`${who} bench-inspected ${String(p['label'])} ×${(p['n'] as number) | 0}`);
                break;
            case 'bench-repair':
                if (this.bays.benchRepair(String(p['label']), (p['n'] as number) | 0)) this.audit(`${who} bench-repaired ${String(p['label'])} ×${(p['n'] as number) | 0}`);
                break;
            case 'bench-ammo-clear':
                if (this.bays.benchAmmoClear(String(p['bin']))) this.audit(`${who} raised a bench clearance on the ${String(p['bin'])} quarantine`);
                break;
            case 'donor-strip-request': {
                // TWO-KEY (ruling 3): queue only — no state change until the GM approves on the panel.
                const instanceId = String(p['instanceId']);
                if (this.pendingStrips().some((s) => s.instanceId === instanceId)) break; // one pending ask per hulk
                this.pendingStrips.update((q) => [...q, { token: it.token, name: who, instanceId, label: this.label(instanceId), at: Date.now() }]);
                this.audit(`${who} requested a donor strip on ${this.label(instanceId)} — awaiting the GM`);
                break;
            }
            default:
                return; // the server allowlist makes this unreachable; nothing applied, nothing logged
        }
        void this.store.persistCurrent(); // the fan is the players' convergence + the audit's delivery
    }

    /** The GM's approve half of the two-key strip. Label resolved BEFORE the destructive call (the panel
     *  law). The audit GATES on donorStrip's own belts (panel finding: the hulk can have left Cold storage
     *  — e.g. assigned to a SALVAGE bay as a prize refit — or the last SALVAGE bay converted between the
     *  request and the click; an unconditional "broken for parts" would be a permanent fanned lie). A
     *  refused approve still consumes the stale request and says honestly why nothing happened. */
    approveStrip(instanceId: string): void {
        const row = this.pendingStrips().find((s) => s.instanceId === instanceId);
        if (!row) return;
        this.pendingStrips.update((q) => q.filter((s) => s.instanceId !== instanceId));
        if (this.bays.donorStrip(instanceId)) {
            this.audit(`GM approved ${row.name}'s donor strip — ${row.label} broken for parts`);
        } else {
            this.audit(`GM approved ${row.name}'s donor strip on ${row.label}, but it could not execute — the hulk is no longer in cold storage or no salvage bay stands; request cleared`);
        }
        void this.store.persistCurrent();
    }
    declineStrip(instanceId: string): void {
        const row = this.pendingStrips().find((s) => s.instanceId === instanceId);
        if (!row) return;
        this.pendingStrips.update((q) => q.filter((s) => s.instanceId !== instanceId));
        this.audit(`GM declined ${row.name}'s donor strip on ${row.label}`); // the honest ack — the log fans to the player
        void this.store.persistCurrent();
    }
}
