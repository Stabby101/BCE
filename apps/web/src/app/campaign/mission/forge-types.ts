/*
 * BCE — Content Forge pack types (DIRECTIVE-025, T-029). The shapes of the authored pack data
 * (content-forge/batches → forge-data/*.json): mission SEEDS, registry NPCs, and VOICE personalities.
 * DATA-003: this is authored prose/structure rendered OVER the computed MissionSpec; never parsed back.
 *
 * D-076 SCOPED DATA-003 EXCEPTION: `MissionSeed.armsMix` + `MissionSeed.vehicleShare` are the ONE
 * structured seed fields the GENERATOR reads back at compute time (to steer the OpFor's unit-type mix —
 * `opforSketch` stays prose-only and is never parsed). Both optional; absent ⇒ today's behavior exactly.
 */

export interface SeedCosts {
    cbills: number | null;
    days: number | null;
    resource: string | null;
    risk: string | null;
}
export interface SeedOption {
    title: string;
    advantages: string[];
    disadvantages: string[];
    consequence: string;
    costs?: SeedCosts;
}
export interface SeedDecisionPoint {
    name: string;
    context: string;
    options: SeedOption[];
}
export interface SeedComplication {
    name: string;
    text: string;
    mechanicalEffect: string;
}
export interface SeedTimelineEntry {
    t: string;
    event: string;
}
export interface SeedFork {
    name: string;
    outcomeGate: string;
    trigger: string;
    consequence: string;
    threat: string;
    nextSeedId?: string; // D-097 — optional hard-preferred arc link: the seed an advancing fork chains to (SOFT-preferred, era-floored, never hard-forced)
}
export interface SeedResourceGate {
    appliesTo: string; // a decision-point name or an option title
    requires: string; // jumpship | dropship | established-base | depot-access | treasury-min:<n>
    whenLacking: 'lock' | 'reprice';
    lackingText: string;
}
export interface SeedSpecific {
    min: number;
    max: number;
    unit: string;
}
// ── SCHEMA v1.3 (FORGE-BRIEF addendum 2026-06-12) — the Pale-Candle depth layer. ALL OPTIONAL:
//    pre-v1.3 seeds carry none of it and render exactly as before (graceful degradation is law). ──
export interface SeedRoute {
    name: string;     // named like TEAL/GRAY where movement matters
    desc: string;
    tradeoff: string;
}
export interface SeedKernel {
    voiceSlot: string; // roleFamily of the staff voice that should comment here
    kernel: string;    // WHAT to comment on (the D-036 narrator's prompt; NONE-mode renders it as the subject)
}
export interface SeedPhase {
    name: string;                       // e.g. "POSTURE — THE WATCH" / INGRESS / EXTRACTION
    lead: string;                       // 1–2 sentence phase intent
    dataBlock?: Record<string, string>; // LZ tables, posting schedules, crossing data
    routes?: SeedRoute[];
    /** signals/codewords/contact procedures. The brief spec'd a string; the era-spread retrofit
     *  authored kv OBJECTS — both shapes are valid data (graceful degradation is law). */
    protocol?: string | Record<string, string>;
    sidebarKernel?: SeedKernel;
}
export interface SeedAssetDetail {
    ref: string;      // "{NPC:flag}" or a role label
    detail: string;   // individual needs/quirks/complications
    priority: string;
}
export interface MissionSeed {
    seedId: string;
    family: string; // == AtBContractType / MissionTypeId
    title: string;
    eraFit: string[];
    factionFit: string[];
    register: string;
    threatRange: string[];
    situation: string;
    objectives: { primary: string; secondary: string; bonus: string };
    complications: SeedComplication[];
    decisionPoints: SeedDecisionPoint[];
    reactionTimeline: { entries: SeedTimelineEntry[]; hardDeadline: string };
    opforSketch: { composition: string; behavior: string };
    forks: SeedFork[];
    storyElementSeed: string;
    voiceSlots: string[];
    registerVariants?: Record<string, Record<string, string>>;
    specifics?: Record<string, SeedSpecific>;
    resourceGates?: SeedResourceGate[];
    // v1.3 (optional — absent on pre-v1.3 seeds; the renderer degrades gracefully)
    phases?: SeedPhase[];
    assetDetails?: SeedAssetDetail[];
    // FORGE-BRIEF v2.2 (optional — absent on pre-v2.2 seeds; D-080 then localizes by faction-space + range
    // only). localeFit constrains WHERE the mission lands: a system whose localeAttrs satisfy these (relaxed
    // terrain → regionRole → settlement, never dead-ends). terrain is inert until systems carry terrain data.
    localeFit?: { settlement?: string[]; regionRole?: string[]; terrain?: string[] };
    // D-076 (the scoped DATA-003 exception — see header): the seed's intended OpFor arms-mix. The generator
    // reads these AT COMPUTE TIME to steer the table. Absent ⇒ today's behavior (campaign state.armsMix()).
    //   armsMix:       MECH_ONLY → 'Mechs only (0 vehicles); COMBINED_ARMS → 'Mechs + combat vehicles.
    //   vehicleShare:  0..1 — the desired vehicle fraction for a COMBINED_ARMS seed (else the per-era default).
    armsMix?: 'MECH_ONLY' | 'COMBINED_ARMS';
    vehicleShare?: number;
    // FORGE-BRIEF v2.5 (D-099): authored planetside OPERATION length in days — the consumed-on-world span the
    // AAR advances the clock by, after the appended jump transit + insertion. Absent ⇒ the type engagement window.
    operationDays?: number;
    // DIRECTIVE-124 (premade Hot Spots — additive, absent on all other seeds): a per-track OpFor BV ratio (multiplies
    // the sizing target) and an explicit OpFor faction override (else the contract enemy). Only authored hotspot seeds set them.
    bvRatio?: number;
    opforFaction?: string;
    // DIRECTIVE-IMPORT-6 Part C (Hot Spots track presets — additive, absent on every other seed): the GM's FULL authored
    // objective list (text + VP + kind + side) for a D-116 preset track. The three `objectives` slots stay populated (by
    // kind) for the shared Forge render/AAR; the generator stamps this list onto MissionForge.trackObjectives at bind so
    // the resolve modal / track sheet list every authored objective with its VP (Part B). Catalog hotspot tracks carry
    // theirs on the HotSpotBrief instead (spec.forge.hotspot.objectives) — never both.
    trackObjectives?: { text: string; vp: number; kind: 'primary' | 'secondary' | 'bonus'; side?: 'both' | 'attacker' | 'defender' }[];
    // IMPORT-6 Part C/E — the preset's authored TRACK-SHEET fields (the shared editor's superset beyond objectives). All
    // optional; each overrides the template archetype's line on the GM/player track sheet (Part E) and playerRole feeds the
    // single-sided resolve's role filter (Part B). Stamped onto MissionForge.trackSheet at bind. Absent on every other seed.
    trackSheet?: { deployment?: string; specialRules?: string; trackEnd?: string; salvagePolicy?: string; playerRole?: 'attacker' | 'defender' };
}

export interface ForgeNpc {
    npcId: string;
    name: string;
    callsign?: string;
    archetype: string;
    factionAffinity: string[];
    eraFit: string[];
    background: string;
    traits: string[];
    tieInFlags: string[];
    voiceTags: string[];
    status: string;
}

export interface ForgeVoice {
    voiceId: string;
    name: string;
    roleFamily: string; // engineering | command | intelligence | logistics | medical | naval | comms
    factionFit: string[];
    eraFit: string[];
    personality: string;
    speechRules: string[];
    sidebarHeader: string;
    sampleLines: string[];
}
