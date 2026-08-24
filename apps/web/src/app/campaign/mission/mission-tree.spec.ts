/*
 * DIRECTIVE-HARDEN-1 Part B — pinned-value specs for the mission-tree pure logic. These lock the book-exact
 * rules hand-fixed in D-134 (two-sided VP resolve) and D-137 (per-track role derivation), plus the legacy
 * computeTier path and the D-039 graded unlock matcher. If one of these fails after a refactor, the refactor
 * changed a BOOK RULE — stop and compare against DRACONIS-REACH-MECHANICS §17/§20, not the spec.
 */
import { twoSidedTier, twoSidedResolve, computeTier, selectUnlocks, singleSidedResolve, resolveModelFor, authoredObjectives, type ResolveAnswers, type OutcomeGate } from './mission-tree'; // IMPORT-6 — single-sided + dispatch
import { combatPayFor } from '../chaos/chaos-sp-costs';
import type { MissionSpec } from './mission-spec';
import type { ChaosContract } from '../chaos/chaos-contract';

/** A minimal spec.forge.hotspot wrapper around an objective list (what twoSidedResolve actually reads). */
function specWith(objectives: { text: string; vp: number; side?: string }[], playerRole?: 'attacker' | 'defender'): MissionSpec {
    return { forge: { hotspot: { objectives, playerRole } } } as unknown as MissionSpec;
}
function contractWith(side: 'a' | 'b', sideRole: 'attacker' | 'defender'): ChaosContract {
    return { side, sideRole } as ChaosContract;
}
const texts = (l: { text: string }[]): string[] => l.map((o) => o.text);

describe('twoSidedTier — the DR two-sided outcome (D-134, Draconis Reach pp.12–13)', () => {
    // (ourMetCount, ourTotal, ourVp, oppVp, broke)
    it('broke/withdrew → FAILURE, even with every objective met and the VP lead', () => {
        expect(twoSidedTier(3, 3, 500, 0, true)).toBe('FAILURE');
    });
    it('win (≥1 met AND ourVp > oppVp) with ALL objectives met → FULL_SUCCESS', () => {
        expect(twoSidedTier(3, 3, 500, 100, false)).toBe('FULL_SUCCESS');
        expect(twoSidedTier(1, 1, 100, 0, false)).toBe('FULL_SUCCESS'); // a single-objective side, all = 1
    });
    it('win without all objectives met → SUCCESS', () => {
        expect(twoSidedTier(1, 3, 250, 0, false)).toBe('SUCCESS');
        expect(twoSidedTier(2, 3, 300, 299, false)).toBe('SUCCESS');
    });
    it('the out-VP gate: ourVp must EXCEED oppVp — a tie or deficit is UNSUCCESSFUL (PARTIAL) even with a met objective', () => {
        expect(twoSidedTier(1, 3, 100, 100, false)).toBe('PARTIAL'); // tie
        expect(twoSidedTier(1, 3, 50, 600, false)).toBe('PARTIAL'); // out-VP'd (the D-134 proven case)
        expect(twoSidedTier(3, 3, 100, 100, false)).toBe('PARTIAL'); // all met but no VP lead ≠ FULL_SUCCESS
    });
    it('nothing met → UNSUCCESSFUL (PARTIAL), not FAILURE (FAILURE is reserved for a broken force)', () => {
        expect(twoSidedTier(0, 3, 0, 0, false)).toBe('PARTIAL');
    });
    it('a VP lead with ZERO objectives met is still unsuccessful — the ≥1-objective clause of the win gate', () => {
        expect(twoSidedTier(0, 3, 100, 0, false)).toBe('PARTIAL');
    });
    it('maps to the book combat pay at scale 1 AND scale 2 (750/500/250/0 × scale)', () => {
        for (const scale of [1, 2]) {
            expect(combatPayFor(twoSidedTier(3, 3, 500, 0, false), scale)).toBe(750 * scale);
            expect(combatPayFor(twoSidedTier(1, 3, 250, 0, false), scale)).toBe(500 * scale);
            expect(combatPayFor(twoSidedTier(1, 3, 50, 600, false), scale)).toBe(250 * scale);
            expect(combatPayFor(twoSidedTier(3, 3, 500, 0, true), scale)).toBe(0);
        }
    });
});

