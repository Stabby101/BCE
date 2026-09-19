
export interface PilotAbility {
    /** Kebab-case stable id, e.g. 'blood-stalker', 'terrain-master-frogman'. */
    id: string;
    name: string;
    /** Point cost (CamOps pp. 73–74 summary tables). Lucky is variable — see its note. */
    points: number;
    /** Mechanical effect, condensed 1-1 from the extract (all numbers/modifiers exact). */
    rulesText: string;
    /** Unit-type / terrain / weapon validity and prerequisites, where the extract has them. */
    restrictions?: string;
    /** Carries extract ambiguities or caveats verbatim rather than resolving them (T-022). */
    note?: string;
    sourcePage: string;
}

export const PILOT_ABILITIES: PilotAbility[] = [
    // ── General SPAs ────────────────────────────────────────────────────────
    {
        id: 'animal-mimicry',
        name: 'Animal Mimicry',
        points: 2,
        rulesText:
            '–1 target modifier on all PSRs required for Quad designs. Animal-like flexibility: ' +
            '–1 MP per hex of light, heavy, or ultra-heavy woods/jungle. +1 on any Morale Check ' +
            'made against this unit; –1 target modifier to the Demoralizer PSR when paired with ' +
            'the Demoralizer SPA.',
        restrictions: 'Quad \'Mechs and ProtoMechs with an animal-like appearance.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'antagonizer',
        name: 'Antagonizer',
        points: 3,
        rulesText:
            'Select an opponent within 10 hexes and LOS. Replace a weapon attack with a PSR at ' +
            '+4 target modifier. On success the target is enraged for turns equal to the margin ' +
            'of success: it must move at best speed toward the Antagonizer and must attack only ' +
            'the Antagonizer. Rage breaks on damage from another unit, or if the Antagonizer ' +
            'moves more than 10 hexes away. One antagonize attempt per turn; re-attempting on an ' +
            'already-enraged target takes a +4 target modifier.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'blood-stalker',
        name: 'Blood Stalker',
        points: 2,
        rulesText:
            'Designate one target per scenario. –1 to-hit against the designated target; +2 ' +
            'to-hit against any other target. The modifier deactivates on the End Phase of the ' +
            'turn after the target is destroyed, defeated, or retreats.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'cluster-hitter',
        name: 'Cluster Hitter',
        points: 2,
        rulesText:
            'Aimed Shot mode: all cluster rounds land in the targeted location (per Marksman ' +
            'rules). When NOT making the focused shot: +1 roll modifier on the Cluster Hits ' +
            'Table for applicable weapons.',
        restrictions:
            'Clustering weapons only (missile, rocket, ultra/rotary AC, LB-X). Incompatible ' +
            'with Oblique Attacker and Sandblaster.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'combat-intuition',
        name: 'Combat Intuition',
        points: 3,
        rulesText:
            'Declare a focus during the End Phase; the pilot takes 1 point of pilot damage (no ' +
            'consciousness roll). Next turn the unit acts after every other unit, or may ' +
            'pre-empt a chosen target and act before that target acts. May be used every turn, ' +
            'but the pilot damage stacks.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'cross-country',
        name: 'Cross-Country',
        points: 2,
        rulesText:
            'The vehicle may pass through water as if 1 depth shallower, and may enter woods, ' +
            'rubble, and rough terrain normally restricted to it at 2× the MP cost a \'Mech ' +
            'would pay.',
        restrictions: 'Combat Vehicles (ground motive only).',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'demoralizer',
        name: 'Demoralizer',
        points: 3,
        rulesText:
            'Target within 10 hexes and LOS. Replace a weapon attack with a PSR at +4 target ' +
            'modifier. On success the target is demoralized for 1 turn: it cannot move faster ' +
            'than Walk/Cruise/Safe Thrust, cannot move closer to the Demoralizer, and takes +1 ' +
            'to-hit on all attacks. The Demoralizer may still fire and move normally while ' +
            'using the ability.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'dodge',
        name: 'Dodge',
        points: 2,
        rulesText:
            'PSR opposed to the enemy\'s physical attack roll; if the margin of success exceeds ' +
            'the attacker\'s, the attack misses. One Dodge roll covers all physical attacks made ' +
            'against the unit that turn.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'eagles-eyes',
        name: 'Eagle\'s Eyes',
        points: 2,
        rulesText:
            'Functions as a Beagle Active Probe with 1-hex range (stacks with an actual probe: ' +
            '+1 hex). +2 target modifier vs. minefield/booby trap/trap attacks. –2 target ' +
            'modifier to clear minefields/traps if the unit can do so.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'environmental-specialist',
        name: 'Environmental Specialist',
        points: 2,
        rulesText:
            'Choose one environmental condition (wind, rain, snow/ice, etc.). Halve (round ' +
            'down) all movement and PSR penalties from that environment. –1 to-hit modifier for ' +
            'all attacks made under those conditions.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'fist-fire',
        name: 'Fist Fire',
        points: 2,
        rulesText:
            'On a successful physical arm attack that inflicts damage: fire one arm-mounted ' +
            'weapon at –1 to-hit, with damage applied to the same hit location.',
        restrictions:
            '\'Mechs, ProtoMechs. Requires an arm with full actuation AND at least 1 ' +
            'direct-fire energy/ballistic weapon.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'forward-observer',
        name: 'Forward Observer',
        points: 1,
        rulesText:
            'When spotting for artillery: the artillery unit gets a –1 target modifier. When ' +
            'adjusting fire: an additional –2 target modifier until the target is struck. Can ' +
            'spot without imposing the "spotter fired" to-hit penalty on the artillery.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'heavy-lifter',
        name: 'Heavy Lifter',
        points: 1,
        rulesText: 'Lift, carry, drag, and throw objects 50% heavier than rated.',
        restrictions: '\'Mechs.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'hopper',
        name: 'Hopper',
        points: 1,
        rulesText:
            'On the turn a leg is blown off: if all required PSRs succeed (including the +5 for ' +
            'the missing leg), the \'Mech stays up. Even on a failed roll: –2 on the ' +
            'pilot-damage PSR. While one-legged: 2 MP of Running movement per turn (no reverse, ' +
            'no sprint).',
        restrictions: '\'Mechs.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'hot-dog',
        name: 'Hot Dog',
        points: 2,
        rulesText:
            '–1 to any roll to avoid overheat effects (shutdown, ammo explosion, pilot damage, ' +
            'random movement from heat).',
        restrictions: '\'Mechs, Aerospace Fighters.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'human-tro',
        name: 'Human TRO',
        points: 1,
        rulesText:
            'Designate one unit type at the start of the scenario (\'Mech, vehicle, aero, ' +
            'battle armor). +1 modifier to rolls on the Determining Critical Hits Table when ' +
            'facing that type.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'iron-will',
        name: 'Iron Will',
        points: 2,
        rulesText:
            'Opponents using Animal Mimicry, Antagonizer, or Demoralizer against this unit take ' +
            'a +2 target modifier on their PSR. If Morale rules are in play: –2 modifier on all ' +
            'routing / morale-recovery rolls.',
        restrictions: 'Any unit.',
        note:
            'CamOps internal inconsistency carried from the extract: the summary table on p. 73 ' +
            'lists Iron Will at 2 pts, but the full description on p. 78 says 1 pt. The extract ' +
            'directs using 2 pts (matches later errata and other SPA lists); flag if canon ' +
            'resolves.',
        sourcePage: 'CamOps p. 73 (table) / p. 78 (description)',
    },
    {
        id: 'jumping-jack',
        name: 'Jumping Jack',
        points: 2,
        rulesText: 'Attacker movement modifier when jumping: reduced from +3 to +1.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'lucky',
        name: 'Lucky',
        points: 1,
        rulesText:
            'Per point spent: 1 reroll of a failed Attack OR Piloting Skill Roll per scenario. ' +
            'The second roll stands even if worse. Cannot be used on crit checks, hull breach, ' +
            'Initiative, or Morale rolls.',
        restrictions: 'Any unit.',
        note:
            'Variable cost — the only variable-cost SPA in the extract: purchasable at 1–4 ' +
            'points, each point granting 1 reroll per scenario. `points` carries the 1-point ' +
            'minimum. Extract provenance pins full descriptions to pp. 74–78 (Animal Mimicry → ' +
            'Light Horseman) and pp. 79–82 (Marksman → Tactical Genius); Lucky falls ' +
            'alphabetically between the anchors, so its exact page is not pinned.',
        sourcePage: 'CamOps pp. 74–82',
    },
    {
        id: 'maneuvering-ace',
        name: 'Maneuvering Ace',
        points: 2,
        rulesText:
            'Bipedal \'Mechs and VTOLs at Cruising speed: may perform a Quad-style lateral ' +
            'shift. Quad \'Mechs: lateral shift costs 1 less MP. Vehicles: +1 target modifier ' +
            'on PSRs for failed turn modes. Aerospace: Thrust Point cost for special maneuvers ' +
            'reduced by 1. All units: –1 target modifier on PSRs to avoid skid / sideslip / ' +
            'out-of-control.',
        restrictions: 'Any non-infantry unit.',
        note:
            'Extract provenance pins full descriptions to pp. 74–78 (Animal Mimicry → Light ' +
            'Horseman) and pp. 79–82 (Marksman → Tactical Genius); Maneuvering Ace falls ' +
            'alphabetically between the anchors, so its exact page is not pinned.',
        sourcePage: 'CamOps pp. 74–82',
    },
    {
        id: 'marksman',
        name: 'Marksman',
        points: 2,
        rulesText:
            'Make an Aimed Shot as if equipped with a targeting computer (TW p. 143). The unit ' +
            'must remain stationary, make no physical attacks that round, and fire only 1 ' +
            'weapon. Stacks with an actual targeting computer / enhanced imaging for an extra ' +
            '–2 to-hit.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'melee-master',
        name: 'Melee Master',
        points: 2,
        rulesText:
            'One extra physical attack per Physical Attack Phase (punch, kick, club, hatchet). ' +
            'Cannot use weapons in the attacking limb. Combines with Charge / Death-from-Above. ' +
            'For ProtoMechs: doubles total damage in a Frenzy attack.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'melee-specialist',
        name: 'Melee Specialist',
        points: 1,
        rulesText: '–1 to-hit on physical attacks. +1 damage on successful physical attacks.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'multi-tasker',
        name: 'Multi-Tasker',
        points: 2,
        rulesText:
            'Reduce multi-target penalties by 1: +0 for forward-arc secondary targets, +1 for ' +
            'rear/side. Crewed vehicles: reduce required gunners by 1 per 2 Gunnery ratings ' +
            '(minimum 1 gunner).',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'natural-grace',
        name: 'Natural Grace',
        points: 3,
        rulesText:
            'Stacked benefits: –1 target modifier on rolls to avoid falls, building-passage ' +
            'damage, pilot damage from falls, and setting off minefields. Extra hexside of ' +
            'torso twist (bipeds rotate 300°; quads can twist like bipeds). Arm flip with only ' +
            'one arm OR an arm that has lower arm/hand actuators. –1 MP per hex to pass through ' +
            'ultra-heavy woods/jungle/buildings. –1 damage from a hostile physical attack if ' +
            'paired with Dodge or Melee Specialist. Use Running MP to move backward if paired ' +
            'with Maneuvering Ace or Speed Demon.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'oblique-artilleryman',
        name: 'Oblique Artilleryman',
        points: 1,
        rulesText:
            '+10% range (rounded up) on artillery weapons (in meters). On a miss: scatter ' +
            'distance reduced by 2 hexes (minimum 0).',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'oblique-attacker',
        name: 'Oblique Attacker',
        points: 1,
        rulesText:
            '–1 to-hit on indirect fire (LRMs, artillery). May identify the target location ' +
            'without a spotter.',
        restrictions: 'Any unit. Incompatible with Cluster Hitter (stated under Cluster Hitter).',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'range-master',
        name: 'Range Master',
        points: 2,
        rulesText:
            'Choose a range band other than Short. Swap that band\'s to-hit modifier with ' +
            'Short\'s (e.g., Long Range chosen: +0 at Long, +4 at Short).',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'sandblaster',
        name: 'Sandblaster',
        points: 2,
        rulesText:
            'Pick one clustering weapon type at scenario start. +4 on the Cluster Hits Table at ' +
            'Short range, +3 at Medium, +2 at Long/Extreme.',
        restrictions: 'Any unit. Incompatible with Cluster Hitter (stated under Cluster Hitter).',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'sharpshooter',
        name: 'Sharpshooter',
        points: 4,
        rulesText:
            'Make an Aimed Shot (same restrictions as Marksman: stationary, 1 weapon, no ' +
            'physical attacks). Stacks with targeting computer / enhanced imaging for an extra ' +
            '–2. On a successful Aimed Shot: one extra critical hit check for the struck area, ' +
            'even through armor.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'slugger',
        name: 'Slugger',
        points: 1,
        rulesText:
            'An improvised club (tree, etc.) can be wielded one-handed (1 functional hand ' +
            'actuator required). Torso weapons and free-arm weapons remain usable while ' +
            'clubbing.',
        restrictions: '\'Mechs. Incompatible with Zweihander.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'sniper',
        name: 'Sniper',
        points: 3,
        rulesText:
            'Halve all range to-hit modifiers: +1 at Medium (was +2), +2 at Long (was +4), +3 ' +
            'at Extreme (was +6).',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'speed-demon',
        name: 'Speed Demon',
        points: 2,
        rulesText:
            'On turns with NO weapon or physical attacks: +1 MP to Running/Flanking, +2 MP to ' +
            'Sprinting.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'stand-aside',
        name: 'Stand-Aside',
        points: 1,
        rulesText:
            'Instead of being blocked by enemy stacking: PSR at +2 target modifier, +1 per ' +
            'weight class by which the OPPOSING unit is heavier, –2 per weight class if YOUR ' +
            'unit is heavier. On success: move through the occupied hex at +1 MP cost. On ' +
            'failure: lose half remaining MP.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'street-fighter',
        name: 'Street Fighter',
        points: 2,
        rulesText:
            'Deliver a physical attack during the Weapon Attack Phase — resolved before the end ' +
            'of the Weapon Phase. Standard physical restrictions still apply (no weapons in the ' +
            'attacking limb, no move-based attacks). Cannot then perform another physical ' +
            'attack that turn in the Physical Attack Phase.',
        restrictions: '\'Mechs, ProtoMechs.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'swordsman',
        name: 'Swordsman',
        points: 2,
        rulesText:
            'Two modes, pick one per attack. Aimed Shot: as if the melee weapon were a ' +
            'direct-fire energy weapon with a targeting computer; the melee weapon\'s to-hit ' +
            'modifiers still apply. Piercing Strike: +2 to-hit; on a hit, an extra crit check ' +
            '(–1 modifier if armor still protects the area).',
        restrictions: '\'Mechs, ProtoMechs; the unit must have a melee weapon.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'tactical-genius',
        name: 'Tactical Genius',
        points: 3,
        rulesText:
            'May reroll Initiative for the entire force. The second roll stands. No effect if ' +
            'the pilot is not the field commander.',
        restrictions: 'Any unit; pilot must be the field commander.',
        sourcePage: 'CamOps pp. 79–82',
    },
    // ── Terrain Master sub-abilities (3 pts each; pick one sub-ability at purchase;
    //    may be bought multiple times for different sub-abilities; no universal benefit) ──
    {
        id: 'terrain-master-drag-racer',
        name: 'Terrain Master — Drag Racer',
        points: 3,
        rulesText:
            '+1 Cruise / +2 Flank / +3 Sprint MP on Paved, Ice, or Black Ice roads (stacks with ' +
            'Speed Demon). –2 target modifier on Driving Skill Rolls on such surfaces ' +
            '(including skid avoidance). At Flank or faster: forward-only lateral shift like a ' +
            'quad \'Mech.',
        restrictions:
            'Terrain Master sub-ability (chosen at purchase). Tracked / Wheeled Combat ' +
            'Vehicles.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'terrain-master-forest-ranger',
        name: 'Terrain Master — Forest Ranger',
        points: 3,
        rulesText:
            '–1 MP per hex in all woods/jungle. –1 target modifier on PSRs required in jungle. ' +
            'At Walk/Cruise: +1 to-hit modifier against the unit while in wooded/jungle ' +
            'terrain.',
        restrictions:
            'Terrain Master sub-ability (chosen at purchase). Any non-airborne unit. The ' +
            'unit\'s own movement-class terrain restrictions still apply (p. 72): Forest ' +
            'Ranger does not let a hovercraft drive through forest.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'terrain-master-frogman',
        name: 'Terrain Master — Frogman',
        points: 3,
        rulesText:
            '–1 MP per hex in water deeper than Depth 1. –1 target modifier on PSRs while ' +
            'submerged (including physical attacks). +2 target modifier on Crush Depth Checks ' +
            '(if using Extreme Depth rules, TO pp. 42–43).',
        restrictions: 'Terrain Master sub-ability (chosen at purchase). \'Mechs, ProtoMechs.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'terrain-master-mountaineer',
        name: 'Terrain Master — Mountaineer',
        points: 3,
        rulesText:
            '–1 MP per hex through gravel piles, rough/ultra-rough, rubble/ultra-rubble, and ' +
            'level changes (including sheer cliffs). –1 target modifier on PSRs crossing such ' +
            'terrain.',
        restrictions: 'Terrain Master sub-ability (chosen at purchase). Any non-airborne unit.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'terrain-master-nightwalker',
        name: 'Terrain Master — Nightwalker',
        points: 3,
        rulesText:
            'At Walk/Cruise: ignore ALL darkness/lighting-based MP modifiers (Dawn, Dusk, ' +
            'Glare, Full Moon, Night, Moonless Night, Pitch Black, Solar Flare). At ' +
            'Flank/Jump/Run/Sprint: reduce these MP penalties by 1 (minimum 0). Does not ' +
            'affect Gunnery.',
        restrictions: 'Terrain Master sub-ability (chosen at purchase). Any non-airborne unit.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'terrain-master-swamp-beast',
        name: 'Terrain Master — Swamp Beast',
        points: 3,
        rulesText:
            '–1 MP per hex in mud or swamp. –1 target modifier on PSRs crossing such terrain ' +
            '(including bog-down checks). At Run/Flank: may spend 1 extra MP per hex to kick up ' +
            'muck — +1 to-hit modifier against the unit while in muddy/swampy hexes.',
        restrictions: 'Terrain Master sub-ability (chosen at purchase). Any non-airborne unit.',
        sourcePage: 'CamOps p. 83',
    },
    {
        id: 'weapon-specialist',
        name: 'Weapon Specialist',
        points: 3,
        rulesText:
            'Pick one weapon model (e.g., Medium Laser, LRM 10, PPC) at acquisition. –2 to-hit ' +
            'with that weapon type.',
        restrictions: 'Any unit.',
        sourcePage: 'CamOps p. 84',
    },
    {
        id: 'zweihander',
        name: 'Zweihander',
        points: 2,
        rulesText:
            'Two-arm power attack to a front-arc target; all to-hit modifiers from BOTH arms\' ' +
            'actuator damage apply. On success: +1 damage per 10 full tons of the attacker\'s ' +
            'weight (2 per 10 tons if Triple-Strength Myomer is active). The attacker makes an ' +
            'immediate Crit Hit check on the striking arm (or both arms if unarmed). On ' +
            'failure: immediate PSR to avoid falling (as a failed kick). Improvised clubs are ' +
            'destroyed by a successful Zweihander attack.',
        restrictions: '\'Mechs; must have hand actuators on BOTH arms. Incompatible with Slugger.',
        sourcePage: 'CamOps p. 84',
    },
    // ── Airborne-only SPAs ──────────────────────────────────────────────────
    {
        id: 'dust-off',
        name: 'Dust-Off',
        points: 2,
        rulesText:
            'Can take off from / land within / hover 1 level above ground in woods/jungle via ' +
            'PSR: +1 Light Woods/Jungle, +2 Heavy, +3 Ultra-Heavy. Failure: crash, severity 1 ' +
            'level per 3 points of failure.',
        restrictions:
            'VTOLs, Fighters (aerospace & conventional), Small Craft, DropShips; must be ' +
            'capable of vertical landing (Airship, VTOL, LAM in AirMech mode, VSTOL fighter).',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'golden-goose',
        name: 'Golden Goose',
        points: 3,
        rulesText:
            '–1 to-hit on air-to-ground Strike attacks. –2 to-hit on Bombing. On a missed bomb: ' +
            'scatter distance reduced by 2 hexes (minimum 0).',
        restrictions: 'VTOLs, Fighters, Small Craft.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'ground-hugger',
        name: 'Ground-Hugger',
        points: 2,
        rulesText:
            '–1 to-hit on air-to-ground Strafe and Strike (NOT Bombing). Strafe: split into two ' +
            '1–3-hex runs along the flight path (may be contiguous for a 6-hex attack line); ' +
            'heat unchanged. Strike: two strike attacks in one turn along the flight path — ' +
            'non-energy weapons must differ; energy weapons may fire twice but generate heat as ' +
            'one Strafe.',
        restrictions: 'VTOLs, Fighters, Small Craft.',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'ride-the-wash',
        name: 'Ride the Wash',
        points: 4,
        rulesText:
            'VTOL / WiGE: free 30° (1-hexside) facing change per turn; free +1 flight ' +
            'elevation. Aerospace / Aircraft: –1 Thrust cost for special maneuvers. ' +
            'Additionally, may use wash turbulence to force PSRs (+3 modifier) on airborne ' +
            'units within 10 elevations below your path along your flight line — failure: lose ' +
            '1 elevation × margin of failure; dropping to or below Elevation 1 = crash. Using ' +
            'the turbulence-attack mode: no weapon attacks that turn, AND a PSR at the end of ' +
            'movement — a failed end-PSR loses 1 elevation × ½ margin of failure.',
        restrictions:
            'Any airborne unit EXCEPT airships. Only usable at Altitude 20 or lower, at ' +
            'Flanking / Max Thrust.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'shaky-stick',
        name: 'Shaky Stick',
        points: 2,
        rulesText:
            '+1 to-hit vs. YOUR craft from ground-based attackers. No effect on airborne ' +
            'opponents. Combines with Golden Goose or Ground-Hugger.',
        restrictions: 'Any airborne unit.',
        sourcePage: 'CamOps pp. 79–82',
    },
    {
        id: 'wind-walker',
        name: 'Wind Walker',
        points: 2,
        rulesText:
            '–1 target modifier on PSRs required to pass through the Space/Atmosphere interface ' +
            '(aerospace fighters only). –1 target modifier on PSRs for ALL landings, including ' +
            'crash landings.',
        restrictions: 'Any airborne unit (plus LAMs, Glider ProtoMechs).',
        sourcePage: 'CamOps p. 84',
    },
    // ── Infantry-only SPAs ──────────────────────────────────────────────────
    {
        id: 'light-horseman',
        name: 'Light Horseman',
        points: 2,
        rulesText:
            '+1 MP per turn from beast mounts. –1 MP penalty for moving through wooded/rough ' +
            'terrain.',
        restrictions: 'Conventional infantry (beast-mounted).',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'heavy-horse',
        name: 'Heavy Horse',
        points: 2,
        rulesText:
            'The squad can carry additional support weaponry. +50% damage (rounded down), ' +
            '–1 MP.',
        restrictions: 'Conventional infantry (beast-mounted).',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'foot-cavalry',
        name: 'Foot Cavalry',
        points: 1,
        rulesText:
            '+15 meters (1 MP) per turn. –1 MP penalty in rough/woods/jungle/buildings. A squad ' +
            'with a Move-or-Fire rule may move AND fire in the same turn.',
        restrictions: 'Conventional infantry (foot motive).',
        sourcePage: 'CamOps pp. 74–78',
    },
    {
        id: 'urban-guerrilla',
        name: 'Urban Guerrilla',
        points: 1,
        rulesText:
            '–1 to-hit on all attacks made against this squad in urban/suburban terrain. ' +
            'Eliminates the double-damage effect for vehicular weapons vs. infantry in the ' +
            'open. Once per scenario: summon "local support" — a new Rifle (Ballistic) Foot ' +
            'Platoon at Green Skill, attacking from a structure within 3 hexes; it scatters ' +
            'when reduced to half strength.',
        restrictions: 'Conventional infantry and battle armor (must be able to enter buildings).',
        sourcePage: 'CamOps p. 84',
    },
];

