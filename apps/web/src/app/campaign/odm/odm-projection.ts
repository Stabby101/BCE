export interface OdmProjection {
    /** MAC pool hours — committed vs available per pool (the bays' burn math, shop.json-fed GM-side). */
    poolHours: { pool: string; label: string; committedPerDay: number; perDay: number }[];
    /** Fleet status lines — name / class / status / fuel% / K-F state (fleet.json + odmFleetStatus overlay). */
    fleet: { name: string; klass: string; status: string; fuelPct: number | null; kf: string | null }[];
    /** Support-register counts (support.json + odmSupport overlay) — id/label/operational count. */
    support: { id: string; label: string; count: number }[];
    contacts: { name: string; rank: string | null; status: string | null }[];
    /** Epoch ms of the GM-side rebuild (staleness cue on the console). */
    at: number;
}
