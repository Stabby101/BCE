import type { ProtoInstance } from '../force/force-generator';

export type OdmTrade = 'mechwarrior' | 'vehicle-crew' | 'aero';

export const TRADE_LABEL: Record<OdmTrade, string> = {
    mechwarrior: 'MechWarriors',
    'vehicle-crew': 'Vehicle crews',
    aero: 'Aerospace pilots',
};

export const TRADE_NOUN: Record<OdmTrade, string> = {
    mechwarrior: 'MechWarrior',
    'vehicle-crew': 'vehicle crew',
    aero: 'aerospace pilot',
};

/** Render order (Part B): MechWarriors · Vehicle crews · Aerospace pilots · (Unassigned trails). */
export const TRADE_ORDER: readonly OdmTrade[] = ['mechwarrior', 'vehicle-crew', 'aero'];

export const TRADE_CHOICES: readonly { id: string; label: string }[] = [
    { id: '', label: 'untraded — awaiting posting' },
    ...TRADE_ORDER.map((t) => ({ id: t as string, label: TRADE_NOUN[t] })),
];

export const UNASSIGNED_LABEL = 'Unassigned — awaiting posting';

/** The A2 mapping, from the CATALOG type. Unknown → null (a STOP-shaped gap — the caller renders it
 *  honestly unassigned and the harness/recon surfaces it; nothing is ever bucketed by guess). */
export function tradeForCatalogType(type: string | null | undefined): OdmTrade | null {
    switch (type) {
        case 'Mek': return 'mechwarrior';
        case 'Tank': return 'vehicle-crew'; // Combat Vehicle · Hovercraft · Support Vehicle — all ground crews
        case 'Aero': return 'aero';
        default: return null; // VTOL / Naval / Infantry / ProtoMek do not occur in ODM content (recon A1)
    }
}

/** Derive a trade from an INSTANCE: the catalog type when the caller resolved it; else the instance's
 *  own minted `unitType` record ('vehicle' | 'mech' — its own declaration, not a guess-bucket). Null
 *  when neither signal exists. */
export function tradeForInstance(inst: Pick<ProtoInstance, 'unitType'> | undefined, catalogType?: string | null): OdmTrade | null {
    const fromCatalog = tradeForCatalogType(catalogType);
    if (fromCatalog) return fromCatalog;
    if (!inst) return null;
    if (inst.unitType === 'vehicle') return 'vehicle-crew';
    if (inst.unitType === 'mech') return 'mechwarrior';
    return null;
}
