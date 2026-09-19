import { parseHotspotText, draftToHotSpot, validateDraft, emptyDraft, emptySide, emptyHireable } from './hotspot-text-parser';
import { resolveSides, backfillSingleSided, type CatalogHotSpot } from './hotspots-catalog';
import { stepValue, CONTRACT_COLUMNS } from './chaos-contract-steps';
import { mercHireCharge } from './hire-personnel';

/** A minimal legacy/authored-shaped hot spot (no `sides`) that resolveSides can synthesize a provisional B from. */
const legacyHotSpot = (over: Partial<CatalogHotSpot> = {}): CatalogHotSpot => ({
    id: 'hs-legacy', title: 'T', world: 'W', employer: 'AFFS', type: 'Objective Raid', blurb: '', situation: '',
    systemProfile: {}, missionBrief: { complications: [], contractVictory: '' },
    tracks: [{ id: 't0', name: 'r', templateId: 'Objective', root: true, situation: '', deployment: '', objectives: [], trackEnd: '', salvagePolicy: '', opfor: { armsMix: 'MECH_ONLY' }, forks: [] }],
    contract: { scale: 1, intensity: 1, lengthMonths: 1, steps: { basePay: 6, support: 5, transport: 6, salvage: 6, command: 6 }, enemyFaction: 'Draconis Combine' },
    era: 'general', region: null, ...over,
} as unknown as CatalogHotSpot);

const SAMPLE = `Operation: Break the Kathil Line
Employer: Federated Suns
Type of Action: Objective Raid
Location: Kathil (Urban)
Length of Contract: 3
Intensity: 2
Scale: 2
Base Pay: 120% (7)
Support: Straight (5)
Transportation: 50% (4)
Salvage Rights: 40% (6)
Command Rights: House (3)
Additional Requirements: Minimum 2,000 BV
Bonus: Battle-loss comp 50%

Track 1: Fort Bourgogne Walls
Situation: The line must hold at the wall.
Deployment: Defender sets up within 3 hexes of the wall.
Attacker: Draconis Combine
Defender: Federated Suns
Objectives:
- Hold the wall to turn 10 (200)
- Destroy the breach team — 150
Special Rules: Night combat.
Track End: One side has no units, or turn 12.
Salvage: WINNER-ALL

Track 2: The Pursuit
Situation: Run the raiders off the road.
Objectives:
- Cripple 2 fleeing lances (100)`;

describe('parseHotspotText — §16 label map', () => {
    it('maps the identity + contract labels (and takes the STEP, not the %, for negotiated terms)', () => {
        const d = parseHotspotText(SAMPLE);
        expect(d.title).toBe('Break the Kathil Line');
        expect(d.employer).toBe('Federated Suns');
        expect(d.type).toBe('Objective Raid');
        expect(d.world).toBe('Kathil'); // terrain parenthetical stripped
        expect(d.lengthMonths).toBe(3);
        expect(d.intensity).toBe(2);
        expect(d.scale).toBe(2);
        expect(d.basePay).toBe(7);   // "120% (7)" → the step
        expect(d.support).toBe(5);
        expect(d.transport).toBe(4);
        expect(d.salvage).toBe(6);
        expect(d.command).toBe(3);
        expect(d.additionalRequirements).toContain('2,000 BV');
        expect(d.bonus).toContain('Battle-loss');
    });

    it('splits Track blocks and maps their fields', () => {
        const d = parseHotspotText(SAMPLE);
        expect(d.tracks.length).toBe(2);
        const t0 = d.tracks[0];
        expect(t0.name).toBe('Fort Bourgogne Walls');
        expect(t0.situation).toContain('line must hold');
        expect(t0.deployment).toContain('within 3 hexes');
        expect(t0.opforFaction).toBe('Federated Suns'); // Defender wins over Attacker (best-effort OpFor)
        expect(t0.trackEnd).toContain('turn 12');
        expect(t0.salvagePolicy).toBe('WINNER-ALL');
        expect(d.tracks[1].name).toBe('The Pursuit');
    });

    it('reads each objective line with its trailing VP', () => {
        const t0 = parseHotspotText(SAMPLE).tracks[0];
        expect(t0.objectives.length).toBe(2);
        expect(t0.objectives[0].text).toBe('Hold the wall to turn 10');
        expect(t0.objectives[0].vp).toBe(200); // "(200)" not "10"
        expect(t0.objectives[1].text).toBe('Destroy the breach team');
        expect(t0.objectives[1].vp).toBe(150); // "— 150"
        expect(parseHotspotText(SAMPLE).tracks[1].objectives[0].vp).toBe(100);
    });

    it('never throws on empty / unlabelled text (returns the empty draft)', () => {
        expect(parseHotspotText('').tracks.length).toBe(1);
        expect(parseHotspotText('just some prose with no labels').title).toBe('');
    });
});

