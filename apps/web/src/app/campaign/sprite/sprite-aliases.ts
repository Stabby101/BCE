export type WeightClass = 'Light' | 'Medium' | 'Heavy' | 'Assault';

/**
 * Case/punctuation-insensitive key: lowercase, strip every non-alphanumeric (path separator,
 * underscore, parentheses, the .png). "meks/Cicada_3F.png" and "meks/cicada_3f.png" both collapse
 * to "mekscicada3fpng". Applied to both icon paths and chassis names.
 */
export function normSprite(s: string | undefined | null): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export const SPRITE_ALIASES: Readonly<Record<string, string>> = {
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
