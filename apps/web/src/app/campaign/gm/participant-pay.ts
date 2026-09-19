import { resolved, GM_SELF_KEY, type ChaosContract } from '../chaos/chaos-contract';
import { combatPayFor, salvageFractionFor } from '../chaos/chaos-sp-costs';
import type { OutcomeGate } from '../mission/mission-tree';

export interface ParticipantPay { combatPay: number; salvageSp: number; basePaySp: number; transportSp?: number; repDelta?: number }
export interface ParticipantPayOpts { settleSigning?: boolean; completed?: boolean }

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
