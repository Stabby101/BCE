/*
 * BCE — Star Map Phase 1 (DIRECTIVE-079). Pure, synchronous faction -> capital systemId lookup, used to
 * DEFAULT a new campaign's currentLocation at creation (size-capital begin()). The capital map is tiny and
 * EAGERLY bundled (no lazy chunk needed at creation); the large systems.json stays lazy. Any faction tag
 * absent from the map falls back to the central, always-present system (Terra).
 */
import capData from './faction-capitals.json';

const CAP = capData as { _meta: { fallback: string }; capitals: Record<string, string> };

/** The systemId of the chosen faction's capital, or the Terra fallback. Never returns empty for a real pack. */
export function capitalSystemIdFor(faction: string | null | undefined): string {
    if (faction && CAP.capitals[faction]) return CAP.capitals[faction];
    return CAP._meta.fallback;
}