describe('twoSidedResolve — the per-track role derivation (D-137)', () => {
    // Modeled on the live tester case (hs-drm-10 t2a): a Defend branch under an attacker-root contract.
    const FLIP_OBJS = [
        { text: 'Hold the zone', vp: 50, side: 'both' }, // leading 'both' — the heuristic must skip it
        { text: 'Deny the retake', vp: 250, side: 'defender' }, // first attacker/defender tag → the TRACK role
        { text: 'Retake the markers', vp: 250, side: 'attacker' },
    ];

    it('a branch track whose role flips: "mine" follows the TRACK role (first tagged objective), NOT the fixed contract.sideRole', () => {
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('a', 'attacker'), {} as ResolveAnswers);
        expect(texts(r.ourObjs)).toEqual(['Hold the zone', 'Deny the retake']);
        expect(texts(r.oppObjs)).toEqual(['Hold the zone', 'Retake the markers']);
    });
    it('the leading side:"both" objective lands in BOTH columns and does not decide the role', () => {
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('a', 'attacker'), {} as ResolveAnswers);
        expect(texts(r.ourObjs)).toContain('Hold the zone');
        expect(texts(r.oppObjs)).toContain('Hold the zone');
    });
    it('side B flips both columns on the same track', () => {
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('b', 'defender'), {} as ResolveAnswers);
        expect(texts(r.ourObjs)).toEqual(['Hold the zone', 'Retake the markers']);
        expect(texts(r.oppObjs)).toEqual(['Hold the zone', 'Deny the retake']);
    });
    it('an explicit track playerRole WINS over the first-objective heuristic (the Phase-3 authoring knob)', () => {
        const rA = twoSidedResolve(specWith(FLIP_OBJS, 'attacker'), contractWith('a', 'attacker'), {} as ResolveAnswers);
        expect(texts(rA.ourObjs)).toEqual(['Hold the zone', 'Retake the markers']);
        const rB = twoSidedResolve(specWith(FLIP_OBJS, 'attacker'), contractWith('b', 'defender'), {} as ResolveAnswers);
        expect(texts(rB.ourObjs)).toEqual(['Hold the zone', 'Deny the retake']);
    });
    it('a track with NO attacker/defender tags falls back to contract.sideRole (the D-134 behavior, byte-identical)', () => {
        const objs = [
            { text: 'Untagged is yours', vp: 100 },
            { text: 'Shared', vp: 50, side: 'both' },
        ];
        const r = twoSidedResolve(specWith(objs), contractWith('a', 'defender'), {} as ResolveAnswers);
        expect(texts(r.ourObjs)).toEqual(['Untagged is yours', 'Shared']); // untagged|role|both
        expect(texts(r.oppObjs)).toEqual(['Shared']); // opposite|both
        expect(r.ourTotal).toBe(2); // the totals follow the FILTERED columns (asymmetric split)
        expect(r.oppObjs.length).toBe(1);
    });
    it('when side tags exist, contract.sideRole does NOT drive the split (the D-134 bug this fix removed)', () => {
        const atkFirst = [
            { text: 'Raid it', vp: 200, side: 'attacker' },
            { text: 'Defend it', vp: 200, side: 'defender' },
        ];
        // even with a wrong/opposite contract role, the track's first-tagged role decides
        const r = twoSidedResolve(specWith(atkFirst), contractWith('a', 'defender'), {} as ResolveAnswers);
        expect(texts(r.ourObjs)).toEqual(['Raid it']);
        expect(texts(r.oppObjs)).toEqual(['Defend it']);
    });
    it('MET marks index the FILTERED lists and drive the VP totals + tier', () => {
        const answers = { ourMet: [false, true], oppMet: [false, false], broke: false } as ResolveAnswers;
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('a', 'attacker'), answers);
        expect(r.ourVp).toBe(250); // 'Deny the retake' (index 1 of the MINE list)
        expect(r.oppVp).toBe(0);
        expect(r.ourMetCount).toBe(1);
        expect(r.ourTotal).toBe(2);
        expect(r.tier).toBe('SUCCESS'); // 1 met + out-VP
    });
    it('ALL own objectives met + the VP lead → FULL_SUCCESS through the resolve path (met-count polarity)', () => {
        const answers = { ourMet: [true, true], oppMet: [false, false], broke: false } as ResolveAnswers;
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('a', 'attacker'), answers);
        expect(r.ourMetCount).toBe(2);
        expect(r.tier).toBe('FULL_SUCCESS');
    });
    it('opponent MET marks accumulate oppVp and trip the out-VP gate at the RESOLVE level', () => {
        const answers = { ourMet: [false, true], oppMet: [true, true], broke: false } as ResolveAnswers;
        const r = twoSidedResolve(specWith(FLIP_OBJS), contractWith('a', 'attacker'), answers);
        expect(r.ourVp).toBe(250);
        expect(r.oppVp).toBe(300); // 50 (both) + 250 (attacker) — the opponent column scores its own marks
        expect(r.tier).toBe('PARTIAL'); // out-VP'd → UNSUCCESSFUL despite a met own objective
    });
    it('null spec/contract degrade to empty objective lists (no throw)', () => {
        const r = twoSidedResolve(null, null, {} as ResolveAnswers);
        expect(r.ourObjs).toEqual([]);
        expect(r.oppObjs).toEqual([]);
    });
});

