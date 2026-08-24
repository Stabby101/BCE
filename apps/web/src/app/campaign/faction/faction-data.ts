/*
 * BCE retool — New Campaign step-3 support data.
 * DIRECTIVE-005 (scaffold) · DIRECTIVE-021 (placeholder formations RETIRED).
 *
 * The D-005 placeholder FORMATION rosters are gone — the real starting-command pick now flows
 * from the cited canon OOB (`formation-oob.ts`, era+faction filtered) + MAKE YOUR OWN. What
 * remains here is durable wiring still in use:
 *   - ARCH_NAMES / CUSTOM_UNIT — archetype labels + the make-your-own sentinel (faction.ts, dashboard.ts).
 *   - FACTION_DATA — the OFFLINE faction-LIST fallback (names + sub only) shown when the unit
 *     catalog (db.mekbay.com) is unreachable so the wizard still proceeds. NOT canon, NOT rosters.
 */
export const CUSTOM_UNIT = '__custom__';

export interface FactionGroup {
    name: string;
    sub?: string;
}

export const ARCH_NAMES: Record<string, string> = {
    MERC: 'Mercenary',
    HOUSE: 'House Regular',
    'H-AFF': 'House-Affiliated',
    PIR: 'Pirate',
    PERIPH: 'Periphery',
    SOL: 'Solaris VII',
    COM: 'ComStar',
    CLAN: 'Clan',
    WOB: 'Word of Blake',
    ROTS: 'Republic of the Sphere',
};

// Offline faction-LIST fallback (names + sub). Used only when the catalog is unreachable.
const GREAT_HOUSES: FactionGroup[] = [
    { name: 'House Davion', sub: 'Federated Suns' },
    { name: 'House Steiner', sub: 'Lyran Commonwealth' },
    { name: 'House Marik', sub: 'Free Worlds League' },
    { name: 'House Liao', sub: 'Capellan Confederation' },
    { name: 'House Kurita', sub: 'Draconis Combine' },
];

export const FACTION_DATA: Record<string, FactionGroup[]> = {
    HOUSE: GREAT_HOUSES,
    'H-AFF': GREAT_HOUSES,
    CLAN: [
        { name: 'Clan Wolf' },
        { name: 'Clan Jade Falcon' },
        { name: 'Clan Ghost Bear' },
        { name: 'Clan Smoke Jaguar' },
        { name: 'Clan Nova Cat' },
        { name: 'Clan Steel Viper' },
        { name: "Clan Hell's Horses" },
    ],
    PERIPH: [
        { name: 'Taurian Concordat' },
        { name: 'Magistracy of Canopus' },
        { name: 'Outworlds Alliance' },
        { name: 'Marian Hegemony' },
        { name: 'Circinus Federation' },
    ],
    COM: [{ name: 'ComStar' }],
    WOB: [{ name: 'Word of Blake' }],
    ROTS: [{ name: 'Republic of the Sphere' }],
    MERC: [
        { name: "Wolf's Dragoons" },
        { name: 'Eridani Light Horse' },
        { name: 'Gray Death Legion' },
    ],
    PIR: [{ name: 'Tortuga Fusiliers' }, { name: 'Belt Pirates' }],
    SOL: [{ name: 'House Singh Stable' }, { name: 'Blackstar Stable' }],
};