/*
 * SPA purchasing / assignment governance — CamOps p. 72, replicated 1-1 from the extract.
 * Slots and point caps gate on pilot Skill Rating; the force-wide caps gate how many SPA
 * pilots a force may field at once.
 */
export const SPA_GOVERNANCE = {
    sourcePage: 'CamOps p. 72',
    /** SPA slots per pilot by Skill Rating. `green` covers Wet Behind the Ears / Very Green / Green. */
    slotsByRating: {
        green: 0,
        regular: 1,
        veteran: 2,
        elite: 2,
        heroic: 3,
        legendary: 3,
    },
    /** Combined point cap across a pilot's SPAs by Skill Rating (no cap row exists for green — 0 slots). */
    pointCapByRating: {
        regular: 2,
        veteran: 4,
        elite: 4,
        heroic: 6,
        legendary: 6,
    },
    /** Force-wide caps on SPA pilots (p. 72). */
    forceWideCap: {
        standard: '1 per 4 fielded units',
        formationRules: '1 per 12 fielded units',
    },
    /**
     * SPA portability (p. 72): unless the description says otherwise, an SPA is tied to the
     * WARRIOR, not the machine — it moves with the pilot between 'Mechs, vehicles, etc.,
     * provided the new unit type is valid for the SPA (e.g., a Swordsman in a 'Mech without
     * a melee weapon simply can't use the ability until he's in one that has one).
     */
    portability:
        'Tied to the warrior, not the machine: moves with the pilot between units, but only ' +
        'functions while the current unit type is valid for the SPA.',
    /**
     * Terrain restrictions (p. 72): movement-class / terrain restrictions of the unit still
     * apply unless the SPA explicitly says otherwise — a Forest Ranger SPA does not let a
     * hovercraft drive through forest.
     */
    terrainRestrictions:
        'Unit movement-class/terrain restrictions still apply unless the SPA explicitly says ' +
        'otherwise.',
} as const;
