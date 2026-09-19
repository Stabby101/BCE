import { MISSION_TYPES, type MissionTypeId } from '../contract/contract-terms';
import type { ContractOffer } from '../contract/contract-market';

/** Garrison-posture mission weighting — defensive/policing duties prominent, raids periodic, the big
 *  set-piece rare. Tunable; faction-posture variants land with T-024. */
export const HOUSE_ORDER_WEIGHTS: Partial<Record<MissionTypeId, number>> = {
    GARRISON_DUTY: 5, SECURITY_DUTY: 4, CADRE_DUTY: 3, RIOT_DUTY: 3, RELIEF_DUTY: 2,
    PIRATE_HUNTING: 2, OBJECTIVE_RAID: 2, RECON_RAID: 2, EXTRACTION_RAID: 2,
    DIVERSIONARY_RAID: 1, GUERRILLA_WARFARE: 1, PLANETARY_ASSAULT: 1,
};

/** The classic Succession Wars rivalries (INTERIM, cited to Sarna; flagged until T-010 real fronts).
 *  `own` matches the player's faction name; `rivals` are target name fragments matched against the
 *  era-active pool. 'Pirates' is a universal target; absent a listed rival, the fallback is any
 *  era-active non-own faction. */
export const CANON_RIVALRIES: { own: RegExp; rivals: string[] }[] = [
    { own: /capellan|liao/i, rivals: ['Federated Suns', 'Free Worlds League'] },
    { own: /federated suns|davion/i, rivals: ['Capellan', 'Draconis Combine'] },
    { own: /draconis combine|kurita/i, rivals: ['Federated Suns', 'Lyran'] },
    { own: /lyran|steiner/i, rivals: ['Draconis Combine', 'Free Worlds League'] },
    { own: /free worlds league|marik/i, rivals: ['Lyran', 'Capellan'] },
];

/** No economics on orders (regulars are paid in honor + logistics). The walk's no-contract seam reads
 *  this retention allowance. INTERIM, flagged until the cited economy pass — the House takes the rest. */
export const HOUSE_SALVAGE_DEFAULTS = { salvagePct: 10 };

/** Weighted mission-type pick over HOUSE_ORDER_WEIGHTS. */
export function pickMissionType(rng: () => number): MissionTypeId {
    const entries = Object.entries(HOUSE_ORDER_WEIGHTS) as [MissionTypeId, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [t, w] of entries) { if ((r -= w) < 0) return t; }
    return entries[0][0];
}

/** Pick an era-valid rival target: a CANON_RIVALRY of the own faction that is era-active, else a
 *  universal 'Pirates' (if present), else any era-active non-own faction (the fallback). */
export function pickRival(ownFaction: string, eraActiveNames: string[], rng: () => number): string {
    const others = eraActiveNames.filter((n) => n !== ownFaction);
    const entry = CANON_RIVALRIES.find((r) => r.own.test(ownFaction));
    if (entry) {
        const matched = others.filter((n) => entry.rivals.some((rv) => n.toLowerCase().includes(rv.toLowerCase())));
        if (matched.length) return matched[Math.floor(rng() * matched.length)];
    }
    const pirates = others.find((n) => /pirate|bandit/i.test(n));
    if (pirates && rng() < 0.5) return pirates;
    if (others.length) return others[Math.floor(rng() * others.length)];
    return pirates ?? 'Pirates';
}

const THREATS = ['LOW', 'MEDIUM', 'HIGH'];

/** Cut a standing order — a synthetic ContractOffer carrying NO pay/clauses (House defaults), employer
 *  = your own faction, an era-valid target. Acknowledging it mints the root + runs the merc pipeline. */
export function generateOrder(opts: { ownFaction: string; ownTier: ContractOffer['employer']['tier']; eraActiveNames: string[]; seq: number; rng: () => number }): ContractOffer {
    const missionType = pickMissionType(opts.rng);
    const def = MISSION_TYPES[missionType];
    const target = pickRival(opts.ownFaction, opts.eraActiveNames, opts.rng);
    const threat = THREATS[Math.min(THREATS.length - 1, Math.floor(opts.rng() * THREATS.length))];
    return {
        id: `order-${opts.seq}`,
        employer: { name: opts.ownFaction, tier: opts.ownTier, generic: false, img: null },
        target,
        missionType,
        missionName: def?.name ?? missionType,
        durationMonths: def?.length ?? 6,
        command: 'House',
        salvage: { exchange: false, pct: HOUSE_SALVAGE_DEFAULTS.salvagePct },
        support: { kind: 'none', pct: 0 },
        transportPct: 100, // House MIC provides the lift
        rolls: { command: 0, salvage: 0, support: 0, transport: 0 }, // orders are not negotiated
        pay: { total: 0, monthly: 0, base: 0, multiplier: 0 },
        status: 'OFFERED',
        // a stashed threat for the card (read off a non-typed field is awkward; the card derives it)
        threat,
    } as ContractOffer & { threat: string };
}

/** Register-framed directive text — an order, not a deal. The seed's own register carries the package. */
export function orderText(order: ContractOffer): string {
    const t = (order as ContractOffer & { threat?: string }).threat ?? 'MEDIUM';
    return `BY ORDER OF ${order.employer.name.toUpperCase()} COMMAND — execute ${order.missionName} against ${order.target}. Assessed threat ${t}; operational window ${order.durationMonths} months. Regulars acknowledge and deploy; the House provides logistics and claims the field.`;
}
