/*
 * BCE campaign-pack — MISSION SPEC + generator core (DIRECTIVE-023, T-014 Layer-1). Pure TS, no Angular/DOM.
 *
 * DATA-003: the MissionSpec IS the record — every objective, the OpFor list, terrain, terms, reward
 * and window are computed/stored here; the briefing PROSE is only a VIEW rendered from it (nothing is
 * ever parsed back out of text). That is what makes AI genuinely optional (T-014 NONE/LOCAL/CLOUD):
 * the narrator ADAPTER seam below is declared but THIS slice ships NONE mode = pack templates only.
 *
 * The type→template table maps the CamOps Missions Table contract types (CamOps 4th pp.40–43 mission
 * descriptions INFORM the objective/deployment/victory shapes; REF-001: cited, not binding — divergences
 * are deliberate) to playable content. OpFor is stood up by the D-018 force generator (the caller passes
 * the band-drawn proto-instances in); sizing tunables are PM-original interim, flagged for the cited
 * CamOps force-sizing pass. PROD-001: plain + playable on real terrain beats elaborate.
 */
import type { MissionTypeId, CommandRights } from '../contract/contract-terms';
import type { ContractOffer } from '../contract/contract-market';
import type { ProtoInstance } from '../force/force-generator';
import type { TheaterSheet, CommsPlan } from './theater';
import type { SeedComplication } from './forge-types'; // D-110e — rolled track complications ride the forge

export type MissionPosture = 'attack' | 'defend' | 'raid' | 'pursuit';

interface MissionTemplate {
    posture: MissionPosture;
    /** one-line situation lead (slot-filled), used by the NONE narrator. */
    lead: string;
    objectives: string[];
    deployment: { player: string; opfor: string };
    victory: string[];
    /** [deployByDays, engagementDays] window. */
    windowDays: [number, number];
}

// ── TUNABLE: per-type OpFor BV ratio + band + base. OpFor BV target = playerBV × base × perType. ──
// PM-original interim (flagged) until the cited CamOps force-sizing pass (T-022).
export const MISSION_TUNABLES = {
    bvRatioBase: 1.0,
    bvTolerance: 0.2, // DIRECTIVE-068 — ± band half-width tightened from 0.25 → 0.20 (campaign + quick mission)
    // D-102 A4 — hard ceiling on the FINAL OpFor BV target as a multiple of the player's FIELDABLE BV, applied
    // AFTER perType × (1+escalation drift). Stops the compounding "2 lances vs 1" balloon (a hard fight, not hopeless).
    bvHardCap: 1.5,
    perTypeBvRatio: {
        GARRISON_DUTY: 1.0,
        CADRE_DUTY: 0.5,
        SECURITY_DUTY: 0.8,
        RIOT_DUTY: 0.6,
        PLANETARY_ASSAULT: 1.3,
        RELIEF_DUTY: 1.1,
        GUERRILLA_WARFARE: 1.1,
        PIRATE_HUNTING: 0.7,
        DIVERSIONARY_RAID: 0.7,
        OBJECTIVE_RAID: 0.8,
        RECON_RAID: 0.6,
        EXTRACTION_RAID: 0.7,
    } as Record<MissionTypeId, number>,
    // D-077 — outcome-feedback escalation tempo. The generator drifts the next bvTarget by the active thread's
    // clamped escalation level (a winning chain heightens the enemy response; a loss eases it). ON TOP of the
    // ratios above (which are unchanged). OpFor BV still lands in ±bvTolerance around the drifted target.
    escalation: {
        bvStep: 0.08,     // bvTarget drift per escalation level (+8%/level)
        bvCap: 0.30,      // max |drift| applied to bvTarget (safety clamp on top of the level clamp)
        min: -2, max: 3,  // escalation level clamp
        ledgerCap: 12,    // rolling OutcomeRecord ledger size
        // per-tier level delta: a clean win heightens, a loss eases, partial/compromised hold.
        tierDelta: { FULL_SUCCESS: 1, SUCCESS: 1, PARTIAL: 0, FAILURE: -1, COMPROMISED: 0, ANY: 0 } as Record<string, number>,
    },
} as const;

