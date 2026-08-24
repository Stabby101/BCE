/*
 * DIRECTIVE-IMPORT-7 Part C — track ↔ terrain coherence + the employer-echo de-dup. Pins: a title naming a biome wins over
 * a contradicting roll (the live "Reading the Jungle" on Tundra); a coherent roll is kept; terrain-agnostic texts keep the
 * roll; title outranks body; the lint predicate; and the NONE-narrator lead names the employer once with "the enemy" for
 * the unknown target.
 */
import { biomesMentioned, terrainContradicts, coherentTerrain, BIOME_KEYWORDS } from './track-terrain';
import { TERRAIN_TABLE, MISSION_TEMPLATES, leadSentence } from '../mission/mission-spec';

const T = (b: string) => TERRAIN_TABLE.find((e) => e.biome === b)!;

describe('track-terrain (IMPORT-7 Part C — the rolled biome must not contradict the track\'s words)', () => {
    it('every keyword biome exists in TERRAIN_TABLE (the rule can always resolve to a real entry)', () => {
        for (const k of BIOME_KEYWORDS) expect(TERRAIN_TABLE.some((e) => e.biome === k.biome)).toBeTrue();
    });
    it('the live repro: "Reading the Jungle … the Paraíso green" on a Tundra roll → Jungle', () => {
        const out = coherentTerrain(['Reading the Jungle', 'The column is out there in the Paraíso green, and the only way to find it is to go looking'], T('Tundra'));
        expect(out.biome).toBe('Jungle');
        expect(out.note).toBe(T('Jungle').note);
        expect(terrainContradicts(['Reading the Jungle'], 'Tundra')).toBeTrue();
        expect(terrainContradicts(['Reading the Jungle'], 'Jungle')).toBeFalse();
    });
    it('a coherent roll is KEPT even when the body also names other biomes', () => {
        expect(coherentTerrain(['Ridge-line Picket', 'from the ridge you can see the coast'], T('Mountain'))).toEqual(T('Mountain'));
        expect(coherentTerrain(['Ridge-line Picket', 'from the ridge you can see the coast'], T('Coastal'))).toEqual(T('Coastal'));
    });
    it('terrain-agnostic texts keep whatever was rolled (nothing to contradict) — the §18 template names, presets without biome words', () => {
        for (const e of TERRAIN_TABLE) expect(coherentTerrain(['Defend', 'A Defend action. Both forces use opposite long map edges.'], e)).toEqual(e);
        expect(biomesMentioned('Relay Station Kestrel')).toEqual([]);
        expect(terrainContradicts(['Relay Station Kestrel', 'break the picket'], 'Desert')).toBeFalse();
    });
    it('title outranks body: a title biome wins over a different body biome when the roll matches neither', () => {
        expect(coherentTerrain(['The Ford at Marrow Creek — Marsh Crossing', 'a city depot must fall'], T('Desert')).biome).toBe('Marshland');
        expect(coherentTerrain(['Fuel Depot', 'the refinery yards burn'], T('Tundra')).biome).toBe('Industrial sprawl');
    });
    it('a hot spot system profile counts (climate / description are in the priority list after the track texts)', () => {
        expect(coherentTerrain(['Convoy', undefined, null, 'Arctic world; permafrost year-round'], T('Desert')).biome).toBe('Tundra');
    });
});

describe('leadSentence (IMPORT-7 Part C bonus — the employer named once; the enemy named, not blanked)', () => {
    it('every mission template lead renders with NO leftover token and no doubled employer', () => {
        for (const [id, t] of Object.entries(MISSION_TEMPLATES)) {
            const s = leadSentence(t.lead);
            expect(s).not.toContain('{', `${id}: ${s}`);
            expect(s).not.toContain('}', `${id}: ${s}`);
            expect(/ {2}/.test(s)).toBeFalse();
        }
    });
    it('the tester line: recon dispositions → "recon enemy dispositions on its behalf" (was "… for Hot Spots Command")', () => {
        expect(leadSentence(MISSION_TEMPLATES.RECON_RAID.lead)).toBe('recon enemy dispositions on its behalf');
        expect(leadSentence(MISSION_TEMPLATES.GARRISON_DUTY.lead)).toBe('hold its ground against the enemy for the term of the contract');
        expect(leadSentence(MISSION_TEMPLATES.RELIEF_DUTY.lead)).toBe('break through to one of its besieged garrisons');
        expect(leadSentence(MISSION_TEMPLATES.PIRATE_HUNTING.lead)).toBe('hunt down the enemy raiders preying on it');
        expect(leadSentence(MISSION_TEMPLATES.GUERRILLA_WARFARE.lead)).toBe('wage a guerrilla campaign against the enemy in its interest');
    });
});
