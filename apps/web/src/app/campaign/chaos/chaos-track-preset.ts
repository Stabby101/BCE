/*
 * BCE — DIRECTIVE-116: Hot Spots "track preset" (build-your-own track). IP-safe: the builder ships EMPTY — the
 * user enters a track from THEIR OWN rulebook; BCE stores their campaign, the content stays theirs (no CGL track
 * text shipped). A preset carries only the narrative fields; it has NO scale/BV — the OpFor sizes to the active
 * contract via the existing generate pipeline (D-110b). synthSeedFromPreset maps it onto a synthetic MissionSeed so
 * the SHARED Forge (mission-generator / bindForge / render) runs unchanged — nothing here rewrites the generator.
 */
import type { MissionSeed } from '../mission/forge-types';
import type { MissionTypeId } from '../contract/contract-terms';
import type { ObjectiveKind } from './hotspots-catalog';
import { TRACK_VP } from './track-setup'; // IMPORT-6 Part C — the default VP by kind (200/100/50) for legacy-preset hydration

/** IMPORT-6 Part C — a preset's FULL objective (the hotspot builder's superset model: text + VP + kind + side). */
export interface PresetObjective { text: string; vp: number; kind: ObjectiveKind; side: 'both' | 'attacker' | 'defender'; }

export interface PresetTrack {
    id: string;
    name: string; // the preset's own label (saved-list name)
    family: MissionTypeId; // mission type — drives the seed family (register/display; OpFor still sizes to the contract)
    title: string; // the operation title (becomes the generated op name)
    location?: string; // free-text world/place from the user's book (display hint)
    situation: string;
    objectives: { primary: string; secondary: string; bonus: string };
    opforSketch: { composition: string; behavior: string };
    armsMix?: 'MECH_ONLY' | 'COMBINED_ARMS'; // steers the OpFor arms mix (D-076), else the campaign default
    vehicleShare?: number; // 0..1 for a COMBINED_ARMS mix (else the per-era default)
    terrainBiome?: string; // biases the localized system (localeFit.terrain); the displayed biome is still rolled
    operationDays?: number; // authored planetside span (D-099), else the type window
    notes?: string; // GM notes (never rendered into the brief)
    createdAt: number;
    // ── DIRECTIVE-IMPORT-6 Part C — the full track-sheet model, ADDITIVE (the shared <bce-track-editor> authors it).
    //    All optional: a pre-IMPORT-6 preset lacks them and hydrates on READ (presetObjectives: the three plain-text
    //    objectives → objectives with default VP by kind 200/100/50, side 'both'). The legacy `objectives` trio is still
    //    written by the builder (first-of-kind) so old readers + the shared Forge render keep working unchanged. ──
    trackObjectives?: PresetObjective[];
    deployment?: string; specialRules?: string; trackEnd?: string; salvagePolicy?: string;
    playerRole?: 'attacker' | 'defender';
    templateId?: string; // the shared editor's track template label (display; `family` still drives the seed)
}

/** IMPORT-6 Part C — the preset's authored objective list, hydrated: the full model when present, else the legacy
 *  three plain-text objectives (empties dropped) with default VP by kind (TRACK_VP 200/100/50) and side 'both'. Pure;
 *  applied at every READ (editor open · seed synth · JSON import) — never a load-time rewrite of the saved preset. */
export function presetObjectives(p: Pick<PresetTrack, 'objectives' | 'trackObjectives'>): PresetObjective[] {
    if (p.trackObjectives?.length) return p.trackObjectives.map((o) => ({ text: o.text, vp: Number(o.vp) || 0, kind: o.kind, side: o.side ?? 'both' }));
    return (['primary', 'secondary', 'bonus'] as const)
        .filter((k) => (p.objectives?.[k] ?? '').trim())
        .map((k) => ({ text: p.objectives[k].trim(), vp: TRACK_VP[k], kind: k, side: 'both' as const }));
}

