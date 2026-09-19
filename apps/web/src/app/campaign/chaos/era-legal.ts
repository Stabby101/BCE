export interface EraLike { id: number; units?: number[] | Set<number> | null; }

/** The campaign era's unit-id membership, or null when the loaded catalog is already the era's slice (nothing to gate). */
export function eraLegalIdSet(eras: readonly EraLike[] | null | undefined, eraId: number | null | undefined): Set<number> | null {
    if (eraId == null || !eras) return null;
    const era = eras.find((e) => e.id === eraId);
    const m = era?.units;
    if (!m) return null;
    const set = m instanceof Set ? m : new Set(m);
    return set.size ? set : null;
}

/** Era-legal = in the era's membership when one is known; always when the loaded catalog is the slice. */
export function isEraLegal(set: Set<number> | null, unitId: number): boolean {
    return !set || set.has(unitId);
}

export function emptyWhy(stages: { eraLegal: number; searched: number; filtered: number }, q: string, hidden: string, eraName: string | null): string | null {
    if (stages.filtered > 0) return null;
    if (stages.eraLegal === 0) return `No era-legal units are loaded${eraName ? ` for ${eraName}` : ''}.`;
    if (stages.searched === 0) return `No era-legal unit matches “${q}”${eraName ? ` — a unit outside ${eraName} is not listed here` : ''}.`;
    return `${stages.searched} era-legal match${stages.searched === 1 ? '' : 'es'} — all hidden by ${hidden}.`;
}
