import type { Faction } from '../../models/factions.model';
import type { Era } from '../../models/eras.model';
import { FACTION_FLAVOR, META_FACTION_DENY, PIRATE_FACTIONS, type FactionFlavor } from './faction-flavor';
import { FORMATION_OOB, type FormationRecord } from './formation-oob';

// BCE-EDIT (REBASE-1 P1 c): the affinity grouping is a BCE faction-select concept. Upstream's
// `factions.model` dropped its `FactionAffinity` type export at the pin (`getFactionAffinity` now
// returns a plain `string`), so the union BCE's section grouping relies on is defined here, at the
// one site that uses it (see ARCH_GROUPS / GROUP_ORDER / GROUP_LABEL below).
export type FactionAffinity = 'Inner Sphere' | 'IS Clan' | 'HW Clan' | 'Periphery' | 'Mercenary' | 'Other';

export interface FactionView {
    faction: Faction;
    flavor: FactionFlavor | null;
}
export interface FactionSection {
    group: FactionAffinity;
    label: string;
    visible: FactionView[]; // shown up front
    overflow: FactionView[]; // collapsible same-affinity tail (empty for short sections)
}
export interface FactionPick {
    sections: FactionSection[]; // affinity-bucketed, majors-first
    count: number; // total era + archetype matches (after meta filter)
    relaxed: boolean; // archetype scope was empty this era -> showing all
    note: string | null; // e.g. PIR generic-Pirates fallback
}

/** Sections this size or smaller show every card; longer ones collapse the tail. */
const SHOW_ALL_MAX = 7;
/** A long section shows this many up front, the rest go to the collapsible tail. */
const VISIBLE_CAP = 6;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Era-name normalize: dashes/punct -> spaces (handles "–" vs "-"). */
const normEra = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Archetype CODE (step-2) -> MekBay faction `group`s it scopes to.
 *  PIR is NOT here — it's an allow-list (PIRATE_FACTIONS), see buildPiratePick. */
export const ARCH_GROUPS: Record<string, FactionAffinity[]> = {
    HOUSE: ['Inner Sphere'],
    'H-AFF': ['Inner Sphere'],
    COM: ['Inner Sphere'], // ComStar is tagged Inner Sphere in MekBay data
    WOB: ['Inner Sphere'], // Word of Blake likewise
    ROTS: ['Inner Sphere'], // Republic of the Sphere likewise
    CLAN: ['IS Clan', 'HW Clan'],
    PERIPH: ['Periphery'],
    MERC: ['Mercenary'],
    SOL: ['Other'], // Solaris 7 sits in the Other group
};

/** Affinity bucket order + display label for the prominent area. */
export const GROUP_ORDER: FactionAffinity[] = ['Inner Sphere', 'IS Clan', 'HW Clan', 'Periphery', 'Mercenary', 'Other'];
export const GROUP_LABEL: Record<FactionAffinity, string> = {
    'Inner Sphere': 'Inner Sphere',
    'IS Clan': 'Clans · Invader',
    'HW Clan': 'Clans · Homeworld',
    Periphery: 'Periphery',
    Mercenary: 'Mercenary',
    Other: 'Other',
};

const META_DENY_NORM = new Set(META_FACTION_DENY.map(norm));
const PIRATE_NORM = new Set(PIRATE_FACTIONS.map(norm));

/** Non-playable MUL data bucket? Deny-list OR "* General" suffix — but never Solaris. */
function isMetaFaction(name: string): boolean {
    const t = name.trim();
    if (/solaris/i.test(t)) return false; // Solaris is a real faction (SOL archetype)
    if (META_DENY_NORM.has(norm(t))) return true;
    return / general$/i.test(t); // "IS Clan General", "Inner Sphere General", ...
}

/** A bandit/pirate faction (PIR allow-list)? */
function isPirateFaction(name: string): boolean {
    return PIRATE_NORM.has(norm(name));
}