describe('validateDraft (strict save) + draftToHotSpot (builder)', () => {
    it('rejects an empty draft (no title, no objective text)', () => {
        expect(validateDraft(emptyDraft()).length).toBeGreaterThan(0);
    });

    it('builds a valid HotSpot: root track, linear fork chain, contract steps, VP', () => {
        const d = parseHotspotText('Operation: X\nBase Pay: 100% (6)\nTrack 1: A\nObjectives:\n- Do the thing (100)\nTrack 2: B\nObjectives:\n- Finish it (50)');
        expect(validateDraft(d)).toEqual([]);
        const hs = draftToHotSpot(d);
        expect(hs.tracks[0].root).toBe(true);
        expect(hs.tracks[0].forks[0].nextTrackId).toBe('t1'); // i → i+1 (linear)
        expect(hs.tracks[1].forks).toEqual([]);               // last track ends the tree
        expect(hs.contract.steps.basePay).toBe(6);
        expect(hs.tracks[0].objectives[0].vp).toBe(100);
        expect(hs.title).toBe('X');
    });

    it('Part D — snaps every contract step to a VALID (non-—) in-range step (no dead terms)', () => {
        const d = emptyDraft();
        d.title = 'Z'; d.basePay = 99; d.command = 0; d.transport = 2; d.salvage = 13;
        d.tracks[0].name = 'root'; d.tracks[0].objectives = [{ text: 'obj', vp: 50, kind: 'primary', side: 'both' }];
        const hs = draftToHotSpot(d);
        expect(hs.contract.steps.basePay).toBe(16);   // 99 → clamped to the top valid step (200%)
        expect(hs.contract.steps.command).toBe(2);    // 0 → nearest valid (Integrated); the old flat clamp left it on a dead —
        expect(hs.contract.steps.transport).toBe(4);  // 2 → nearest valid transport (0%) — was blank + non-negotiable
        expect(hs.contract.steps.salvage).toBe(12);   // 13 → nearest valid at/below (100%)
        // the invariant: EVERY emitted step resolves to a real value (never a dead —), so it renders + negotiates
        for (const col of CONTRACT_COLUMNS) expect(stepValue(col, hs.contract.steps[col])).not.toBeNull();
    });
});

describe('tracks are OPTIONAL (universal-library play)', () => {
    it('a titled hot spot with NO meaningful tracks is VALID and builds with empty tracks[]', () => {
        const d = emptyDraft(); d.title = 'Library Op'; // the default track row is left pristine → ignored
        expect(validateDraft(d)).toEqual([]);
        const hs = draftToHotSpot(d);
        expect(hs.tracks).toEqual([]); // 0 embedded tracks → draws from the universal library at play time
        expect(hs.title).toBe('Library Op');
        expect(hs.contract).toBeDefined(); // the contract terms still ship
    });

    it('a HALF-built track (name, no objective) is a save error', () => {
        const d = emptyDraft(); d.title = 'X'; d.tracks[0].name = 'Half';
        const errs = validateDraft(d);
        expect(errs.length).toBeGreaterThan(0);
        expect(errs.join(' ')).toContain('Half');
    });

    it('an embedded 1-track hot spot still builds a root track (backward-compat)', () => {
        const d = emptyDraft(); d.title = 'Authored'; d.tracks[0].name = 'Root'; d.tracks[0].objectives = [{ text: 'hold', vp: 200, kind: 'primary', side: 'both' }];
        expect(validateDraft(d)).toEqual([]);
        const hs = draftToHotSpot(d);
        expect(hs.tracks.length).toBe(1);
        expect(hs.tracks[0].root).toBe(true);
        expect(hs.tracks[0].forks).toEqual([]);
    });
});

