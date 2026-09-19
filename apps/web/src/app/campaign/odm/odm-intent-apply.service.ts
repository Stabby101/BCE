import { Injectable, effect, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService, type OdmIntent } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { OdmRepairBaysService } from './odm-repair-bays.service';
import { OdmReassignService } from './odm-reassign.service';
import { canDeploy } from '../force/deployed';
import { PilotService } from '../barracks/pilot.service';
import { appendLedger, ODM_SEAT_REQUEST_CAP, type OdmLedgerEntry, type OdmSeatRequest } from './odm-ledger';

export interface PendingStrip { token: string; name: string; instanceId: string; label: string; at: number }

@Injectable({ providedIn: 'root' })
export class OdmIntentApplyService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly bays = inject(OdmRepairBaysService);
    private readonly crew = inject(OdmReassignService);
    private readonly pilotsSvc = inject(PilotService);

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
            const readOnly = this.store.readOnly(); // read BEFORE the consume so the effect tracks it
            const it = this.rt.consumeOdmIntent();
            if (!it) return;
            // holder, else the owner); a READ-ONLY GM device that still receives one (an older host, a race across a
            // hand-off) DROPS it — applying here would change a state this device cannot persist, and the next fan
            // would overwrite it anyway. The belt behind the server's own routing.
            if (readOnly) return;
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
    private ledger(it: OdmIntent, e: Pick<OdmLedgerEntry, 'seat' | 'field' | 'was' | 'now' | 'outcome'>): void {
        const entry: OdmLedgerEntry = { ts: Date.now(), actor: it.name || 'Player', actorKey: it.actorKey || 'unknown', seat: e.seat, seatLabel: e.seat ? this.label(e.seat) : null, field: e.field, was: e.was, now: e.now, verb: it.verb, outcome: e.outcome };
        this.state.setOdmLedger(appendLedger(this.state.odmLedger(), entry));
    }
    private crewName(instanceId: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
        return p ? (p.callsign || p.name) : null;
    }
    private bayOf(instanceId: string): string | null {
        return (this.state.bays() ?? []).find((b) => b.occupantId === instanceId)?.id ?? null;
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
                const wasCrew = this.crewName(instanceId);
                if (this.crew.reassign(instanceId, pilotId)) {
                    this.audit(pilotId ? `${who} reassigned ${this.pilotName(pilotId)} → ${label}` : `${who} stood the crew down from ${label}`);
                    this.ledger(it, { seat: instanceId, field: 'crew', was: wasCrew, now: pilotId ? this.pilotName(pilotId) : null, outcome: 'applied' });
                } else if (pilotId) {
                    this.ledger(it, { seat: instanceId, field: 'crew', was: wasCrew, now: this.pilotName(pilotId), outcome: 'refused' });
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
                this.ledger(it, { seat: instanceId, field: 'deployment', was: inst.condition, now: next, outcome: 'applied' });
                break;
            }
            // Every bays arm gates its audit on the service's OWN belts (panel finding: an unconditional
            // line records an action that never happened — e.g. two consoles racing one free bay, or a
            // bench count the depot can't cover). A refused apply writes NOTHING: the log records only
            // what happened; the fan re-renders the truth on every console.
            case 'bay-assign': {
                const label = this.label(String(p['instanceId']));
                const wasBay = this.bayOf(String(p['instanceId']));
                if (this.bays.assign(String(p['instanceId']), String(p['bayId']))) { this.audit(`${who} assigned ${label} to ${String(p['bayId'])}`); this.ledger(it, { seat: String(p['instanceId']), field: 'repair bay', was: wasBay, now: String(p['bayId']), outcome: 'applied' }); }
                break;
            }
            case 'bay-unassign': {
                const occ = (this.state.bays() ?? []).find((b) => b.id === String(p['bayId']))?.occupantId ?? null; // resolve BEFORE the clear
                if (this.bays.unassign(String(p['bayId']))) { this.audit(`${who} cleared ${String(p['bayId'])}`); this.ledger(it, { seat: occ, field: `bay ${String(p['bayId'])}`, was: occ ? this.label(occ) : null, now: null, outcome: 'applied' }); }
                break;
            }
            case 'bay-priority':
                if (this.bays.setJobPriority(String(p['bayId']), p['p'] as 1 | 2 | 3 | 4)) { this.audit(`${who} set ${String(p['bayId'])} priority ${String(p['p'])}`); this.ledger(it, { seat: null, field: `bay ${String(p['bayId'])} priority`, was: null, now: String(p['p']), outcome: 'applied' }); }
                break;
            case 'bay-type':
                if (this.bays.setBayType(String(p['bayId']), p['type'] as 'GENERAL' | 'SALVAGE')) { this.audit(`${who} converted ${String(p['bayId'])} → ${String(p['type'])}`); this.ledger(it, { seat: null, field: `bay ${String(p['bayId'])} type`, was: null, now: String(p['type']), outcome: 'applied' }); }
                break;
            case 'bench-assess': {
                const oc = p['outcome'] as { a: number; b: number; c: number };
                if (this.bays.benchAssess(String(p['label']), { a: oc.a | 0, b: oc.b | 0, c: oc.c | 0 })) { this.audit(`${who} bench-assessed ${String(p['label'])} (A${oc.a | 0}/B${oc.b | 0}/C${oc.c | 0})`); this.ledger(it, { seat: null, field: `bench · ${String(p['label'])}`, was: 'raw', now: `A${oc.a | 0}/B${oc.b | 0}/C${oc.c | 0}`, outcome: 'applied' }); }
                break;
            }
            case 'bench-inspect':
                if (this.bays.benchInspect(String(p['label']), (p['n'] as number) | 0)) { this.audit(`${who} bench-inspected ${String(p['label'])} ×${(p['n'] as number) | 0}`); this.ledger(it, { seat: null, field: `bench · ${String(p['label'])}`, was: null, now: `inspected ×${(p['n'] as number) | 0}`, outcome: 'applied' }); }
                break;
            case 'bench-repair':
                if (this.bays.benchRepair(String(p['label']), (p['n'] as number) | 0)) { this.audit(`${who} bench-repaired ${String(p['label'])} ×${(p['n'] as number) | 0}`); this.ledger(it, { seat: null, field: `bench · ${String(p['label'])}`, was: null, now: `repaired ×${(p['n'] as number) | 0}`, outcome: 'applied' }); }
                break;
            case 'bench-ammo-clear':
                if (this.bays.benchAmmoClear(String(p['bin']))) { this.audit(`${who} raised a bench clearance on the ${String(p['bin'])} quarantine`); this.ledger(it, { seat: null, field: `quarantine · ${String(p['bin'])}`, was: 'quarantined', now: 'clearance raised', outcome: 'applied' }); }
                break;
            case 'donor-strip-request': {
                // TWO-KEY (ruling 3): queue only — no state change until the GM approves on the panel.
                const instanceId = String(p['instanceId']);
                if (this.pendingStrips().some((s) => s.instanceId === instanceId)) break; // one pending ask per hulk
                this.pendingStrips.update((q) => [...q, { token: it.token, name: who, instanceId, label: this.label(instanceId), at: Date.now() }]);
                this.audit(`${who} requested a donor strip on ${this.label(instanceId)} — awaiting the GM`);
                this.ledger(it, { seat: instanceId, field: 'donor strip', was: null, now: 'awaiting the GM', outcome: 'requested' });
                break;
            }
            //    (ws-authz.seatDecision); the seat is the address — the pilot is whoever RIDES it. ──
            case 'rename-pilot': {
                const instanceId = String(p['instanceId']);
                const name = String(p['name'] ?? '').trim();
                const pilot = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId);
                if (!pilot || pilot.status === 'KIA' || !name || name === pilot.name) {
                    this.audit(`${who} tried to rename the pilot of ${this.label(instanceId)} — REFUSED (${!pilot ? 'the seat is empty' : pilot.status === 'KIA' ? 'the fallen keep their names' : 'nothing to change'})`);
                    this.ledger(it, { seat: instanceId, field: 'pilot name', was: pilot?.name ?? null, now: name || null, outcome: 'refused' });
                    break;
                }
                const was = pilot.name;
                this.pilotsSvc.rename(pilot.pilotId, name);
                this.audit(`${who} renamed the pilot of ${this.label(instanceId)}: ${was} → ${name}`);
                this.ledger(it, { seat: instanceId, field: 'pilot name', was, now: name, outcome: 'applied' });
                break;
            }
            case 'seat-note': {
                const instanceId = String(p['instanceId']);
                const text = String(p['text'] ?? '').trim();
                const notes = this.state.odmSeatNotes();
                const was = notes[instanceId] ?? null;
                if ((was ?? '') === text) break; // nothing moved — nothing logged
                const next = { ...notes };
                if (text) next[instanceId] = text; else delete next[instanceId];
                this.state.setOdmSeatNotes(next);
                this.audit(text ? `${who} noted on ${this.label(instanceId)}: "${text}"` : `${who} cleared the note on ${this.label(instanceId)}`);
                this.ledger(it, { seat: instanceId, field: 'note', was, now: text || null, outcome: 'applied' });
                break;
            }
            case 'seat-request': {
                const instanceId = String(p['instanceId']);
                const kind = p['kind'] === 'loadout' ? 'loadout' : 'repair';
                const text = String(p['text'] ?? '').trim();
                const req: OdmSeatRequest = { id: `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, instanceId, seatLabel: this.label(instanceId), kind, text, by: who, byKey: it.actorKey || 'unknown', at: Date.now(), status: 'open' };
                this.state.setOdmSeatRequests([...this.state.odmSeatRequests(), req].slice(-ODM_SEAT_REQUEST_CAP));
                this.audit(`${who} requested a ${kind} on ${this.label(instanceId)}: "${text}" — awaiting the GM`);
                this.ledger(it, { seat: instanceId, field: `${kind} request`, was: null, now: text, outcome: 'requested' });
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
        const gm = (now: string, outcome: OdmLedgerEntry['outcome']): void => this.state.setOdmLedger(appendLedger(this.state.odmLedger(), { ts: Date.now(), actor: 'GM', actorKey: 'gm', seat: instanceId, seatLabel: row.label, field: 'donor strip', was: `requested by ${row.name}`, now, verb: 'donor-strip-approve', outcome }));
        if (this.bays.donorStrip(instanceId)) {
            this.audit(`GM approved ${row.name}'s donor strip — ${row.label} broken for parts`);
            gm('broken for parts', 'applied');
        } else {
            gm('approved — could not execute', 'refused');
            this.audit(`GM approved ${row.name}'s donor strip on ${row.label}, but it could not execute — the hulk is no longer in cold storage or no salvage bay stands; request cleared`);
        }
        void this.store.persistCurrent();
    }
    closeSeatRequest(id: string, status: 'done' | 'declined'): void {
        const row = this.state.odmSeatRequests().find((r) => r.id === id);
        if (!row || row.status !== 'open' || this.store.readOnly()) return;
        this.state.setOdmSeatRequests(this.state.odmSeatRequests().map((r) => (r.id === id ? { ...r, status } : r)));
        this.audit(`GM marked ${row.by}'s ${row.kind} request on ${row.seatLabel} ${status === 'done' ? 'DONE' : 'DECLINED'}`);
        this.state.setOdmLedger(appendLedger(this.state.odmLedger(), { ts: Date.now(), actor: 'GM', actorKey: 'gm', seat: row.instanceId, seatLabel: row.seatLabel, field: `${row.kind} request`, was: 'open', now: status, verb: 'seat-request-close', outcome: 'applied' }));
        void this.store.persistCurrent();
    }
    declineStrip(instanceId: string): void {
        const row = this.pendingStrips().find((s) => s.instanceId === instanceId);
        if (!row) return;
        this.pendingStrips.update((q) => q.filter((s) => s.instanceId !== instanceId));
        this.audit(`GM declined ${row.name}'s donor strip on ${row.label}`); // the honest ack — the log fans to the player
        this.state.setOdmLedger(appendLedger(this.state.odmLedger(), { ts: Date.now(), actor: 'GM', actorKey: 'gm', seat: instanceId, seatLabel: row.label, field: 'donor strip', was: `requested by ${row.name}`, now: 'declined', verb: 'donor-strip-decline', outcome: 'applied' }));
        void this.store.persistCurrent();
    }
}
