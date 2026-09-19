import type { CampaignEra } from '../new-campaign-state';

export type SigilKey = 'star' | 'tower' | 'fist' | 'sword' | 'cloud' | 'wreath';

export interface EraCard {
    id: number;
    name: string;
    from: number;
    to: number; // 9999 = present
    sigil: SigilKey;
    desc: string;
}

export const ERAS: EraCard[] = [
    { id: 1, name: 'Age of War', from: 2005, to: 2570, sigil: 'star', desc: "Humanity's first steps off Terra spark interstellar empires — and the BattleMech changes warfare forever." },
    { id: 2, name: 'Star League', from: 2571, to: 2780, sigil: 'star', desc: 'The League flourishes under the First Lords; technology and prosperity peak as a darkness grows within.' },
    { id: 3, name: 'Early Succession War', from: 2781, to: 2900, sigil: 'tower', desc: 'Minoru Kurita declares himself First Lord, sparking the Succession Wars and massive loss of life and tech.' },
    { id: 4, name: 'Late Succession War – LosTech', from: 2901, to: 3019, sigil: 'tower', desc: "Two centuries of constant warfare reduce Star League technology to 'lostech'." },
    { id: 5, name: 'Late Succession War – Renaissance', from: 3020, to: 3049, sigil: 'tower', desc: 'The Helm memory core kickstarts rediscovery of lost tech as the Fourth Succession War erupts.' },
    { id: 6, name: 'Clan Invasion', from: 3050, to: 3061, sigil: 'fist', desc: "A mysterious invader — Kerensky's returning Clans — conquers world after world with superior technology." },
    { id: 7, name: 'Civil War', from: 3062, to: 3067, sigil: 'sword', desc: 'With the Clan threat blunted, internal conflicts explode across the Inner Sphere.' },
    { id: 8, name: 'Jihad', from: 3068, to: 3080, sigil: 'cloud', desc: 'The Word of Blake launches an interstellar holy war, unleashing weapons of mass destruction once more.' },
    { id: 9, name: 'Early Republic', from: 3081, to: 3100, sigil: 'wreath', desc: "Stone's Republic leads a fragile peace in the aftermath of the Jihad." },
    { id: 10, name: 'Late Republic', from: 3101, to: 3130, sigil: 'wreath', desc: 'The tides of war rise again as old houses move to reclaim worlds seized by the Republic.' },
    { id: 11, name: 'Dark Age', from: 3131, to: 3150, sigil: 'wreath', desc: 'The HPG network goes dark; the Great Houses seize back what the Republic once took.' },
    { id: 12, name: 'ilClan', from: 3151, to: 9999, sigil: 'star', desc: 'Clan Wolf has conquered Terra. What will follow?' },
];

/** Project an EraCard onto the wizard's CampaignEra state shape. */
export function toCampaignEra(e: EraCard): CampaignEra {
    return { id: e.id, name: e.name, from: e.from, to: e.to };
}

/** Resolve an era by its display name (the key stored on an era-locked Hot Spot campaign). */
export function eraCardByName(name: string): EraCard | undefined {
    return ERAS.find((e) => e.name === name);
}