describe('computeTier — the legacy single-sided resolve (D-039, unchanged by the two-sided work)', () => {
    const a = (primary: boolean, secondary: boolean, bonus: boolean, compromised = false): ResolveAnswers =>
        ({ primary, secondary, bonus, compromised } as ResolveAnswers);
    it('primary missed → FAILURE', () => expect(computeTier(a(false, true, true), [])).toBe('FAILURE'));
    it('primary only → PARTIAL', () => expect(computeTier(a(true, false, false), [])).toBe('PARTIAL'));
    it('primary + secondary → SUCCESS (bonus NOT required)', () => expect(computeTier(a(true, true, false), [])).toBe('SUCCESS'));
    it('all incl. bonus → FULL_SUCCESS', () => expect(computeTier(a(true, true, true), [])).toBe('FULL_SUCCESS'));
    it('compromised overlays ONLY when a child carries a COMPROMISED gate', () => {
        expect(computeTier(a(true, true, false, true), ['COMPROMISED'])).toBe('COMPROMISED');
        expect(computeTier(a(true, true, false, true), ['SUCCESS'])).toBe('SUCCESS');
    });
    it('a COMPROMISED-gated child does NOT overlay without the GM answering compromised', () => {
        expect(computeTier(a(true, true, false, false), ['COMPROMISED'])).toBe('SUCCESS');
    });
    it('bonus WITHOUT secondary does not advance past PARTIAL (the D-039 ladder needs the secondary)', () => {
        expect(computeTier(a(true, false, true), [])).toBe('PARTIAL');
    });
});

