
/** CamOps contract-terms employer row (drives the terms modifiers). */
export type EmployerTier =
    | 'super'
    | 'major'
    | 'minor'
    | 'independent'
    | 'corporation'
    | 'mercenary';

/** CamOps employer variations — neutral this slice; cited per-employer values = T-022. */
export type EmployerTemperament = 'stingy' | 'generous' | 'controlling' | 'lenient';

export interface EmployerTraits {
    /** MekBay faction names/aliases (canonical first) — or the display name of a generic employer. */
    match: string[];
    /** BCE-generic CamOps employer (not a MekBay faction): always era-eligible, no logo. */
    generic?: boolean;
    tier: EmployerTier;
    /** CamOps independent-employers column splits Periphery MAJOR vs MINOR (selection only; terms use `tier`). */
    periphery?: 'major' | 'minor';
    temperament: EmployerTemperament | null;
    /** Citation refs consulted (Sarna for classification; CamOps for the row semantics). */
    sources: string[];
}

export const EMPLOYER_TRAITS: EmployerTraits[] = [
    // --- Superpowers (CamOps "superpower" employer row) ---
    { match: ['Star League', 'Star League Defense Force', 'SLDF'], tier: 'super', temperament: null,
      sources: ['https://www.sarna.net/wiki/Star_League', 'CamOps 4th printing p.42 (employer rows)'] },
    { match: ['Federated Commonwealth', 'FedCom'], tier: 'super', temperament: null,
      sources: ['https://www.sarna.net/wiki/Federated_Commonwealth', 'CamOps 4th printing p.42 (employer rows)'] },

    // --- Great Houses & major Inner Sphere powers ---
    { match: ['Federated Suns', 'House Davion'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Federated_Suns'] },
    { match: ['Lyran Commonwealth', 'Lyran Alliance', 'House Steiner'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Lyran_Commonwealth'] },
    { match: ['Draconis Combine', 'House Kurita'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Draconis_Combine'] },
    { match: ['Free Worlds League', 'House Marik'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Free_Worlds_League'] },
    { match: ['Capellan Confederation', 'House Liao'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Capellan_Confederation'] },
    { match: ['ComStar'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/ComStar'] },
    { match: ['Word of Blake', 'WoB'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Word_of_Blake'] },
    { match: ['Republic of the Sphere', 'The Republic'], tier: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Republic_of_the_Sphere'] },

    // --- Minor Inner Sphere powers ---
    { match: ['Free Rasalhague Republic', 'FRR'], tier: 'minor', temperament: null,
      sources: ['https://www.sarna.net/wiki/Free_Rasalhague_Republic'] },
    { match: ['St. Ives Compact'], tier: 'minor', temperament: null,
      sources: ['https://www.sarna.net/wiki/St._Ives_Compact'] },

    // --- Periphery states (terms row = minor power; selection column splits major/minor Periphery) ---
    { match: ['Taurian Concordat'], tier: 'minor', periphery: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Taurian_Concordat'] },
    { match: ['Magistracy of Canopus'], tier: 'minor', periphery: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Magistracy_of_Canopus'] },
    { match: ['Outworlds Alliance'], tier: 'minor', periphery: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Outworlds_Alliance'] },
    { match: ['Rim Worlds Republic'], tier: 'minor', periphery: 'major', temperament: null,
      sources: ['https://www.sarna.net/wiki/Rim_Worlds_Republic'] },
    { match: ['Marian Hegemony'], tier: 'minor', periphery: 'minor', temperament: null,
      sources: ['https://www.sarna.net/wiki/Marian_Hegemony'] },
    { match: ['Circinus Federation'], tier: 'minor', periphery: 'minor', temperament: null,
      sources: ['https://www.sarna.net/wiki/Circinus_Federation'] },

    { match: ['Star League (Second)', 'Second Star League'], tier: 'super', temperament: null,
      sources: ['https://www.sarna.net/wiki/Second_Star_League', 'CamOps 4th printing p.42 (employer rows: alliance of all Great Houses, 3058-3067)'] },
    { match: ["Wolf's Dragoons", 'Dragoons'], tier: 'mercenary', temperament: null,
      sources: ["https://www.sarna.net/wiki/Wolf's_Dragoons", 'CamOps 4th printing p.42 (mercenary subcontract row)'] },
    { match: ['Kell Hounds'], tier: 'mercenary', temperament: null,
      sources: ['https://www.sarna.net/wiki/Kell_Hounds', 'CamOps 4th printing p.42 (mercenary subcontract row)'] },
    { match: ['Mercenary', 'Mercenaries'], tier: 'mercenary', temperament: null,
      sources: ['https://www.sarna.net/wiki/Mercenary', 'CamOps 4th printing p.42 (mercenary subcontract row)'] },
    { match: ['Solaris 7', 'Solaris VII', 'Solaris'], tier: 'corporation', temperament: null,
      sources: ['https://www.sarna.net/wiki/Solaris_VII', 'CamOps 4th printing p.42 (corporation row: stable/media sponsors)'] },
    { match: ['Pirates', 'Bandits'], tier: 'independent', temperament: null,
      sources: ['https://www.sarna.net/wiki/Pirate', 'CamOps 4th printing p.42 (independent employers: non-state)'] },

    // --- BCE-generic CamOps employers (always era-eligible; no MekBay faction behind them) ---
    { match: ['Local Nobility'], generic: true, tier: 'independent', temperament: null,
      sources: ['CamOps 4th printing p.42 (independent employers column: nobles)'] },
    { match: ['Planetary Government'], generic: true, tier: 'independent', temperament: null,
      sources: ['CamOps 4th printing p.42 (independent employers column: planetary governments)'] },
    { match: ['Corporate Sponsor'], generic: true, tier: 'corporation', temperament: null,
      sources: ['CamOps 4th printing p.42 (independent employers column: corporations)'] },
    { match: ['Mercenary Command (subcontract)'], generic: true, tier: 'mercenary', temperament: null,
      sources: ['CamOps 4th printing p.42 (independent employers column: mercenary subcontracts)'] },
];

/**
 * Fallback when no record matches: classify by MekBay `faction.group`.
 * (Clan groups never reach this — Clans are excluded from the merc employer pool in code.)
 */
export const DEFAULT_TIER_BY_GROUP: Record<string, EmployerTier> = {
    'Inner Sphere': 'major',
    'Periphery': 'minor',
    'Mercenary': 'mercenary',
    'Other': 'minor',
};
