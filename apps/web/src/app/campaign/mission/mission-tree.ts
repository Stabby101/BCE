/*
 * BCE — mission TREE model + gate logic (DIRECTIVE-026). Pure TS, no Angular/DOM.
 *
 * The campaign's branching spine: a contract mints a root branch; GENERATE on an AVAILABLE branch runs
 * the D-025 mission and mints its seed's forks as LOCKED children (the lookahead); RESOLVE evaluates the
 * GM's objective answers into an outcome tier; matching/ANY children unlock (AVAILABLE), wrong-outcome
 * siblings RETIRE (visible, never deleted — D32 semantics). DATA-003: forks are authored fork DATA on
 * every seed; nothing is parsed from prose. Forks → children, answers → tier, tier → gates.
 */

import type { EngagedSnapshot, FieldWalkResult } from '../walk/field-walk-core';
import type { MissionSpec } from './mission-spec'; // D-134 — two-sided VP resolve reads spec.forge.hotspot.objectives (type-only)
import type { ChaosContract } from '../chaos/chaos-contract'; // D-134 — reads contract.side/sideRole (type-only)

// D-039: SUCCESS sits between PARTIAL and FULL_SUCCESS — primary+secondary advances WITHOUT the bonus;
// FULL_SUCCESS is now reserved for genuine bonus-reward branches. COMPROMISED stays the overlay; ANY = always.
export type OutcomeGate = 'FULL_SUCCESS' | 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'COMPROMISED' | 'ANY';
export type BranchState = 'LOCKED' | 'AVAILABLE' | 'ACTIVE' | 'RESOLVED' | 'RETIRED';

/** D-077 — a resolved mission's outcome, appended to a rolling campaign ledger (DATA-003-safe: computed
 *  STATE the generator reads back, never authored prose). threadTag links a branch chain (= the contract);
 *  the generator drifts the next bvTarget by the thread's escalation level, and the renderer can surface
 *  the prior outcome via the {PRIOR_TIER}/{PRIOR_WORLD} slots. */
export interface OutcomeRecord {
    contractId: string;
    branchId: string;
    threadTag: string;          // the chain root (the contract id); '__campaign__' when contract-less
    tier: OutcomeGate;          // the resolved outcome tier
    date?: { y: number; m: number; d: number };
    opforCommanderNpcId?: string;
    intelSourceNpcId?: string;  // D-096 — the thread's recurring intel contact (read back to re-bind + the callback)
    bvTarget: number;           // the OpFor BV faced (the difficulty marker)
    world?: string;             // the world it played on ({PRIOR_WORLD})
}

export interface ResolveAnswers {
    primary: boolean; // primary objective met?
    secondary: boolean;
    bonus: boolean;
    compromised: boolean; // "the enemy learned something material"
    notes?: string;
    salvageValue?: number; // D-110c — GM-entered Hot Spots salvage (SP); undefined → post the D-110b estimate. Transient (not persisted).
    claimedPrizeBv?: number; // D-121 — Σ BV of claimed prize 'Mechs; the auto salvage estimate subtracts it (no double-dip). Transient.
    damageTaken?: number; // D-122 — total own-force damage points taken (auto-summed from the digital sheets, GM-editable). Transient.
    damageGiven?: number; // D-122 — total damage dealt to the OpFor (GM-entered; OpFor post-battle state isn't stored). Transient.
    // D-134 — two-sided (DR VP) resolve inputs (transient; HS-only, gated on contract.side). Indexed to the role-filtered
    // objective lists from twoSidedResolve (IMPORT-6: or to singleSidedResolve's filtered one-column list — the modal
    // renders whichever list the dispatch picked, in the same order); absent → the legacy primary/secondary/bonus path.
    ourMet?: boolean[];
    oppMet?: boolean[];
    broke?: boolean; // your force broke / withdrew → FAILURE (0 combat pay)
}

// ── DIRECTIVE-134 — two-sided contracts Phase 2: the Draconis Reach VP resolve. Both sides score their objectives;
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

/** Pure — resolve a two-sided track from the GM's per-objective MET marks. Sources the authored objectives (with vp +
 *  side) from spec.forge.hotspot.objectives, filtered by the player's PER-TRACK tactical role (D-137): the authored
 *  side tags are the TRACK's attacker/defender roles and the player's role flips between tracks, so the fixed
 *  contract.sideRole (the strategic side at signing) would swap the columns on any track whose role differs from the
 *  root's. Authored role = the track's explicit playerRole, else the side of the first attacker/defender-tagged
 *  objective (the author lists the player's objective first); side B plays the opposing contract → flipped. YOUR
 *  objectives = untagged (existing content is A-centric) ∪ side ∈ {mineRole,'both'}; OPPONENT = side ∈
 *  {opposite,'both'}. Used by BOTH the resolve modal (live verdict) and resolveBranch (no logic duplication). */
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

