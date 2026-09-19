export interface OdmDoorAccount {
    /** the engine enforces accounts (false = dev/LAN single-operator — never a co-GM) */
    authRequired: boolean;
    id: string | null;
    role: string | null;
}
export type OdmDoorDecision<R> =
    | { kind: 'create' }
    | { kind: 'enter'; rec: R; coGm: boolean }
    | { kind: 'picker'; recs: R[] };

/** `odmRows` = the account's packId:'odm' rows exactly as the server listed them. */
export function odmDoorDecision<R extends { ownerId?: string | null; odmRecord?: boolean }>(odmRows: readonly R[], me: OdmDoorAccount): OdmDoorDecision<R> {
    if (me.authRequired && me.role === 'gm' && me.id) {
        const the = odmRows.find((r) => r.odmRecord === true); // at most one — the pin is a single id
        if (the && the.ownerId != null && the.ownerId !== me.id) return { kind: 'enter', rec: the, coGm: true };
    }
    if (odmRows.length === 0) return { kind: 'create' };
    if (odmRows.length === 1) return { kind: 'enter', rec: odmRows[0], coGm: false };
    return { kind: 'picker', recs: odmRows.slice() };
}