describe('selectUnlocks — the D-039 graded, never-dead-end gate matcher (unchanged, pinned for HARDEN-2+)', () => {
    const kid = (branchId: string, outcomeGate: OutcomeGate) => ({ branchId, outcomeGate });
    it('ANY always opens; exact tier matches open without reduced-spoils', () => {
        const r = selectUnlocks([kid('any', 'ANY'), kid('s', 'SUCCESS'), kid('p', 'PARTIAL')], 'SUCCESS');
        expect(r.unlock.sort()).toEqual(['any', 's']);
        expect(r.reducedSpoils).toEqual([]);
        expect(r.matched).toBeTrue();
    });
    it('an out-graded tier grades DOWN to the best advancing fork below, flagged reduced-spoils', () => {
        const r = selectUnlocks([kid('s', 'SUCCESS'), kid('p', 'PARTIAL')], 'FULL_SUCCESS');
        expect(r.unlock).toEqual(['s']);
        expect(r.reducedSpoils).toEqual(['s']);
        expect(r.matched).toBeTrue(); // a single graded unlock IS a match — no spurious continuation
    });
    it('grading down never opens a FAILURE fork (only advancing PARTIAL/SUCCESS forks are gradable)', () => {
        const r = selectUnlocks([kid('f', 'FAILURE')], 'SUCCESS');
        expect(r.unlock).toEqual([]);
        expect(r.matched).toBeFalse();
    });
    it('a COMPROMISED tier opens COMPROMISED forks, not FAILURE forks', () => {
        const r = selectUnlocks([kid('c', 'COMPROMISED'), kid('f', 'FAILURE')], 'COMPROMISED');
        expect(r.unlock).toEqual(['c']);
        expect(r.matched).toBeTrue();
    });
    it('FULL_SUCCESS forks are bonus-EXCLUSIVE — never opened by a lower tier grading up', () => {
        const r = selectUnlocks([kid('f', 'FULL_SUCCESS')], 'SUCCESS');
        expect(r.unlock).toEqual([]);
        expect(r.matched).toBeFalse(); // the caller mints a continuation — the campaign never dead-ends
    });
    it('FAILURE opens only FAILURE forks', () => {
        const r = selectUnlocks([kid('f', 'FAILURE'), kid('s', 'SUCCESS')], 'FAILURE');
        expect(r.unlock).toEqual(['f']);
        expect(r.matched).toBeTrue();
    });
});

// ── DIRECTIVE-IMPORT-6 Part B — SINGLE-SIDED authored-objective resolve + the shared dispatch rule (append-only; the
//    D-134/137 describes above are UNMODIFIED — they pin that the two-sided path is byte-identical). ──

/** A spec whose hotspot brief is SINGLE-SIDED (a custom hot spot built without an opposing side). */
function singleSpec(objectives: { text: string; vp: number; side?: string }[]): MissionSpec {
    return { forge: { hotspot: { objectives, singleSided: true } } } as unknown as MissionSpec;
}
/** A spec for a D-116 PRESET track: no hotspot brief; the authored list rides forge.trackObjectives (stamped at bind). */
function presetSpec(trackObjectives: { text: string; vp: number; kind: 'primary' | 'secondary' | 'bonus'; side?: string }[]): MissionSpec {
    return { forge: { trackObjectives } } as unknown as MissionSpec;
}
const OBJS = [{ text: 'Seize the depot', vp: 200 }, { text: 'Hold the ridge', vp: 100 }, { text: 'Capture the commander', vp: 50 }];
const A: ChaosContract = { side: 'a', sideRole: 'attacker' } as ChaosContract;

