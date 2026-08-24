/*
 * BCE campaign-pack — CANON MERCENARY COMMANDS (model-your-outfit templates).
 *
 * First slice of the faction order-of-battle (T-024), merc-flow-first. The MERC archetype
 * lets a player MODEL their command on one of these, seeing its signature 'Mechs + notable
 * pilots (the "signature 'Mechs + notable pilots" depth James chose), or build their own.
 *
 * PROVENANCE / COPYRIGHT (T-022 posture): blurbs/notes are ORIGINAL short summaries — NOT
 * copied from Sarna/sourcebooks. Gunnery/Piloting are game-mechanic facts; left null where a
 * canon rating couldn't be verified (do not guess). Each record cites its Sarna page.
 * Signature-'Mech ↔ pilot pairings reflect canon association; CC may resolve-probe chassis
 * names against MUL like the D-010 reconcile.
 */

export interface MercSigMech {
    chassis: string;
    variant: string | null;
    pilot: string | null;
    note: string | null;
}

export interface MercPilot {
    name: string;
    gunnery: number | null;
    piloting: number | null;
    role: string | null;
    note: string | null;
}

export interface MercCommand {
    name: string;
    aliases: string[];
    /** One original sentence, <= ~22 words. Not copied from any source. */
    blurb: string;
    foundedYear: number | null;
    activeNote: string;
    signatureMechs: MercSigMech[];
    notablePilots: MercPilot[];
    /** [primary, secondary] accent hex (shared with faction-flavor.ts merc records). */
    colors: [string, string];
    sources: string[];
}

