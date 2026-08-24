/*
 * BCE retool — New Campaign starting RESOURCE LEVEL config. DIRECTIVE-007.
 * Static BCE setup config (NOT the formation backfill): three resource tiers and the
 * DropShip provided at each unit size. Capital (cash) and resources (hardware) are
 * separate, complementary dials. Tier ids: 'lean' | 'normal' | 'established'.
 */

export type ResourceTierId = 'lean' | 'normal' | 'established';

/** DropShip provided at each unit-size id (Normal / Established tiers). */
export const SHIP_BY_SIZE: Record<string, string> = {
    single: 'Leopard (light)',
    lance: 'Leopard',
    company: 'Union',
    battalion: 'Overlord',
    regiment: 'Overlord ×3',
};

/** A bullet line on a resource card; `none` marks a "not included / caveat" line (— prefix). */
export interface ResourceLine {
    text: string;
    none?: boolean;
}

export interface ResourceTier {
    id: ResourceTierId;
    name: string;  // 'Lean' | 'Normal' | 'Established'
    grade: string; // 'Low' | 'Medium' | 'High'
    /** Card detail lines, given the chosen size's DropShip name. */
    assets: (ship: string) => ResourceLine[];
}

export const RESOURCE_TIERS: readonly ResourceTier[] = [
    {
        id: 'lean', name: 'Lean', grade: 'Low',
        assets: () => [
            { text: 'Capital only — no transport, no base', none: true },
            { text: 'You buy, lease, or contract everything' },
        ],
    },
    {
        id: 'normal', name: 'Normal', grade: 'Medium',
        assets: (ship) => [
            { text: `DropShip sized to your force — ${ship}` },
            { text: 'Organic combat drops + in-system movement' },
            { text: '(still hire jump passage between stars)', none: true },
        ],
    },
    {
        id: 'established', name: 'Established', grade: 'High',
        assets: (ship) => [
            { text: `Everything in Normal — DropShip (${ship})` },
            { text: 'Invader-class JumpShip — your own interstellar lift' },
            { text: 'Planetary base with repair / refit facilities' },
        ],
    },
];

/** DropShip for a unit-size id, or an em dash if unknown. */
export function shipForSize(sizeId: string | null | undefined): string {
    return (sizeId && SHIP_BY_SIZE[sizeId]) || '—';
}

/** Tier display label (name + grade) for a tier id, or null if unknown. */
export function resourceLabel(tierId: string | null | undefined): { name: string; grade: string } | null {
    const t = RESOURCE_TIERS.find((x) => x.id === tierId);
    return t ? { name: t.name, grade: t.grade } : null;
}

/** Compact assets line for the summary read-back (tier + chosen size). */
export function resourceAssetsSummary(tierId: string | null | undefined, sizeId: string | null | undefined): string {
    const ship = shipForSize(sizeId);
    switch (tierId) {
        case 'lean': return 'Capital only — no transport or base';
        case 'normal': return `DropShip: ${ship}`;
        case 'established': return `DropShip: ${ship} · Invader JumpShip · base w/ repair`;
        default: return '—';
    }
}
