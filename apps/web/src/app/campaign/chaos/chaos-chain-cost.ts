/*
 * GM-2 P2b-fix — THE PATH CHECK. The four belts on a phone-signed contract check the rep BUDGET, not the PATH: a modified
 * client could sign terms the D-128 chain would never reach (a raise past the per-term cap, a landing on a `—` row, a
 * column moved down outside a sacrifice, a spend below what the raises cost). This module re-derives the MINIMAL
 * reputation cost of a signed terms vector from its authored SEED using the pinned D-128 helpers (chaos-contract-steps.ts:
 * nextValidStep / repCostUp / sacrificeDropTarget — HARDEN-1's specs), by an exact bounded search over EXACTLY the moves
 * NegotiationService allows:
 *   · a Rep raise on a column: to the next valid step up, costing the rows crossed (em-dash rows paid-but-wasted), the
 *     column's accumulated raise-rows never exceeding the per-term cap (= Scale);
 *   · a sacrifice (at most 2): drop one column two rows (floored to a valid step) to raise ANOTHER one valid step for no
 *     rep, the raise's rows still counting toward that column's cap.
 * Command is excluded for a participant (locked to the primary's step; the lock belt refuses a moved step before this).
 * Pure — no Angular, no DI; pinned by chaos-chain-cost.spec.ts. The GM device REFUSES a signing whose claimed spend is
 * below the minimal cost, or whose terms no chain reaches.
 */
import { CONTRACT_COLUMNS, nextValidStep, repCostUp, sacrificeDropTarget, type ContractColumn } from './chaos-contract-steps';

export type Steps = Record<ContractColumn, number>;
export type ChainVerdict = { ok: true; minimalRep: number; sacrifices: number } | { ok: false; reason: string };

const MAX_STATES = 60000; // the reachable space is tiny (raises capped at Scale rows per column, ≤ 2 sacrifices); this is a belt, not a budget

/** The minimal Rep the D-128 chain must spend to turn `seed` into `signed` at `scale`; `ok:false` when no chain reaches it. */
export function minimalRepCost(seed: Steps, signed: Steps, scale: number, opts: { lockCommand?: boolean } = {}): ChainVerdict {
    const cols: ContractColumn[] = opts.lockCommand ? CONTRACT_COLUMNS.filter((c) => c !== 'command') : [...CONTRACT_COLUMNS];
    if (opts.lockCommand && seed.command !== signed.command) return { ok: false, reason: 'Command Rights moved off the locked step' };
    for (const c of CONTRACT_COLUMNS) {
        if (!Number.isInteger(signed[c]) || !Number.isInteger(seed[c])) return { ok: false, reason: `${c}: not an integer step` };
    }
    const maxRep = 2 * scale; // the largest budget any reputation can yield at this Scale (repBudgetFor = min(rep, 2×scale))
    const key = (s: Steps, r: Steps, sac: number) => `${cols.map((c) => `${s[c]}:${r[c]}`).join('|')}#${sac}`;
    const best = new Map<string, number>(); // state → the least rep it has been reached with
    let visited = 0;
    let answer: { rep: number; sac: number } | null = null;
    const same = (s: Steps) => CONTRACT_COLUMNS.every((c) => s[c] === signed[c]);
    const stack: { s: Steps; r: Steps; rep: number; sac: number }[] = [{ s: { ...seed }, r: { basePay: 0, command: 0, salvage: 0, support: 0, transport: 0 }, rep: 0, sac: 0 }];
    while (stack.length) {
        const st = stack.pop() as { s: Steps; r: Steps; rep: number; sac: number };
        if (++visited > MAX_STATES) return { ok: false, reason: 'the chain search exhausted its bound' };
        const k = key(st.s, st.r, st.sac);
        const seen = best.get(k);
        if (seen !== undefined && seen <= st.rep) continue;
        best.set(k, st.rep);
        if (same(st.s)) { if (!answer || st.rep < answer.rep || (st.rep === answer.rep && st.sac < answer.sac)) answer = { rep: st.rep, sac: st.sac }; continue; }
        if (answer && st.rep >= answer.rep) continue; // cannot improve
        // a Rep raise
        for (const c of cols) {
            const cost = repCostUp(c, st.s[c]);
            if (cost == null || st.r[c] + cost > scale || st.rep + cost > maxRep) continue;
            const to = nextValidStep(c, st.s[c], 1) as number;
            if (to > signed[c] && st.sac >= 2) continue; // overshooting with no drops left can never come back
            stack.push({ s: { ...st.s, [c]: to }, r: { ...st.r, [c]: st.r[c] + cost }, rep: st.rep + cost, sac: st.sac });
        }
        // a sacrifice: drop one column two rows (floored) to raise another one valid step, for no Rep
        if (st.sac < 2) {
            for (const drop of cols) {
                const dropTo = sacrificeDropTarget(drop, st.s[drop]);
                if (dropTo == null) continue;
                for (const raise of cols) {
                    if (raise === drop) continue;
                    const rt = nextValidStep(raise, st.s[raise], 1);
                    if (rt == null) continue;
                    const rc = rt - st.s[raise];
                    if (st.r[raise] + rc > scale) continue;
                    stack.push({ s: { ...st.s, [drop]: dropTo, [raise]: rt }, r: { ...st.r, [raise]: st.r[raise] + rc }, rep: st.rep, sac: st.sac + 1 });
                }
            }
        }
    }
    return answer ? { ok: true, minimalRep: answer.rep, sacrifices: answer.sac } : { ok: false, reason: 'no D-128 chain reaches these terms from the authored seed' };
}