/** The mission types offered in the builder, labelled by Chaos archetype (our own labels — no book text). */
export const CHAOS_TRACK_FAMILIES: readonly { id: MissionTypeId; label: string }[] = [
    { id: 'OBJECTIVE_RAID', label: 'Raid' },
    { id: 'GARRISON_DUTY', label: 'Garrison' },
    { id: 'PLANETARY_ASSAULT', label: 'Invasion / Assault' },
    { id: 'RECON_RAID', label: 'Expedition / Recon' },
    { id: 'PIRATE_HUNTING', label: 'Pirate Hunt' },
    { id: 'CADRE_DUTY', label: 'Retainer / Cadre' },
    { id: 'EXTRACTION_RAID', label: 'Extraction' },
    { id: 'SECURITY_DUTY', label: 'Security' },
    { id: 'GUERRILLA_WARFARE', label: 'Guerrilla' },
    { id: 'DIVERSIONARY_RAID', label: 'Diversion' },
    { id: 'RELIEF_DUTY', label: 'Relief' },
    { id: 'RIOT_DUTY', label: 'Riot' },
];

/**
 * D-116 — synthesize a MissionSeed from an authored preset. The narrative fields map straight across; the
 * generation-only structure (forks / decisionPoints / complications / reactionTimeline / voiceSlots / specifics)
 * is EMPTY so the Forge degrades gracefully (no forks → no board children; no voiceSlots → no NPC casting). The
 * seedId is namespaced 'preset-<id>' so ForgePackService.seedById can resolve it back to the live preset at render
 * time (the pack never holds it, so random generation never selects it). localeFit.terrain (from terrainBiome)
 * biases the localizer; armsMix/vehicleShare/operationDays ride through to the OpFor + clock as on any seed.
 */
export function synthSeedFromPreset(p: PresetTrack): MissionSeed {
    const localeFit = p.terrainBiome ? { terrain: [p.terrainBiome] } : undefined;
    // IMPORT-6 Part C — the hydrated full objective list rides the seed (→ forge.trackObjectives at bind → the Part B
    // per-objective resolve + the track sheets). With a full list the three legacy slots are the FIRST objective of each
    // kind; a pre-IMPORT-6 preset keeps its stored trio VERBATIM (byte-identical seed) and hydrates the list from it.
    const objs = presetObjectives(p);
    const full = !!p.trackObjectives?.length;
    // With a full list: the first objective of each KIND; the PRIMARY slot falls back to the first objective when no
    // primary-kind row exists, so the legacy trio (AAR / filledObjectives) never carries a blank primary.
    const byKind = (k: ObjectiveKind): string => (full ? objs.find((o) => o.kind === k)?.text || (k === 'primary' ? objs[0]?.text : '') || '' : p.objectives?.[k] ?? '');
    // IMPORT-6 Part C/E — the authored track-sheet fields ride the seed (→ forge.trackSheet at bind → the GM/player
    // sheets + the single-sided role filter). Emitted only when at least one is authored (legacy presets: none).
    const sheet = {
        ...(p.deployment?.trim() ? { deployment: p.deployment.trim() } : {}),
        ...(p.specialRules?.trim() ? { specialRules: p.specialRules.trim() } : {}),
        ...(p.trackEnd?.trim() ? { trackEnd: p.trackEnd.trim() } : {}),
        ...(p.salvagePolicy?.trim() ? { salvagePolicy: p.salvagePolicy.trim() } : {}),
        ...(p.playerRole === 'attacker' || p.playerRole === 'defender' ? { playerRole: p.playerRole } : {}),
    };
    return {
        seedId: 'preset-' + p.id,
        family: p.family,
        title: p.title?.trim() || p.name,
        eraFit: [],
        factionFit: [],
        register: 'chaos-preset',
        threatRange: [],
        situation: p.situation,
        objectives: { primary: byKind('primary'), secondary: byKind('secondary'), bonus: byKind('bonus') },
        ...(objs.length ? { trackObjectives: objs } : {}),
        ...(Object.keys(sheet).length ? { trackSheet: sheet } : {}),
        complications: [],
        decisionPoints: [],
        reactionTimeline: { entries: [], hardDeadline: '' },
        opforSketch: { composition: p.opforSketch.composition, behavior: p.opforSketch.behavior },
        forks: [],
        storyElementSeed: '',
        voiceSlots: [],
        localeFit,
        armsMix: p.armsMix,
        vehicleShare: p.vehicleShare,
        operationDays: p.operationDays,
    };
}
