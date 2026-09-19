
export type NarratorMode = 'off' | 'local';

/** A single prose section handed to REFINE. The locked values MUST all survive (machine-diff.ts). */
export interface RefineTarget {
    id: string;            // stable per artifact+section, e.g. 'situation' / 'command' / 'intelligence'
    label: string;         // human label for the per-section result UI
    roleFamily: string | null; // which staff voice authors it (engineering|command|intelligence|…)
    text: string;          // the template prose (the starting point + the diff baseline)
    names: string[];       // explicit locked names (world, faction, employer, opposition, codewords…)
}

/** VALIDATE = the quality formula as lint (a second json_schema call). */
export interface ValidateReport {
    vagueWords: string[];
    missingIntelAge: boolean;
    optionImbalance: boolean;
    numberDrift: boolean;
    verdict: 'pass' | 'warn' | 'fail';
}

/** One section's refine outcome — the per-section result state the UI renders. */
export interface RefineResult {
    id: string;
    label: string;
    status: 'accepted' | 'rejected' | 'error';
    gate: string | null;   // the NAMED reason on reject/error (machine-diff drift, server down, timeout)
    text: string | null;   // the accepted refined prose (null on reject/error → template stands)
    validate: ValidateReport | null;
    ms: number;
    promptTokens: number;
    completionTokens: number;
}

/** Stored on the spec / AAR record (optional; stored-not-rerolled; REROLL clears). Render prefers
 *  refined-and-verified over template, section by section. */
export type RefinedStore = Record<string, { text: string; verified: boolean }>;


/** A staff-voice sidebar box to rewrite MISSION-AWARE (Job 1). The model gets the whole package as
 *  context + this box's voice/header/stub; it returns prose in that officer's voice that references
 *  the real world/OpFor/objective/clock. The machine diff guards it (no invented numbers). */
export interface VoiceBoxTarget {
    id: string;            // the staff-voice family: command|intelligence|engineering|logistics|naval|medical|comms
    header: string;        // the officer's sidebar header (e.g. "ODELL BRANN — CHIEF TECH'S LEDGER:")
    name: string;          // the officer's name (for the prompt)
    speechRules: string[]; // the voice's binding speech rules
    stub: string[];        // the current authored sample lines — the fallback + tone reference
    commentOn: string;     // WHAT this voice should address this mission (subject seed)
}

/** One rewritten voice box's outcome (machine-diff guarded; null text → the stub stands). */
export interface VoiceBoxResult { id: string; status: 'accepted' | 'rejected' | 'error'; gate: string | null; text: string | null; }

/** Job 2 — the coherence verdict (advisory, GM-only, display-only; never auto-edits structure). */
export interface CoherenceFlag { where: string; issue: string; }
export interface CoherenceVerdict { reads: 'clean' | 'flags'; flags: CoherenceFlag[]; model: string; }

/** The whole-mission pass result the service returns (the component stores the accepted pieces). */
export interface WholeMissionResult {
    voices: VoiceBoxResult[];
    coherence: CoherenceVerdict | null;
    ms: number;
    tokS: number;
    promptTokens: number;
    completionTokens: number;
}

/** Stored on the spec (optional; REROLL clears; OFF unchanged). refinedVoices = accepted Job-1 boxes;
 *  coherence = the Job-2 verdict (display-only data). */
export type RefinedVoiceStore = Record<string, { text: string; verified: boolean }>;

export interface NarratorModelRow { id: string; label: string; sizeMB: number; approxVramGB: number; fetched: boolean }

/** Live sidecar stats (footer console + Settings). All localhost; degrades per-panel when offline. */
export interface NarratorStats {
    sidecar: 'up' | 'offline';
    llama: { status: 'off' | 'loading' | 'ready' | 'offline'; pid: number | null; uptimeSec: number; model: string; activeId?: string; refineRuns: number; validateRuns: number; promptTokens: number; completionTokens: number; lastTokS: number; lastMs: number; lastKind: string | null };
    models?: NarratorModelRow[];
    gpu: { name: string; utilPct: number; memUsedMB: number; memTotalMB: number; tempC: number } | null;
    sys: { cpuPct: number; memUsedMB: number; memTotalMB: number } | null;
}
