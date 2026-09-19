
import type { EngagedSnapshot, FieldWalkResult } from '../walk/field-walk-core';
import type { MissionSpec } from './mission-spec';
import type { ChaosContract } from '../chaos/chaos-contract';

// FULL_SUCCESS is now reserved for genuine bonus-reward branches. COMPROMISED stays the overlay; ANY = always.
export type OutcomeGate = 'FULL_SUCCESS' | 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'COMPROMISED' | 'ANY';
export type BranchState = 'LOCKED' | 'AVAILABLE' | 'ACTIVE' | 'RESOLVED' | 'RETIRED';

export interface OutcomeRecord {
    contractId: string;
    branchId: string;
    threadTag: string;          // the chain root (the contract id); '__campaign__' when contract-less
    tier: OutcomeGate;          // the resolved outcome tier
    date?: { y: number; m: number; d: number };
    opforCommanderNpcId?: string;
    intelSourceNpcId?: string;
    bvTarget: number;           // the OpFor BV faced (the difficulty marker)
    world?: string;             // the world it played on ({PRIOR_WORLD})
}

export interface ResolveAnswers {
    primary: boolean; // primary objective met?
    secondary: boolean;
    bonus: boolean;
    compromised: boolean; // "the enemy learned something material"
    notes?: string;
    salvageValue?: number;
    claimedPrizeBv?: number;
    damageTaken?: number;
    damageGiven?: number;
    // renders whichever list the dispatch picked, in the same order); absent → the legacy primary/secondary/bonus path.
    ourMet?: boolean[];
    oppMet?: boolean[];
    broke?: boolean; // your force broke / withdrew → FAILURE (0 combat pay)
}

//    success = you complete ≥1 objective AND out-VP the opponent. Maps onto the EXISTING OutcomeGate → the existing
//    combat-pay tiers (COMBAT_TIER_BY_GATE → CHAOS_COMBAT_PAY 750/500/250/0 × scale) → the existing tree gating. ──
/** Pure — the two-sided outcome tier. FULL_SUCCESS = all your objectives + out-VP (→750); SUCCESS = ≥1 obj + out-VP
 *  (→500); PARTIAL = unsuccessful but unbroken (→250); FAILURE = broke/withdrew (→0). */
export function twoSidedTier(ourMetCount: number, ourTotal: number, ourVp: number, oppVp: number, broke: boolean): OutcomeGate {
    if (broke) return 'FAILURE';
    const win = ourMetCount >= 1 && ourVp > oppVp;
    if (win && ourMetCount === ourTotal) return 'FULL_SUCCESS';
    if (win) return 'SUCCESS';
    return 'PARTIAL';
}

export function twoSidedResolve(spec: MissionSpec | null | undefined, contract: ChaosContract | null | undefined, answers: ResolveAnswers): {
    ourObjs: { text: string; vp: number; met: boolean }[];
    oppObjs: { text: string; vp: number; met: boolean }[];
    ourVp: number; oppVp: number; ourMetCount: number; ourTotal: number; tier: OutcomeGate;
} {
    const hs = spec?.forge?.hotspot;
    const objs = hs?.objectives ?? [];
    const opposite = (r: 'attacker' | 'defender'): 'attacker' | 'defender' => (r === 'defender' ? 'attacker' : 'defender');
    const authored = (hs?.playerRole
        ?? objs.find((o) => o.side === 'attacker' || o.side === 'defender')?.side
        ?? contract?.sideRole ?? 'attacker') as 'attacker' | 'defender';
    const mineRole = contract?.side === 'b' ? opposite(authored) : authored;
    const theirRole = opposite(mineRole);
    const mine = objs.filter((o) => !o.side || o.side === mineRole || o.side === 'both');
    const theirs = objs.filter((o) => o.side === theirRole || o.side === 'both');
    const ourMet = answers.ourMet ?? [];
    const oppMet = answers.oppMet ?? [];
    const ourObjs = mine.map((o, i) => ({ text: o.text, vp: o.vp, met: !!ourMet[i] }));
    const oppObjs = theirs.map((o, i) => ({ text: o.text, vp: o.vp, met: !!oppMet[i] }));
    const ourVp = ourObjs.reduce((s, o) => s + (o.met ? o.vp : 0), 0);
    const oppVp = oppObjs.reduce((s, o) => s + (o.met ? o.vp : 0), 0);
    const ourMetCount = ourObjs.filter((o) => o.met).length;
    const ourTotal = ourObjs.length;
    return { ourObjs, oppObjs, ourVp, oppVp, ourMetCount, ourTotal, tier: twoSidedTier(ourMetCount, ourTotal, ourVp, oppVp, !!answers.broke) };
}

