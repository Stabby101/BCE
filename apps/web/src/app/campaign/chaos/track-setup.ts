import type { MissionTypeId } from '../contract/contract-terms';
import type { MissionSeed } from '../mission/forge-types';

export type TrackTemplateKey =
    | 'assault' | 'breakthrough' | 'defend' | 'flank' | 'meeting'
    | 'objective-raid' | 'pursuit' | 'pushback' | 'recon' | 'retreat' | 'strike'
    | 'duel-arena';
                    // three authored DR tracks carry templateId "Duel" that has ALWAYS aliased to 'meeting' (their bespoke
                    // duel rules are authored specialRules on a meeting base) — capturing that alias would silently re-base
                    // shipped content. 'Duel Arena' resolves here; authored "Duel" stays byte-identical. // DECISION

export type TrackSide = 'attacker' | 'defender';

/** The six salvage policies observed across the templates (§18). The rendered Salvage line still leads with the
 *  contract's negotiated % (spec.clauses); this policy is the template's default, shown as context. */
export type SalvagePolicy = 'winner-all' | 'pool-draft' | 'none' | 'attacker-if-win' | 'defender-if-win' | 'negotiated';

export interface TrackTemplate {
    /** Display name (our label — common English, not book text). */
    name: string;
    /** Role tags shown as `ATTACKER (ROLE)` / `DEFENDER (ROLE)`. */
    attackerRole: string;
    defenderRole: string;
    /** Map / home-edge paragraph. */
    setupText: string;
    /** Per-side deployment paragraphs (entry turn + asset notes). */
    attackerText: string;
    defenderText: string;
    /** Track End condition (turn limit / no-'Mechs). Per-template; falls back to DEFAULT_TRACK_END shape. */
    trackEndText: string;
    salvagePolicy: SalvagePolicy;
    standardRules?: string[];
}

/** A resolved archetype: a template plus which side the player's force plays for this mission family. */
export interface TrackArchetype extends TrackTemplate {
    playerSide: TrackSide;
    templateKey: TrackTemplateKey;
}

/** Universal default when a template doesn't override its own end (§18). */
export const DEFAULT_TRACK_END =
    "This track ends at the end of turn 10 (turn 8 in Alpha Strike), or as soon as one side has no 'Mech units left in play.";

/** Render fallback VP by objective priority. A seed's additive per-objective VP wins over this when present. */
export const TRACK_VP = { primary: 200, secondary: 100, bonus: 50 } as const;

/** One-sentence summary of each salvage policy (our words), shown as the track's default alongside the contract %. */
export const SALVAGE_POLICY_LABEL: Record<SalvagePolicy, string> = {
    'winner-all': 'the victor keeps all recoverable salvage',
    'pool-draft': 'wrecks go to a shared pool, winner drafting first, then sides alternate picks',
    'none': 'no battlefield salvage — every wreck returns to its owner',
    'attacker-if-win': 'the attacker keeps the salvage on a win, otherwise each side recovers its own',
    'defender-if-win': 'the defender keeps the salvage on a win, otherwise each side recovers its own',
    'negotiated': 'salvage is divided as the two commands negotiate',
};

/**
 * The eleven general track templates (§18), in our own words. Each supplies the GAME SETUP paragraphs and the
 * Track End + default salvage policy. GM-editable: this is plain data, safe to tune per campaign.
 */
