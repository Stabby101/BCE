
export function snapshotCustomHotspotCount(snapshot: unknown): number {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    const at = (o: unknown): number => {
        if (!o || typeof o !== 'object') return 0;
        const list = (o as { customHotSpots?: unknown }).customHotSpots;
        return Array.isArray(list) ? list.length : 0;
    };
    return at(snapshot) + at((snapshot as { gmOnly?: unknown }).gmOnly);
}

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
