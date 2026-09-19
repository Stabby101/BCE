export type Settlement = 'capital' | 'industrial' | 'agrarian' | 'port' | 'frontier';
export type RegionRole = 'interior' | 'border' | 'contested';

export interface StarSystem {
    id: string;
    name: string;
    x: number;
    y: number;
    /** era id (our non-sequential ids) -> OUR faction tag. Phase 1 = a single 3025 baseline under era id 5. */
    ownerByEra: Record<string, string>;
    socio?: { tech?: string; industry?: string; raw?: string; output?: string; agri?: string; population?: number };
    localeAttrs: { settlement: Settlement; regionRole: RegionRole; terrain?: string[] };
    factories?: string[];
}

export interface SystemsPack {
    _meta: { provenance: string; era3025Id: number; count: number; generated: string };
    systems: StarSystem[];
}

/** The era id whose range contains 3025 (Late Succession War – Renaissance) — the Phase-1 ownership baseline. */
export const ERA_3025_BASELINE = 5;
