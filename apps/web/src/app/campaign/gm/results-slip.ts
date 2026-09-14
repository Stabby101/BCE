/*
 * GM-1 P3 — the RESULTS SLIP: the take-home record a player device receives at resolve (the deliberate v1
 * ruling: results go home by EXPORT, not write-back — each player applies their units' end-state to their
 * home campaign BY HAND). Built GM-side in confirmResolve BEFORE applyHsSettlement deletes lost units'
 * damage envelopes; carried as a TOP-LEVEL snapshot field (players must receive it; replaced each resolve).
 * Rows carry NO tokens (the HARDEN-5b discipline) — a player finds ITS rows via its own claim rows
 * (holderToken match, the same identity the sheet uses); salvage is honestly the TEAM share (no per-player
 * split exists in the book model — the only per-entity division is the D-125 pilot careerSP share).
 */
import type { CBTSerializedState } from '../../models/force-serialization';

/** GM-2 P2a/P2b — one company's pay by ITS terms. P2b adds ONE month of its own Base Pay per track (S22), the net transport
 *  and the rep spent at signing (both on the FIRST slip after signing — S23), and the completion +1 on the last track. */
export interface ParticipantSlipPay {
    combatPay: number;
    salvageSp: number;
    basePaySp?: number;   // round(500 × scale × basePay% / 100) — one month, paid per track
    transportSp?: number; // the net transport at signing, debited at home (first slip only)
    repDelta?: number;    // −repSpent on the first slip, +1 on the contract's last track
}

export interface SlipUnitRow {
    instanceId: string;
    label: string; // "Chassis Model"
    status: 'ok' | 'destroyed' | 'abandoned';
    pilotFate?: 'ok' | 'injured' | 'kia'; // present on losses (the GM's chosen fate)
    crewHits?: number; // crew hits from the reconciled end-state (0-6); the render prefers pilotFate when present
    damage?: CBTSerializedState | null; // the end-state to apply at home (null = pristine / unreconciled)
    /** DIRECTIVE-PD3 P1 (PD3-12) — the Hot Spots TABLETOP damage level (the Repair & Refit recorder, D-110d) and the
     *  triage tag, when the GM recorded either: a unit played on the table has no envelope, so without these a
     *  participant's home company never learned it was hit. HS rows only — a Traditional slip never carries them. */
    chaosDamage?: 'armor' | 'structure' | 'crippled' | 'destroyed';
    triage?: 'G' | 'Y' | 'R' | 'B';
    // GM-2 P1 — the identity cut, echoed from the mint's provenance: which HOME campaign and which home unit / pilot
    // this row IS. "Apply to my campaign" matches on originInstanceId; absent on rows from pre-P1 imports (not applicable).
    sourceCampaignId?: string;
    originInstanceId?: string;
    originPilotId?: string;
}

export interface ResultsSlip {
    /** GM-2 P1 — minted GM-side at resolve (a uuid, never derived); the idempotency key on the home campaign's appliedSlips[].
     *  Absent on slips minted before P1 — such a slip cannot be applied (the render says so). */
    slipId?: string;
    branchId: string;
    trackName: string;
    resolvedAt: number; // epoch ms
    outcome?: string;   // the resolve tier label (SUCCESS/PARTIAL/…) as recorded
    /** TEAM SP. ORDER-3 H16 — OPTIONAL: an ODM table's slip carries NEITHER (absent, not 0) — the company record holds the
     *  outcome and the ODM iron rule pays 0; the render says so in one line. Every Classic/HS slip still sets both. */
    combatPay?: number;
    salvageSp?: number; // TEAM SP — the fallback share (GM-2 P2a: a company that signed its own contract reads `pay` instead)
    /** GM-2 P2a — PER-PLAYER pay, keyed by the home campaign id (sourceCampaignId): present only for the companies that signed
     *  their OWN contract this session (the GM-brokered participant contract), each paid by ITS terms. A company without one
     *  takes the team share above, exactly as P1 paid it; an empty map → the key is absent (byte-identical slip). */
    pay?: Record<string, ParticipantSlipPay>;
    /** GM-2 P3 — career SP earned THIS resolve by a brought pilot (the D-125 earn side's share), keyed by the HOME pilot id
     *  (originPilotId). P1's Apply lands it on the home pilot's card. Absent when nothing was credited. */
    pilotSp?: Record<string, number>;

    units: SlipUnitRow[];
    // GM-2 P1 — the session's identity for the home campaign's ledger line ("three sessions, three lines").
    sessionName?: string;  // the GM campaign's save name
    hotspotTitle?: string; // the hot spot the track belonged to
}

/** GM-2 P1 — a slip's identity: a uuid minted at resolve (never derived from branch/date — two resolves of one branch are two
 *  slips). ORDER-3 H16 — moved here (a pure move) so the ODM resolve mints the same way the Classic/HS resolve does. */
export function newSlipId(): string {
    try { const c = globalThis.crypto as { randomUUID?: () => string } | undefined; if (c?.randomUUID) return c.randomUUID(); } catch { /* fall through */ }
    return `slip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
