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

/* ── DIRECTIVE-ODM-21 — ODM AS A SINGLE ENTITY (enforcement, not detection) ──────────────────────────
 * ODM-20 shipped DETECTION: the cover tile alarms when it finds 2+. An entity is something that cannot
 * be duplicated, so the refusal lives here, on the shared write path.
 *
 * DELIBERATELY UNGUARDED: NULL-OWNER ACCOUNTS. The guard asks "does THIS OWNER already have an odm row",
 * so a null ownerId cannot be asked about — matching all nulls would treat every legacy/unowned campaign
 * (and every dev/LAN campaign, which are ALL null-owner) as one account and refuse the second ODM
 * campaign for effectively everyone. That is why `ownerId == null` returns false rather than matching.
 * The consequence is real and intended: a legacy unowned account gets NO singleton protection. Do not
 * "fix" that by stamping an ownerId onto a live row — that is a data edit to a production campaign.
 *
 * THE forceNew FLAG IS CLIENT-SUPPLIED AND THEREFORE FORGEABLE. It is a DATA-INTEGRITY GUARD FOR A
 * USER'S OWN ACCOUNT, **NOT A SECURITY BOUNDARY** — a crafted client can always set it. That is
 * acceptable because the thing being protected is the user's own campaign list, not another tenant's
 * data. It is named here so nobody later reads this guard as enforcement and builds a real trust
 * decision on top of it; the tenancy boundary is canAccess/ownerId, and it is elsewhere.
 *
 * BLAST RADIUS: the first four clauses fail closed for everything that is not an ODM CREATE under auth,
 * so a non-ODM create and EVERY update (ODM or not) are unaffected by construction, not by test. */
export function odmSingletonRefused(
    authRequired: boolean,
    ownerId: string | null | undefined,
    isCreate: boolean,
    ownerHasOdm: boolean,
    forceNew: boolean,
    snapshot: unknown,
): boolean {
    if (!authRequired) return false;                        // dev/LAN/single-tenant — no gate (unchanged)
    if (ownerId == null) return false;                      // unowned: unaskable, see the note above
    if (!isCreate) return false;                            // an UPDATE to an existing row is never refused
    if (snapshotPackId(snapshot) !== 'odm') return false;   // not an ODM campaign — never gated here
    if (forceNew) return false;                             // the one exception (forgeable by design)
    return ownerHasOdm;                                     // refuse the second
}
