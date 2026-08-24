/*
 * DIRECTIVE-ODM-1 Phase 1 — the server-authoritative gate on PACK-campaign persistence.
 *
 * A pack campaign (ODM) rides in the snapshot blob as an additive `packId` field, persisted via the normal
 * campaign save — so the authoritative gate lives on that save path (the IMPORT-1 custom-hotspot-gate
 * precedent, same file shape): an account WITHOUT the pack's feature grant may not create or persist a
 * pack-tagged campaign. Hiding the cover card is UX; THIS is the security.
 *
 * Pure functions (no Nest/DB deps) so the decision is unit-testable in isolation. When auth is NOT required
 * (local/dev/LAN, BCE_AUTH_REQUIRED off) there is no tenant tier and no gate — single-tenant behavior is
 * byte-unchanged (consistent with viewer() and guestCustomHotspotRefused).
 */

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
