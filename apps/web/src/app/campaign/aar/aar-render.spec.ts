/*
 * IMPORT-6 FOLLOWUPS — the AAR consumes the resolve MODEL's outcome. Pins that a Hot Spots resolution carrying
 * `aar.objectiveMarks` (snapshotted at resolve from twoSidedResolve / singleSidedResolve) renders the AUTHORED objectives
 * with the GM's real MET marks + VP + the book grade, and that a resolution WITHOUT marks (Traditional / legacy) renders the
 * legacy Primary/Secondary/Bonus trio byte-identically to before.
 */
import { buildAarDocument, type AarContext } from './aar-render';
import type { MissionBranch } from '../mission/mission-tree';

const ctx = (isHotspots: boolean): AarContext => ({
    register: 'merc', commandName: 'Test Command', unitSizeName: 'Company', contextLabel: 'ctx',
    voices: { command: null, intelligence: null, engineering: null }, armorerClosing: null,
    pilotInfoOf: () => null, bayHistory: [], openJobs: {}, salvageClause: null, npcNamesByFlag: {}, unlocked: [], isHotspots,
});
const branch = (over: Partial<MissionBranch['resolution']>): MissionBranch => ({
    branchId: 'b1', name: 'Relay Station Kestrel', parentBranchId: null, outcomeGate: 'ANY', threat: 'LOW', state: 'RESOLVED',
    resolution: { outcomeTier: 'SUCCESS', answers: { primary: true, secondary: true, bonus: false, compromised: false }, ...over } as MissionBranch['resolution'],
});

describe('buildAarDocument — IMPORT-6 FOLLOWUPS objective marks + book grade', () => {
    it('renders the AUTHORED objectives with the GM marks + VP (single-sided), the VP tally + grade, and the HS tier line grade', () => {
        const d = buildAarDocument(branch({
            outcomeTier: 'SUCCESS',
            aar: { model: 'one', objectiveMarks: [{ text: 'Seize the relay', vp: 200, met: true, side: 'our' }, { text: 'Tag the command lance', vp: 100, met: false, side: 'our' }, { text: 'Exfiltrate clean', vp: 50, met: false, side: 'our' }] },
        }), ctx(true));
        const cmd = d.sections.find((s) => s.id === 'command')!;
        expect(cmd.headers).toEqual(['OBJECTIVE', 'VP', 'RESULT']);
        expect(cmd.rows!.map((r) => r.cells)).toEqual([['Seize the relay', '200', 'MET'], ['Tag the command lance', '100', 'NOT MET'], ['Exfiltrate clean', '50', 'NOT MET']]);
        expect(cmd.rows![0].tone).toBe('ok'); expect(cmd.rows![1].tone).toBe('bad');
        expect(cmd.paragraphs.some((p) => /Victory points — 200 of 350 authored; you met 1 of 3 objectives\. Outcome tier SUCCESS — successful \(500 SP × scale\)/.test(p))).toBeTrue();
        expect(d.tierLine).toBe('OUTCOME — SUCCESS · successful (500 SP × scale)');
    });
    it('two-sided: our column as rows, the opponent column as the note; a broke force is stated', () => {
        const d = buildAarDocument(branch({
            outcomeTier: 'FAILURE',
            answers: { primary: true, secondary: true, bonus: false, compromised: false, broke: true },
            aar: { model: 'two', objectiveMarks: [{ text: 'Hold the line', vp: 200, met: true, side: 'our' }, { text: 'Break through', vp: 250, met: true, side: 'opp' }] },
        }), ctx(true));
        const cmd = d.sections.find((s) => s.id === 'command')!;
        expect(cmd.rows!.length).toBe(1);
        expect(cmd.note).toContain('Break through (250 VP): MET');
        expect(cmd.paragraphs.some((p) => /yours 200, opponent 250; you met 1 of 1 objectives; your force broke \/ withdrew\. Outcome tier FAILURE — force broken \/ no pay/.test(p))).toBeTrue();
    });
    it('NO objectiveMarks (Traditional / legacy toggles) → the legacy Primary/Secondary/Bonus trio + a raw tier line, unchanged', () => {
        const d = buildAarDocument(branch({ aar: { objectives: { primary: 'P', secondary: 'S', bonus: 'B' } } }), ctx(false));
        const cmd = d.sections.find((s) => s.id === 'command')!;
        expect(cmd.headers).toEqual(['PRIORITY', 'OBJECTIVE', 'RESULT']);
        expect(cmd.rows!.map((r) => r.cells)).toEqual([['Primary', 'P', 'MET'], ['Secondary', 'S', 'MET'], ['Bonus', 'B', 'NOT MET']]);
        expect(d.tierLine).toBe('OUTCOME — SUCCESS');
        // Hot Spots with the legacy toggles (an objective-less track) keeps the trio but gains the grade suffix
        expect(buildAarDocument(branch({ aar: { objectives: { primary: 'P', secondary: 'S', bonus: 'B' } } }), ctx(true)).tierLine).toBe('OUTCOME — SUCCESS · successful (500 SP × scale)');
    });
});
