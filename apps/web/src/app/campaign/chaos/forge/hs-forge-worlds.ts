/*
 * BCE — HSFORGE-1: world selection + systemProfile assembly. Pure (no Angular): the orchestrator
 * supplies the loaded systems array, the ownerAt resolver, the facts pack, and the RNG.
 *
 * REGION (ruling D4): membership = anchor+radius over the committed star map — the SAME rule the
 * HSFORGE-1a build used to guarantee the belt ships, so runtime candidates == the built belt.
 * WORLD (C16): joined by systemId, never by name (the tigress collision). PROFILE (C17): REAL facts
 * only — a field with no data is OMITTED (renderers skip nulls); `description` is corpus texture and
 * is assembled by the dressing layer, never from witness prose.
 */
import type { StarSystem } from '../../star/star-types';
import { eraTag } from '../../mission/forge-select';
import type { ForgeRegion, WorldFacts } from './hs-forge-data';
import { eraValue } from './hs-forge-data';
import type { HotSpotSystemProfile } from '../hotspots-catalog';

/** The one resolved era context — the id-space discipline in a single struct (the documented
 *  wrong-id incident class: wizard id → ownership/adjacency; MekBay id → unit/faction pools;
 *  chamber tag → HotSpot.era). Resolved ONCE by the orchestrator. */
export interface EraCtx {
    wizardEraId: number;   // 1..12 — systems.json ownerByEra / factionAdjacency
    mekbayEraId: number | null; // e.g. ilClan = 257 — Faction.eras unit pools / MUL gate
    year: number;
    chamberTag: string;    // one of eraTag()'s 8 buckets or 'ilclan' — HotSpot.era exact-match vocab
}

/** The chamber-era tag for a campaign year. Mirrors the offer board's DECISION (chaos-contracts-tab
 *  campaignEra computed): eraTag() terminally buckets 'dark-age' and never returns 'ilclan', so
 *  year ≥ 3151 resolves explicitly. // DECISION: duplicated deliberately as a pure helper (the tab's
 *  private computed stays byte-untouched in Phase 1); unify at the next tab-touching pass. */
export function campaignEraTag(year: number): string {
    return year >= 3151 ? 'ilclan' : eraTag(year);
}

export interface WorldPick {
    system: StarSystem;
    owner: string;      // ownerAt(system, wizardEraId) — the defender-side state faction
    district: string;
}

/** Candidate systems for a region (anchor+radius) or era-wide (region null). Filtered to worlds whose
 *  era owner passes `ownerOk` (a fieldable/mappable faction — the pair step needs a real defender). */
export function worldCandidates(
    systems: readonly StarSystem[],
    region: ForgeRegion | null,
    era: EraCtx,
    ownerAt: (sys: StarSystem, eraId: number) => string,
    ownerOk: (owner: string) => boolean,
): StarSystem[] {
    let pool = systems as StarSystem[];
    if (region) {
        const anchor = systems.find((s) => s.id === region.anchorSystemId);
        if (!anchor) return [];
        pool = systems.filter((s) => Math.hypot(s.x - anchor.x, s.y - anchor.y) <= region.radiusLy);
    }
    return pool.filter((s) => { const o = ownerAt(s, era.wizardEraId); return o !== 'Unknown' && ownerOk(o); });
}

/** Pick the hotspot's world: prefer border/contested (a conflict theater), then any candidate. */
export function pickWorld(
    candidates: readonly StarSystem[],
    era: EraCtx,
    ownerAt: (sys: StarSystem, eraId: number) => string,
    districtFor: (settlement: string | undefined, rng: () => number) => string,
    rng: () => number,
): WorldPick | null {
    if (!candidates.length) return null;
    const frontier = candidates.filter((s) => s.localeAttrs.regionRole === 'border' || s.localeAttrs.regionRole === 'contested');
    const pool = frontier.length ? frontier : candidates;
    const system = pool[Math.floor(rng() * pool.length)];
    return { system, owner: ownerAt(system, era.wizardEraId), district: districtFor(system.localeAttrs.settlement, rng) };
}

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];