export const TRACK_TEMPLATES: Record<TrackTemplateKey, TrackTemplate> = {
    assault: {
        name: 'Assault',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite long map edges as their home edges.',
        defenderText: 'Deploy your whole force first, every unit within five hexes (about ten inches at ground scale) of the map centre, before the first initiative.',
        attackerText: 'Enter from your home edge on turn 1. You bring no minefields or immobilising assets to this fight.',
        trackEndText: DEFAULT_TRACK_END,
        salvagePolicy: 'winner-all',
    },
    breakthrough: {
        name: 'Breakthrough',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite long map edges as their home edges.',
        defenderText: 'Deploy your force within six hexes (twelve inches) of the map centre before the first initiative, and stop the enemy from crossing.',
        attackerText: 'Enter from your home edge on turn 1, drive through the enemy line, and run at least half your force off the far (defender\'s) edge.',
        trackEndText: DEFAULT_TRACK_END,
        salvagePolicy: 'pool-draft',
    },
    defend: {
        name: 'Defend',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite short map edges as their home edges.',
        defenderText: 'Hold a third of your force in reserve (it arrives at the end of turn 1, anywhere in your own half); deploy the rest within six hexes (twelve inches) of the centre. You may not call off-board strikes.',
        attackerText: 'Enter from your home edge on turn 1 and drive the defenders off the centre.',
        trackEndText: "This track ends at the end of turn 6 (turn 8 in Alpha Strike at larger scales), or when one side has no 'Mech units left in play.",
        salvagePolicy: 'winner-all',
    },
    flank: {
        name: 'Flank',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite long map edges as their home edges. The defender additionally sites two veteran emplacement/turret assets across the centre line, in the attacker\'s half.',
        defenderText: 'Deploy your whole force in your own half before turn 1, and place the two fixed emplacements forward of centre.',
        attackerText: 'Bring a third of your force on from your home edge on turn 1; the remaining flanking element enters from one short edge on turn 2.',
        trackEndText: "This track ends at the end of turn 8 (turn 6 in Alpha Strike), or when one side has no 'Mech units left in play.",
        salvagePolicy: 'none',
    },
    meeting: {
        name: 'Meeting Engagement',
        attackerRole: 'STANDARD', defenderRole: 'STANDARD',
        setupText: 'Both forces use opposite short map edges as their home edges. This is a chance encounter, so neither side is dug in.',
        defenderText: 'Enter from your home edge on turn 1. You bring no fixed defences or minefields.',
        attackerText: 'Enter from your home edge on turn 1. You bring no fixed defences or minefields.',
        trackEndText: DEFAULT_TRACK_END,
        salvagePolicy: 'winner-all',
    },
    'objective-raid': {
        name: 'Objective Raid',
        attackerRole: 'RAIDERS', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite short map edges as their home edges. Two indestructible objective structures stand within four hexes (six at larger scale) of the map centre.',
        defenderText: 'Deploy your entire force on the map, at least half of it within six hexes of the objective structures, and keep the raiders off them.',
        attackerText: 'Enter from your home edge on turn 1. Reach the structures, seize what you can, and carry it off your own edge.',
        trackEndText: "This track ends at the end of turn 12 (turn 10 in Alpha Strike), or when one side has no 'Mech units left in play.",
        salvagePolicy: 'defender-if-win',
    },
    pursuit: {
        name: 'Pursuit',
        attackerRole: 'STANDARD', defenderRole: 'RAIDERS',
        setupText: 'Both forces start from the same (the attacker\'s) short edge — this is a running fight down the length of the map.',
        defenderText: 'Enter on turn 1. At least half your force must be slow (walking movement of 8 or less, or 16 inches or less); you may take voluntary damage to qualify.',
        attackerText: 'Enter one turn behind, on turn 2, from the same edge, and run the enemy down before they can escape off the far edge.',
        trackEndText: "This track ends at the end of turn 10, or when one side has no 'Mech units left in play.",
        salvagePolicy: 'attacker-if-win',
    },
    pushback: {
        name: 'Pushback',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite short map edges as their home edges. The attacker is reinforced with extra vehicle assets and presses from two directions.',
        defenderText: 'Deploy first, at least five hexes (ten inches) in from your own edge, and hold your ground.',
        attackerText: 'Split into two elements: the first enters from your home edge on turn 1, the second crosses from the long edges past the midline.',
        trackEndText: DEFAULT_TRACK_END,
        salvagePolicy: 'pool-draft',
    },
    recon: {
        name: 'Recon',
        attackerRole: 'STANDARD', defenderRole: 'GARRISON',
        setupText: 'The attacker chooses any map edge as its home edge; the defender takes any other. Scanning rules are in effect for this track.',
        defenderText: 'Deploy anywhere, with at least half your force in the map half nearest the attacker, and deny the enemy a clean look at your units.',
        attackerText: 'Enter from your home edge on turn 1 and scan the enemy force to complete your objectives.',
        trackEndText: "This track ends at the end of turn 8, or when one side has no 'Mech units left in play.",
        salvagePolicy: 'none',
    },
    retreat: {
        name: 'Retreat',
        attackerRole: 'STANDARD', defenderRole: 'RAIDERS',
        setupText: 'Both forces start from the same short edge. Scanning rules are in effect for this track.',
        defenderText: 'Enter from the attacker\'s edge on turn 1 and fight your way back to your own edge to escape.',
        attackerText: 'Enter from your own edge on turn 2 and stop the enemy from slipping away.',
        trackEndText: "This track ends at the end of turn 10, or when one side has no 'Mech units left in play.",
        salvagePolicy: 'attacker-if-win',
    },
    strike: {
        name: 'Strike',
        attackerRole: 'RAIDERS', defenderRole: 'GARRISON',
        setupText: 'Both forces use opposite long map edges as their home edges. Four medium structures stand near the centre; one is secretly the enemy headquarters.',
        defenderText: 'Deploy in your own half before initiative, at least half your force within three hexes of the structures, and record which building is your HQ.',
        attackerText: 'Bring half your force on from your home edge on turn 1, the rest from a short edge on turn 2; find and destroy the headquarters.',
        trackEndText: DEFAULT_TRACK_END,
        salvagePolicy: 'pool-draft',
    },
    'duel-arena': {
        name: 'Duel',
        attackerRole: 'CHALLENGER', defenderRole: 'CHALLENGER',
        setupText: 'A sanctioned arena bout: one machine a side, matched by weight class unless both parties agree to an open match. Both machines use opposite short map edges as their home edges.',
        defenderText: 'Field a single unit. Leaving the arena by any edge other than your own counts as your destruction.',
        attackerText: 'Field a single unit. Leaving the arena by any edge other than your own counts as your destruction.',
        trackEndText: 'The bout ends when one machine is destroyed or its pilot concedes; a crippled machine may fight on.',
        salvagePolicy: 'none', // §18 duel salvage is n/a — 'none' (wrecks return to owners) is the faithful mapping
    },
};

