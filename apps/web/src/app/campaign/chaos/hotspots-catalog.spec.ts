/*
 * DIRECTIVE-ERA-1 (rulings 2 + 4, 2026-09-02) — pins the Hot Spots CHAMBER predicate (the era/region filter
 * `hotSpotCatalog` runs — STRICT era equality, the IMPORT-2 custom bypass, region-null = general) that IMPORT-2
 * Part A asked for and never got, and the ERA-1 side rules: a Clan that does not hire mercenaries is never offered
 * as a side to fight FOR (the D-133 mirror goes side-A-only), while an Inner Sphere enemy still authors both sides.
 * Pure functions only — no TestBed. Mutation-kill notes are inline: each `it` names the regression it would catch.
 */
import { inChamber, factionHiresMercenaries, resolveSides, opposingFaction, type CatalogHotSpot } from './hotspots-catalog';

const hs = (over: Partial<CatalogHotSpot> = {}): CatalogHotSpot => ({
    id: 'hs-x', title: 'T', world: 'W', employer: 'Federated Suns — the district garrison command', type: 'Objective Raid', situation: '',
    systemProfile: {}, missionBrief: { complications: [], contractVictory: '' },
    tracks: [{ id: 't0', name: 'r', templateId: 'Objective', root: true, situation: '', deployment: '', objectives: [], trackEnd: '', salvagePolicy: '', opfor: { bvRatio: 1 }, forks: [] }],
    contract: { scale: 1, intensity: 1, lengthMonths: 1, steps: { basePay: 6, support: 5, transport: 6, salvage: 6, command: 6 }, enemyFaction: 'Draconis Combine' },
    era: 'ilclan', region: 'draconis-march', ...over,
} as unknown as CatalogHotSpot);

describe('ERA-1 · inChamber — the offer-board chamber predicate', () => {
    const authored = hs({ era: 'ilclan', region: 'draconis-march' });

    it('matches the campaign era EXACTLY (an ilclan pack lists for an ilclan campaign)', () => {
        expect(inChamber(authored, 'ilclan', null)).toBeTrue();
    });
    it('is STRICT — a 3050 (clan-invasion) campaign is never dealt ilclan content (kills a loosened/fallback filter)', () => {
        expect(inChamber(authored, 'clan-invasion', null)).toBeFalse();
        expect(inChamber(authored, 'clan-invasion', 'draconis-march')).toBeFalse();
    });
    it('is STRICT the other way — clan-invasion content never lists in an ilclan campaign', () => {
        expect(inChamber(hs({ era: 'clan-invasion', region: 'invasion-corridor' }), 'ilclan', null)).toBeFalse();
    });
    it('a null query era passes every era (the id-resolution pool), a null query region passes every region', () => {
        expect(inChamber(authored, null, null)).toBeTrue();
        expect(inChamber(hs({ era: 'clan-invasion', region: 'invasion-corridor' }), null, null)).toBeTrue();
        expect(inChamber(authored, 'ilclan', undefined)).toBeTrue();
    });
    it('region: the theater must match when both sides name one; a region-null (general) hot spot lists in every theater', () => {
        expect(inChamber(authored, 'ilclan', 'draconis-march')).toBeTrue();
        expect(inChamber(authored, 'ilclan', 'capellan-march')).toBeFalse();
        expect(inChamber(hs({ era: 'ilclan', region: null }), 'ilclan', 'capellan-march')).toBeTrue();
    });
    it('IMPORT-2 Part A — a CUSTOM hot spot always lists, regardless of era and theater', () => {
        const custom = hs({ custom: true, era: 'general', region: null });
        expect(inChamber(custom, 'clan-invasion', 'invasion-corridor')).toBeTrue();
        expect(inChamber(custom, 'star-league', 'capellan-march')).toBeTrue();
        // and the bypass is the custom stamp, not the 'general' era (kills a "general lists everywhere" regression)
        expect(inChamber(hs({ era: 'general', region: null }), 'clan-invasion', null)).toBeFalse();
    });
});

