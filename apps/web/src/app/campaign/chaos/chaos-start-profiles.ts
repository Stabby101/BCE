export interface StartProfile {
    id: string;
    label: string;
    blurb: string;
    forceBV: number; // BV budget the starting force is built to
    unitCap: number; // max units in the starting force
    warchestSP: number; // opening Support Points
    reputation: number; // opening Reputation
    scale: number; // opening Contract Scale
    pilots: number; // number of Named Pilots seeded with the force
}

export const CHAOS_START_PROFILES: StartProfile[] = [
    {
        id: 'merc',
        label: 'Mercenary Command',
        blurb: 'A fresh independent command taking its first Hot Spot contracts — a lean lance built on a tight budget, a modest Warchest, and a pair of Named Pilots.',
        forceBV: 3000, unitCap: 2, warchestSP: 3000, reputation: 1, scale: 1, pilots: 2,
    },
    {
        id: 'veteran',
        label: 'Veteran Command',
        blurb: 'An established outfit with a reputation and a company of iron — a bigger force budget, a fuller Warchest, a higher Scale, and four Named Pilots.',
        forceBV: 12000, unitCap: 9, warchestSP: 6000, reputation: 5, scale: 3, pilots: 4,
    },
    {
        id: 'custom',
        label: 'Custom',
        blurb: 'Set your own opening budget — force BV, Warchest SP, Scale, unit cap, and Named Pilot count — for a GM-tailored or other-book start.',
        forceBV: 3000, unitCap: 2, warchestSP: 3000, reputation: 1, scale: 1, pilots: 2,
    },
];

export const CUSTOM_PROFILE_ID = 'custom';
