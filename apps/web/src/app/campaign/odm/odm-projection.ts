/*
 * ODM-18 P1 (ruling 2) — the COMPANY-STATE PROJECTION type: the GM device publishes the pack-fed surfaces
 * a joined account-less player can never fetch (the /pack/odm/* 401 wall). MINIMAL AND ENUMERATED — these
 * four blocks are the whole projection, and it must never quietly grow (the ruling's words). Derived-cache:
 * the GM device rebuilds it on hydrate and after every intent apply; players read it from the fanned
 * snapshot like any other field. Display strings only — no pack internals, no GM-only truth.
 */
export interface OdmProjection {
    /** MAC pool hours — committed vs available per pool (the bays' burn math, shop.json-fed GM-side). */
    poolHours: { pool: string; label: string; committedPerDay: number; perDay: number }[];
    /** Fleet status lines — name / class / status / fuel% / K-F state (fleet.json + odmFleetStatus overlay). */
    fleet: { name: string; klass: string; status: string; fuelPct: number | null; kf: string | null }[];
    /** Support-register counts (support.json + odmSupport overlay) — id/label/operational count. */
    support: { id: string; label: string; count: number }[];
    /** Contact DISPLAY rows (the ODM-12 registry is player-safe by design) — name/rank/status only. */
    contacts: { name: string; rank: string | null; status: string | null }[];
    /** Epoch ms of the GM-side rebuild (staleness cue on the console). */
    at: number;
}
