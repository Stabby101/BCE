
/** The pack id a campaign snapshot carries, or null. Defensive duck-read of the opaque/untrusted blob. */
export function snapshotPackId(snapshot: unknown): string | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const v = (snapshot as { packId?: unknown }).packId;
    return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The gate decision: TRUE ⇒ refuse this save. Fires only when auth is required AND the snapshot is
 *  pack-tagged AND the saver is neither an admin nor entitled to that pack. Guests are never entitled
 *  (they can hold no grants), so a guest pack save is refused by construction. */
export function packRefused(role: string | undefined | null, authRequired: boolean, entitled: boolean, snapshot: unknown): boolean {
    if (!authRequired) return false; // dev/LAN/single-tenant — no gate (unchanged)
    const packId = snapshotPackId(snapshot);
    if (!packId) return false; // a plain campaign — never gated here
    if (role === 'admin') return false; // admin bypass (console-operated anyway)
    return !entitled;
}

export function odmSingletonRefused(
    authRequired: boolean,
    isCreate: boolean,
    anyOdmExists: boolean,
    forceNew: boolean,
    isOwner: boolean,
    snapshot: unknown,
): boolean {
    if (!authRequired) return false;                        // dev/LAN/single-tenant — no gate (unchanged)
    if (!isCreate) return false;                            // an UPDATE to an existing row is never refused
    if (snapshotPackId(snapshot) !== 'odm') return false;   // not an ODM campaign — never gated here
    if (forceNew && isOwner) return false;                  // the OWNER's escape → the anomaly picker (owner-only)
    return anyOdmExists;                                    // ONE ODM in the world — refuse ANY second (per PACK)
}

export function odmFlipRefused(authRequired: boolean, existingPackId: string | null, incomingSnapshot: unknown): boolean {
    if (!authRequired) return false;
    return existingPackId !== 'odm' && snapshotPackId(incomingSnapshot) === 'odm';
}

export const ODM_FEATURE = 'odm';

export type OdmRecordRole = 'write' | 'read' | 'none';
export function odmRecordAccess(opts: { admin: boolean; isOwner: boolean; role: string | null | undefined; features: readonly string[] }): OdmRecordRole {
    if (opts.admin || opts.isOwner) return 'write';
    if (opts.role === 'gm' && opts.features.includes(ODM_FEATURE)) return 'read'; // co-GM = odm grant + role gm (no new feature)
    return 'none';
}

export type OdmMigrationPlan = { status: 'skipped' | 'error' | 'ok'; recordId: string | null; anomalies: string[]; message: string };
export function planOdmMigration(pinnedId: string | null | undefined, odmRowIds: readonly string[]): OdmMigrationPlan {
    const pin = pinnedId?.trim() || null;
    if (!pin) return { status: 'skipped', recordId: null, anomalies: [], message: 'ODM_RECORD_ID not set — no ODM record pinned, migration skipped' };
    if (!odmRowIds.includes(pin)) return { status: 'error', recordId: null, anomalies: [], message: `ODM_RECORD_ID=${pin} matches no campaign row — NO CHANGE (check the pin)` };
    const anomalies = odmRowIds.filter((id) => id !== pin);
    return { status: 'ok', recordId: pin, anomalies, message: `ODM record pinned ${pin}; ${anomalies.length} other packId:'odm' row(s) flagged as anomalies` };
}
