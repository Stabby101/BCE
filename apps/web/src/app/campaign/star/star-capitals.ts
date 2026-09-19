import capData from './faction-capitals.json';

const CAP = capData as { _meta: { fallback: string }; capitals: Record<string, string> };

/** The systemId of the chosen faction's capital, or the Terra fallback. Never returns empty for a real pack. */
export function capitalSystemIdFor(faction: string | null | undefined): string {
    if (faction && CAP.capitals[faction]) return CAP.capitals[faction];
    return CAP._meta.fallback;
}
