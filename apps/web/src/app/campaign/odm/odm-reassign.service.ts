import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from '../barracks/pilot.service';
import type { Pilot } from '../barracks/pilot-generator';
import type { ProtoInstance } from '../force/force-generator';
import { DataService } from '../../services/data.service';
import { TRADE_NOUN, tradeForInstance, type OdmTrade } from './odm-trades';

export function crewName(p: Pick<Pilot, 'name' | 'callsign'>): string {
    return p.callsign ? `${p.name} "${p.callsign}"` : p.name;
}

/** The machine as it is named on every surface — `Phoenix Hawk PXH-1`. */
export function machineLabel(i: Pick<ProtoInstance, 'chassis' | 'model'> | undefined): string {
    return i ? `${i.chassis} ${i.model}`.trim() : '';
}

@Injectable({ providedIn: 'root' })
export class OdmReassignService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
    private readonly data = inject(DataService);

    /** Reassign a machine's crew (pilotId '' = unassign the current crew). Returns false when nothing
     *  applied (unknown pilot/instance, KIA — PilotService.assign's own guards hold). */
    reassign(instanceId: string, pilotId: string): boolean {
        if (pilotId) {
            const pilot = (this.state.pilots() ?? []).find((p) => p.pilotId === pilotId);
            if (!pilot || pilot.status === 'KIA') return false; // assign() would no-op on KIA; refuse loudly here
            // Resolve the instance BEFORE mutating (panel finding): PilotService.assign never validates
            // instanceId, so validating after it would leave a persisted GHOST assignment (pilot crewing a
            // written-off/nonexistent id, their real machine pilotless) behind a false return.
            const inst = (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
            if (!inst) return false;
            if (!this.tradeAllows(pilot.trade, this.tradeOfInstance(inst))) {
                console.warn(`[] posting REFUSED — ${crewName(pilot)} is a ${pilot.trade}; ${machineLabel(inst)} is crewed by a different trade. Vehicles are crewed, 'Mechs are piloted, fighters are flown: retraining is a decision not a side effect of needing a driver today.`);
                return false;
            }
            this.pilotService.assign(pilotId, instanceId);

            if (!pilot.trade) {
                const trade = tradeForInstance(inst, this.data.getUnitByName(inst.unitRef)?.type ?? null);
                if (trade) {
                    this.state.setPilots((this.state.pilots() ?? []).map((p) => (p.pilotId === pilotId ? { ...p, trade } : p)));
                }
            }

        } else {
            const current = (this.state.pilots() ?? []).find((p) => p.assignedInstanceId === instanceId);
            if (!current) return false;
            this.pilotService.assign(current.pilotId, null);
        }
        void this.store.persistCurrent();
        return true;
    }

    //    stands: ONE operation, ONE set of words, ONE guard. What a component owns is the `confirm()` call;
    //    the SENTENCE and the option list are derived here so they cannot drift apart. ──

    /** The instance, or undefined. */
    private instance(instanceId: string | null | undefined): ProtoInstance | undefined {
        if (!instanceId) return undefined;
        return (this.state.startingForce() ?? []).find((i) => i.instanceId === instanceId);
    }

    /** The TRADE a machine is crewed by (null = a hull whose type we cannot classify — see tradeFilter). */
    tradeOfInstance(inst: ProtoInstance | undefined): OdmTrade | null {
        if (!inst) return null;
        return tradeForInstance(inst, this.data.getUnitByName(inst.unitRef)?.type ?? null);
    }

    tradeAllows(pilotTrade: string | undefined, machineTrade: OdmTrade | null): boolean {
        if (!pilotTrade) return true;   // untraded bench — the first posting stamps them
        if (!machineTrade) return true; // unclassifiable hull — honest unknown, never a silent lockout
        return pilotTrade === machineTrade;
    }

    /** Would posting `pilotId` here take them off another machine? Returns the exact sentence to show, or
     *  null when nothing is displaced. The seat they leave EMPTIES — stated before it happens, because a
     *  machine quietly losing its crew is discovered at deploy, which is far too late. */
    displacementWarning(pilotId: string, instanceId: string): string | null {
        if (!pilotId) return null;
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        const from = p?.assignedInstanceId;
        if (!p || !from || from === instanceId) return null;
        const m = machineLabel(this.instance(from));
        return `This moves ${crewName(p)} off ${m}.\n\n${m} will then have NO CREW and cannot deploy until you crew it again.\n\nContinue?`;
    }

    /** The stand-down sentence (the roster's visible unassign). Null when the machine has no crew. */
    standDownWarning(instanceId: string): string | null {
        const cur = (this.state.pilots() ?? []).find((p) => p.assignedInstanceId === instanceId);
        if (!cur) return null;
        return `Take ${crewName(cur)} off ${machineLabel(this.instance(instanceId))}?\n\nThey return to the spares list. The machine will have NO CREW and cannot deploy until you crew it again.`;
    }

    postingOptions(pilotId: string): { id: string; label: string }[] {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        if (!p) return [];
        const crewBy = new Map<string, Pilot>();
        for (const q of this.state.pilots() ?? []) if (q.assignedInstanceId) crewBy.set(q.assignedInstanceId, q);
        return (this.state.startingForce() ?? [])
            // leave someone sitting in an off-trade hull (permitted, visible, never laundered); filtering
            // their own machine out would leave the control reading "stand down" over a crewed pilot —
            // a display that contradicts the state, which is the whole silent-wrong-value class.
            .filter((i) => i.instanceId === p.assignedInstanceId || this.tradeAllows(p.trade, this.tradeOfInstance(i)))
            .map((i) => {
                const held = crewBy.get(i.instanceId);
                const who = held ? (held.pilotId === pilotId ? 'current posting' : `crewed by ${crewName(held)}`) : 'no crew';
                const t = this.tradeOfInstance(i);
                // The untraded bench, said from the pilot's side: taking this seat is what begins a career.
                const stamp = !p.trade && t ? ` — stamps them a ${TRADE_NOUN[t]}` : '';
                const off = i.instanceId === p.assignedInstanceId && !this.tradeAllows(p.trade, t) ? ' — OFF-TRADE' : '';
                return { id: i.instanceId, label: `${machineLabel(i)} · ${who}${stamp}${off}` };
            });
    }

    //    forward-only, so a pilot the old A5 re-stamp already converted is now permanently barred from
    //    their real profession — and nothing in the app could edit the field. A correction that requires a
    //    console is a MISSING FEATURE, not a missing bypass (process law C-6), and the answer is a control
    //    that goes through the real services, never a hole beside them. Built ahead of everything else
    //    that starts from it. ──

    /** A trade as it is said of one person; the absent case is SAID, never guessed. */
    private tradeWord(t: string | undefined): string {
        return t ? (TRADE_NOUN[t as OdmTrade] ?? t) : 'untraded';
    }

    /** The confirm for a trade correction, or null when it would change nothing. A trade is a person's
     *  profession, so the correction always states itself — including, when it applies, that it leaves
     *  them sitting in a hull their new trade does not crew. That mismatch is PERMITTED and VISIBLE
     *  (ruling 3 blocks the act of POSTING cross-trade; it does not dissolve a seat someone already
     *  holds), and silently standing them down to tidy it would be a destructive surprise. */
    tradeChangeWarning(pilotId: string, trade: string): string | null {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        const next = trade || undefined;
        if (!p || p.status === 'KIA' || (p.trade ?? undefined) === next) return null;
        const seat = this.instance(p.assignedInstanceId);
        const seatTrade = this.tradeOfInstance(seat);
        const mismatch = seat && seatTrade && next && seatTrade !== next
            ? `\n\nThey stay in ${machineLabel(seat)}, which is crewed by a ${TRADE_NOUN[seatTrade]} — a visible mismatch, not a re-posting. Move them yourself if that is wrong.`
            : '';
        return `Correct ${crewName(p)}'s trade: ${this.tradeWord(p.trade)} → ${this.tradeWord(next)}?\n\n`
            + `This is a RECORD CORRECTION, not retraining — it says who they always were. It is written to the campaign log.${mismatch}`;
    }

    setTrade(pilotId: string, trade: string): boolean {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        const next = trade || undefined;
        if (!p || p.status === 'KIA') return false;
        if ((p.trade ?? undefined) === next) return false;
        const seat = this.instance(p.assignedInstanceId);
        const seatTrade = this.tradeOfInstance(seat);
        const note = seat && seatTrade && next && seatTrade !== next
            ? ` · left seated in ${machineLabel(seat)} (a ${TRADE_NOUN[seatTrade]} hull) — mismatch recorded, not corrected by moving them`
            : '';
        this.state.setPilots((this.state.pilots() ?? []).map((x) => (x.pilotId === pilotId ? { ...x, trade: next } : x)));
        this.state.logNotice(`Trade corrected — ${crewName(p)}: ${this.tradeWord(p.trade)} → ${this.tradeWord(next)} (GM record correction)${note}`, null, 'admin');
        void this.store.persistCurrent();
        return true;
    }

    setPrimaryHull(pilotId: string, chassis: string | null): boolean {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        if (!p || p.status === 'KIA') return false;
        if (!p.assignedInstanceId) return false; // unassigned — nothing to mark (the disabled-with-reason case)
        const next = chassis || undefined;
        if ((p.primaryHull ?? undefined) === next) return false;
        this.state.setPilots((this.state.pilots() ?? []).map((x) => (x.pilotId === pilotId ? { ...x, primaryHull: next } : x)));
        void this.store.persistCurrent();
        return true;
    }
}
