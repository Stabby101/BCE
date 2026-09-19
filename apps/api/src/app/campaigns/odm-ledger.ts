export interface OdmLedgerEntry {
    ts: number;
    actor: string;
    actorKey: string;        // an opaque, stable handle — never a bearer token; the per-player filter keys on it
    seat: string | null;     // the unit instanceId the entry is about (null = a company-level entry)
    seatLabel: string | null;
    field: string;
    was: string | null;
    now: string | null;
    verb: string;
    outcome: 'applied' | 'refused' | 'requested' | 'override' | 'rollback';
    /** ORDER-13 — set on the SERVER-written seat lines only (claims/seat-ledger.service.ts): a row id and the acting role. */
    id?: number;
    role?: string;
}

/** The ledger is bounded: the newest entries win (a snapshot is fanned whole on every write). */
export const ODM_LEDGER_CAP = 500;

const ledgerOf = (snapshot: unknown): OdmLedgerEntry[] => {
    const g = snapshot && typeof snapshot === 'object' ? (snapshot as { gmOnly?: unknown }).gmOnly : null;
    const l = g && typeof g === 'object' ? (g as { odmLedger?: unknown }).odmLedger : null;
    return Array.isArray(l) ? (l as OdmLedgerEntry[]) : [];
};

/** Mutates `restored` in place: its ledger becomes the CURRENT ledger + `entry` (capped). Everything else in the
 *  restored `gmOnly` block is left exactly as the checkpoint had it. */
export function carryLedgerAcrossRestore(current: unknown, restored: Record<string, unknown>, entry: OdmLedgerEntry): void {
    const gmOnly = restored['gmOnly'] && typeof restored['gmOnly'] === 'object' ? (restored['gmOnly'] as Record<string, unknown>) : {};
    restored['gmOnly'] = { ...gmOnly, odmLedger: [...ledgerOf(current), entry].slice(-ODM_LEDGER_CAP) };
}
