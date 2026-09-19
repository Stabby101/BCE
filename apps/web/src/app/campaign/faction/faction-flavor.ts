
export type FlavorAffinity =
    | 'Inner Sphere'
    | 'IS Clan'
    | 'HW Clan'
    | 'Periphery'
    | 'Mercenary'
    | 'Pirate'
    | 'ComStar'
    | 'Other';

export interface FactionFlavor {
    /** Names/aliases to match against MekBay's faction.name (canonical first). */
    match: string[];
    affinity: FlavorAffinity;
    /** [primary, secondary] accent hex — approximate heraldry, UI accent only. */
    colors: [string, string];
    /** One original sentence, <= ~18 words. Not copied from any source. */
    blurb: string;
    /** Citation URL(s) consulted (Sarna). */
    sources: string[];
}

export const FACTION_FLAVOR: FactionFlavor[] = [
    // --- Great Houses & Inner Sphere states ---
    { match: ['Federated Suns', 'House Davion', 'Suns'], affinity: 'Inner Sphere', colors: ['#d4af37', '#7a1d1d'],
      blurb: 'Sword-and-sunburst Davion realm prizing chivalry, democratic ideals, and an aggressive, well-drilled regular army.',
      sources: ['https://www.sarna.net/wiki/Federated_Suns'] },
    { match: ['Lyran Commonwealth', 'House Steiner', 'Lyran Alliance'], affinity: 'Inner Sphere', colors: ['#1f4e8c', '#0b1d33'],
      blurb: 'Wealthy mercantile Steiner state fielding heavy assault ’Mechs backed by deep industrial and banking power.',
      sources: ['https://www.sarna.net/wiki/Lyran_Commonwealth'] },
    { match: ['Free Worlds League', 'House Marik', 'FWL'], affinity: 'Inner Sphere', colors: ['#5b2a86', '#e0c200'],
      blurb: 'Fractious purple-and-gold Marik confederation of squabbling provinces, vast industry, and endless internal politics.',
      sources: ['https://www.sarna.net/wiki/Free_Worlds_League'] },
    { match: ['Capellan Confederation', 'House Liao', 'CapCon', 'Capellans'], affinity: 'Inner Sphere', colors: ['#2e7d32', '#0e3b14'],
      blurb: 'Authoritarian Liao state blending Chinese tradition, fanatic loyalty, and cunning special operations against larger rivals.',
      sources: ['https://www.sarna.net/wiki/Capellan_Confederation'] },
    { match: ['Draconis Combine', 'House Kurita', 'DCMS', 'Dragon'], affinity: 'Inner Sphere', colors: ['#b3001b', '#111111'],
      blurb: 'Samurai-coded Kurita empire fusing feudal honor, harsh discipline, and relentless martial expansionism under the Dragon.',
      sources: ['https://www.sarna.net/wiki/Draconis_Combine'] },
    { match: ['Federated Commonwealth', 'FedCom', 'Davion-Steiner'], affinity: 'Inner Sphere', colors: ['#d4af37', '#1f4e8c'],
      blurb: 'Davion-Steiner superstate uniting two Great Houses into a sprawling, briefly dominant, ultimately fractured alliance.',
      sources: ['https://www.sarna.net/wiki/Federated_Commonwealth'] },
    { match: ['Republic of the Sphere', 'The Republic', 'RotS', 'RAF'], affinity: 'Other', colors: ['#1565c0', '#c8a951'],
      blurb: 'Devlin Stone’s idealistic post-Jihad nation seeking peace, demilitarization, and unity across the former Star League core.',
      sources: ['https://www.sarna.net/wiki/Republic_of_the_Sphere'] },
    { match: ['Star League Defense Force', 'SLDF', 'Star League'], affinity: 'Other', colors: ['#caa84a', '#0b1d33'],
      blurb: 'Legendary unified army of the original Star League, fielding humanity’s finest technology before its exodus and fall.',
      sources: ['https://www.sarna.net/wiki/Star_League_Defense_Force'] },

    { match: ['Free Rasalhague Republic', 'FRR', 'Rasalhague'], affinity: 'Inner Sphere', colors: ['#1565c0', '#eceff1'],
      blurb: 'Norse-heritage republic carved from Steiner and Kurita border worlds, soon bearing the Clan invasion’s full weight.',
      sources: ['https://www.sarna.net/wiki/Free_Rasalhague_Republic'] },
    { match: ['St. Ives Compact', 'St Ives Compact', 'St. Ives'], affinity: 'Inner Sphere', colors: ['#00897b', '#fdd835'],
      blurb: 'Candace Liao’s Davion-aligned Capellan splinter, prosperous and free until forcibly reabsorbed by the Confederation.',
      sources: ['https://www.sarna.net/wiki/St._Ives_Compact'] },

    // --- FWL Dark-Age successor states ---
    { match: ['Duchy of Andurien', 'Andurien'], affinity: 'Inner Sphere', colors: ['#6a1b9a', '#00695c'],
      blurb: 'Perennially secessionist southern duchy under House Humphreys, forever maneuvering between Liao menace and League politics.',
      sources: ['https://www.sarna.net/wiki/Duchy_of_Andurien'] },
    { match: ['Duchy of Tamarind-Abbey', 'Tamarind-Abbey', 'Tamarind'], affinity: 'Inner Sphere', colors: ['#5e35b1', '#c0a16b'],
      blurb: 'Western League remnant holding the Lyran border, a steadfast bastion of Marik loyalty after the collapse.',
      sources: ['https://www.sarna.net/wiki/Duchy_of_Tamarind-Abbey'] },
    { match: ['Marik-Stewart Commonwealth', 'Marik-Stewart'], affinity: 'Inner Sphere', colors: ['#4a148c', '#9575cd'],
      blurb: 'Core Marik successor state bearing the dynasty’s name, ground down by relentless Lyran aggression.',
      sources: ['https://www.sarna.net/wiki/Marik-Stewart_Commonwealth'] },
    { match: ['Oriente Protectorate', 'Duchy of Oriente', 'Oriente'], affinity: 'Inner Sphere', colors: ['#7b1fa2', '#ffb300'],
      blurb: 'Industrial League heartland under House Halas, the seed from which the Free Worlds eventually reunified.',
      sources: ['https://www.sarna.net/wiki/Oriente_Protectorate'] },
    { match: ['Regulan Fiefs', 'Principality of Regulus', 'Regulus'], affinity: 'Inner Sphere', colors: ['#4527a0', '#b71c1c'],
      blurb: 'Hard-line Regulan realm under Cameron-Jones, fanatically anti-Blakist and contemptuous of League reunification.',
      sources: ['https://www.sarna.net/wiki/Regulan_Fiefs'] },
    { match: ['Rim Commonality'], affinity: 'Inner Sphere', colors: ['#6a1b9a', '#90a4ae'],
      blurb: 'Distant rimward trade worlds of the old League, keeping quiet independence through the Dark Age.',
      sources: ['https://www.sarna.net/wiki/Rim_Commonality'] },

    // --- ComStar / Word of Blake ---
    { match: ['ComStar', 'The Order'], affinity: 'ComStar', colors: ['#e8a33d', '#1a2a4a'],
      blurb: 'Secretive techno-mystic order controlling interstellar communication while hoarding Star League technology behind quasi-religious ritual.',
      sources: ['https://www.sarna.net/wiki/ComStar'] },
    { match: ['Word of Blake', 'WoB', 'Blakists', 'The Blessed Order'], affinity: 'ComStar', colors: ['#6a1b9a', '#cfb53b'],
      blurb: 'Zealous ComStar splinter waging an apocalyptic Jihad to forcibly reunify humanity under technological worship.',
      sources: ['https://www.sarna.net/wiki/Word_of_Blake'] },

    // --- Clans (Inner Sphere / occupation-zone) ---
    { match: ['Clan Wolf', 'The Wolves', 'Wolf Empire'], affinity: 'IS Clan', colors: ['#8a8d8f', '#1b1b1b'],
      blurb: 'Kerensky’s elite founding Clan, ambitious conquerors who carved a permanent empire deep into the Inner Sphere.',
      sources: ['https://www.sarna.net/wiki/Clan_Wolf'] },
    { match: ['Clan Wolf-in-Exile', 'Exiled Wolves', 'Wolves-in-Exile'], affinity: 'IS Clan', colors: ['#9aa0a6', '#7a1d1d'],
      blurb: 'Honor-bound Warden Wolves cast out after defeat, sheltering on Arc-Royal and warring against their Crusader kin.',
      sources: ['https://www.sarna.net/wiki/Clan_Wolf-in-Exile'] },
    { match: ['Clan Jade Falcon', 'The Falcons', 'Jade Falcons'], affinity: 'IS Clan', colors: ['#1e7d4f', '#0a2e1c'],
      blurb: 'Fiercely proud, aggressive Crusader Clan obsessed with purity, honor, and relentless conquest of the Inner Sphere.',
      sources: ['https://www.sarna.net/wiki/Clan_Jade_Falcon'] },
    { match: ['Clan Ghost Bear', 'The Bears', 'Ghost Bears', 'Rasalhague Dominion'], affinity: 'IS Clan', colors: ['#37474f', '#cfd8dc'],
      blurb: 'Patient, family-focused Clan that relocated wholesale to the Inner Sphere and founded a stable new dominion.',
      sources: ['https://www.sarna.net/wiki/Clan_Ghost_Bear'] },
    { match: ['Clan Smoke Jaguar', 'The Jaguars', 'Smoke Jaguars'], affinity: 'IS Clan', colors: ['#37352f', '#b8860b'],
      blurb: 'Brutal, arrogant Crusader Clan whose atrocities triggered the unified assault that annihilated them entirely.',
      sources: ['https://www.sarna.net/wiki/Clan_Smoke_Jaguar'] },
    { match: ['Clan Nova Cat', 'The Cats', 'Nova Cats'], affinity: 'IS Clan', colors: ['#4527a0', '#b39ddb'],
      blurb: 'Mystical, vision-guided Clan that abandoned its kin to ally with the Draconis Combine and Star League.',
      sources: ['https://www.sarna.net/wiki/Clan_Nova_Cat'] },
    { match: ['Clan Steel Viper', 'The Vipers', 'Steel Vipers'], affinity: 'IS Clan', colors: ['#00695c', '#b71c1c'],
      blurb: 'Rigidly traditionalist Clan zealous for purity, briefly invading then expelled from the Inner Sphere.',
      sources: ['https://www.sarna.net/wiki/Clan_Steel_Viper'] },
    { match: ["Clan Hell's Horses", 'The Horses', 'Hells Horses'], affinity: 'IS Clan', colors: ['#bf360c', '#212121'],
      blurb: 'Cavalry-minded Clan championing combined-arms warfare, prizing infantry and vehicles alongside their treasured BattleMechs.',
      sources: ["https://www.sarna.net/wiki/Clan_Hell's_Horses"] },

    // --- Clans (Homeworld) ---
    { match: ['Clan Diamond Shark', 'Clan Sea Fox', 'The Sharks', 'Merchant Clan'], affinity: 'HW Clan', colors: ['#0277bd', '#b0bec5'],
      blurb: 'Trade-driven merchant Clan turned nomadic, dominating commerce with vast ArcShips after fleeing the Homeworlds.',
      sources: ['https://www.sarna.net/wiki/Clan_Diamond_Shark', 'https://www.sarna.net/wiki/Clan_Sea_Fox'] },
    { match: ['Clan Snow Raven', 'The Ravens', 'Snow Ravens', 'Raven Alliance'], affinity: 'HW Clan', colors: ['#37474f', '#eceff1'],
      blurb: 'Aerospace and naval-focused Clan that merged with the Outworlds Alliance to form the Raven Alliance.',
      sources: ['https://www.sarna.net/wiki/Clan_Snow_Raven'] },
    { match: ['Clan Star Adder', 'The Adders', 'Star Adders'], affinity: 'HW Clan', colors: ['#283593', '#9e9e9e'],
      blurb: 'Disciplined, methodical Homeworld Clan that rose to dominate Clan space after the Wars of Reaving.',
      sources: ['https://www.sarna.net/wiki/Clan_Star_Adder'] },
    { match: ['Clan Cloud Cobra', 'The Cobras', 'Cloud Cobras'], affinity: 'HW Clan', colors: ['#00838f', '#cddc39'],
      blurb: 'Devoutly religious Homeworld Clan blending spiritual orders with strong aerospace forces and shrewd diplomacy.',
      sources: ['https://www.sarna.net/wiki/Clan_Cloud_Cobra'] },
    { match: ['Clan Coyote', 'The Coyotes'], affinity: 'HW Clan', colors: ['#8d6e63', '#3e2723'],
      blurb: 'Inventive founding Homeworld Clan, creators of the OmniMech, marked by pride and steady decline.',
      sources: ['https://www.sarna.net/wiki/Clan_Coyote'] },
    { match: ['Clan Fire Mandrill', 'The Mandrills', 'Fire Mandrills'], affinity: 'HW Clan', colors: ['#e65100', '#f9a825'],
      blurb: 'Fractured Homeworld Clan splintered into feuding Kindraa, perpetually undermined by their own bitter internal rivalries.',
      sources: ['https://www.sarna.net/wiki/Clan_Fire_Mandrill'] },
    { match: ['Clan Ice Hellion', 'The Hellions', 'Ice Hellions'], affinity: 'HW Clan', colors: ['#0097a7', '#e1f5fe'],
      blurb: 'Swift, brash Homeworld Clan favoring speed and audacity, whose overreach led to its destruction.',
      sources: ['https://www.sarna.net/wiki/Clan_Ice_Hellion'] },
    { match: ['Clan Goliath Scorpion', 'The Scorpions', 'Goliath Scorpions'], affinity: 'HW Clan', colors: ['#6d4c41', '#fbc02d'],
      blurb: 'Mystic seeker Clan questing for lost Star League relics, guided by ritual and spiritual conviction.',
      sources: ['https://www.sarna.net/wiki/Clan_Goliath_Scorpion'] },
    { match: ['Clan Blood Spirit', 'The Spirits', 'Blood Spirits'], affinity: 'HW Clan', colors: ['#b71c1c', '#4a0000'],
      blurb: 'Isolationist, self-reliant Homeworld Clan distrustful of all rivals, perennially poor yet stubbornly defiant.',
      sources: ['https://www.sarna.net/wiki/Clan_Blood_Spirit'] },

    { match: ['Clan Burrock', 'The Burrocks', 'Burrocks'], affinity: 'HW Clan', colors: ['#8d3b2f', '#212121'],
      blurb: 'Homeworld Clan entangled with dark-caste criminal networks, absorbed by Star Adder after its scandal broke.',
      sources: ['https://www.sarna.net/wiki/Clan_Burrock'] },

    // --- Periphery ---
    { match: ['Taurian Concordat', 'The Taurians', 'Concordat'], affinity: 'Periphery', colors: ['#0d47a1', '#b71c1c'],
      blurb: 'Proudly independent Periphery realm defined by fierce anti-Inner Sphere paranoia and rugged frontier self-determination.',
      sources: ['https://www.sarna.net/wiki/Taurian_Concordat'] },
    { match: ['Magistracy of Canopus', 'The Magistracy', 'Canopians'], affinity: 'Periphery', colors: ['#ad1457', '#f8bbd0'],
      blurb: 'Matriarchal Periphery state famed for pleasure industries, social liberty, and surprisingly capable mercenary-bolstered forces.',
      sources: ['https://www.sarna.net/wiki/Magistracy_of_Canopus'] },
    { match: ['Outworlds Alliance', 'The Alliance'], affinity: 'Periphery', colors: ['#2e7d32', '#fdd835'],
      blurb: 'Pacifist-leaning agrarian Periphery nation that later merged with Clan Snow Raven for protection.',
      sources: ['https://www.sarna.net/wiki/Outworlds_Alliance'] },
    { match: ['Marian Hegemony', 'The Hegemony', 'Marians'], affinity: 'Periphery', colors: ['#b71c1c', '#d4af37'],
      blurb: 'Roman-themed Periphery empire styled on legions and caesars, expanding through conquest and slave-taking raids.',
      sources: ['https://www.sarna.net/wiki/Marian_Hegemony'] },
    { match: ['Rim Worlds Republic', 'Amaris Empire'], affinity: 'Periphery', colors: ['#37474f', '#9e9e9e'],
      blurb: 'Amaris-ruled Periphery state whose betrayal of the Star League ignited its catastrophic civil war.',
      sources: ['https://www.sarna.net/wiki/Rim_Worlds_Republic'] },
    { match: ['Circinus Federation', 'Circinus'], affinity: 'Periphery', colors: ['#4e342e', '#bdbdbd'],
      blurb: 'Lawless bandit Periphery state built on piracy, organized crime, and brutal opportunistic raiding.',
      sources: ['https://www.sarna.net/wiki/Circinus_Federation'] },

    // --- Mercenary commands ---
    { match: ["Wolf's Dragoons", 'The Dragoons', 'Dragoons'], affinity: 'Mercenary', colors: ['#212121', '#b71c1c'],
      blurb: 'Legendary elite mercenaries secretly born of the Clans, fielding their finest technology and fierce honor.',
      sources: ["https://www.sarna.net/wiki/Wolf's_Dragoons"] },
    { match: ['Eridani Light Horse', 'The Light Horse', 'ELH'], affinity: 'Mercenary', colors: ['#5d4037', '#ffb300'],
      blurb: 'Storied mercenary command descended from the SLDF, masters of combined-arms cavalry and mobile warfare.',
      sources: ['https://www.sarna.net/wiki/Eridani_Light_Horse'] },
    { match: ['Kell Hounds', 'The Hounds'], affinity: 'Mercenary', colors: ['#1b5e20', '#212121'],
      blurb: 'Highly respected elite mercenary regiment loyal to House Steiner, renowned for skill and unshakable integrity.',
      sources: ['https://www.sarna.net/wiki/Kell_Hounds'] },
    { match: ['Gray Death Legion', 'Grey Death Legion', 'The Legion', 'GDL'], affinity: 'Mercenary', colors: ['#455a64', '#cfd8dc'],
      blurb: 'Famous mercenary unit founded by Grayson Carlyle, central to recovering lost Star League technology.',
      sources: ['https://www.sarna.net/wiki/Gray_Death_Legion'] },
    { match: ['Northwind Highlanders', 'The Highlanders', 'Highlanders'], affinity: 'Mercenary', colors: ['#1b5e20', '#c62828'],
      blurb: 'Scottish-heritage mercenary brigade bound by clan tradition, fierce pride, and deep ties to Northwind.',
      sources: ['https://www.sarna.net/wiki/Northwind_Highlanders'] },
    { match: ["Cranston Snord's Irregulars", "Snord's Irregulars", 'The Irregulars'], affinity: 'Mercenary', colors: ['#6a1b9a', '#fdd835'],
      blurb: 'Eccentric mercenary company led by Cranston Snord, notorious for obsessive collecting of relics and artwork.',
      sources: ["https://www.sarna.net/wiki/Snord's_Irregulars"] },
    { match: ["Rhonda's Irregulars"], affinity: 'Mercenary', colors: ['#7b1fa2', '#ffd54f'],
      blurb: 'Snord’s eccentric mercenary unit under daughter Rhonda, continuing its relic-hunting legacy into later decades.',
      sources: ["https://www.sarna.net/wiki/Snord's_Irregulars"] },

    // --- Pirate / bandit factions (PIR archetype) ---
    { match: ['Pirates', 'Bandits', 'Bandit'], affinity: 'Pirate', colors: ['#3e2723', '#9e9e9e'],
      blurb: 'Roving raider bands haunting the Periphery and borders, bound by loot, survival, and shifting loyalties.',
      sources: ['https://www.sarna.net/wiki/Pirate'] },
    { match: ['Tortuga Dominions', 'Tortuga', 'Tortuga Fusiliers'], affinity: 'Pirate', colors: ['#4e342e', '#bf360c'],
      blurb: 'Lawless deep-Periphery pirate haven of slavers, raiders, and feuding warlords beyond the Outworlds frontier.',
      sources: ['https://www.sarna.net/wiki/Tortuga_Dominions'] },
    { match: ['Oberon Confederation', 'Oberon'], affinity: 'Pirate', colors: ['#37474f', '#c62828'],
      blurb: 'Brutal bandit kingdom rimward of the Combine, raider chiefs preying on Lyran and Kurita border worlds.',
      sources: ['https://www.sarna.net/wiki/Oberon_Confederation'] },
    { match: ['Greater Valkyrate', 'Valkyrate', "Morgraine's Valkyrate"], affinity: 'Pirate', colors: ['#311b92', '#9575cd'],
      blurb: 'Periphery bandit confederation forged by raider leaders, notorious for piracy along the northern Inner Sphere rim.',
      sources: ['https://www.sarna.net/wiki/Greater_Valkyrate'] },
];

/**
 * Non-playable MUL data buckets to HIDE from the campaign picker (every archetype).
 * Also drop any faction whose name ends in "General" (Periphery General, Clan General,
 * IS Clan General, HW Clan General, Inner Sphere General, Mercenary General, …) — handle
 * that as a suffix pattern in code, not an exhaustive list.
 * NOTE: "Solaris" is NOT meta — it's a real faction reachable via the Solaris (SOL) archetype.
 */
export const META_FACTION_DENY: string[] = ['Extinct', 'Unique', 'None', 'Non-Aligned', 'Unknown', 'Undetermined'];

export const PIRATE_FACTIONS: string[] = [
    'Pirates', 'Bandits',
    'Circinus Federation',
    'Tortuga Dominions', 'Tortuga Fusiliers',
    'Oberon Confederation',
    'Greater Valkyrate', "Morgraine's Valkyrate",
    'Elysian Fields',
    'Lothian League',
    'Belt Pirates',
];