// ── DIRECTIVE-IMPORT-6 Part B — SINGLE-SIDED authored-objective resolve (no authored opposition). ──
/** The authored per-track objective list a Hot Spots spec carries: a catalog hotspot track's brief
 *  (spec.forge.hotspot.objectives — authored / custom / forged) else a D-116 preset's list stamped at bind
 *  (spec.forge.trackObjectives — a D-116 preset's list, or a §18 universal pick's generic typed slots per the TESTER-4 ruling).
 *  Empty for Traditional, Forge-seed continuations, and objective-less tracks. */
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

/** Which authored-objective resolve model a Hot Spots spec + contract use (the ONE dispatch rule shared by the resolve
 *  modal's live verdict and resolveBranch's posted tier — keep them from drifting):
 *  'two' = the D-134 two-sided VP model (a signed side + a hotspot brief that is NOT single-sided; the objective list may
 *  be empty → columns render "no authored objectives", byte-identical to before IMPORT-6);
 *  'one' = IMPORT-6 single-sided (a single-sided custom's brief, or a preset track's trackObjectives) WITH ≥1 objective;
 *  'legacy' = the primary/secondary/bonus toggles + computeTier (Traditional, Forge-seed continuations, objective-less). */
export function resolveModelFor(spec: MissionSpec | null | undefined, contract: ChaosContract | null | undefined): 'two' | 'one' | 'legacy' {
    const hs = spec?.forge?.hotspot;
    if (contract?.side && hs && !hs.singleSided) return 'two';
    if (contract && (hs?.singleSided || (!hs && spec?.forge?.trackObjectives)) && authoredObjectives(spec).length > 0) return 'one';
    return 'legacy';
}

/** DIRECTIVE-122 — the per-mission ITERATION LEDGER (Hot Spots-only; Traditional never sets it). A stored snapshot
 *  taken at RESOLVE of one mission's date cycle: the Warchest movement, the field counts, the two damage totals
 *  (GM-captured), the wounds, and the market purchases made that cycle. The flow pop-out + the AAR render it
 *  verbatim — no re-derive (DATA-003: the ledger is a stored record, reload-identical). */
export interface IterationLedger {
    warchestStart: number;   // Warchest SP carried into the cycle (balance before the window)
    warchestEnd: number;     // Warchest SP after this resolve settled (last balance in the window)
    spSpent: number;         // Σ of the debits (positive `paid`) in the window — gross outflow, income excluded
    deployed: number;        // BLUFOR units fielded (resolution.engaged.bluforIds)
    gained: number;          // units acquired this cycle = prizes claimed + market purchases
    lost: number;            // own units lost (resolution.losses; 0 without D-121)
    damageTaken?: number;    // own damage points (auto-sum, GM-editable); undefined → shown as "—"
    damageGiven?: number;    // OpFor damage (GM-entered); undefined → shown as "—"
    wounds: number;          // pilots injured or killed among the losses (0 without D-121)
    purchases: { label: string; sp: number }[]; // the 'Purchase —' market-buy lines in the window
    dateFrom: string;        // the cycle's date window (aar.advancedFrom, else the resolved date)
    dateTo: string;
}
/** D-034 — the resolve-time AAR snapshot: spec data the after-action render needs AFTER resolveBranch
 *  clears the spec (objective texts as resolved; the seed's NPC flags → missions-appeared; the op slots).
 *  Captured at RESOLVE exactly like `engaged` (D-031) — forward-only; pre-D-034 resolutions lack it and
 *  the AAR renders honestly without it (never invented backward). */
