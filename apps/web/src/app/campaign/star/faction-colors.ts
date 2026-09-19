export const FACTION_COLORS: Readonly<Record<string, string>> = {
    'Federated Suns': '#d99b28',
    'Draconis Combine': '#c0392b',
    'Lyran Commonwealth': '#2f79c0',
    'Free Worlds League': '#8e44ad',
    'Capellan Confederation': '#3aa35a',
    'Federated Commonwealth': '#c58f3a',
    'ComStar': '#dcd6c2',
    'Word of Blake': '#e6e6e6',
    'Republic of the Sphere': '#6d8f9e',
    'Free Rasalhague Republic': '#45b0c9',
    'Rasalhague Dominion': '#79b3c4',
    'St. Ives Compact': '#66c2a5',
    'Marik-Stewart Commonwealth': '#9b59b6',
    'Duchy of Andurien': '#7cae7c',
    'Oriente Protectorate': '#a569bd',
    'Regulan Fiefs': '#b07fc0',
    'Duchy of Tamarind-Abbey': '#b39ddb',
    'Magistracy of Canopus': '#9acd6b',
    'Taurian Concordat': '#4f9e5a',
    'Outworlds Alliance': '#c89a5a',
    'Marian Hegemony': '#cf6a3c',
    'Circinus Federation': '#8a8a8a',
    'Rim Worlds Republic': '#8f8560',
    'periphery-independent': '#8f8874',
    'Clan Wolf': '#c0492a',
    'Clan Jade Falcon': '#7cae35',
    'Clan Ghost Bear': '#5f7d8c',
    'Clan Snow Raven': '#2f8f80',
    "Clan Hell's Horses": '#9c5a2e',
    'Clan Coyote': '#c39212',
    'Clan Smoke Jaguar': '#6b4f2a',
    'Clan Nova Cat': '#7b6ca8',
    'Clan Steel Viper': '#4a8f5a',
    'Clan Fire Mandrill': '#d47a2a',
    'Clan Star Adder': '#8a9a3a',
    'Clan Blood Spirit': '#a83a4a',
    'Clan Burrock': '#7a5a3a',
    'Clan Cloud Cobra': '#5a8fa8',
    'Clan Ice Hellion': '#8fb8d0',
    'Clan Sea Fox': '#2f9a8f',
    'Clan Goliath Scorpion': '#b0902a',
};

const GREY = '#808080';

/** Territory/legend color for a faction tag. Known tag → its palette color; null/'Unknown' → grey (no owner);
 *  any other (surprise) tag → a stable hashed HSL so it still paints and stays consistent across renders. */
export function factionColor(tag: string | null | undefined): string {
    if (!tag || tag === 'Unknown') return GREY;
    const c = FACTION_COLORS[tag];
    if (c) return c;
    let h = 0;
    for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 42%, 52%)`;
}
