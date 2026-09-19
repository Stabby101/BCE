import { TERRAIN_TABLE } from '../mission/mission-spec';

/** biome → the words that name it (word-boundary, case-insensitive). Order = tie-break priority within ONE text. */
export const BIOME_KEYWORDS: readonly { biome: string; re: RegExp }[] = [
    { biome: 'Jungle', re: /\b(jungle|rain ?forest|the green|canopy|monsoon)\b/i },
    { biome: 'Tundra', re: /\b(tundra|snow(?:field|drift|s)?|ice|frozen|glacier|permafrost|blizzard|arctic)\b/i },
    { biome: 'Desert', re: /\b(desert|dunes?|sand(?:s|storm)?)\b/i },
    { biome: 'Marshland', re: /\b(marsh(?:land)?|swamp|bog|wetlands?|fen|bayou|mire)\b/i },
    { biome: 'Mountain', re: /\b(mountains?|ridge(?:-?line)?|peaks?|highlands?|alpine|passes?)\b/i },
    { biome: 'Coastal', re: /\b(coast(?:al|line)?|beach(?:es)?|shore(?:line)?|tidal|harbou?r|estuary|delta|seaside)\b/i },
    { biome: 'Dense urban', re: /\b(urban|city|downtown|streets?|arcology|metropolis|city blocks?)\b/i },
    { biome: 'Industrial sprawl', re: /\b(refiner(?:y|ies)|industrial|factory|factories|foundry|smelter|rail ?yards?|shipyards?)\b/i },
    { biome: 'Temperate plains', re: /\b(plains?|prairie|steppe|grassland|meadows?|farmland|open fields?)\b/i },
    { biome: 'Arid badlands', re: /\b(badlands|mesas?|canyons?|arroyos?|scrubland|wastes?)\b/i },
];

/** The biomes a text names, in keyword-table order (empty = the text is terrain-agnostic). */
export function biomesMentioned(text: string | null | undefined): string[] {
    const t = (text ?? '').toString();
    if (!t.trim()) return [];
    return BIOME_KEYWORDS.filter((k) => k.re.test(t)).map((k) => k.biome);
}

/** True when the texts name ≥1 biome and the rolled biome is not among them (the lint's definition). */
export function terrainContradicts(texts: readonly (string | null | undefined)[], biome: string): boolean {
    const mentioned = new Set(texts.flatMap(biomesMentioned));
    return mentioned.size > 0 && !mentioned.has(biome);
}

/** The coherent terrain for a track: `texts` in PRIORITY order (title first). Returns the rolled terrain unchanged when it
 *  is coherent (or nothing is mentioned), else the TERRAIN_TABLE entry of the first-mentioned biome. */
export function coherentTerrain(texts: readonly (string | null | undefined)[], rolled: { biome: string; note: string }): { biome: string; note: string } {
    const mentioned: string[] = [];
    for (const t of texts) for (const b of biomesMentioned(t)) if (!mentioned.includes(b)) mentioned.push(b);
    if (!mentioned.length || mentioned.includes(rolled.biome)) return rolled;
    const pick = TERRAIN_TABLE.find((e) => e.biome === mentioned[0]);
    return pick ? { biome: pick.biome, note: pick.note } : rolled;
}