// ── TUNABLE: terrain/biome table (rolled per mission). PROD-001 — real, playable terrain. ──
export const TERRAIN_TABLE: { biome: string; note: string }[] = [
    { biome: 'Temperate plains', note: 'Open rolling grassland with scattered light woods — long fields of fire' },
    { biome: 'Arid badlands', note: 'Broken rock and mesas — cover in the cuts, exposure on the flats' },
    { biome: 'Dense urban', note: 'City blocks and rubble — short ranges, blocked LOS, building cover' },
    { biome: 'Marshland', note: 'Bog and waterways — soft ground, movement hazards, thin cover' },
    { biome: 'Mountain', note: 'Steep elevation and narrow passes — chokepoints and contested high ground' },
    { biome: 'Tundra', note: 'Open snowfield — minimal cover, cold-weather operations' },
    { biome: 'Jungle', note: 'Heavy woods — close ranges, limited LOS, infantry-friendly cover' },
    { biome: 'Coastal', note: 'Beaches and tidal flats — water hazards and open approaches' },
    { biome: 'Desert', note: 'Sand and dunes — heat, dust, and open sightlines' },
    { biome: 'Industrial sprawl', note: 'Refineries and yards — hazardous terrain, dense cover, chokepoints' },
];

/** CamOps mission descriptions inform these shapes (pp.40–43); REF-001 — cited, deliberate. */
export const MISSION_TEMPLATES: Record<MissionTypeId, MissionTemplate> = {
    GARRISON_DUTY: {
        posture: 'defend', lead: 'hold {employer} ground against {target} for the term of the contract',
        objectives: ['Garrison the {employer} holdings threatened by {target} and hold them for the contract term', 'Repel any {target} incursion against the protected zone', 'Keep at least half the command combat-capable'],
        deployment: { player: 'Defender — deploy from the home edge, dug in around the objectives', opfor: 'Attacker — {target} probes the opposite edge in successive assaults' },
        victory: ['No protected objective falls to {target}', 'Break the attacking force or force its withdrawal'], windowDays: [30, 30],
    },
    CADRE_DUTY: {
        posture: 'defend', lead: 'train {employer} cadre to combat readiness under light contact',
        objectives: ['Stand up and train {employer} cadre formations to combat readiness', 'Demonstrate doctrine against light {target} probes', 'Bring the trainees through with minimal losses'],
        deployment: { player: 'Instructor force — central muster ground', opfor: 'Light {target} raiders — a single approach edge' },
        victory: ['Cadre certified combat-ready', 'No trainee formation routed'], windowDays: [30, 21],
    },
    SECURITY_DUTY: {
        posture: 'defend', lead: 'screen {employer} assets against {target} strikes',
        objectives: ['Provide security for {employer} assets against {target}', 'Screen the protected element through the engagement area', 'Intercept {target} strike attempts'],
        deployment: { player: 'Escort — astride the protected route', opfor: '{target} interceptors — striking from flanking edges' },
        victory: ['Protected element survives intact', 'Drive off the {target} strike'], windowDays: [21, 14],
    },
    RIOT_DUTY: {
        posture: 'defend', lead: 'restore order in {employer} territory against {target}-backed unrest',
        objectives: ['Restore order in {employer} territory against {target}-backed unrest', 'Secure the key urban centers and disperse hostile formations', 'Avoid collateral escalation'],
        deployment: { player: 'Peacekeeper — staged in the urban core', opfor: '{target} militia — dispersed through the city blocks' },
        victory: ['Hostile formations broken or dispersed', 'Key centers held'], windowDays: [21, 14],
    },
    PLANETARY_ASSAULT: {
        posture: 'attack', lead: 'spearhead the {employer} assault on {target} holdings',
        objectives: ['Spearhead the {employer} assault on {target} holdings', 'Break the {target} defensive line and seize the objectives', 'Hold the seized ground against counterattack'],
        deployment: { player: 'Attacker — advance from the landing edge', opfor: '{target} defenders — dug in across the objective line' },
        victory: ['Objective line seized', '{target} defense broken'], windowDays: [30, 30],
    },
    RELIEF_DUTY: {
        posture: 'attack', lead: 'break through to a besieged {employer} garrison',
        objectives: ['Break through to the besieged {employer} garrison', 'Shatter the {target} siege lines', 'Link up and stabilize the perimeter'],
        deployment: { player: 'Relief column — drive inward from one edge', opfor: '{target} besiegers — encircling the garrison' },
        victory: ['Link-up with the garrison achieved', '{target} siege lines broken'], windowDays: [30, 21],
    },
    GUERRILLA_WARFARE: {
        posture: 'raid', lead: 'wage a guerrilla campaign against {target} in {employer} interest',
        objectives: ['Wage a guerrilla campaign against {target} in {employer} interest', 'Strike {target} infrastructure and withdraw before reprisal', 'Sustain the insurgency without decisive loss'],
        deployment: { player: 'Insurgents — infiltrate from broken terrain', opfor: '{target} counter-insurgency sweep — converging from multiple edges' },
        victory: ['Target struck and the force exfiltrated', 'No company-level losses to reprisal'], windowDays: [30, 21],
    },
    PIRATE_HUNTING: {
        posture: 'pursuit', lead: 'hunt down the {target} raiders preying on {employer}',
        objectives: ['Hunt down the {target} raiders preying on {employer}', 'Bring the pirate force to battle and destroy it', 'Recover what plunder can be taken'],
        deployment: { player: 'Hunters — pursuit from one edge', opfor: '{target} pirates — scattered, fast, and light' },
        victory: ['Pirate force destroyed or scattered', 'Raiding broken'], windowDays: [21, 14],
    },
    DIVERSIONARY_RAID: {
        posture: 'raid', lead: 'mount a diversion to fix {target} attention for {employer}',
        objectives: ['Mount a diversionary raid to fix {target} attention for {employer}', 'Make maximum noise against a {target} secondary objective', 'Withdraw once the diversion is achieved'],
        deployment: { player: 'Raiders — fast strike from one edge', opfor: '{target} garrison — reacting and reinforcing' },
        victory: ['{target} forces drawn to the diversion', 'Raiders withdrawn intact'], windowDays: [14, 7],
    },
    OBJECTIVE_RAID: {
        posture: 'raid', lead: 'raid and destroy a designated {target} objective',
        objectives: ['Raid and destroy the designated {target} objective', 'Penetrate to the objective and demolish it', 'Exfiltrate before {target} reinforcement closes'],
        deployment: { player: 'Raiders — penetration edge', opfor: '{target} defenders — around the objective, with a reinforcement edge' },
        victory: ['Objective destroyed', 'Raiding force withdrawn'], windowDays: [14, 7],
    },
    RECON_RAID: {
        posture: 'raid', lead: 'recon {target} dispositions for {employer}',
        objectives: ['Recon {target} dispositions for {employer}', 'Probe the {target} line and confirm strength and composition', 'Avoid decisive engagement; extract the intelligence'],
        deployment: { player: 'Recon element — infiltration edge', opfor: '{target} screen — patrols backed by a reaction force' },
        victory: ['{target} dispositions confirmed', 'Recon element extracted with the intelligence'], windowDays: [14, 7],
    },
    EXTRACTION_RAID: {
        posture: 'raid', lead: 'extract a high-value asset from {target} custody',
        objectives: ['Extract the high-value asset from {target} custody', 'Reach the asset and secure it', 'Exfiltrate to the extraction zone before {target} reinforcements close'],
        deployment: { player: 'Extraction team — insert from one edge; extraction zone on the friendly edge', opfor: '{target} holding force — around the asset, with a reinforcement edge' },
        victory: ['Asset secured and extracted off-map', 'Extraction team withdrawn'], windowDays: [14, 7],
    },
};

