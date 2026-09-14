/*
 * ODM-18 P1 (ruling 5 — extraction is LAW, duplicated guards drift): the ONE reassign-pilot mutation both
 * the ODM roster UI and the intent adapter call. Bundles assign + the ODM-15 trade-stamp + persist
 * ATOMICALLY (the recon's catch: PilotService.assign alone neither stamps nor persists — an apply that
 * called it bare would silently drop both). The stamp FOLLOWS the assignment (a record of what they crew,
 * not a career history); unassignment leaves the stamp — last crewed (the ODM-15 A5 rule, verbatim).
 * Render machinery (sheet re-drive) stays with the roster component — it is view concern, and the roster's
 * own pilots() effect re-drives when mounted.
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from '../barracks/pilot.service';
import type { Pilot } from '../barracks/pilot-generator';
import type { ProtoInstance } from '../force/force-generator';
import { DataService } from '../../services/data.service';
import { TRADE_NOUN, tradeForInstance, type OdmTrade } from './odm-trades';

/** The crew member as they are addressed on every surface — `Mara Voss "Ghost"`. ODM-25 lifted this out of
 *  the roster component so the pull-down, the pilot overlay and the warnings all say the same name. */
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
            /* ODM-25 ruling 3 — CROSS-TRADE IS A BLOCK, and the block lives HERE, not only in the pruned
               option list. A guard that exists only in the markup is decoration (the standing harness law):
               the pull-down is one caller, the pilot overlay is a second, and the player INTENT ADAPTER is a
               third that never sees a list at all. A refusal is announced, never silent — a blocked action
               with no witness is the same failure class as a wrong value with no witness. */
            if (!this.tradeAllows(pilot.trade, this.tradeOfInstance(inst))) {
                console.warn(`[ODM-25] posting REFUSED — ${crewName(pilot)} is a ${pilot.trade}; ${machineLabel(inst)} is crewed by a different trade. Vehicles are crewed, 'Mechs are piloted, fighters are flown: retraining is a decision (ODM-16), not a side effect of needing a driver today.`);
                return false;
            }
            this.pilotService.assign(pilotId, instanceId);
            /* ── DIRECTIVE-ODM-25 — TRADE IS IDENTITY, NOT CURRENT POSTING. **ODM-15 A5 IS SUPERSEDED.**
               This used to re-stamp the pilot's trade to match the machine they were assigned to, so a
               MechWarrior put in a tank silently BECAME a vehicle crew. That does not forbid a cross-trade
               assignment, it LAUNDERS one — the mismatch was erased in the very act of creating it.

               A5's reasoning was "ODM does not model retraining." Retraining is now ordered, and under that
               model converting a MechWarrior into a vehicle crew because you needed a driver today is
               exactly the flattening ODM-15 exists to prevent: this fork is people-first, and a person's
               profession is not overwritten by what they climbed into this morning. A cross-trade assignment
               is now a VISIBLE MISMATCH — permitted, annotated, never laundered.

               FORWARD-ONLY, NO BACK-FILL: trades already re-stamped by past assignments are unrecoverable,
               so current values stand as the baseline. A guessed original is worse than an honest current
               value (the standing rule), and this matches ODM-15's own forward-only migration.

               ODM-16 will key hull specialization off NEW primaryHull/secondaryHull fields, not off trade —
               different granularities (trade is Mek/Tank/Aero; hull spec is per-chassis). Do not overload
               this field to serve it. ── */

            /* THE REFINEMENT (PM, 2026-08-31) — IDENTITY MEANS NEVER OVERWRITE AN EXISTING TRADE. It does
               NOT mean never STAMP AN ABSENT one. ODM-15 A4's bench ("Unassigned — awaiting posting") carries
               NO trade, so a first posting is the moment a career begins and MUST stamp; every posting after
               that leaves it alone. This is the one place the old re-stamp behaviour was correct, and it has
               to survive its removal — deleting it wholesale would leave the bench permanently untraded and
               invisible to the trade filter that now prunes the crew list. */
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

    // ── ODM-25 — the shared crew-control vocabulary. Three surfaces now change a posting (the roster
    //    pull-down, the roster's stand-down button, the pilot overlay's posting row) and ODM-18 ruling 5
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

    /** ODM-25 ruling 3 — CROSS-TRADE IS A BLOCK. Vehicles are crewed, 'Mechs are piloted, fighters are
     *  flown: a different profession, not a penalty band. (Cross-HULL *within* a trade — Phoenix Hawk →
     *  Ostscout — is ODM-16's penalty and is NOT filtered here.)
     *
     *  Two deliberate openings, both of which exist to avoid a SILENT LOCKOUT (the C-ter composition
     *  failure: a filter keyed on a field another ruling stopped writing bricked the whole bench):
     *    · an UNTRADED pilot passes every filter — their first posting is what begins the career, and the
     *      stamp-if-absent path in reassign() is what writes it.
     *    · a hull we cannot classify (`tradeOfInstance` → null) accepts anyone. An unclassifiable machine
     *      must read as "we don't know", never as "nobody may crew this", which is indistinguishable from
     *      a broken control. */
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

    /** ODM-25 — the PILOT OVERLAY's posting list: which machines may this person crew, each annotated with
     *  who is in it now. The mirror image of the roster's crew list, same trade rule, same annotation
     *  discipline — the screen that DISPLAYS a posting can now change it. */
    postingOptions(pilotId: string): { id: string; label: string }[] {
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        if (!p) return [];
        const crewBy = new Map<string, Pilot>();
        for (const q of this.state.pilots() ?? []) if (q.assignedInstanceId) crewBy.set(q.assignedInstanceId, q);
        return (this.state.startingForce() ?? [])
            // ODM-25b — THE SEAT THEY ARE IN IS ALWAYS LISTED, trade or no trade. A corrected trade can
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

    // ── ODM-25b — THE TRADE EDITOR. The gap ruling 3 opened, and PM's own composition error: identity is
    //    forward-only, so a pilot the old A5 re-stamp already converted is now permanently barred from
    //    their real profession — and nothing in the app could edit the field. A correction that requires a
    //    console is a MISSING FEATURE, not a missing bypass (process law C-6), and the answer is a control
    //    that goes through the real services, never a hole beside them. Built ahead of everything else
    //    because James is stamping CANON: a mis-traded pilot in the baseline is inherited by every cycle
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

    /** Apply the correction. Refuses a no-op and the dead; logs every change like any other reconciliation
     *  (the ODM-15b / quartermaster precedent) so a canon baseline can be audited afterwards rather than
     *  taken on trust. Returns false when nothing applied. */
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

    /** ODM-25 ruling 4 — the PRIMARY HULL marker. `primaryHull` is the CHASSIS, never the instance: an
     *  instanceId dies with the machine, and familiarity is with the hull, not with a serial number. It is
     *  a SEPARATE field from ODM-15b's `pilotPrimary` (which answers the stables/mint question) — one field
     *  answering two questions is the bay bug. One primary per pilot: setting REPLACES, never adds. No
     *  mechanic reads it yet; ODM-16 is where it earns a number.
     *
     *  THE GUARD LIVES HERE, not in the template's `disabled`: a pilot with no posting has no hull to call
     *  primary, and a forced click must do nothing. Returns false when refused. */
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
