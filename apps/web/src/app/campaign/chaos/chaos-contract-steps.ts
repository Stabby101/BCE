export type ContractColumn = 'basePay' | 'command' | 'salvage' | 'support' | 'transport';
export const CONTRACT_COLUMNS: ContractColumn[] = ['basePay', 'command', 'salvage', 'support', 'transport'];
export const COLUMN_LABEL: Record<ContractColumn, string> = {
    basePay: 'Base Pay',
    command: 'Command Rights',
    salvage: 'Salvage Rights',
    support: 'Support Rights',
    transport: 'Transport',
};

/** The 17-step table. `null` marks an invalid `—` step. basePay/transport are %; salvage/support are enums/%. */
const STEPS: Record<ContractColumn, (number | string | null)[]> = {
    // Base Pay % (of 500 SP × scale) — all 17 valid.
    basePay: [50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
    // Command Rights (enum) — only steps 3/7/8/11 valid.
    command: [null, null, 'Integrated', null, null, null, 'House', 'Liaison', null, null, 'Independent', null, null, null, null, null, null],
    // Salvage Rights (None / Exchange / %).
    salvage: ['None', null, 'Exchange', 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, null, null, null, null],
    // Support Rights — 'None' | 'Straight/X' (covers X% of repairs) | 'Battle/X' (covers 100% repairs + X% losses).
    support: ['None', 'Straight/20', 'Straight/40', 'Straight/60', 'Straight/70', 'Straight/80', 'Straight/90', 'Straight/100', 'Battle/10', 'Battle/20', 'Battle/30', 'Battle/40', 'Battle/50', 'Battle/75', 'Battle/100', null, null],
    // Transportation % reimbursement — only steps 5–9 valid.
    transport: [null, null, null, null, 0, 25, 50, 75, 100, null, null, null, null, null, null, null, null],
};

export const CONTRACT_STEP_COUNT = 17;

/** The value at a 0-based step index for a column (null if the `—` step). */
export function stepValue(col: ContractColumn, step: number): number | string | null {
    return STEPS[col][step] ?? null;
}

/** The next VALID (non-`—`) step index moving in `dir` (+1 up / −1 down) from `from`, or null if none remains. */
export function nextValidStep(col: ContractColumn, from: number, dir: 1 | -1): number | null {
    for (let i = from + dir; i >= 0 && i < CONTRACT_STEP_COUNT; i += dir) {
        if (STEPS[col][i] != null) return i;
    }
    return null;
}

export function snapValidStep(col: ContractColumn, idx: number): number {
    const i = Math.max(0, Math.min(CONTRACT_STEP_COUNT - 1, Math.round(Number(idx) || 0)));
    if (STEPS[col][i] != null) return i;
    return nextValidStep(col, i, -1) ?? nextValidStep(col, i, 1) ?? i;
}

/** The human label a step resolves to (the % / enum), for a builder dropdown / display. '—' for an invalid step. */
export function stepLabel(col: ContractColumn, step: number): string {
    const v = STEPS[col][step];
    if (v == null) return '—';
    return typeof v === 'number' && (col === 'basePay' || col === 'transport' || col === 'salvage') ? `${v}%` : String(v);
}

export function validStepOptions(col: ContractColumn): { index: number; label: string }[] {
    const out: { index: number; label: string }[] = [];
    for (let i = 0; i < CONTRACT_STEP_COUNT; i++) if (STEPS[col][i] != null) out.push({ index: i, label: stepLabel(col, i) });
    return out;
}

export function repCostUp(col: ContractColumn, from: number): number | null {
    const to = nextValidStep(col, from, 1);
    return to == null ? null : to - from;
}

export function sacrificeDropTarget(col: ContractColumn, from: number): number | null {
    for (let j = from - 2; j >= 0; j--) {
        if (STEPS[col][j] != null) return j;
    }
    return null;
}

export function repBudgetFor(rep: number, scale: number): number {
    return Math.min(rep, 2 * scale);
}

export function canRaiseTerm(cost: number | null, repUsed: number, repBudget: number, colRaises: number, scale: number): boolean {
    return cost != null && repUsed + cost <= repBudget && colRaises + cost <= scale;
}

/** Contract type — GM-editable defaults (our own values). defaultSteps = the 0-based starting step per column. */
export interface ChaosContractType {
    id: string;
    label: string;
    defaultSteps: Record<ContractColumn, number>;
    intensityRange: [number, number]; // [min tracks, max tracks]
}

export const CHAOS_CONTRACT_TYPES: ChaosContractType[] = [
    { id: 'raid', label: 'Raid', defaultSteps: { basePay: 7, command: 6, salvage: 4, support: 1, transport: 5 }, intensityRange: [1, 2] },
    { id: 'garrison', label: 'Garrison', defaultSteps: { basePay: 6, command: 6, salvage: 5, support: 5, transport: 6 }, intensityRange: [2, 4] },
    { id: 'invasion', label: 'Invasion', defaultSteps: { basePay: 8, command: 6, salvage: 6, support: 7, transport: 8 }, intensityRange: [3, 5] },
    { id: 'expedition', label: 'Expedition', defaultSteps: { basePay: 4, command: 10, salvage: 3, support: 3, transport: 5 }, intensityRange: [1, 3] },
    { id: 'pirate-hunt', label: 'Pirate Hunt', defaultSteps: { basePay: 6, command: 7, salvage: 7, support: 4, transport: 6 }, intensityRange: [2, 3] },
    { id: 'retainer', label: 'Retainer', defaultSteps: { basePay: 5, command: 6, salvage: 4, support: 5, transport: 7 }, intensityRange: [3, 6] },
];