/** Headline factions, in play priority. Matched exact-normalized vs faction.name. */
const MAJORS: string[] = [
    // Great Houses & IS states
    'Federated Suns', 'Lyran Commonwealth', 'Free Worlds League', 'Capellan Confederation', 'Draconis Combine',
    'Federated Commonwealth', 'Free Rasalhague Republic',
    // ComStar / Blake / Republic
    'ComStar', 'Word of Blake', 'Republic of the Sphere',
    // Major IS (occupation-zone) Clans
    'Clan Wolf', 'Clan Jade Falcon', 'Clan Ghost Bear', 'Clan Smoke Jaguar', 'Clan Nova Cat', 'Clan Steel Viper',
    "Clan Hell's Horses", 'Clan Diamond Shark', 'Clan Snow Raven', 'Clan Wolf-in-Exile',
    // Major Homeworld Clans
    'Clan Star Adder', 'Clan Cloud Cobra', 'Clan Coyote', 'Clan Goliath Scorpion', 'Clan Blood Spirit',
    'Clan Fire Mandrill', 'Clan Ice Hellion',
    // Major Periphery
    'Taurian Concordat', 'Magistracy of Canopus', 'Outworlds Alliance', 'Marian Hegemony', 'Rim Worlds Republic',
    // Major Mercenary commands
    "Wolf's Dragoons", 'Eridani Light Horse', 'Kell Hounds', 'Gray Death Legion', 'Northwind Highlanders',
];
const MAJOR_RANK = new Map<string, number>(MAJORS.map((m, i) => [norm(m), i]));
const majorRank = (name: string): number => MAJOR_RANK.get(norm(name)) ?? -1;

/** Resolve the wizard era to a MekBay era id: start-year, then name, then range. */
export function resolveMekbayEraId(w: { name: string; from: number; to: number } | null | undefined, eras: Era[]): number | null {
    if (!w || !eras.length) return null;
    let e = eras.find((x) => x.years?.from === w.from);
    if (e) return e.id;
    const n = normEra(w.name);
    e = eras.find((x) => normEra(x.name) === n);
    if (e) return e.id;
    e = eras.find((x) => x.years?.from != null && x.years?.to != null && w.from >= (x.years.from as number) && w.from <= (x.years.to as number));
    return e ? e.id : null;
}

/** faction.eras[eraId] non-empty? Handles Set | array | object shapes. */
function activeInEra(f: Faction, eraId: number): boolean {
    const s = (f.eras as Record<number, unknown>)?.[eraId];
    if (!s) return false;
    if (s instanceof Set) return s.size > 0;
    if (Array.isArray(s)) return s.length > 0;
    if (typeof s === 'object') return Object.keys(s as object).length > 0;
    return false;
}

/** Match a MekBay faction name to a flavor record (exact-normalized vs match[]). */
export function matchFlavor(name: string): FactionFlavor | null {
    const n = norm(name);
    for (const rec of FACTION_FLAVOR) {
        if (rec.match.some((m) => norm(m) === n)) return rec;
    }
    return null;
}

/** Order a group's factions majors-first (by priority), then the rest alphabetically. */
function orderCards(views: Array<{ faction: Faction; flavor: FactionFlavor | null; rank: number }>): FactionView[] {
    const majors = views.filter((v) => v.rank >= 0).sort((a, b) => a.rank - b.rank);
    const rest = views.filter((v) => v.rank < 0).sort((a, b) => a.faction.name.localeCompare(b.faction.name));
    return [...majors, ...rest].map(({ faction, flavor }) => ({ faction, flavor }));
}

/** Build a section, showing all when short and collapsing the tail when long. */
function makeSection(group: FactionAffinity, label: string, cards: FactionView[]): FactionSection {
    if (cards.length <= SHOW_ALL_MAX) return { group, label, visible: cards, overflow: [] };
    return { group, label, visible: cards.slice(0, VISIBLE_CAP), overflow: cards.slice(VISIBLE_CAP) };
}

/** PIR archetype: PIRATE_FACTIONS ∩ era-active only; generic "Pirates" + note fallback. */
function buildPiratePick(pool: Faction[]): FactionPick {
    const pirates = pool.filter((f) => isPirateFaction(f.name));
    let note: string | null = null;
    let cards: FactionView[];
    if (pirates.length === 0) {
        const generic = pool.find((f) => norm(f.name) === norm('Pirates'));
        cards = generic ? [{ faction: generic, flavor: matchFlavor(generic.name) }] : [];
        note = 'No specific pirate bands on record for this era — generic raiders only.';
    } else {
        cards = orderCards(pirates.map((f) => ({ faction: f, flavor: matchFlavor(f.name), rank: majorRank(f.name) })));
    }
    const sections = cards.length ? [makeSection('Periphery', 'Pirates · Bandits', cards)] : [];
    return { sections, count: cards.length, relaxed: false, note };
}

