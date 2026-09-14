/*
 * DIRECTIVE-IMPORT-1 Part A — the server-authoritative gate on custom-hotspot persistence.
 *
 * Custom (`custom:true`) hotspots ride INSIDE the campaign snapshot blob (snapshot.customHotSpots[]), persisted
 * via the normal campaign save. So the authoritative accountability gate lives on that save path (not a hidden
 * UI button, and not a separate endpoint a guest could bypass by POSTing a crafted snapshot): a GUEST-role
 * account may not persist custom hotspots. Only authenticated non-guest accounts (gm/admin) can — the anchor
 * for hosting user content.
 *
 * Pure functions (no Nest/DB deps) so the decision is unit-testable in isolation. When auth is NOT required
 * (local/dev/LAN, BCE_AUTH_REQUIRED off) there is no guest tier and no gate — the existing experience is
 * byte-unchanged.
 */

/** How many custom (user-authored) hotspots a campaign snapshot carries. Reads snapshot.customHotSpots[]
 *  defensively (the blob is opaque/untrusted): a non-array / missing field → 0. The COUNT of that list is the
 *  gate signal — the client only ever populates customHotSpots with custom (`custom:true`) hotspots, so any
 *  entry present there is one, and a guest submitting a snapshot with entries is exactly what we refuse.
 *  GM-1 P2 — the count reads BOTH layouts: top-level AND gmOnly.customHotSpots (GM sessions store the
 *  chamber under the gmOnly key). Without this, a crafted {gmOnly:{customHotSpots:[...]}} snapshot would
 *  count 0 and smuggle past the gate — the exact bypass this file's header says it exists to prevent.
 *  (This is a sanctioned save-chokepoint read of ONE well-known key; the FAN still never parses gmOnly.) */
export function snapshotCustomHotspotCount(snapshot: unknown): number {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    const at = (o: unknown): number => {
        if (!o || typeof o !== 'object') return 0;
        const list = (o as { customHotSpots?: unknown }).customHotSpots;
        return Array.isArray(list) ? list.length : 0;
    };
    return at(snapshot) + at((snapshot as { gmOnly?: unknown }).gmOnly);
}

/** GM-1 P2 — the gmOnly ENTITLEMENT belt (the pack-gate shape): a snapshot carrying the gmOnly key persists
 *  only for an admin or an ENTITLED account — gmOnly is the GM-truth container. ODM-18 P1 widened `entitled`
 *  at the controller: the gm-mode grant OR the snapshot's own pack grant (an ODM-entitled owner is
 *  legitimately the GM of their pack campaign and carries gmOnly.pilotNotes without any gm-mode flag; the
 *  pack-persist gate already enforces the same grant on the same save). EXISTENCE check only: the contents
 *  are never parsed (opacity holds). Dev/LAN (auth off) never gates. */
export function gmOnlyRefused(role: string | undefined | null, authRequired: boolean, entitled: boolean, snapshot: unknown): boolean {
    if (!authRequired) return false; // dev/LAN/single-tenant — permissive, unchanged
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!('gmOnly' in (snapshot as Record<string, unknown>))) return false; // no key → no gate
    if (role === 'admin') return false;
    return !entitled;
}

/** The gate decision: TRUE ⇒ refuse this save (a guest is trying to persist custom hotspots). Only fires when
 *  auth is required AND the saver is a guest AND the snapshot actually carries custom hotspots. A gm/admin, or
 *  any save with no custom hotspots, or an unauthenticated/dev deployment, passes untouched. */
export function guestCustomHotspotRefused(role: string | undefined | null, authRequired: boolean, snapshot: unknown): boolean {
    if (!authRequired) return false; // dev/LAN/single-tenant — no guest tier, no gate (unchanged)
    if (role !== 'guest') return false; // gm/admin (or no role) may import
    return snapshotCustomHotspotCount(snapshot) > 0;
}
