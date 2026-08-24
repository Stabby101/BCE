/*
 * DIRECTIVE-IMPORT-6 Part C — the D-116 preset's ADDITIVE full-objective model. Pins that a pre-IMPORT-6 preset
 * (three plain-text objectives, no `trackObjectives`) hydrates on read to VP 200/100/50 by kind + side 'both' with
 * empties dropped; that an authored `trackObjectives` list wins untouched (vp coerced); and that synthSeedFromPreset
 * keeps emitting the legacy `objectives` trio (byte-compat for old readers + the shared Forge render) AND carries the
 * full list (→ forge.trackObjectives at bind → the Part B per-objective resolve).
 */
import { presetObjectives, synthSeedFromPreset, type PresetTrack, type PresetObjective } from './chaos-track-preset';
import { TRACK_VP } from './track-setup';

const legacy = (over: Partial<PresetTrack> = {}): PresetTrack => ({
    id: 'p1', name: 'My Raid', family: 'OBJECTIVE_RAID', title: 'Break the Kathil Line', situation: 'A daring strike.',
    objectives: { primary: ' Destroy the depot ', secondary: 'Minimize losses', bonus: '' },
    opforSketch: { composition: 'an armor company', behavior: 'dug in' },
    createdAt: 1, ...over,
});

const FULL_LIST: PresetObjective[] = [
    { text: 'Hold the wall', vp: 300, kind: 'primary', side: 'defender' },
    { text: 'Kill the commander', vp: 150, kind: 'bonus', side: 'both' },
    { text: 'Second primary', vp: 100, kind: 'primary', side: 'both' },
];

describe('presetObjectives (IMPORT-6 Part C hydration)', () => {
    it('hydrates a LEGACY preset: text → objective with VP by kind (200/100/50), side both, empties dropped, text trimmed', () => {
        expect(TRACK_VP).toEqual({ primary: 200, secondary: 100, bonus: 50 });
        expect(presetObjectives(legacy())).toEqual([
            { text: 'Destroy the depot', vp: 200, kind: 'primary', side: 'both' },
            { text: 'Minimize losses', vp: 100, kind: 'secondary', side: 'both' },
        ]);
        expect(presetObjectives(legacy({ objectives: { primary: '', secondary: '', bonus: 'Only a bonus' } }))).toEqual([
            { text: 'Only a bonus', vp: 50, kind: 'bonus', side: 'both' },
        ]);
    });

    it('returns an authored trackObjectives list untouched (order, kind, side; vp coerced to a number)', () => {
        const p = legacy({ trackObjectives: [...FULL_LIST, { text: 'Stringy', vp: '75' as unknown as number, kind: 'secondary', side: 'attacker' }] });
        const out = presetObjectives(p);
        expect(out.length).toBe(4);
        expect(out.slice(0, 3)).toEqual(FULL_LIST);
        expect(out[3]).toEqual({ text: 'Stringy', vp: 75, kind: 'secondary', side: 'attacker' });
        // the legacy trio is IGNORED once a full list exists (it is a derived mirror, not a second source)
        expect(out.some((o) => o.text === 'Destroy the depot')).toBe(false);
    });
});

describe('synthSeedFromPreset (IMPORT-6 Part C — trio byte-compat + the full list on the seed)', () => {
    it('LEGACY preset: emits the stored objectives trio VERBATIM and the hydrated list', () => {
        const s = synthSeedFromPreset(legacy());
        expect(s.seedId).toBe('preset-p1');
        expect(s.objectives).toEqual({ primary: ' Destroy the depot ', secondary: 'Minimize losses', bonus: '' }); // untouched — no trim, no reorder
        expect(s.trackObjectives).toEqual([
            { text: 'Destroy the depot', vp: 200, kind: 'primary', side: 'both' },
            { text: 'Minimize losses', vp: 100, kind: 'secondary', side: 'both' },
        ]);
        expect(s.forks).toEqual([]);
        expect(s.register).toBe('chaos-preset');
    });

    it('FULL preset: the trio is derived FIRST-of-kind and the whole list is carried', () => {
        const s = synthSeedFromPreset(legacy({ trackObjectives: FULL_LIST }));
        expect(s.objectives).toEqual({ primary: 'Hold the wall', secondary: '', bonus: 'Kill the commander' }); // first primary wins; no secondary → ''
        expect(s.trackObjectives).toEqual(FULL_LIST);
    });

    it('FULL preset with NO primary-kind row: the trio\'s primary falls back to the FIRST objective (old readers never see a blank primary); secondary/bonus stay by kind', () => {
        const s = synthSeedFromPreset(legacy({ trackObjectives: [{ text: 'Screen the flank', vp: 100, kind: 'secondary', side: 'both' }, { text: 'Tag the HQ', vp: 50, kind: 'bonus', side: 'both' }] }));
        expect(s.objectives).toEqual({ primary: 'Screen the flank', secondary: 'Screen the flank', bonus: 'Tag the HQ' });
        expect(s.trackObjectives?.length).toBe(2);
    });

    it('carries the authored TRACK-SHEET fields (deployment / rules / track end / salvage / role) as seed.trackSheet — only when authored', () => {
        expect('trackSheet' in synthSeedFromPreset(legacy())).toBe(false);
        const s = synthSeedFromPreset(legacy({ deployment: ' Dug in on the ridge ', trackEnd: 'Ends turn 6', playerRole: 'defender', specialRules: '', salvagePolicy: undefined }));
        expect(s.trackSheet).toEqual({ deployment: 'Dug in on the ridge', trackEnd: 'Ends turn 6', playerRole: 'defender' });
    });

    it('an empty trio with no list → the seed carries NO trackObjectives key', () => {
        const s = synthSeedFromPreset(legacy({ objectives: { primary: '', secondary: '', bonus: '' } }));
        expect('trackObjectives' in s).toBe(false);
        expect(s.objectives).toEqual({ primary: '', secondary: '', bonus: '' });
    });
});