describe('singleSidedResolve — IMPORT-6 Part B (no authored opposition; the unscored VP is the opponent)', () => {
    it('one column = the PLAYER\'s objectives: untagged ∪ own role ∪ both — an OpFor-tagged objective is NOT scored as the player\'s', () => {
        // no authored playerRole → the first attacker/defender-tagged objective's side is the player's (as twoSidedResolve infers)
        const spec = singleSpec([{ text: 'A', vp: 100, side: 'attacker' }, { text: 'D', vp: 100, side: 'defender' }, { text: 'B', vp: 50, side: 'both' }, { text: 'U', vp: 25 }]);
        const r = singleSidedResolve(spec, { primary: true, secondary: true, bonus: false, compromised: false });
        expect(texts(r.ourObjs)).toEqual(['A', 'B', 'U']);
        expect(r.totalVp).toBe(175);
        expect(r.ourTotal).toBe(3);
        // an authored playerRole (the builder's "Your role") wins over the first-tagged heuristic
        const asDef = { forge: { hotspot: { objectives: [{ text: 'A', vp: 100, side: 'attacker' }, { text: 'D', vp: 100, side: 'defender' }], playerRole: 'defender', singleSided: true } } } as unknown as MissionSpec;
        expect(texts(singleSidedResolve(asDef, { primary: true, secondary: true, bonus: false, compromised: false }).ourObjs)).toEqual(['D']);
        // a preset carries its role on forge.trackSheet
        const preset = { forge: { trackObjectives: [{ text: 'P', vp: 200, kind: 'primary', side: 'attacker' }, { text: 'Q', vp: 100, kind: 'secondary', side: 'defender' }], trackSheet: { playerRole: 'defender' } } } as unknown as MissionSpec;
        expect(texts(singleSidedResolve(preset, { primary: true, secondary: true, bonus: false, compromised: false }).ourObjs)).toEqual(['Q']);
    });
    it('a tagged single-sided custom resolves the SAME as the pre-IMPORT-6 two-sided filter did for it (no tier regression)', () => {
        // pre-IMPORT-6 such a save signed side "a" and went through twoSidedResolve: mine=[attacker obj], theirs=[defender obj]
        const objs = [{ text: 'Seize the depot', vp: 200, side: 'attacker' }, { text: 'Hold the depot (garrison)', vp: 200, side: 'defender' }];
        const before = twoSidedResolve(specWith(objs), A, { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true] });
        const after = singleSidedResolve(singleSpec(objs), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true] });
        expect(before.tier).toBe('FULL_SUCCESS');
        expect(after.tier).toBe('FULL_SUCCESS');
        expect(texts(after.ourObjs)).toEqual(['Seize the depot']);
    });
    it('untagged / all-both lists degenerate to the WHOLE list (side tags absent → nothing to filter)', () => {
        const r = singleSidedResolve(singleSpec(OBJS.map((o) => ({ ...o, side: 'both' }))), { primary: true, secondary: true, bonus: false, compromised: false });
        expect(r.ourTotal).toBe(3);
        expect(singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false }).ourTotal).toBe(3);
    });
    it('an all-zero-VP list scores by objective COUNT (all met → FULL_SUCCESS is reachable; > half met → SUCCESS)', () => {
        const zero = singleSpec([{ text: 'x', vp: 0 }, { text: 'y', vp: 0 }, { text: 'z', vp: 0 }]);
        expect(singleSidedResolve(zero, { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, true, true] }).tier).toBe('FULL_SUCCESS');
        expect(singleSidedResolve(zero, { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, true, false] }).tier).toBe('SUCCESS');
        expect(singleSidedResolve(zero, { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, false, false] }).tier).toBe('PARTIAL');
    });
    it('nothing met → PARTIAL (DR unsuccessful-but-unbroken, 250×scale — never FAILURE)', () => {
        const r = singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false });
        expect(r.ourVp).toBe(0); expect(r.tier).toBe('PARTIAL');
        expect(combatPayFor(r.tier, 1)).toBe(250);
    });
    it('more than half the authored VP → SUCCESS (500×scale); the primary alone (200 of 350) wins', () => {
        const r = singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true] });
        expect(r.ourVp).toBe(200); expect(r.tier).toBe('SUCCESS');
        expect(combatPayFor(r.tier, 2)).toBe(1000);
    });
    it('half or less of the authored VP → PARTIAL (secondary+bonus = 150 of 350; exactly half also PARTIAL)', () => {
        const r = singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [false, true, true] });
        expect(r.ourVp).toBe(150); expect(r.tier).toBe('PARTIAL');
        const half = singleSidedResolve(singleSpec([{ text: 'x', vp: 100 }, { text: 'y', vp: 100 }]), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, false] });
        expect(half.tier).toBe('PARTIAL');
    });
    it('every objective met → FULL_SUCCESS (750×scale)', () => {
        const r = singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, true, true] });
        expect(r.ourMetCount).toBe(3); expect(r.tier).toBe('FULL_SUCCESS');
        expect(combatPayFor(r.tier, 1)).toBe(750);
    });
    it('broke/withdrew → FAILURE (0) even with everything met', () => {
        const r = singleSidedResolve(singleSpec(OBJS), { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, true, true], broke: true });
        expect(r.tier).toBe('FAILURE'); expect(combatPayFor(r.tier, 3)).toBe(0);
    });
    it('reads a PRESET track\'s list from forge.trackObjectives when there is no hotspot brief (Part C coupling)', () => {
        const spec = presetSpec([{ text: 'P', vp: 200, kind: 'primary' }, { text: 'S', vp: 100, kind: 'secondary' }]);
        expect(texts(authoredObjectives(spec))).toEqual(['P', 'S']);
        const r = singleSidedResolve(spec, { primary: true, secondary: true, bonus: false, compromised: false, ourMet: [true, true] });
        expect(r.tier).toBe('FULL_SUCCESS');
    });
    it('a hotspot brief WINS over trackObjectives (never both; the brief is the record for catalog tracks)', () => {
        const spec = { forge: { hotspot: { objectives: [{ text: 'H', vp: 300 }], singleSided: true }, trackObjectives: [{ text: 'T', vp: 1, kind: 'primary' }] } } as unknown as MissionSpec;
        expect(texts(authoredObjectives(spec))).toEqual(['H']);
    });
});