export function authoredObjectives(spec: MissionSpec | null | undefined): { text: string; vp: number; kind?: string; side?: string }[] {
    return spec?.forge?.hotspot?.objectives ?? spec?.forge?.trackObjectives ?? [];
}

/** Pure — resolve a SINGLE-SIDED track (a single-sided custom hot spot, or a preset track played via the picker) from
 *  the GM's per-objective MET marks. ONE column = the PLAYER's objectives: the same role filter twoSidedResolve applies
 *  (role = the track's authored playerRole — brief or preset sheet — else the first attacker/defender-tagged objective's
 *  side, else attacker; mine = untagged ∪ role ∪ 'both'; single-sided always signs side A, so no flip) — an author who
 *  tagged the OpFor's goal 'defender' doesn't have it scored as the player's; an untagged / all-'both' list degenerates
 *  to the whole list. Tier = the UNCHANGED twoSidedTier with the authored VP you did NOT score as the opposition: broke
 *  → FAILURE (0); all met → FULL_SUCCESS (750×scale); more than half the authored VP → SUCCESS (500); else PARTIAL (250 —
 *  DR "unsuccessful but unbroken"). An all-zero-VP list scores by objective COUNT instead (else FULL_SUCCESS would be
 *  unreachable). answers.ourMet is indexed to THIS filtered list (the modal renders it in the same order). */
export function singleSidedResolve(spec: MissionSpec | null | undefined, answers: ResolveAnswers): {
    ourObjs: { text: string; vp: number; met: boolean }[];
    ourVp: number; totalVp: number; ourMetCount: number; ourTotal: number; tier: OutcomeGate;
} {
    const objs = authoredObjectives(spec);
    const role = (spec?.forge?.hotspot?.playerRole ?? spec?.forge?.trackSheet?.playerRole
        ?? objs.find((o) => o.side === 'attacker' || o.side === 'defender')?.side ?? 'attacker') as 'attacker' | 'defender';
    const mine = objs.filter((o) => !o.side || o.side === role || o.side === 'both');
    const ourMet = answers.ourMet ?? [];
    const ourObjs = mine.map((o, i) => ({ text: o.text, vp: o.vp, met: !!ourMet[i] }));
    const totalVp = ourObjs.reduce((s, o) => s + o.vp, 0);
    const ourVp = ourObjs.reduce((s, o) => s + (o.met ? o.vp : 0), 0);
    const ourMetCount = ourObjs.filter((o) => o.met).length;
    const ourTotal = ourObjs.length;
    const score = totalVp > 0 ? { ours: ourVp, opp: totalVp - ourVp } : { ours: ourMetCount, opp: ourTotal - ourMetCount }; // zero-VP list → by count
    return { ourObjs, ourVp, totalVp, ourMetCount, ourTotal, tier: twoSidedTier(ourMetCount, ourTotal, score.ours, score.opp, !!answers.broke) };
}

export function resolveModelFor(spec: MissionSpec | null | undefined, contract: ChaosContract | null | undefined): 'two' | 'one' | 'legacy' {
    const hs = spec?.forge?.hotspot;
    if (contract?.side && hs && !hs.singleSided) return 'two';
    if (contract && (hs?.singleSided || (!hs && spec?.forge?.trackObjectives)) && authoredObjectives(spec).length > 0) return 'one';
    return 'legacy';
}

