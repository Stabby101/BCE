/*
 * DIRECTIVE-ODM-15 — the barracks trades, pure module. A tanker is not a MechWarrior: the ODM register
 * is people-first, and the trade is derived from the MACHINE (catalog `type`), never guessed. The A2
 * mapping is closed over the vocabulary recon enumerated (Mek · Tank; Aero mapped but absent from all
 * ODM content today, and the force-spec validator bounds capture vocabulary to {Mek, Tank}); anything
 * outside it returns null — an honest gap that files under "Unassigned", NEVER a MechWarriors fallback.
 * Grouping and words only: no skill renames, no per-trade mechanics, no crew-size modeling.
 */
import type { ProtoInstance } from '../force/force-generator';

export type OdmTrade = 'mechwarrior' | 'vehicle-crew' | 'aero';

export const TRADE_LABEL: Record<OdmTrade, string> = {
    mechwarrior: 'MechWarriors',
    'vehicle-crew': 'Vehicle crews',
    aero: 'Aerospace pilots',
};

/** ODM-25 — the SINGULAR noun, for sentences about ONE person ("will be stamped a MechWarrior on posting").
 *  TRADE_LABEL is a bucket heading and reads wrong in a sentence; this is the same vocabulary, said of a
 *  person. No new concept — a second grammatical form of the ODM-15 A2 mapping. */
export const TRADE_NOUN: Record<OdmTrade, string> = {
    mechwarrior: 'MechWarrior',
    'vehicle-crew': 'vehicle crew',
    aero: 'aerospace pilot',
};

/** Render order (Part B): MechWarriors · Vehicle crews · Aerospace pilots · (Unassigned trails). */
export const TRADE_ORDER: readonly OdmTrade[] = ['mechwarrior', 'vehicle-crew', 'aero'];

/** ODM-25b — the TRADE EDITOR's choices, including the honest absence. `''` is not a fourth trade: it is
 *  ODM-15 A4's bench, and it is offered because a GM who does not know what someone was before the old A5
 *  re-stamp converted them should be able to SAY SO rather than guess. An honest absence beats a guessed
 *  value, and an untraded pilot is stamped by their next posting rather than by a coin flip today. */
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