describe('one-sided / two-sided emission', () => {
    const twoSided = () => {
        const d = emptyDraft();
        d.title = 'Opposed Op'; d.twoSided = true;
        d.sideA = { ...emptySide('attacker'), title: 'Break the Thrust', employer: 'AFFS High Command', faction: 'Federated Suns', basePay: 6, blurb: 'Break the thrust.' };
        d.sideB = { ...emptySide('defender'), title: 'Hold the Line', employer: 'DCMS', faction: 'Draconis Combine', basePay: 7, blurb: 'Hold the line.' };
        return d;
    };

    it('single-sided emits NO `sides` (byte-unchanged)', () => {
        const d = emptyDraft(); d.title = 'Single';
        expect(draftToHotSpot(d).sides).toBeUndefined();
    });

    it('two-sided emits a complete opposed pair with DERIVED enemyFaction', () => {
        const hs = draftToHotSpot(twoSided());
        expect(hs.sides).toBeDefined();
        expect(hs.sides!.a.role).toBe('attacker');
        expect(hs.sides!.b!.role).toBe('defender');
        expect(hs.sides!.a.faction).toBe('Federated Suns');
        expect(hs.sides!.b!.faction).toBe('Draconis Combine');
        expect(hs.sides!.a.contract.enemyFaction).toBe('Draconis Combine'); // OpFor = the OTHER side
        expect(hs.sides!.b!.contract.enemyFaction).toBe('Federated Suns');
        expect(hs.sides!.a.contract.steps.basePay).toBe(6);
        expect(hs.sides!.b!.contract.steps.basePay).toBe(7);
        expect(hs.sides!.a.synthesized).toBeUndefined(); // authored, not best-effort
        expect(hs.employer).toBe('AFFS High Command');    // top-level from side A
        expect(hs.contract.enemyFaction).toBe('Draconis Combine'); // top-level = side A's view (legacy readers)
    });

    it('enforces opposed roles at emission (Side B is the opposite of Side A even if the draft is malformed)', () => {
        const d = twoSided(); d.sideB.role = 'attacker'; // malformed same-role draft
        expect(draftToHotSpot(d).sides!.b!.role).toBe('defender');
    });

    it('a complete pair validates; a half-filled / same-role / duplicate-faction pair is a save error', () => {
        expect(validateDraft(twoSided())).toEqual([]);
        const half = twoSided(); half.sideB.faction = '';
        expect(validateDraft(half).some((e) => /Side B/.test(e))).toBe(true);
        const sameRole = twoSided(); sameRole.sideB.role = 'attacker';
        expect(validateDraft(sameRole).some((e) => /opposed/.test(e))).toBe(true);
        const dupFac = twoSided(); dupFac.sideB.faction = 'Federated Suns';
        expect(validateDraft(dupFac).some((e) => /different factions/.test(e))).toBe(true);
    });

    it('resolveSides reads the builder\'s authored sides VERBATIM (the engine handshake — no resolve change)', () => {
        const hs = draftToHotSpot(twoSided());
        const cat = { ...hs, id: 'hs-custom-x', era: 'general', region: null } as CatalogHotSpot;
        const sides = resolveSides(cat);
        expect(sides).toBe(cat.sides!);             // returned verbatim (authored win)
        expect(sides.a.faction).toBe('Federated Suns');
        expect(sides.b!.faction).toBe('Draconis Combine');
    });
});