/** Build the grouped, era-gated, archetype-scoped, meta-filtered pick. */
export function buildFactionPick(factions: Faction[], archCode: string, eraId: number | null): FactionPick {
    const empty: FactionPick = { sections: [], count: 0, relaxed: false, note: null };
    if (!factions.length) return empty; // no catalog at all → caller shows the placeholder fallback

    // in a load race, or the resident slice/catalog tags no faction active in this era), RELAX the era gate to
    // the full meta-filtered set so the column is NEVER empty and the wizard never dead-ends. (The stale-slice
    // root cause is fixed in DataService; this is the durable safety net the directive mandates — empty-success
    // is treated like a fallback, flagged.)
    const metaFiltered = factions.filter((f) => !isMetaFaction(f.name));
    let pool = eraId != null ? metaFiltered.filter((f) => activeInEra(f, eraId)) : [];
    let eraRelaxed = false;
    if (pool.length === 0) {
        pool = metaFiltered;
        eraRelaxed = pool.length > 0;
    }
    if (pool.length === 0) return empty; // everything was a meta bucket → caller shows the placeholder fallback
    const eraNote = eraRelaxed ? 'Broad list — limited faction data for this era.' : null;

    if (archCode === 'PIR') {
        const pp = buildPiratePick(pool);
        return { ...pp, note: pp.note ?? eraNote }; // `relaxed` (archetype) stays as PIR computed; eraNote flags the era-relax
    }

    const groups = ARCH_GROUPS[archCode];
    let scoped = groups ? pool.filter((f) => groups.includes(f.group)) : pool;
    let relaxed = false; // ARCHETYPE relax only (no factions of the chosen group) — distinct from the era-relax note
    if (scoped.length === 0 && pool.length > 0) {
        scoped = pool; // never dead-end: fall back to all (era-relaxed) factions
        relaxed = true;
    }

    const sections: FactionSection[] = [];
    for (const g of GROUP_ORDER) {
        const views = scoped
            .filter((f) => f.group === g)
            .map((f) => ({ faction: f, flavor: matchFlavor(f.name), rank: majorRank(f.name) }));
        if (views.length) sections.push(makeSection(g, GROUP_LABEL[g], orderCards(views)));
    }
    return { sections, count: scoped.length, relaxed, note: eraNote };
}

export function eraActivePool(factions: Faction[], eraId: number | null): Faction[] {
    if (eraId == null || !factions.length) return [];
    return factions.filter((f) => activeInEra(f, eraId) && !isMetaFaction(f.name));
}

export interface FormationPick extends FormationRecord {
    broaderEra?: boolean;
}

export function formationsFor(factionName: string, startYear: number, limit = 5): FormationPick[] {
    const t = norm(factionName);
    const sameFaction = FORMATION_OOB.filter((f) => f.faction.some((m) => norm(m) === t));
    const inEra = sameFaction.filter(
        (f) => (f.foundedYear == null || f.foundedYear <= startYear) && (f.disbandedYear == null || f.disbandedYear >= startYear),
    );
    if (inEra.length >= limit) return inEra.slice(0, limit);
    // short this era → fill from the faction's other-era commands (flagged broaderEra), up to the limit
    const fill = sameFaction.filter((f) => !inEra.includes(f)).map((f) => ({ ...f, broaderEra: true }));
    return [...inEra, ...fill].slice(0, limit);
}

/** Faction names in this era+archetype with NO flavor record (resolve-probe). */
export function flavorMisses(factions: Faction[], archCode: string, eraId: number | null): string[] {
    const pick = buildFactionPick(factions, archCode, eraId);
    return pick.sections
        .flatMap((s) => [...s.visible, ...s.overflow])
        .filter((v) => !v.flavor)
        .map((v) => v.faction.name);
}