export interface MissionClauses {
    command: CommandRights;
    salvageExchange: boolean;
    salvagePct: number;
    supportKind: 'straight' | 'battle-loss' | 'none';
    supportPct: number;
    transportPct: number;
}

/** Forge binding (D-025) — the chosen seed + the values rolled/filled ONCE (reload-identical). The
 *  seed prose loads from the pack by seedId and renders over these (DATA-003). NPC/staff assignments
 *  are campaign-level (they recur) and ride NewCampaignState, referenced here by the seed's flags. */
export interface MissionForge {
    seedId: string;
    register: string;
    generic?: boolean; // true = no seed matched → the D-023 template path renders, flagged generic
    rolledSpecifics: Record<string, number>;
    slots: { EMPLOYER: string; TARGET_FACTION: string; WORLD: string; DISTRICT: string; YEAR: string; FORCE_SIZE: string; PRIOR_TIER?: string; PRIOR_WORLD?: string };
    npcFlags: string[]; // tie-in flags this seed references (the npcId lives on the campaign assignment)
    branchLead?: string; // D-026 — the parent fork's trigger, fed as the briefing situation lead
    continuityLead?: string; // D-096 — engine-composed recurring-NPC callback (verbatim PM lines), prepended like branchLead
    systemId?: string; // D-080 — the real Star Map system this mission localized to (rolled once; reload-identical)
    // D-110e — Command-Rights-scaled extra complications rolled at generation (HS-only; deterministic by mission
    // id, stable on reload). Merged with the seed's own complications in the §2.4 render. Absent for Traditional.
    rolledComplications?: SeedComplication[];
    // D-117 — Hot Spots TRACK render ingredients, slot-filled at BIND so the PLAYER briefing can render the book
    // track layout from the persisted record alone (DATA-003 — no seed/pack access needed player-side). All optional,
    // HS-only, forward-only; Traditional and pre-117 specs never carry them and degrade gracefully (sections skipped).
    trackTemplate?: string; // resolved track template key (see chaos/track-setup.ts)
    opName?: string; // the operation / track name, slot-filled (OPERATION prefix stripped)
    situationLead?: string; // the 1-2 sentence italic situation blurb, slot-filled
    trackComplications?: { name: string; text: string; effect: string }[]; // seed + rolled, merged + slot-filled
    objectiveVp?: { primary?: number; secondary?: number; bonus?: number }; // optional per-objective VP (wins over TRACK_VP fallback)
    // DIRECTIVE-124 — the AUTHORED premade-hotspot render payload (literal, no slot-fill). Stamped at bind when the
    // seed is a preset hotspot; persisted so the GM deploy brief AND the player tablet render the ONE authored brief
    // from the record. Its presence SUPPRESSES the Forge FRAGORD/WARNORD (the single-brief flag). Absent otherwise.
    hotspot?: import('../chaos/hotspots-catalog').HotSpotBrief;
    // DIRECTIVE-IMPORT-6 Part B/C — the FULL authored objective list (text + VP + kind + side) of a Hot Spots track that
    // is NOT a catalog hotspot track (a D-116 preset played via the picker). Stamped at bind from seed.trackObjectives;
    // persisted so the resolve modal + the GM/player track sheets list every objective from the record alone. Absent for
    // Traditional, §18 universal picks (generic slots by design — IP-001), and catalog tracks (they carry `hotspot`).
    trackObjectives?: { text: string; vp: number; kind: 'primary' | 'secondary' | 'bonus'; side?: 'both' | 'attacker' | 'defender' }[];
    // DIRECTIVE-IMPORT-6 Part C/E — a preset track's authored TRACK-SHEET overrides (deployment / special rules / track end
    // / salvage policy / your role), persisted so the GM + player track sheets print the GM's words over the template
    // archetype's, and the single-sided resolve filters by the authored role. Absent for every non-preset track.
    trackSheet?: { deployment?: string; specialRules?: string; trackEnd?: string; salvagePolicy?: string; playerRole?: 'attacker' | 'defender' };
    // IMPORT-6 FOLLOWUPS — RESULTS ONLY: the special personnel actually HIRED and fielded for THIS track (name · role ·
    // 'Mech · G/P), stamped at hire/release and at bind (a contract-long hire survives into the next track). Never the
    // OFFER list (HotSpotBrief.hireable stays GM-side); no cost/one-time data. Absent when none are fielded (Traditional
    // never sets it — hiredMercs is written only by the HS deploy hire panel).
    hiredWithYou?: { name: string; role: string; chassis?: string; model?: string; gunnery: number; piloting: number }[];
}