export interface IterationLedger {
    warchestStart: number;   // Warchest SP carried into the cycle (balance before the window)
    warchestEnd: number;     // Warchest SP after this resolve settled (last balance in the window)
    spSpent: number;         // Σ of the debits (positive `paid`) in the window — gross outflow, income excluded
    deployed: number;        // BLUFOR units fielded (resolution.engaged.bluforIds)
    gained: number;          // units acquired this cycle = prizes claimed + market purchases
    lost: number;
    damageTaken?: number;    // own damage points (auto-sum, GM-editable); undefined → shown as "—"
    damageGiven?: number;    // OpFor damage (GM-entered); undefined → shown as "—"
    wounds: number;
    purchases: { label: string; sp: number }[]; // the 'Purchase —' market-buy lines in the window
    dateFrom: string;        // the cycle's date window (aar.advancedFrom, else the resolved date)
    dateTo: string;
}
export interface AarSnapshot {
    objectives?: { primary: string; secondary: string; bonus: string };
    // opponent column), snapshotted at RESOLVE because the spec is cleared right after (DATA-003 — forge.hotspot /
    // forge.trackObjectives are gone). Written only under the VP models ('two' / 'one'); absent → the AAR + flow render the
    // legacy primary/secondary/bonus trio, byte-identical. `model` names which resolve model produced the marks.
    objectiveMarks?: { text: string; vp: number; met: boolean; side?: 'our' | 'opp' }[];
    model?: 'two' | 'one';
    npcFlags?: string[];
    world?: string;
    district?: string;
    employer?: string;
    target?: string;
    // Optional; render prefers refined-and-verified over template; absent = template (OFF identical).
    refined?: Record<string, { text: string; verified: boolean }>;
    elapsedDays?: number;
    advancedFrom?: string;  // formatted pre-advance date
    advancedTo?: string;    // formatted post-advance date
    travel?: { jumps: number; jumpTransitDays: number; insertionDays: number; operationDays: number; totalDays: number; hasTravel: boolean };
}

export interface BranchResolution {
    outcomeTier: OutcomeGate; // the resolved tier (FULL_SUCCESS/PARTIAL/FAILURE/COMPROMISED)
    resolvedDate?: { y: number; m: number; d: number };
    notes?: string;
    answers?: ResolveAnswers;
    override?: boolean; // a GM override of the computed tier was applied
    engaged?: EngagedSnapshot;   // the engaged units, snapshotted at RESOLVE (the spec is cleared after)
    fieldWalk?: FieldWalkResult;
    aar?: AarSnapshot;           // resolve-time spec snapshot for the AAR render (the spec is cleared after)
    //    the GM advances the campaign phase after an HS resolve → the rail leaves the branch (idle/CONTRACT) and the
    //    clock-advance can't double-fire. HS has no field walk, so this is the HS analog of `fieldWalk`-finalized. ──
    advanced?: boolean;
    //    field walk + its own AAR sections). Recorded at resolve in place of the C-bill walk. ──
    losses?: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[];
    prizes?: { instanceId: string; label: string }[]; // captured enemy 'Mechs → Cold storage (provenance 'captured')
    settlement?: { combatPay: number; salvageSp: number }; // the SP posted at resolve, snapshotted for the AAR render
    //    Traditional never sets it). The flow pop-out + the AAR render it; no re-derive (stored record). ──
    ledger?: IterationLedger;
}

export interface MissionBranch {
    branchId: string;
    name: string; // the operation name (fork.name for children; opener name for the root)
    parentBranchId: string | null;
    outcomeGate: OutcomeGate; // the parent outcome that unlocks this branch (ANY = the opener / always)
    threat: string;
    state: BranchState;
    seedFamilyHint?: string; // fork.family (v1.2; absent today → falls back to the contract missionType)
    nextSeedId?: string;
    forkContext?: { trigger: string; consequence: string }; // DATA feeding the briefing lead
    missionSpecRef?: string; // the missionId of the generated spec, once ACTIVE/RESOLVED
    systemId?: string;
    resolution?: BranchResolution;
    // command advances but on a lesser branch ("reduced spoils"). A Flow/board cue, not a mechanic.
    reducedSpoils?: boolean;
    // non-failure (or any) outcome — the campaign rolls the next operation rather than stalling.
    continuation?: boolean;
    // node's track-type label. Set only in HS (root at mint, generated branch when ACTIVE, pending child from its
    // fork's preset seed). Traditional branches never carry it → the flow renders unchanged.
    trackType?: string;
}