export interface AarSnapshot {
    objectives?: { primary: string; secondary: string; bonus: string };
    // IMPORT-6 FOLLOWUPS — the AUTHORED objective list AS RESOLVED (text + VP + the GM's MET mark; 'opp' rows = the two-sided
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
    // D-038 — narrator-refined section prose, machine-diff-verified, stored per section id.
    // Optional; render prefers refined-and-verified over template; absent = template (OFF identical).
    refined?: Record<string, { text: string; verified: boolean }>;
    // D-099 — the campaign-clock advance this resolution consumed (transit + insertion + operation). Captured at
    // resolve so the AAR shows the elapsed span + the new date; absent on pre-D-099 / no-clock / Quick-Mission resolutions.
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
    // ── D-031 Walk the field ──
    engaged?: EngagedSnapshot;   // the engaged units, snapshotted at RESOLVE (the spec is cleared after)
    fieldWalk?: FieldWalkResult; // the walk output (D-033's raw material); absent + engaged present = pending walk
    // ── D-034 After-action ──
    aar?: AarSnapshot;           // resolve-time spec snapshot for the AAR render (the spec is cleared after)
    // ── DIRECTIVE-119 — Hot Spots "ADVANCE PHASE" marker (additive, optional; Traditional never sets it). Set when
    //    the GM advances the campaign phase after an HS resolve → the rail leaves the branch (idle/CONTRACT) and the
    //    clock-advance can't double-fire. HS has no field walk, so this is the HS analog of `fieldWalk`-finalized. ──
    advanced?: boolean;
    // ── DIRECTIVE-121 — Hot Spots field settlement (additive, optional; Traditional never sets them — it uses the
    //    field walk + its own AAR sections). Recorded at resolve in place of the C-bill walk. ──
    losses?: { instanceId: string; label: string; reason: 'destroyed' | 'abandoned'; pilotFate: 'ok' | 'injured' | 'kia' }[];
    prizes?: { instanceId: string; label: string }[]; // captured enemy 'Mechs → Cold storage (provenance 'captured')
    settlement?: { combatPay: number; salvageSp: number }; // the SP posted at resolve, snapshotted for the AAR render
    // ── DIRECTIVE-122 — the per-mission iteration ledger, snapshotted at resolve (additive, optional; HS-only —
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
    nextSeedId?: string; // D-097 — fork.nextSeedId: the authored next part of an arc (soft-preferred at GENERATE, era-floored)
    forkContext?: { trigger: string; consequence: string }; // DATA feeding the briefing lead
    missionSpecRef?: string; // the missionId of the generated spec, once ACTIVE/RESOLVED
    systemId?: string; // D-080 — the Star Map system this branch's mission localized to; children localize near it
    resolution?: BranchResolution;
    // D-039: this branch was taken by GRADING DOWN — the outcome out-graded the authored fork, so the
    // command advances but on a lesser branch ("reduced spoils"). A Flow/board cue, not a mechanic.
    reducedSpoils?: boolean;
    // D-039: a never-dead-end CONTINUATION branch the engine minted because no authored fork matched a
    // non-failure (or any) outcome — the campaign rolls the next operation rather than stalling.
    continuation?: boolean;
    // D-129 — the authored DR track template (Hot Spots only; e.g. 'Defend'/'Recon'/'Breakthrough'), for the flow
    // node's track-type label. Set only in HS (root at mint, generated branch when ACTIVE, pending child from its
    // fork's preset seed). Traditional branches never carry it → the flow renders unchanged.
    trackType?: string;
}

/** A completed contract's closed tree, kept so the FLOW tab (D-028) can recall finished campaigns'
 *  shapes read-only after a new accept overwrites the live missionTree. */
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

/**
 * Compute the outcome tier from the GM's YES/NO answers (DATA-003 — the GM answers facts, structure
 * decides). D-039 finer tiers: primary-no → FAILURE; primary only → PARTIAL; primary+secondary → SUCCESS
 * (the good advance, bonus NOT required); all incl. bonus → FULL_SUCCESS. A material compromise overlays
 * COMPROMISED only where the branch's children actually carry a COMPROMISED gate.
 */
export function computeTier(a: ResolveAnswers, childGates: OutcomeGate[]): OutcomeGate {
    if (a.compromised && childGates.includes('COMPROMISED')) return 'COMPROMISED';
    if (!a.primary) return 'FAILURE';
    if (a.secondary && a.bonus) return 'FULL_SUCCESS';
    if (a.secondary) return 'SUCCESS';
    return 'PARTIAL';
}

/** Advancing-tier ordering (D-039). FAILURE/COMPROMISED are not on this ladder — they match exactly. */
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

/**
 * THE GRADED MATCHER (D-039) — the dead-tree fix. Gates are THRESHOLDS, not exact keys:
 *   • ANY → always opens.
 *   • COMPROMISED tier → opens COMPROMISED forks (computeTier only returns it when one exists).
 *   • FAILURE tier → opens FAILURE forks.
 *   • advancing tier (PARTIAL/SUCCESS/FULL_SUCCESS) → opens the exact-tier fork(s) if authored; else the
 *     HIGHEST authored non-exclusive advancing fork BELOW the tier (PARTIAL/SUCCESS), flagged reduced-
 *     spoils (you out-graded the branch you took). FULL_SUCCESS forks are bonus-EXCLUSIVE: they open
 *     ONLY at a true FULL_SUCCESS tier, never by grading.
 * matched=false (no fork opened) is the signal to roll a continuation — the campaign never dead-ends.
 */
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