/** D-099 — the appended travel/insertion timer for a mission, computed from the unit's current system to the
 *  localized target ({WORLD}) via systems.json coords. hasTravel=false ⇒ no map/location → operation-only (migration-safe). */
export interface MissionTravel {
    jumps: number;           // ceil(LY / jumpLy)
    jumpTransitDays: number; // jumps × per-jump recharge
    insertionDays: number;   // jump-point → planet burn
    operationDays: number;   // planetside op length (mirrored here so the block is self-contained)
    totalDays: number;       // jumpTransitDays + insertionDays + operationDays — the span the AAR advances the clock by
    hasTravel: boolean;      // false = no current-location/target coords → operation-only
    fromSystem: string | null;
    toSystem: string | null;
    ly: number;              // straight-line light-years (display/debug)
}

/** DATA-003 — the stored mission RECORD. Briefing prose is rendered from this; never parsed back. */
export interface MissionSpec {
    missionId: string;
    contractId: string;
    type: MissionTypeId;
    typeName: string;
    posture: MissionPosture;
    objectives: string[];
    opforForce: ProtoInstance[];
    opforBv: number;
    playerBv: number;
    terrain: { biome: string; note: string };
    deployment: { player: string; opfor: string };
    victoryConditions: string[];
    clauses: MissionClauses;
    reward: { total: number; monthly: number };
    window: { deployByDays: number; engagementDays: number; note: string };
    // D-099 — planetside operation length (seed.operationDays ?? type engagementDays) + the appended travel timer
    // (current location → localized target). The FRAGORD §6 clock + WARNORD read these; the AAR advances by travel.totalDays.
    operationDays?: number;
    travel?: MissionTravel;
    seed: number;
    forge?: MissionForge; // D-025 — seed binding (absent = pure D-023 template)
    // D-035 — §2.1 theater sheet + Appendix B comms plan, rolled ONCE at generation and STORED
    // (stored-not-rerolled). Optional: pre-D-035 specs lack them; the renderer degrades gracefully.
    theater?: TheaterSheet;
    comms?: CommsPlan;
    // D-038 — narrator-refined section prose (machine-diff-verified), keyed by section id. Optional;
    // stored-not-rerolled (REROLL/regenerate builds a fresh spec → cleared); render prefers refined.
    refined?: Record<string, { text: string; verified: boolean }>;
    // D-043 narrator v2 — the whole-mission pass. refinedVoices = mission-aware staff-voice boxes
    // (keyed by voice family, machine-diff-guarded); coherence = the advisory GM verdict (display-only).
    // Both optional, stored-not-rerolled (cleared on REROLL/regenerate), OFF renders neither.
    refinedVoices?: Record<string, { text: string; verified: boolean }>;
    coherence?: { reads: 'clean' | 'flags'; flags: { where: string; issue: string }[]; model: string };
    // D-045 — refine transparency (all optional, no version bump; logic untouched). refinedAt/model
    // feed the top-level ✦ REFINED stamp; refineLog is the GM change-log (prose-only before→after per
    // section, incl machine-diff-REJECTED boxes shown honestly as "kept template").
    refinedAt?: number;
    refinedModel?: string;
    refineLog?: { kind: 'voice' | 'situation'; label: string; status: 'accepted' | 'rejected' | 'error'; before: string; after: string | null; gate: string | null }[];
}

