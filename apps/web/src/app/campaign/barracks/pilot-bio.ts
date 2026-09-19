
interface BioPools {
    origins: string[]; // "came up ..." — where they're from, in the register's idiom
    paths: string[];   // how they reached a cockpit
}

const POOLS: Record<string, BioPools> = {
    'is-kurita': {
        origins: ['Born to a vassal family that has served the same district lord for five generations', 'Raised in a foundry town where the work rotation was posted in Combine script first', 'The child of a garrison NCO who kept the family name off every list worth avoiding', 'Brought up in a coastal prefecture that tithed rice and conscripts in equal measure'],
        paths: ['earned the cockpit through the Sun Zhang cadre system and never speaks of the cost', 'inherited a lance seat when an uncle\'s name was struck from the rolls', 'tested out of infantry selection into a salvage-rebuilt BattleMech', 'served two tours as a tech\'s apprentice before a battlefield commission'],
    },
    'is-davion': {
        origins: ['Raised on a March border world where the militia muster was a family reunion', 'The third generation of a family that has held the same quarter-section since the Star League', 'Grew up dockside at a DropPort, learning every hull class by sound', 'Born to schoolteachers who still send clippings from the planetary assembly minutes'],
        paths: ['took the NAIS entrance exams twice and the second score is framed at home', 'mustered through the planetary militia into a line regiment', 'won the seat in an open trial against forty other candidates', 'apprenticed under a lance sergeant who signed the recommendation in block capitals'],
    },
    'is-steiner': {
        origins: ['Born into a merchant family that priced everything, including sentiment', 'Raised in an arcology where the commute crossed three tax jurisdictions', 'The child of shipping clerks who kept the household ledger balanced to the kroner', 'Grew up in a garrison town that threw better parades than battles'],
        paths: ['bought out of a commercial pilot contract to take a military berth', 'came up through an academy whose graduation gift was a debt schedule', 'transferred from the family firm\'s security wing with a spotless audit', 'earned the commission the social way and kept it the hard way'],
    },
    'is-liao': {
        origins: ['Born in a prefecture where the neighborhood committee filed weekly and everyone knew it', 'Raised by parents who taught caution as a first language', 'The child of a state opera costumer and a customs inspector — both excellent listeners', 'Grew up on a terraced farm world that fed three garrisons and asked nothing back'],
        paths: ['was selected young and never told exactly why', 'volunteered the day the recruiter implied the alternative', 'earned the cockpit through cadre scores the family still cannot discuss', 'served as a garrison runner until a vacancy opened suddenly'],
    },
    'is-marik': {
        origins: ['Born on a provincial world that votes against the Captain-General on principle', 'Raised between two customs zones and fluent in the paperwork of both', 'The child of a parliamentary clerk who read committee minutes as bedtime stories', 'Grew up in a free port where every flag was for rent'],
        paths: ['joined the provincial guard to spite a relative and stayed for the machine', 'came up through a militia that answered to three authorities and obeyed none quickly', 'earned the seat in a unification-day lottery few believe was random', 'transferred twice when home provinces changed allegiance'],
    },
    clan: {
        origins: ['Decanted into a sibko that started forty strong', 'Raised in the warrior creche of a frontline Cluster', 'Born trueborn to a Bloodname house with long memories', 'A freeborn who outscored the sibko at every trial that mattered'],
        paths: ['claimed the cockpit in a Trial of Position witnessed by two Star Colonels', 'earned warrior status on the second attempt and has not lost a trial since', 'took the seat from its previous holder in a circle no wider than the machine\'s shadow', 'was granted the ride after the Trial adjudicator overruled the first result'],
    },
    merc: {
        origins: ['Off a contract world that changed hands twice before adulthood', 'Raised in the back of a unit train that never stopped longer than a refit', 'Born to a tech family that followed the work from employer to employer', 'Grew up listening to contract negotiations through thin partition walls'],
        paths: ['signed the first articles at the legal minimum age, witnessed by the paymaster', 'inherited the seat, the debt on it, and the callsign that came with both', 'walked off a House line unit the day the garrison stood down', 'won the ride in a salvage settlement that still gets disputed at reunions'],
    },
    'periphery/pirate': {
        origins: ['Born on a rock the star charts list as uninhabited', 'Raised where the law arrived twice a year by JumpShip, if the recharge held', 'The child of settlers who paid protection in fuel and never once paid twice', 'Grew up stripping wrecks before being tall enough to reach the cockpit rails'],
        paths: ['took the machine in a salvage dispute that ended with one claimant', 'learned gunnery on a stripped-down AgroMech with a bolted-on rifle', 'crewed three different hulls under three different flags before keeping one', 'was voted into the seat by a crew that does not vote twice'],
    },
    comstar: {
        origins: ['Raised within the Order, schooled in the white noise of the compounds', 'Born to lay staff at an HPG station and inducted at fourteen', 'A transfer from secular life whose file begins abruptly', 'Brought up between relay postings on six worlds in ten years'],
        paths: ['earned the cockpit in the Com Guards\' quiet expansion', 'was assessed, selected, and reassigned in a single directive', 'trained in simulators a decade before touching a live machine', 'serves where the Precentor Martial\'s long plans require'],
    },
    sldf: {
        origins: ['Born on a federal district world under the Star League banner', 'Raised in a service family with three generations of SLDF paybooks', 'The child of Hegemony civil engineers who built what the Army defended', 'Grew up beside a Castle Brian and learned its silhouette before the alphabet'],
        paths: ['commissioned through the War Academy with honors in combined arms', 'mustered up from armored infantry after Gorst Flats', 'earned the cockpit in the Martial Olympiad trials', 'transferred from the Royal divisions with the paperwork to prove it'],
    },
};

/** Era texture — one clause, light touch. Keyed by the forge eraTag. */
const ERA_CLAUSE: Record<string, string> = {
    'age-of-war': 'in the years when the Houses still fought without rules',
    'star-league': 'under the long peace of the Star League',
    'early-succession-wars': 'while the First Succession War burned the maps',
    'late-succession-wars': 'in the grinding years of the Succession Wars',
    'clan-invasion': 'in the year the Clans came over the Periphery rim',
    'civil-war': 'while the FedCom tore itself apart',
    jihad: 'as the Jihad set the Inner Sphere alight',
    'dark-age': 'after the HPG blackout rewrote every certainty',
};

/** Temperament/habit closers — shared pool, register-neutral (the table reads these aloud). */
const HABITS = [
    'Keeps the first spent casing from every contract in a footlocker that is never discussed.',
    'Walks the machine before every drop, one full circuit, gauntlets off.',
    'Reads the technical readout of every kill afterward, cover to cover, without comment.',
    'Writes letters home that are never mailed and never thrown away.',
    'Will not eat before a drop and will not stop eating after one.',
    'Names every machine the same name and refuses to say it aloud.',
    'Quotes regulations from memory, including the ones being broken at the time.',
    'Sleeps inside the bay on the night before contact, cot beside the right foot actuator.',
    'Keeps the cockpit checklist laminated from a dead instructor\'s original.',
    'Counts ammunition by hand after every engagement and signs the tally.',
];

const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

/** Generate one ~2-sentence bio. Pure; the caller stores the result on the pilot (GM-editable after). */
export function generateBio(register: string, eraTag: string, rng: () => number = Math.random): string {
    const pools = POOLS[register] ?? POOLS['merc'];
    const era = ERA_CLAUSE[eraTag] ?? '';
    const s1 = `${pick(pools.origins, rng)}${era ? `, ${era}` : ''}, and ${pick(pools.paths, rng)}.`;
    return `${s1} ${pick(HABITS, rng)}`;
}