describe('ERA-1 · factionHiresMercenaries — Clans do not hire; the HS-modeled trading Clans do', () => {
    it('Inner Sphere states, Pirates and Mercenary commands hire', () => {
        for (const f of ['Draconis Combine', 'Federated Suns', 'Federated Commonwealth', 'Free Rasalhague Republic', 'Capellan Confederation', 'Pirates', 'Mercenary', 'ComStar', 'Local / planetary forces']) {
            expect(factionHiresMercenaries(f)).withContext(f).toBeTrue();
        }
    });
    it('the Invasion Clans do NOT (Smoke Jaguar, Ghost Bear, Wolf, Jade Falcon, Nova Cat, Steel Viper) — name-space of systems.json owners', () => {
        for (const f of ['Clan Smoke Jaguar', 'Clan Ghost Bear', 'Clan Wolf', 'Clan Jade Falcon', 'Clan Nova Cat', 'Clan Steel Viper', "Clan Hell's Horses"]) {
            expect(factionHiresMercenaries(f)).withContext(f).toBeFalse();
        }
    });
    it('the exception is exactly the MUL-allowlisted trading Clans (D-127): Sea Fox and Raven Alliance / Snow Raven', () => {
        expect(factionHiresMercenaries('Clan Sea Fox')).toBeTrue();
        expect(factionHiresMercenaries('Clan Diamond Shark')).toBeTrue(); // the alias — the catalog's name for Sea Fox
        expect(factionHiresMercenaries('Clan Snow Raven')).toBeTrue();
        expect(factionHiresMercenaries('Raven Alliance')).toBeTrue();
    });
    it('an empty/absent name hires (no enemy named = nothing to suppress)', () => {
        expect(factionHiresMercenaries('')).toBeTrue();
        expect(factionHiresMercenaries(undefined)).toBeTrue();
    });
});

describe('ERA-1 · resolveSides — a non-hiring Clan enemy makes the mirror side-A-only', () => {
    it('an Inner Sphere enemy still authors both sides (the D-133 provisional mirror — the NEGATIVE test)', () => {
        const s = resolveSides(hs({ contract: { ...hs().contract, enemyFaction: 'Draconis Combine' } }));
        expect(s.b).toBeDefined();
        expect(s.b!.employer).toBe('Draconis Combine');
        expect(s.b!.synthesized).toBeTrue();
        expect(opposingFaction(hs(), 'a')).toBe('Draconis Combine');
    });
    it('a Clan Smoke Jaguar enemy → side A only, and the OpFor for side A is still the Clan', () => {
        const h = hs({ contract: { ...hs().contract, enemyFaction: 'Clan Smoke Jaguar' } });
        const s = resolveSides(h);
        expect(s.b).toBeUndefined();
        expect(s.a.employer).toBe(h.employer);
        expect(opposingFaction(h, 'a')).toBe('Clan Smoke Jaguar');
    });
    it('a Clan Sea Fox enemy (a hiring Clan) keeps both sides', () => {
        expect(resolveSides(hs({ contract: { ...hs().contract, enemyFaction: 'Clan Sea Fox' } })).b).toBeDefined();
    });
    it('AUTHORED sides win verbatim — an author who wrote a Clan side B keeps it (the inference is mirror-only)', () => {
        const a = { key: 'a' as const, role: 'attacker' as const, employer: 'E', faction: 'Federated Suns', contract: hs().contract };
        const b = { key: 'b' as const, role: 'defender' as const, employer: 'Clan Wolf', faction: 'Clan Wolf', contract: { ...hs().contract, enemyFaction: 'Federated Suns' } };
        expect(resolveSides(hs({ sides: { a, b } })).b).toBe(b);
    });
    it('a single-sided FORGED record (`sides:{a}` + singleSided) resolves to its authored side A, no synthesized B', () => {
        const a = { key: 'a' as const, role: 'attacker' as const, employer: 'Free Rasalhague Republic — the border muster', faction: 'Free Rasalhague Republic', contract: { ...hs().contract, enemyFaction: 'Clan Ghost Bear' } };
        const h = hs({ sides: { a }, singleSided: true, contract: a.contract });
        const s = resolveSides(h);
        expect(s.a).toBe(a);
        expect(s.b).toBeUndefined();
        expect(opposingFaction(h, 'a')).toBe('Clan Ghost Bear');
    });
});