describe('single-sided flag (C), transport carries (D), per-side identity (E)', () => {
    const withTrack = (d: ReturnType<typeof emptyDraft>) => { d.tracks[0].name = 'root'; d.tracks[0].objectives = [{ text: 'obj', vp: 50, kind: 'primary', side: 'both' }]; return d; };

    it('Part C — a single-sided build emits `singleSided:true` and resolveSides returns EXACTLY one side (no synthesized B)', () => {
        const d = withTrack(emptyDraft()); d.title = 'Solo'; d.employer = 'AFFS'; d.enemyFaction = 'Draconis Combine';
        const hs = draftToHotSpot(d);
        expect(hs.singleSided).toBe(true);
        expect(hs.sides).toBeUndefined();
        const cat = { ...hs, id: 'hs-x', era: 'general', region: null } as CatalogHotSpot;
        const s = resolveSides(cat);
        expect(s.a).toBeDefined();
        expect(s.b).toBeUndefined(); // no phantom opponent
    });

    it('Part C — a flag-LESS (legacy/authored) hotspot still synthesizes a provisional B (byte-unchanged)', () => {
        const s = resolveSides(legacyHotSpot());
        expect(s.b).toBeDefined();
        expect(s.b!.synthesized).toBe(true);
    });

    it('Part D — transport (and every term) carries from the builder to a VALID negotiable step (the tester bug: transport blank/non-negotiable)', () => {
        // the old default put command on a dead — step; the whole point is that a fresh build is fully negotiable
        const hs = draftToHotSpot(withTrack(emptyDraft()));
        for (const col of CONTRACT_COLUMNS) expect(stepValue(col, hs.contract.steps[col])).not.toBeNull();
        expect(stepValue('transport', hs.contract.steps.transport)).toBe(50); // the valid default (50%), not '—'
    });

    it('Part E — two-sided carries per-side title/type/situation/employerDesc; top-level falls back to side A', () => {
        const d = emptyDraft(); d.twoSided = true;
        d.sideA = { ...emptySide('attacker'), title: 'Break the Thrust', type: 'Objective Raid', employer: 'AFFS', employerDesc: 'The Federated Suns high command.', faction: 'Federated Suns', situation: 'Shatter the salient.', basePay: 6 };
        d.sideB = { ...emptySide('defender'), title: 'Hold the Line', type: 'Garrison', employer: 'DCMS', employerDesc: 'The Combine defenders.', faction: 'Draconis Combine', situation: 'Hold at all costs.', basePay: 7 };
        const hs = draftToHotSpot(d);
        expect(hs.sides!.a.title).toBe('Break the Thrust');
        expect(hs.sides!.b!.title).toBe('Hold the Line');
        expect(hs.sides!.a.type).toBe('Objective Raid');
        expect(hs.sides!.b!.type).toBe('Garrison');
        expect(hs.sides!.a.situation).toBe('Shatter the salient.');
        expect(hs.sides!.b!.employerDesc).toBe('The Combine defenders.');
        // top-level (legacy / `sides`-less reader + offer-card world header) falls back to side A
        expect(hs.title).toBe('Break the Thrust');
        expect(hs.type).toBe('Objective Raid');
        expect(hs.situation).toBe('Shatter the salient.');
        expect(hs.employerDesc).toBe('The Federated Suns high command.');
        expect(hs.world).toBe(''); // world stays SHARED (blank here — not pulled per-side)
    });

    it('Part E — validation requires a title per side, and blocks a half-filled pair', () => {
        const d = emptyDraft(); d.twoSided = true;
        d.sideA = { ...emptySide('attacker'), title: 'A', employer: 'AFFS', faction: 'Federated Suns' };
        d.sideB = { ...emptySide('defender'), title: '', employer: 'DCMS', faction: 'Draconis Combine' };
        expect(validateDraft(d).some((e) => /Side B needs an operation title/.test(e))).toBe(true);
        d.sideB.title = 'B';
        expect(validateDraft(d)).toEqual([]);
    });

    it('Part F — a free-text planet description emits onto systemProfile.description', () => {
        const d = withTrack(emptyDraft()); d.title = 'P'; d.planetDescription = 'A windswept border world of black basalt.';
        expect(draftToHotSpot(d).systemProfile.description).toBe('A windswept border world of black basalt.');
    });
});

describe('singleSided backfill (custom hot spots built before the two-sided toggle)', () => {
    it('a CUSTOM hot spot with no sides + no flag is backfilled to singleSided → resolveSides returns ONE side', () => {
        const h = backfillSingleSided(legacyHotSpot({ custom: true }));
        expect(h.singleSided).toBe(true);
        expect(resolveSides(h).b).toBeUndefined(); // no phantom opponent
    });

    it('an AUTHORED/premade hot spot with no sides is NOT touched → still synthesizes a provisional B', () => {
        const h = backfillSingleSided(legacyHotSpot({ custom: false }));
        expect(h.singleSided).toBeUndefined();
        const s = resolveSides(h);
        expect(s.b).toBeDefined();
        expect(s.b!.synthesized).toBe(true);
    });

    it('a custom TWO-sided build (has sides) is NOT flagged single-sided', () => {
        const sides = { a: {}, b: {} } as CatalogHotSpot['sides'];
        expect(backfillSingleSided(legacyHotSpot({ custom: true, sides })).singleSided).toBeUndefined();
    });

    it('an explicit singleSided (true or false) is preserved — the backfill only fills undefined', () => {
        expect(backfillSingleSided(legacyHotSpot({ custom: true, singleSided: true })).singleSided).toBe(true);
        expect(backfillSingleSided(legacyHotSpot({ custom: true, singleSided: false })).singleSided).toBe(false);
    });
});

