/*
 * GM-2 P2a — PER-PARTICIPANT PAY at resolve. A joined company that signed its OWN contract (the GM-brokered participant
 * contract) is paid by ITS terms; the figure rides the results slip under its home campaign id and P1's Apply lands it.
 * Pure — no Angular, no DI — pinned by participant-pay.spec.ts, which also pins EQUALITY with the primary's path.
 *
 * The formulas are the PRIMARY's, verbatim (mission-tree.service resolveBranch, D-109 / D-110b):
 *   · combat pay = the outcome tier's SP × the contract's Scale (chaos-sp-costs combatPayFor);
 *   · salvage = the D-110b ESTIMATE: the OpFor BV faced less a claimed prize, × the tier's salvage fraction × the sell
 *     economy (÷2) × the contract's negotiated Salvage %; 'None' / 'Exchange' → 0, as the primary posts nothing.
 * DECISION (GM-2 P2a): the GM-entered salvage override in the resolve dialog is the GM's OWN contract's number and never
 * applies here — a participant's salvage is always the estimate under its own %. Base Pay (the monthly tick) and Command
 * Rights (the D-110e complication roll at Generate, track-level) have no resolve-time settlement for the primary either,
 * so none is invented for a participant — see FOLLOWUPS §GM-2 P2a.
 */
import { resolved, GM_SELF_KEY, type ChaosContract } from '../chaos/chaos-contract';
import { combatPayFor, salvageFractionFor } from '../chaos/chaos-sp-costs';
import type { OutcomeGate } from '../mission/mission-tree';

export interface ParticipantPay { combatPay: number; salvageSp: number; basePaySp: number; transportSp?: number; repDelta?: number }
export interface ParticipantPayOpts { settleSigning?: boolean; completed?: boolean }

/** ONE contract's pay for a resolved track. GM-2 P2b: + ONE month of the contract's own Base Pay per track (S22 — the
 *  monthly-tick formula, 500 × scale × basePay%); when `settleSigning` (the first slip after signing) the net transport
 *  (debited at home, S23) and −repSpent; when `completed` (the primary's last track) the Rep +1 the primary earns. */
export function participantPay(c: ChaosContract, tier: OutcomeGate, opforBv: number, claimedPrizeBv = 0, opts: ParticipantPayOpts = {}): ParticipantPay {
    const combatPay = combatPayFor(tier, c.scale);
    const terms = resolved(c.steps);
    const salv = terms.salvage;
    const pct = typeof salv === 'number' ? salv : 0;
    const frac = salvageFractionFor(tier);
    const base = Math.max(0, (opforBv ?? 0) - (claimedPrizeBv ?? 0));
    const salvageSp = frac > 0 && pct > 0 ? Math.round((base * frac * 0.5 * pct) / 100) : 0;
    const basePaySp = Math.round((500 * c.scale * (terms.basePay ?? 0)) / 100);
    const transportSp = opts.settleSigning ? Math.max(0, Math.round(c.transportSp ?? 0)) : 0;
    const repDelta = (opts.settleSigning ? -Math.max(0, Math.round(c.repSpent ?? 0)) : 0) + (opts.completed ? 1 : 0);
    return { combatPay, salvageSp, basePaySp, ...(transportSp ? { transportSp } : {}), ...(repDelta ? { repDelta } : {}) };
}

/** The slip's per-player pay: one entry per company on the slip that signed its OWN contract; a company without one is
 *  ABSENT (it takes the team share — P1's behaviour); no signed company at all → undefined (the key never appears, so an
 *  empty map yields the P1 slip byte-for-byte). */
export function slipPayFor(map: Record<string, ChaosContract>, companies: Iterable<string>, tier: OutcomeGate, opforBv: number, claimedPrizeBv = 0, completed = false): Record<string, ParticipantPay> | undefined {
    const out: Record<string, ParticipantPay> = {};
    const onTrack = new Set(companies);
    for (const key of onTrack) { if (key === GM_SELF_KEY) continue; const c = map[key]; if (c) out[key] = participantPay(c, tier, opforBv, claimedPrizeBv, { settleSigning: !c.repSettled, completed }); }
    // GM-3 P1 (closes S27) — at COMPLETION every signed participant gets the +1, whether or not it fielded on the last track: a
    // signed company with no rows on this slip gets a completion-only entry (no track pay — it did not fight it; the signing
    // settlement if still owed; the +1). The GM's own entry (GM_SELF_KEY) is paid on the GM device, never on the slip.
    if (completed) for (const key of Object.keys(map)) {
        if (key === GM_SELF_KEY || onTrack.has(key)) continue;
        const c = map[key];
        const transportSp = !c.repSettled ? Math.max(0, Math.round(c.transportSp ?? 0)) : 0;
        const repDelta = (!c.repSettled ? -Math.max(0, Math.round(c.repSpent ?? 0)) : 0) + 1;
        out[key] = { combatPay: 0, salvageSp: 0, basePaySp: 0, ...(transportSp ? { transportSp } : {}), repDelta };
    }
    return Object.keys(out).length ? out : undefined;
}