export const MERC_COMMANDS: MercCommand[] = [
    {
        name: "Wolf's Dragoons",
        aliases: ["The Dragoons"],
        blurb: "Secretly Clan-born, this peerless mercenary brigade became the Inner Sphere's gold standard for skill, honor, and professionalism.",
        foundedYear: 3004,
        activeNote: "Appeared in the Inner Sphere in the 3000s; a major power through the Jihad and beyond.",
        colors: ["#212121", "#b71c1c"],
        signatureMechs: [
            { chassis: "Archer", variant: "ARC-2W", pilot: "Jaime Wolf", note: "Personal ride of the Dragoons' legendary founding commander." },
            { chassis: "Warhammer", variant: null, pilot: "Natasha Kerensky", note: "The Black Widow's early mount before heavier assault machines." },
            { chassis: "Annihilator", variant: null, pilot: null, note: "Rare Star League assault 'Mech fielded by elite Zeta Battalion." },
        ],
        notablePilots: [
            { name: "Jaime Wolf", gunnery: null, piloting: null, role: "Commanding Officer", note: "Founder whose name became shorthand for the unit itself." },
            { name: "Natasha Kerensky", gunnery: null, piloting: null, role: "Black Widow Company commander", note: "Feared ace nicknamed the Black Widow." },
            { name: "Joshua Wolf", gunnery: null, piloting: null, role: "Senior officer", note: "One of the Dragoons' senior Wolf-line commanders." },
        ],
        sources: ["https://www.sarna.net/wiki/Wolf%27s_Dragoons"],
    },
    {
        name: "Eridani Light Horse",
        aliases: ["The Light Horse", "ELH"],
        blurb: "One of the oldest mercenary outfits alive — former SLDF cavalry keeping faith with a fallen Star League across the centuries.",
        foundedYear: 2702,
        activeNote: "Rooted in the Star League's Third RCT; still soldiering through the Jihad and Dark Age.",
        colors: ["#5d4037", "#ffb300"],
        signatureMechs: [
            { chassis: "Cyclops", variant: null, pilot: "Ariana Winston", note: "Command 'Mech suited to the unit's combined-arms generalship." },
            { chassis: "Hatchetman", variant: null, pilot: "Joe Weems", note: "Close-combat machine used by Light Horse warriors." },
            { chassis: "Locust", variant: null, pilot: null, note: "Light scout typical of the unit's fast cavalry doctrine." },
        ],
        notablePilots: [
            { name: "Ariana Winston", gunnery: null, piloting: null, role: "Commanding General", note: "Led the Light Horse on the Task Force Serpent expedition." },
            { name: "Joe Weems", gunnery: null, piloting: null, role: "Officer", note: "Noted Hatchetman pilot within the command." },
        ],
        sources: ["https://www.sarna.net/wiki/Eridani_Light_Horse"],
    },
    {
        name: "Kell Hounds",
        aliases: ["The Hounds"],
        blurb: "A small but elite regiment loyal to House Steiner, famous for the Kell brothers and the mysterious Phantom 'Mech legend.",
        foundedYear: 3010,
        activeNote: "Raised in the 3010s; fighting on through the Clan Invasion and the Jihad.",
        colors: ["#1b5e20", "#212121"],
        signatureMechs: [
            { chassis: "Thunderbolt", variant: null, pilot: "Morgan Kell", note: "Heavy workhorse associated with the founding commander." },
            { chassis: "Archer", variant: null, pilot: null, note: "Missile platform common in the Hounds' lance cores." },
            { chassis: "Wolfhound", variant: null, pilot: "Daniel Allard", note: "Light striker fitting the unit's namesake imagery." },
        ],
        notablePilots: [
            { name: "Morgan Kell", gunnery: null, piloting: null, role: "Founder / Commanding Officer", note: "Linked to the Inner Sphere's Phantom 'Mech legend." },
            { name: "Patrick Kell", gunnery: null, piloting: null, role: "Co-founder", note: "Morgan's brother and co-founder, killed early in the unit's history." },
            { name: "Daniel Allard", gunnery: null, piloting: null, role: "Senior officer", note: "Long-serving Hound commander killed fighting the Clans." },
        ],
        sources: ["https://www.sarna.net/wiki/Kell_Hounds"],
    },
    {
        name: "Gray Death Legion",
        aliases: ["The Legion", "GDL"],
        blurb: "A reputation-built mercenary regiment that rose to fame after recovering a priceless lost Star League library memory core.",
        foundedYear: 3024,
        activeNote: "Founded in the mid-3020s; active through the Clan Invasion era.",
        colors: ["#455a64", "#cfd8dc"],
        signatureMechs: [
            { chassis: "Marauder", variant: "MAD-3R", pilot: "Grayson Death Carlyle", note: "The founder's signature command 'Mech." },
            { chassis: "Archer", variant: "ARC-2R", pilot: "Isoru Koga", note: "Missile boat fielded by a senior Legion officer." },
            { chassis: "Shadow Hawk", variant: null, pilot: "Lori Kalmar", note: "Versatile medium tied to the unit's early core members." },
        ],
        notablePilots: [
            { name: "Grayson Death Carlyle", gunnery: null, piloting: null, role: "Founder / Commanding Officer", note: "Built the Legion from a single 'Mech into a famous regiment." },
            { name: "Lori Kalmar", gunnery: null, piloting: null, role: "Senior officer", note: "Early core member and Grayson's close ally." },
            { name: "Isoru Koga", gunnery: null, piloting: null, role: "Officer", note: "Veteran Legion warrior and Archer pilot." },
        ],
        sources: ["https://www.sarna.net/wiki/Gray_Death_Legion"],
    },
    {
        name: "Northwind Highlanders",
        aliases: ["The Highlanders"],
        blurb: "An ancient, proud mercenary brotherhood of Scottish heritage whose loyalty and standards famously could not be bought.",
        foundedYear: 2362,
        activeNote: "One of the longest-lived commands in the setting, from pre-Star League days into the ilClan era.",
        colors: ["#1b5e20", "#c62828"],
        signatureMechs: [
            { chassis: "Highlander", variant: null, pilot: null, note: "Assault 'Mech sharing the command's name and identity." },
            { chassis: "Cicada", variant: null, pilot: null, note: "Fast medium associated with Highlander operations." },
            { chassis: "Marauder", variant: null, pilot: null, note: "Heavy 'Mech common among the unit's regiments." },
        ],
        notablePilots: [
            { name: "William MacLeod", gunnery: null, piloting: null, role: "Senior commander", note: "Led MacLeod's Regiment within the Highlanders." },
            { name: "Catherine Stirling", gunnery: null, piloting: null, role: "Officer", note: "Notable Highlander officer of the Clan-era unit." },
        ],
        sources: ["https://www.sarna.net/wiki/Northwind_Highlanders"],
    },
    {
        name: "Snord's Irregulars",
        aliases: ["Cranston Snord's Irregulars", "Rhonda's Irregulars"],
        blurb: "An eccentric, hard-fighting mercenary outfit obsessed with hunting lost Star League relics under their flamboyant founder.",
        foundedYear: 3007,
        activeNote: "Won in a poker game in 3007; led by the Snord family for decades afterward.",
        colors: ["#6a1b9a", "#fdd835"],
        signatureMechs: [
            { chassis: "Archer", variant: null, pilot: "Cranston Snord", note: "The founder's trademark 'Mech from his earliest days." },
            { chassis: "Marauder", variant: null, pilot: "David Rowsch", note: "Heavy hitter among the Irregulars' command lance." },
            { chassis: "Thunderbolt", variant: null, pilot: "Deb H'Chu", note: "Durable brawler fielded by a senior Irregular." },
        ],
        notablePilots: [
            { name: "Cranston Snord", gunnery: null, piloting: null, role: "Founder / Commanding Officer", note: "Relic-collecting eccentric who founded the unit." },
            { name: "Rhonda Snord", gunnery: null, piloting: null, role: "Successor commander", note: "Cranston's daughter who later led the Irregulars." },
        ],
        sources: ["https://www.sarna.net/wiki/Snord%27s_Irregulars"],
    },
];