describe('Part D — hireable special personnel (authoring + round-trip)', () => {
    /** A saveable single-sided draft (title + no meaningful tracks = library play) to hang hireable rows on. */
    const titled = () => { const d = emptyDraft(); d.title = 'Hire Op'; return d; };

    it('emits authored rows onto hireable[] with blank optionals OMITTED (a "" chassis would defeat buildMercInstance\'s ?? chain)', () => {
        const d = titled();
        d.hireable = [
            { ...emptyHireable(), name: '  Captain Vasquez ', role: ' Ace lance leader', gunnery: 2.4, piloting: 3, edge: 2, chassis: 'Marauder', model: ' MAD-3R ', bv: 1363, spCost: 300.6, oneTimeHire: true },
            { ...emptyHireable(), name: 'Sgt. Okafor', role: 'Scout', gunnery: 4, piloting: 5, edge: 0, chassis: '', model: '', bv: 0, spCost: 100, oneTimeHire: false },
        ];
        expect(validateDraft(d)).toEqual([]);
        const hs = draftToHotSpot(d);
        expect(hs.hireable).toEqual([
            { name: 'Captain Vasquez', role: 'Ace lance leader', gunnery: 2, piloting: 3, edge: 2, chassis: 'Marauder', model: 'MAD-3R', bv: 1363, spCost: 301, oneTimeHire: true },
            { name: 'Sgt. Okafor', role: 'Scout', gunnery: 4, piloting: 5, spCost: 100 },
        ]);
        // the omissions are REAL absences, not undefined-valued keys (JSON export drops undefined anyway, but the in-memory shape must match too)
        const second = hs.hireable![1];
        expect('chassis' in second).toBe(false);
        expect('model' in second).toBe(false);
        expect('edge' in second).toBe(false);
        expect('bv' in second).toBe(false);
        expect('oneTimeHire' in second).toBe(false);
    });

    it('emits NO hireable key when none are authored (every existing emit stays byte-identical)', () => {
        const hs = draftToHotSpot(titled());
        expect('hireable' in hs).toBe(false);
        // a hand-built / older-shape draft with the field missing entirely is tolerated too
        const legacy = titled() as Partial<ReturnType<typeof emptyDraft>>;
        delete legacy.hireable;
        expect(validateDraft(legacy as ReturnType<typeof emptyDraft>)).toEqual([]);
        expect('hireable' in draftToHotSpot(legacy as ReturnType<typeof emptyDraft>)).toBe(false);
    });

    it('drops a pristine (＋Add\'d, untouched) row and rejects a STARTED row without a name', () => {
        const d = titled();
        d.hireable = [emptyHireable()]; // pristine → not meaningful → ignored, not an error
        expect(validateDraft(d)).toEqual([]);
        expect('hireable' in draftToHotSpot(d)).toBe(false);
        d.hireable = [{ ...emptyHireable(), role: 'Sniper' }]; // started (a role) but nameless → save error
        expect(validateDraft(d).some((e) => /Special personnel row 1 needs a name/.test(e))).toBe(true);
    });

    it('rejects duplicate specialist names, case-insensitive + trimmed (the deploy panel tracks + keys one-time-paid by name)', () => {
        const d = titled();
        d.hireable = [{ ...emptyHireable(), name: 'Vasquez' }, { ...emptyHireable(), name: '  vasquez ' }];
        expect(validateDraft(d).some((e) => /unique name/.test(e))).toBe(true);
        d.hireable[1].name = 'Okafor';
        expect(validateDraft(d)).toEqual([]);
    });

    it('survives the JSON export→import round-trip (export = the whole HotSpot JSON; import spreads it back)', () => {
        const d = titled();
        d.hireable = [{ ...emptyHireable(), name: 'Vasquez', role: 'Ace', chassis: 'Marauder', spCost: 300, oneTimeHire: true }];
        const built = draftToHotSpot(d);
        const back = JSON.parse(JSON.stringify(built)) as typeof built;
        expect(back.hireable).toEqual(built.hireable);
        expect(back.hireable).toEqual([{ name: 'Vasquez', role: 'Ace', gunnery: 4, piloting: 5, edge: 1, chassis: 'Marauder', spCost: 300, oneTimeHire: true }]);
    });

    it('a builder-emitted hireable charges correctly through the deploy-hire engine (per track = spCost; one-time already paid → 0)', () => {
        const d = titled();
        d.hireable = [
            { ...emptyHireable(), name: 'Per-Track Pete', spCost: 150 },
            { ...emptyHireable(), name: 'One-Time Olga', spCost: 400, oneTimeHire: true },
        ];
        const [perTrack, oneTime] = draftToHotSpot(d).hireable!;
        expect(mercHireCharge(perTrack, [])).toBe(150);
        expect(mercHireCharge(perTrack, ['Per-Track Pete'])).toBe(150); // per-track: paying before never makes it free
        expect(mercHireCharge(oneTime, [])).toBe(400);
        expect(mercHireCharge(oneTime, ['One-Time Olga'])).toBe(0);      // one-time + already paid this contract → free re-field
    });
});
