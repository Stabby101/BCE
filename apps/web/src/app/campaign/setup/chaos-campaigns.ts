export interface ChaosCampaign {
    id: string;
    name: string;
    book: string | null; // source rulebook TITLE only (no book text); null = engine-generated, no book needed
    era: string | null; // era display name → resolves via era/eras.ts eraCardByName; null when not era-locked
    eraLocked: boolean; // true → seeds `era` + skips the Era step; false → player still picks the era
    available: boolean; // only `true` entries are selectable in the Setup card
    blurb: string; // OUR OWN one-line summary of the setting
}

export const CHAOS_CAMPAIGNS: ChaosCampaign[] = [
    {
        id: 'generic',
        name: 'Generic Hot Spots',
        book: null,
        era: null,
        eraLocked: false,
        available: true,
        blurb: 'Run the Chaos Campaign rules over BCE-generated contracts in any era — pick your own era next, and the engine supplies the tracks and opposition.',
    },
    {
        id: 'draconis-reach',
        name: 'Draconis Reach',
        book: 'Hot Spots: Draconis Reach',
        era: 'ilClan',
        eraLocked: true,
        available: true,
        blurb: 'A contested run of Draconis Combine border worlds where hired commands grind through raids, reprisals, and shifting front lines for whichever paymaster holds the ground this month.',
    },
    {
        id: 'hinterlands',
        name: 'Hinterlands',
        book: 'Hot Spots: Hinterlands',
        era: 'ilClan',
        eraLocked: true,
        available: false,
        blurb: 'Far-flung frontier systems beyond the reach of the great powers, where a command survives on whatever work the local strongmen can pay for.',
    },
];