describe('resolveModelFor — the ONE dispatch rule shared by the resolve modal and resolveBranch', () => {
    const legacyAns: ResolveAnswers = { primary: true, secondary: true, bonus: false, compromised: false };
    it('two-sided: a signed side + a hotspot brief that is NOT single-sided → "two" (D-134 unchanged, even with all-both or empty lists)', () => {
        expect(resolveModelFor(specWith(OBJS.map((o) => ({ ...o, side: 'both' }))), A)).toBe('two');
        expect(resolveModelFor(specWith([]), A)).toBe('two'); // pre-IMPORT-6 behavior kept: columns render "no authored objectives"
        expect(resolveModelFor(specWith([{ text: 'a', vp: 1, side: 'attacker' }, { text: 'd', vp: 1, side: 'defender' }], 'attacker'), contractWith('b', 'defender'))).toBe('two');
    });
    it('single-sided custom (brief.singleSided) with ≥1 objective → "one"; with NO objectives → "legacy" (the generic toggles)', () => {
        expect(resolveModelFor(singleSpec(OBJS), A)).toBe('one');
        expect(resolveModelFor(singleSpec([]), A)).toBe('legacy');
    });
    it('a preset track or a §18 universal pick (no brief, trackObjectives — TESTER-4 ruling) → "one"; a Forge seed (neither) → "legacy"', () => {
        expect(resolveModelFor(presetSpec([{ text: 'P', vp: 200, kind: 'primary' }]), A)).toBe('one');
        expect(resolveModelFor({ forge: {} } as unknown as MissionSpec, A)).toBe('legacy');
        expect(resolveModelFor({ forge: { trackObjectives: [] } } as unknown as MissionSpec, A)).toBe('legacy');
    });
    it('Traditional (no chaos contract) → always "legacy", whatever the spec carries', () => {
        expect(resolveModelFor(specWith(OBJS), null)).toBe('legacy');
        expect(resolveModelFor(singleSpec(OBJS), undefined)).toBe('legacy');
        expect(resolveModelFor(presetSpec([{ text: 'P', vp: 200, kind: 'primary' }]), null)).toBe('legacy');
    });
    it('a pre-D-133 save (contract without a side) with a two-sided brief → "legacy" (D-134 byte-identical)', () => {
        expect(resolveModelFor(specWith(OBJS), { } as ChaosContract)).toBe('legacy');
        expect(computeTier(legacyAns, [])).toBe('SUCCESS'); // and the legacy default answers still resolve as before
    });
});