/** Climate label derived from real temp/water (facts stay facts; the label is our plain formatting).
 *  HOTSPOT-BRIEF v1: sys values ≤25 ch (grid cells) — hence the short middle band. */
function climateLabel(tempC: number | undefined, waterPct: number | undefined): string | undefined {
    if (tempC == null) return undefined;
    const heat = tempC <= 0 ? 'Arctic' : tempC <= 15 ? 'Cold' : tempC <= 30 ? 'Temperate' : tempC <= 45 ? 'Warm' : 'Hot';
    if (waterPct == null) return heat;
    return `${heat}, ${waterPct <= 25 ? 'arid' : waterPct >= 70 ? 'wet' : 'mild'}`;
}

/** Assemble a HotSpotSystemProfile from the facts pack (real facts only; absent = omitted — C17).
 *  `description` is left for the dressing layer. Era-keyed facts resolve at the campaign era. */
export function profileFor(facts: WorldFacts | undefined, era: EraCtx, eraYears: Record<string, number>): HotSpotSystemProfile {
    if (!facts) return {};
    const pop = eraValue(facts.popByEra, era.wizardEraId);
    const socio = eraValue(facts.socioByEra, era.wizardEraId);
    const hpgRaw = eraValue(facts.hpgByEra, era.wizardEraId);
    const hpg = hpgRaw && hpgRaw !== 'X' ? hpgRaw : null; // mm-data 'X' = no/destroyed HPG → omit
    const station = eraValue(facts.stationByEra, era.wizardEraId);
    const popEraKey = facts.popByEra ? Object.keys(facts.popByEra).map(Number).filter((n) => n <= era.wizardEraId).sort((a, b) => b - a)[0] : null;
    return {
        ...(facts.starType ? { starType: facts.starType } : {}),
        ...(facts.rechargeHours != null ? { rechargeHours: facts.rechargeHours } : {}),
        ...(facts.position != null ? { positionInSystem: ORDINAL[facts.position - 1] ?? String(facts.position) } : {}),
        ...(facts.timeToJumpPointDays != null ? { timeToJumpPointDays: facts.timeToJumpPointDays } : {}),
        ...(satellitesLabel(facts) ? { satellites: satellitesLabel(facts) as string } : {}),
        ...(facts.gravity != null ? { surfaceGravity: facts.gravity } : {}),
        ...(facts.pressure ? { atmPressure: facts.pressure } : {}),
        ...(facts.tempC != null ? { equatorialTempC: facts.tempC } : {}),
        ...(climateLabel(facts.tempC, facts.waterPct) ? { climate: climateLabel(facts.tempC, facts.waterPct) } : {}),
        ...(facts.waterPct != null ? { surfaceWaterPct: facts.waterPct } : {}),
        ...(station && station !== 'None' ? { rechargeStation: station } : {}),
        ...(hpg ? { hpgClass: hpg } : {}),
        ...(facts.lifeForm ? { highestNativeLife: facts.lifeForm } : {}),
        ...(pop != null ? { population: pop } : {}),
        ...(pop != null && popEraKey != null ? { populationYear: eraYears[String(popEraKey)] ?? undefined } : {}),
        ...(socio ? { socioIndustrial: socio } : {}),
        ...(facts.landmasses?.length ? { landmasses: facts.landmasses } : {}),
        ...(facts.capitalCity ? { capitalCity: facts.capitalCity } : {}),
    };
}

/** HOTSPOT-BRIEF v1: sys values ≤25 ch — count + first name only ("5 (Bethel +4)"). */
function satellitesLabel(facts: WorldFacts): string | null {
    const named = facts.satellites ?? [];
    const moons = facts.smallMoons ?? 0;
    const total = named.length + moons;
    if (!total) return null;
    if (!named.length) return `${moons} minor moons`;
    const extra = total - 1;
    return `${total} (${named[0]}${extra ? ` +${extra}` : ''})`;
}

/** The BCE era representative years (systems.json _meta.eras) — populationYear resolution. */
export const ERA_YEARS: Record<string, number> = { 1: 2400, 2: 2750, 3: 2830, 4: 2960, 5: 3025, 6: 3055, 7: 3065, 8: 3072, 9: 3085, 10: 3120, 11: 3140, 12: 3152 };