//    in OUR OWN words (mechanics only — names describe what the mechanic IS; no book objective names, no book prose).
//    `side` drives the resolve role filter (singleSidedResolve); the track sheet lists BOTH sides, book-style. ──
export interface TrackTemplateObjective {
    text: string;
    vp: number;
    kind: 'primary' | 'secondary' | 'bonus';
    side: 'attacker' | 'defender' | 'both';
}
export const TEMPLATE_OBJECTIVES: Record<TrackTemplateKey, TrackTemplateObjective[]> = {
    assault: [
        { text: 'Sustained pressure — keep your force engaged with the enemy (you attack it or it attacks you) for two consecutive turns.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Unbroken line — every unit of yours is still on the field at the end of turn 3.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Break their force — destroy or cripple half the enemy force by BV; an exactly equal tally scores for neither side.', vp: 200, kind: 'primary', side: 'both' },
        { text: 'Sweep the board — no enemy unit left in play at track end.', vp: 100, kind: 'secondary', side: 'both' },
    ],
    breakthrough: [
        { text: 'Reach the line — get half your force, counted by BV, across the centre line.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Meet them head-on — keep half your force engaged (attacking or attacked) for any two turns.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Out the far side — exit half your force off the far (defender\'s) edge.', vp: 300, kind: 'primary', side: 'attacker' },
        { text: 'Leave a mark — put at least one internal-structure hit on every enemy unit.', vp: 100, kind: 'secondary', side: 'both' },
        { text: 'Seal the breach — destroy or cripple half the attacking force before it exits.', vp: 300, kind: 'primary', side: 'defender' },
    ],
    defend: [
        { text: 'Contest the centre — half your force within four hexes (six at Scale 2+) of the centre at the end of turn 3 (turn 4 at Scale 2+).', vp: 50, kind: 'bonus', side: 'both' },
        { text: 'Own the ground — more non-crippled BV than the enemy within four hexes (six at Scale 2+) of the centre when the track ends.', vp: 250, kind: 'primary', side: 'both' },
        { text: 'Kill their commander — destroy or cripple the unit carrying the enemy commander.', vp: 150, kind: 'secondary', side: 'both' },
    ],
    flank: [
        { text: 'Into their half — half your force inside the defender\'s half at the end of any phase.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Meet the flank — keep half your force engaged (attacking or attacked) for any two turns.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Grind them down — destroy or cripple half the defending force.', vp: 150, kind: 'secondary', side: 'attacker' },
        { text: 'Silence the guns — destroy every fixed emplacement.', vp: 150, kind: 'primary', side: 'attacker' },
        { text: 'Bar the door — keep one \'Mech per Scale at the defender\'s home edge for two consecutive turns.', vp: 150, kind: 'secondary', side: 'attacker' },
        { text: 'Blunt the assault — destroy or cripple half the attacking force.', vp: 150, kind: 'primary', side: 'defender' },
        { text: 'Break contact clean — after blunting the assault, exit half your force off your own edge.', vp: 150, kind: 'secondary', side: 'defender' },
    ],
    meeting: [
        { text: 'Close the distance — engage the enemy, or close within twelve hexes, for any two turns.', vp: 50, kind: 'bonus', side: 'both' },
        { text: 'First blood — be FIRST to destroy or cripple a third of the enemy force by BV. Simultaneous scores for neither; units withdrawing early count as crippled.', vp: 200, kind: 'primary', side: 'both' },
        { text: 'Leave a mark — put at least one internal-structure hit on every enemy unit.', vp: 100, kind: 'secondary', side: 'both' },
    ],
    'objective-raid': [
        { text: 'Past the wire — at least one unit per Scale crosses the centre line.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Stand your post — every unit of yours stays within six hexes of the objective structures for the first two turns.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Haul it home — carry a seized component off your own home edge. Scores 100 VP per component delivered.', vp: 100, kind: 'primary', side: 'attacker' },
        { text: 'Make the raid cost them — scores 100 VP per raiding unit destroyed.', vp: 100, kind: 'primary', side: 'defender' },
    ],
    pursuit: [
        { text: 'Run them down — engage half the fleeing units (attack them or draw their fire).', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Stay ahead — get half your force, by BV, across the centre line.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Close the net — stop three-quarters of the fleeing force from exiting by the end of turn 10.', vp: 300, kind: 'primary', side: 'attacker' },
        { text: 'Leave none standing — destroy the entire fleeing force.', vp: 100, kind: 'secondary', side: 'attacker' },
        { text: 'Slip the net — exit half your slow-runners off the far edge by the end of turn 10.', vp: 300, kind: 'primary', side: 'defender' },
        { text: 'Vanish — exit three-quarters of your force off the far edge.', vp: 100, kind: 'secondary', side: 'defender' },
    ],
    pushback: [
        { text: 'Over the line — get half your force across the centre.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Meet the push — keep half your force engaged (attacking or attacked) for any two turns.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Flood their half — three-quarters of your force inside the defender\'s half at the end of turn 4.', vp: 200, kind: 'secondary', side: 'attacker' },
        { text: 'Shatter them — destroy or cripple a third of the defending force.', vp: 400, kind: 'primary', side: 'attacker' },
        { text: 'Break three in four — destroy or cripple three-quarters of the defending force.', vp: 150, kind: 'secondary', side: 'attacker' },
        { text: 'Trade ground for time — exit half your force off your own edge between turns 6 and 10.', vp: 200, kind: 'secondary', side: 'defender' },
        { text: 'Exact the toll — destroy or cripple half the attacking force.', vp: 400, kind: 'primary', side: 'defender' },
        { text: 'Command intact — finish the track with your commander\'s unit alive and your other objectives met.', vp: 150, kind: 'secondary', side: 'defender' },
    ],
    recon: [
        { text: 'Eyes on — scan one enemy unit per Scale.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Stay in the fight — keep half your force alive and on the map for the first two turns.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Map their order of battle — scan two-thirds of the enemy force.', vp: 100, kind: 'primary', side: 'attacker' },
        { text: 'Hit them on the way through — destroy or cripple a quarter of the defenders.', vp: 100, kind: 'secondary', side: 'attacker' },
        { text: 'Bring the data home — exit half your force off your home edge after turn 4.', vp: 100, kind: 'secondary', side: 'attacker' },
    ],
    retreat: [
        { text: 'Track the withdrawal — scan one enemy unit, or have half your units in the withdrawing side\'s half at the end of turn 4.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'First one out — exit at least one unit off the far edge.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Read their condition — scan two-thirds of the withdrawing force.', vp: 200, kind: 'primary', side: 'attacker' },
        { text: 'Sting first — be first to destroy or cripple a quarter of the enemy. Simultaneous scores for BOTH sides.', vp: 100, kind: 'secondary', side: 'both' },
        { text: 'Bring them home — exit half your units, counted by number, off the far edge; crippled units that make it off still count.', vp: 200, kind: 'primary', side: 'defender' },
    ],
    strike: [
        { text: 'Find the nerve centre — scan two of the structures, or locate the hidden HQ.', vp: 50, kind: 'bonus', side: 'attacker' },
        { text: 'Screen the site — half your force within three hexes of the structures at the end of turn 4.', vp: 50, kind: 'bonus', side: 'defender' },
        { text: 'Raze the nerve centre — destroy the headquarters building after scanning it.', vp: 200, kind: 'primary', side: 'attacker' },
        { text: 'Wreck the garrison — destroy or cripple half the defending force.', vp: 100, kind: 'secondary', side: 'attacker' },
        { text: 'Kill the raid\'s leader — destroy or cripple the attacking commander\'s unit.', vp: 200, kind: 'primary', side: 'defender' },
    ],
    'duel-arena': [
        { text: 'Last the opening — survive the first two turns of the bout.', vp: 50, kind: 'secondary', side: 'both' },
        { text: 'Win the bout — destroy the opposing machine or force its surrender. Worth double against a heavier weight class.', vp: 100, kind: 'primary', side: 'both' },
        { text: 'Leave it limping — cripple the opposing machine. Worth double against a heavier weight class.', vp: 50, kind: 'secondary', side: 'both' },
        { text: 'Crowd-pleaser: cockpit strike — scores 10 VP per head hit (20 when the shot lands on a natural 12).', vp: 10, kind: 'bonus', side: 'both' },
        { text: 'Crowd-pleaser: caught from behind — scores 10 VP for each turn you land a rear-arc hit.', vp: 10, kind: 'bonus', side: 'both' },
        { text: 'Crowd-pleaser: fireworks — scores 10 VP each time you touch off an enemy ammunition explosion (20 in Alpha Strike).', vp: 10, kind: 'bonus', side: 'both' },
    ],
};

export const TEMPLATE_DEEP_RULES: Record<TrackTemplateKey, string[]> = {
    assault: ['The attacker fields no minefields and no assets that immobilise (the garrison is dug in; the assault comes in clean).'],
    breakthrough: ['Exit scoring: an attacking unit that leaves by the defender\'s edge is out of the fight but counts toward the exit objective; leaving by any other edge is simply a withdrawal.'],
    defend: ['Defender reserve: a third of the defending force starts off-map and arrives at the end of turn 1, anywhere in the defender\'s half.', 'The defender may not call off-board fire support on this track.'],
    flank: ['Fixed emplacements: the defender sites two veteran-crewed MEDIUM emplacement/turret assets per Scale forward of the centre, in the attacker\'s half; they are units for all scoring purposes (Alpha Strike: gun trailers; with battlefield support off the table, use 30-CF light buildings mounting large lasers).'],
    meeting: ['Chance contact: neither side brings minefields or assets that immobilise.'],
    'objective-raid': [
        'The objective structures cannot be destroyed — the fight is over what is inside them.',
        'Component carry: a unit ending its movement at a structure loads one component per turn (loading needs working hand actuators or a cargo bay). Capacity by weight class — light 1, medium 2, heavy 3, assault 4 (cargo-rated vehicles: one per 5 tons of cargo). A carrying unit loses 1 MP (two inches in Alpha Strike), and jumping while loaded forces a piloting check. Infantry can load components but cannot carry them off.',
    ],
    pursuit: ['Same-edge start: both forces enter from the attacker\'s edge, the pursuer one turn behind.', 'Slow-runner rule: at least half the fleeing force must have a maximum movement of 8 or less (16 inches or less in Alpha Strike); a faster unit may take voluntary critical hits before the track to qualify as a slow-runner.'],
    pushback: ['Two-axis assault: the attacker MUST split into two elements — one from its home edge on turn 1, the second entering from the long edges past the midline.', 'The attacker is reinforced for this track with a support allowance of 32 battlefield-support points per Scale, spent on vehicle assets only.'],
    recon: [
        'Scanning: end your movement within two hexes (four inches in Alpha Strike) of an enemy unit, with line-of-sight to it, to scan it.',
        'Turnabout scoring: any attacker objective still unmet when the track ends scores its VP for the DEFENDER instead. A defending unit that withdraws early counts as both scanned and destroyed.',
    ],
    retreat: ['Same-edge start: the withdrawing force enters from the attacker\'s home edge on turn 1 and races for the far edge, which counts as its home edge; the attacker follows from the entry edge on turn 2.', 'Scanning is in effect: end your movement within two hexes (four inches in Alpha Strike) of an enemy unit, with line-of-sight to it, to scan it.'],
    strike: ['Hidden HQ: the four structures read identical until scanned; the defender secretly records which is the headquarters before deployment. Scan a structure from within two hexes; battle armor and infantry may scan only adjacent or from inside, and cannot attack that turn.'],
    'duel-arena': [
        'Arena law: one unit a side, no BV or battlefield-support ceiling, matched by weight class unless both parties agree to an open bout. Leaving by any edge but your own counts as destruction.',
        'The purse: this track\'s VP convert DIRECTLY to SP — every point scored is a point of combat pay (the standard pay tiers do not apply).',
        'One bout per campaign month; track costs are paid at Scale 1 regardless of contract Scale.',
        'Team bouts (multiple machines a side, by mutual agreement): the match ends instead when more than half a side\'s BV has been destroyed or has left the arena.',
    ],
};

export const TEMPLATE_STANDARD_RULES: Partial<Record<TrackTemplateKey, string[]>> = {
    'objective-raid': ['Component-carry: a raider reaching an objective structure seizes a component and must carry it off its own home edge to score.'],
    recon: ['Scanning: end movement within close line-of-sight of an enemy unit to identify ("scan") it and complete recon objectives.'],
    strike: ['Scanning + hidden HQ: the centre structures read identical until scanned; one is the secretly-recorded HQ, revealed only when scanned or destroyed.'],
    retreat: ['Scanning is in effect; the withdrawing side enters from the opponent’s edge and races for its own.'],
    pursuit: ['Same-edge start: both forces enter from the attacker’s edge one turn apart — a running fight down the map.'],
    breakthrough: ['Cross-and-exit: the attacker scores by driving through and running units off the defender’s far edge.'],
    defend: ['Reserve + no off-board fire: a third of the defender arrives end of turn 1; neither side calls off-board strikes.'],
    pushback: ['Two-axis assault: the attacker presses from the home edge and across the long edges past the midline.'],
    flank: ['Fixed emplacements: the defender sites two veteran turret/emplacement assets forward of centre; the attacker flanks in on turn 2.'],
    assault: ['Stand-up assault: the defender deploys massed at centre; the attacker brings no minefields or immobilising assets.'],
    meeting: ['Meeting engagement: a chance clash — neither side is dug in, no fixed defences or minefields.'],
};
/** Map an authored templateId (PascalCase / DR name, e.g. 'Defend'/'Strike'/'Objective') → a TrackTemplateKey. */
export function templateKeyFor(templateId: string): TrackTemplateKey | undefined {
    const t = (templateId || '').trim().toLowerCase().replace(/\s+/g, '-');
    if ((TRACK_TEMPLATES as Record<string, TrackTemplate>)[t]) return t as TrackTemplateKey;
    // Multi-word / DR-name aliases (the authored templateIds use spaces + book names, e.g. 'Meeting Engagement').
    const alias: Record<string, TrackTemplateKey> = {
        objective: 'objective-raid', raid: 'objective-raid', 'objective-raid': 'objective-raid',
        'meeting-engagement': 'meeting', 'meeting-engagements': 'meeting', duel: 'meeting',
    };
    return alias[t];
}
export function standardRulesForTemplate(templateId: string): string[] {
    const key = templateKeyFor(templateId);
    return (key && TEMPLATE_STANDARD_RULES[key]) || [];
}

/**
 * Mission family → track template + which side the player plays. Every MissionTypeId is mapped; a family the map
 * doesn't know (or a null/undefined) falls back to a stand-up Meeting Engagement with the player attacking. Ten of
 * the eleven templates are exercised here (Retreat is defined for GM/preset use). GM-editable.
 */
export const FAMILY_TRACK: Record<MissionTypeId, { template: TrackTemplateKey; playerSide: TrackSide }> = {
    GARRISON_DUTY: { template: 'defend', playerSide: 'defender' },
    CADRE_DUTY: { template: 'defend', playerSide: 'defender' },
    SECURITY_DUTY: { template: 'meeting', playerSide: 'defender' },
    RIOT_DUTY: { template: 'meeting', playerSide: 'attacker' },
    PLANETARY_ASSAULT: { template: 'assault', playerSide: 'attacker' },
    RELIEF_DUTY: { template: 'pushback', playerSide: 'attacker' },
    GUERRILLA_WARFARE: { template: 'strike', playerSide: 'attacker' },
    PIRATE_HUNTING: { template: 'pursuit', playerSide: 'attacker' },
    DIVERSIONARY_RAID: { template: 'flank', playerSide: 'attacker' },
    OBJECTIVE_RAID: { template: 'objective-raid', playerSide: 'attacker' },
    RECON_RAID: { template: 'recon', playerSide: 'attacker' },
    EXTRACTION_RAID: { template: 'breakthrough', playerSide: 'attacker' },
};

const FALLBACK: { template: TrackTemplateKey; playerSide: TrackSide } = { template: 'meeting', playerSide: 'attacker' };

/** Resolve a mission family to a full TrackArchetype (template text + player side). Never throws; unknown → Meeting. */
export function trackArchetypeFor(family: MissionTypeId | string | null | undefined): TrackArchetype {
    const pick = (family && (FAMILY_TRACK as Record<string, { template: TrackTemplateKey; playerSide: TrackSide }>)[family]) || FALLBACK;
    const t = TRACK_TEMPLATES[pick.template];
    return { ...t, playerSide: pick.playerSide, templateKey: pick.template };
}

export function trackArchetypeForSpec(templateKey: string | null | undefined, family: MissionTypeId | string | null | undefined, playerRole?: TrackSide | null): TrackArchetype {
    const base = trackArchetypeFor(family);
    const key = templateKey ? templateKeyFor(templateKey) : undefined;
    const arch = (() => {
        if (!key || key === base.templateKey) return base;
        const fam = TEMPLATE_KEY_FAMILY[key];
        const side = (fam && FAMILY_TRACK[fam]?.playerSide) || base.playerSide;
        return { ...TRACK_TEMPLATES[key], playerSide: side, templateKey: key };
    })();
    // an AUTHORED role (a preset's "Your role", forge.trackSheet.playerRole) wins over the family default
    return playerRole === 'attacker' || playerRole === 'defender' ? { ...arch, playerSide: playerRole } : arch;
}

export function templateTrackEnd(templateId: string | null | undefined): string {
    const key = templateId ? templateKeyFor(templateId) : undefined;
    return (key && TRACK_TEMPLATES[key]?.trackEndText) || DEFAULT_TRACK_END;
}

/** The player's own role label for a resolved archetype (e.g. 'ATTACKER (STANDARD)'). */
export function playerRoleLabel(a: TrackArchetype): string {
    return a.playerSide === 'attacker' ? `ATTACKER (${a.attackerRole})` : `DEFENDER (${a.defenderRole})`;
}

/** The opposing side's role label (shown under the assessed-OpFor summary). */
export function opposingRoleLabel(a: TrackArchetype): string {
    return a.playerSide === 'attacker' ? `DEFENDER (${a.defenderRole})` : `ATTACKER (${a.attackerRole})`;
}

const TEMPLATE_KEY_FAMILY: Record<TrackTemplateKey, MissionTypeId> = {
    assault: 'PLANETARY_ASSAULT', breakthrough: 'EXTRACTION_RAID', defend: 'GARRISON_DUTY',
    flank: 'DIVERSIONARY_RAID', meeting: 'SECURITY_DUTY', 'objective-raid': 'OBJECTIVE_RAID',
    pursuit: 'PIRATE_HUNTING', pushback: 'RELIEF_DUTY', recon: 'RECON_RAID',
    retreat: 'RECON_RAID', strike: 'GUERRILLA_WARFARE',
    'duel-arena': 'RIOT_DUTY',
};
/** The pickable universal library — the 11 §18 templates as `{ key, name }` for the play-time track picker. */
export const UNIVERSAL_TRACK_LIBRARY: readonly { key: TrackTemplateKey; name: string }[] =
    (Object.keys(TRACK_TEMPLATES) as TrackTemplateKey[]).map((key) => ({ key, name: TRACK_TEMPLATES[key].name }));

export function synthSeedFromTemplate(key: TrackTemplateKey): MissionSeed {
    const t = TRACK_TEMPLATES[key];
    const objs = TEMPLATE_OBJECTIVES[key] ?? [];
    const side = FAMILY_TRACK[TEMPLATE_KEY_FAMILY[key]]?.playerSide ?? 'attacker';
    const mine = objs.filter((o) => o.side === side || o.side === 'both');
    const textOf = (k: 'primary' | 'secondary' | 'bonus'): string | undefined => mine.find((o) => o.kind === k)?.text;
    return {
        seedId: 'preset-tpl-' + key,
        family: TEMPLATE_KEY_FAMILY[key] ?? 'OBJECTIVE_RAID',
        title: t.name,
        eraFit: [], factionFit: [], register: 'chaos-preset', threatRange: [],
        situation: `A ${t.name} action. ${t.setupText}`,
        // the legacy narrator trio mirrors the PLAYER-side set (render + resolve use trackObjectives below)
        objectives: {
            primary: textOf('primary') ?? `Complete your force's primary objective for this ${t.name} track.`,
            secondary: textOf('secondary') ?? 'Complete your secondary objective.',
            bonus: textOf('bonus') ?? "Complete the track's bonus objective.",
        },
        trackObjectives: objs.map((o) => ({ text: o.text, vp: o.vp, kind: o.kind, side: o.side })),
        trackSheet: {
            specialRules: (TEMPLATE_DEEP_RULES[key] ?? []).join(' '),
            playerRole: side,
        },
        complications: [], decisionPoints: [], reactionTimeline: { entries: [], hardDeadline: '' },
        opforSketch: { composition: '', behavior: '' },
        forks: [], storyElementSeed: '', voiceSlots: [],
    };
}