const sum = (xs: ProtoInstance[]): number => xs.reduce((a, b) => a + (b.bv ?? 0), 0);

/** Build the stored MissionSpec from the active contract + the (already band-drawn) OpFor force. */
export function buildMissionSpec(contract: ContractOffer, opforForce: ProtoInstance[], playerBv: number, rng: () => number = Math.random): MissionSpec {
    const tmpl = MISSION_TEMPLATES[contract.missionType];
    const fill = (s: string): string => s.replace(/\{target\}/g, contract.target).replace(/\{employer\}/g, contract.employer.name);
    const terrain = TERRAIN_TABLE[Math.floor(rng() * TERRAIN_TABLE.length)];
    const [deployByDays, engagementDays] = tmpl.windowDays;
    return {
        missionId: `msn-${Math.floor(rng() * 1e9)}`,
        contractId: contract.id,
        type: contract.missionType,
        typeName: contract.missionName,
        posture: tmpl.posture,
        objectives: tmpl.objectives.map(fill),
        opforForce,
        opforBv: sum(opforForce),
        playerBv,
        terrain: { biome: terrain.biome, note: terrain.note },
        deployment: { player: fill(tmpl.deployment.player), opfor: fill(tmpl.deployment.opfor) },
        victoryConditions: tmpl.victory.map(fill),
        clauses: {
            command: contract.command,
            salvageExchange: contract.salvage.exchange,
            salvagePct: contract.salvage.pct,
            supportKind: contract.support.kind,
            supportPct: contract.support.pct,
            transportPct: contract.transportPct,
        },
        reward: { total: contract.pay.total, monthly: contract.pay.monthly },
        window: { deployByDays, engagementDays, note: `Deploy within ${deployByDays} days; engagement window ~${engagementDays} days.` },
        seed: Math.floor(rng() * 1e9),
    };
}