export interface TreeArchiveEntry {
    contractId: string;
    label: string; // e.g. "Wolf's Dragoons · Garrison Duty"
    completedDate?: { y: number; m: number; d: number };
    tree: MissionBranch[];
}

// ── TUNABLE: opener count (1–3) + whether choosing one available child retires the rest. ──
export const TREE_TUNABLES = {
    openerCount: 1, // 1 root opener (dial up to 3 when ANY-gated alternates exist)
    exclusiveChoice: false, // false = picking one available child leaves the siblings available
};

export function computeTier(a: ResolveAnswers, childGates: OutcomeGate[]): OutcomeGate {
    if (a.compromised && childGates.includes('COMPROMISED')) return 'COMPROMISED';
    if (!a.primary) return 'FAILURE';
    if (a.secondary && a.bonus) return 'FULL_SUCCESS';
    if (a.secondary) return 'SUCCESS';
    return 'PARTIAL';
}

export const TIER_ORDER: Record<string, number> = { PARTIAL: 1, SUCCESS: 2, FULL_SUCCESS: 3 };
/** Non-exclusive advancing gates a higher tier may GRADE DOWN into. FULL_SUCCESS is bonus-EXCLUSIVE. */
const GRADABLE = new Set<OutcomeGate>(['PARTIAL', 'SUCCESS']);

/** A child's gate matches a resolved tier EXACTLY (ANY always). Kept for simple displays; the engine
 *  uses selectUnlocks for the graded, never-dead-end evaluation. */
export function gateMatches(gate: OutcomeGate, tier: OutcomeGate): boolean {
    return gate === 'ANY' || gate === tier;
}

export interface GateChild { branchId: string; outcomeGate: OutcomeGate }
export interface UnlockResult {
    unlock: string[];        // branchIds that become AVAILABLE
    reducedSpoils: string[]; // of those, the ones taken by grading DOWN (out-graded the authored fork)
    matched: boolean;        // did ANY fork open? (false → the caller rolls a never-dead-end continuation)
}

export function selectUnlocks(children: GateChild[], tier: OutcomeGate): UnlockResult {
    const unlock = new Set<string>();
    const reduced = new Set<string>();
    for (const c of children) if (c.outcomeGate === 'ANY') unlock.add(c.branchId);

    if (tier === 'COMPROMISED') {
        for (const c of children) if (c.outcomeGate === 'COMPROMISED') unlock.add(c.branchId);
    } else if (tier === 'FAILURE') {
        for (const c of children) if (c.outcomeGate === 'FAILURE') unlock.add(c.branchId);
    } else {
        const tlev = TIER_ORDER[tier] ?? 0;
        const exact = children.filter((c) => c.outcomeGate === tier);
        if (exact.length) {
            for (const c of exact) unlock.add(c.branchId);
        } else {
            // grade down: the best non-exclusive advancing fork strictly below the tier.
            const below = children
                .filter((c) => GRADABLE.has(c.outcomeGate) && (TIER_ORDER[c.outcomeGate] ?? 0) < tlev)
                .sort((a, b) => (TIER_ORDER[b.outcomeGate] ?? 0) - (TIER_ORDER[a.outcomeGate] ?? 0));
            if (below.length) {
                const best = TIER_ORDER[below[0].outcomeGate] ?? 0;
                for (const c of below) if ((TIER_ORDER[c.outcomeGate] ?? 0) === best) { unlock.add(c.branchId); reduced.add(c.branchId); }
            }
        }
    }
    return { unlock: [...unlock], reducedSpoils: [...reduced], matched: unlock.size > 0 };
}
