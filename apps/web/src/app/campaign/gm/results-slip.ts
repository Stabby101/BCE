import type { CBTSerializedState } from '../../models/force-serialization';

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
    chaosDamage?: 'armor' | 'structure' | 'crippled' | 'destroyed';
    triage?: 'G' | 'Y' | 'R' | 'B';
    // this row IS. "Apply to my campaign" matches on originInstanceId; absent on rows from pre-P1 imports (not applicable).
    sourceCampaignId?: string;
    originInstanceId?: string;
    originPilotId?: string;
}

export interface ResultsSlip {
    slipId?: string;
    branchId: string;
    trackName: string;
    resolvedAt: number; // epoch ms
    outcome?: string;   // the resolve tier label (SUCCESS/PARTIAL/…) as recorded
    combatPay?: number;
    salvageSp?: number;
    pay?: Record<string, ParticipantSlipPay>;
    pilotSp?: Record<string, number>;

    units: SlipUnitRow[];
    sessionName?: string;  // the GM campaign's save name
    hotspotTitle?: string; // the hot spot the track belonged to
}

export function newSlipId(): string {
    try { const c = globalThis.crypto as { randomUUID?: () => string } | undefined; if (c?.randomUUID) return c.randomUUID(); } catch { /* fall through */ }
    return `slip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