// ── Narrator ADAPTER seam (T-014). NONE mode ships now (pack templates). LOCAL/CLOUD are declared,
//    not implemented — CLOUD is governed by SEC-002 (key server-side; the browser never calls the API). ──
export type NarratorMode = 'none' | 'local' | 'cloud';
export interface BriefingView {
    situation: string;
    objectives: string[];
    opforReadout: string;
    terms: string;
    window: string;
}
export interface NarratorAdapter {
    readonly mode: NarratorMode;
    narrate(spec: MissionSpec, employer: string): BriefingView;
}

const fmtBv = (n: number): string => n.toLocaleString('en-US');
const supportText = (c: MissionClauses): string =>
    c.supportKind === 'straight' ? `${c.supportPct}% straight` : c.supportKind === 'battle-loss' ? `${c.supportPct}% battle-loss` : 'none';

/** IMPORT-7 Part C (bonus) — the D-085 voice de-dup for the templated situation lead: the employer is named ONCE (the
 *  sentence subject); its later {employer} slot becomes a pronoun in the right grammatical position, and {target}
 *  (unknown to the NONE narrator) becomes "the enemy" instead of vanishing ("…retained the command to recon dispositions
 *  for Hot Spots Command" → "…engaged the command to recon enemy dispositions on its behalf"). Pure over the lead text. */
export function leadSentence(lead: string): string {
    return lead
        .replace(/a besieged \{employer\} garrison/g, 'one of its besieged garrisons')
        .replace(/ for \{employer\}$/g, ' on its behalf')
        .replace(/ on \{employer\}$/g, ' on it')
        .replace(/\bthe \{employer\} /g, 'its ')
        .replace(/\{employer\} /g, 'its ')
        .replace(/\{employer\}/g, 'it')
        .replace(/\bthe \{target\}/g, 'the enemy')
        .replace(/against \{target\}/g, 'against the enemy')
        .replace(/\{target\}-/g, 'enemy-')
        .replace(/\{target\} /g, 'enemy ')
        .replace(/\{target\}/g, 'the enemy')
        .replace(/\s+/g, ' ').trim();
}

/** NONE-mode narrator — generic templated prose slot-filled from the spec (a VIEW, DATA-003). */
export const NONE_NARRATOR: NarratorAdapter = {
    mode: 'none',
    narrate(spec, employer) {
        const salv = spec.clauses.salvageExchange ? 'salvage exchange' : `${spec.clauses.salvagePct}% salvage`;
        return {
            situation: `${employer} has engaged the command to ${leadSentence(MISSION_TEMPLATES[spec.type].lead)}. The engagement falls on ${spec.terrain.biome.toLowerCase()} — ${spec.terrain.note}.`,
            objectives: spec.objectives,
            opforReadout: `Estimated ${spec.opforForce.length} hostile 'Mechs, ~${fmtBv(spec.opforBv)} BV (your force fields ~${fmtBv(spec.playerBv)} BV). Composition and dispositions follow on the OpFor read-out.`,
            terms: `Command rights ${spec.clauses.command}; ${salv}; support ${supportText(spec.clauses)}; transport ${spec.clauses.transportPct}%. Contract pay ${fmtBv(spec.reward.total)} C-bills (${fmtBv(spec.reward.monthly)}/mo).`,
            window: spec.window.note,
        };
    },
};
