import { inChamber, factionHiresMercenaries, factionHiresCommand, hirableSides, resolveSides, opposingFaction, type CatalogHotSpot } from './hotspots-catalog';

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
    it('Part A — a CUSTOM hot spot always lists, regardless of era and theater', () => {
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
    it('the exception is exactly the MUL-allowlisted trading Clans Sea Fox and Raven Alliance / Snow Raven', () => {
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
    it('an Inner Sphere enemy still authors both sides (the provisional mirror — the NEGATIVE test)', () => {
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

describe('ORDER-15 (a) · factionHiresCommand / hirableSides — the hiring predicate keys on the command\u2019s AFFILIATION', () => {
    it('a MERCENARY command (the default, null, and every older save) → the ERA-1 rule verbatim', () => {
        for (const aff of [null, undefined, '', 'Mercenary']) {
            expect(factionHiresCommand('Federated Suns', aff)).withContext(String(aff)).toBeTrue();
            expect(factionHiresCommand('Clan Smoke Jaguar', aff)).withContext(String(aff)).toBeFalse();
            expect(factionHiresCommand('Clan Sea Fox', aff)).withContext(String(aff)).toBeTrue();
        }
    });
    it('a HOUSE command is hired by its OWN faction (the employer resolves to the same MUL key) and by employers that are no faction at all', () => {
        expect(factionHiresCommand('Federated Suns — the district garrison command', 'Federated Suns')).toBeTrue();
        expect(factionHiresCommand('Federated Suns', 'Federated Suns')).toBeTrue();
        expect(factionHiresCommand('Local / planetary forces', 'Federated Suns')).toBeTrue();
        expect(factionHiresCommand('Kathil Agricorp', 'Federated Suns')).toBeTrue(); // a corporation — no faction key
        expect(factionHiresCommand('', 'Federated Suns')).toBeTrue();
    });
    it('a HOUSE command is NEVER hired by a foreign faction — a House, a Clan, a hiring Clan, the pirates', () => {
        for (const emp of ['Draconis Combine', 'Combine', 'Clan Sea Fox', 'Clan Smoke Jaguar', 'Pirates', 'Capellan Confederation']) {
            expect(factionHiresCommand(emp, 'Federated Suns')).withContext(emp).toBeFalse();
        }
    });
    it('hirableSides: a merc command takes both sides; an FS command only the FS side; a Combine command only the Combine side; a Lyran command neither', () => {
        const h = hs(); // employer FS · enemy Draconis Combine → sides a (FS) + b (the Combine mirror)
        expect(hirableSides(h, 'Mercenary').map((x) => x.key)).toEqual(['a', 'b']);
        expect(hirableSides(h, null).map((x) => x.key)).toEqual(['a', 'b']);
        expect(hirableSides(h, 'Federated Suns').map((x) => x.key)).toEqual(['a']);
        expect(hirableSides(h, 'Draconis Combine').map((x) => x.key)).toEqual(['b']);
        expect(hirableSides(h, 'Lyran Commonwealth')).toEqual([]); // no side hires it → the offer board does not deal this hot spot to it
    });
    it('a generic employer (planetary) hires any House command; the mirror side against a House still does not', () => {
        const h = hs({ employer: 'Local / planetary forces', contract: { ...hs().contract, enemyFaction: 'Draconis Combine' } });
        expect(hirableSides(h, 'Federated Suns').map((x) => x.key)).toEqual(['a']);
        expect(hirableSides(h, 'Draconis Combine').map((x) => x.key)).toEqual(['a', 'b']); // its own side (b) AND the planetary side (a)
    });
});
