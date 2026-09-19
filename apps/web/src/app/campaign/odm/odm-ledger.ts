export interface OdmLedgerEntry {
    ts: number;
    actor: string;
    actorKey: string;
    seat: string | null;
    seatLabel: string | null;
    field: string;
    was: string | null;
    now: string | null;
    verb: string;
    outcome: 'applied' | 'refused' | 'requested' | 'override' | 'rollback';
    /** ORDER-13 — set on the SERVER-written seat lines only (the api's seat-ledger.service): a row id and the ACTING ROLE
     *  (owner · owner-reading · admin · player · dev). The client never writes these. */
    id?: number;
    role?: string;
}

/** A loadout / repair REQUEST a seat's holder raised. Player-visible (top-level in the snapshot): the requester
 *  sees its status move. It changes nothing on the machine — the GM acts on it and marks it. */
export interface OdmSeatRequest {
    id: string;
    instanceId: string;
    seatLabel: string;
    kind: 'repair' | 'loadout';
    text: string;
    by: string;
    byKey: string;
    at: number;
    status: 'open' | 'done' | 'declined';
}

export const ODM_LEDGER_CAP = 500;
export const ODM_SEAT_REQUEST_CAP = 100;

/** Append, newest last, bounded (a snapshot is fanned whole on every write). Never mutates its input. */
export function appendLedger(list: readonly OdmLedgerEntry[] | null | undefined, entry: OdmLedgerEntry): OdmLedgerEntry[] {
    return [...(list ?? []), entry].slice(-ODM_LEDGER_CAP);
}

/** The per-player filter's options: one row per ACTOR KEY (the stable handle — two devices may share a display
 *  name), labelled with the name that actor used most recently, in first-seen order. */
export function ledgerActors(list: readonly OdmLedgerEntry[] | null | undefined): { key: string; name: string; count: number }[] {
    const seen = new Map<string, { key: string; name: string; count: number }>();
    for (const e of list ?? []) {
        const row = seen.get(e.actorKey) ?? { key: e.actorKey, name: e.actor, count: 0 };
        row.name = e.actor; row.count += 1;
        seen.set(e.actorKey, row);
    }
    return [...seen.values()];
}

/** ORDER-13 — ONE view over two ledgers: the snapshot's (intents, overrides, rollbacks — written by the writer device) and the
 *  server's seat ledger (every seat change, whoever performed it). Chronological by `ts`, stable (the snapshot's order first on a
 *  tie), never mutates either input. The view then filters/reverses this as it always did. */
export function mergeLedgers(snapshot: readonly OdmLedgerEntry[] | null | undefined, server: readonly OdmLedgerEntry[] | null | undefined): OdmLedgerEntry[] {
    return [...(snapshot ?? []), ...(server ?? [])].sort((a, b) => a.ts - b.ts);
}

/** Newest first; `actorKey` null/'' = everyone. */
export function filterLedger(list: readonly OdmLedgerEntry[] | null | undefined, actorKey: string | null | undefined): OdmLedgerEntry[] {
    const all = [...(list ?? [])].reverse();
    return actorKey ? all.filter((e) => e.actorKey === actorKey) : all;
}
