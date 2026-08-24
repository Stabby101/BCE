/*
 * BCE — sprite resolution data: normalizer + PM-PATCHABLE alias map (HOTFIX-003).
 * The catalog's unit.icon paths are lowercased ("meks/cicada_3f.png") while the MekBay sprite
 * manifest preserves case ("meks/Cicada_3F.png") — the HOTFIX-003 probe found 96% of the 664
 * misses are pure case/punctuation. This is the DATA side of the ONE lookup path (see
 * sprite-resolver.service.ts): a case/punct-insensitive normalizer + a small alias map for true
 * odd cases the normalize + family passes can't reach. NEVER edit the manifest — add an alias here.
 */
export type WeightClass = 'Light' | 'Medium' | 'Heavy' | 'Assault';

/**
 * Case/punctuation-insensitive key: lowercase, strip every non-alphanumeric (path separator,
 * underscore, parentheses, the .png). "meks/Cicada_3F.png" and "meks/cicada_3f.png" both collapse
 * to "mekscicada3fpng". Applied to both icon paths and chassis names.
 */
export function normSprite(s: string | undefined | null): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * PM-PATCHABLE alias map — key = normSprite(unit.icon) OR normSprite(unit.chassis), value = an
 * EXACT manifest key. For the rare case the normalize + family passes can't reach (e.g. a catalog
 * parenthetical "Mad Cat (Timber Wolf)" whose atlas art lives under a wholly different name).
 * Empty at HOTFIX-003 — the probe proved normalization (637) + family alias (26) + one silhouette
 * cover all 664 misses with no hand aliases needed. Add rows as the catalog grows; a value that
 * is not in the manifest is ignored (the resolver falls through to family / silhouette).
 */
export const SPRITE_ALIASES: Readonly<Record<string, string>> = {
    // 'madcattimberwolf': 'meks/Mad cat.png',   // ← example shape; none required at HOTFIX-003
};

/** Weight class from tonnage — the silhouette fallback when weightClass is missing/unrecognized. */
export function wcFromTons(tons: number | undefined): WeightClass {
    const t = tons || 0;
    return t >= 80 ? 'Assault' : t >= 60 ? 'Heavy' : t >= 40 ? 'Medium' : 'Light';
}

/** Coerce a catalog weightClass string to the canonical set; fall back to tonnage when absent/odd. */
export function normWeightClass(wc: string | undefined, tons?: number): WeightClass {
    switch ((wc || '').trim().toLowerCase()) {
        case 'light': return 'Light';
        case 'medium': return 'Medium';
        case 'heavy': return 'Heavy';
        case 'assault': return 'Assault';
        default: return wcFromTons(tons);
    }
}
