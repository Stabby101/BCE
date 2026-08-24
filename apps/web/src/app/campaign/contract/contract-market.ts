/*
 * BCE campaign-pack — CONTRACT MARKET generation (DIRECTIVE-017). Pure TS, no Angular/DOM.
 *
 * Ports CamOpsContractMarket.generateContract + the MissionSelector tables (CamOps 4th p.40)
 * + the offer-count / employer-selection rolls, 1-to-1 from reference/mekhq (GPLv3). Rolls use
 * an injectable RNG (defaults to Math.random) so generation is testable and so the caller can
 * generate ONCE at Begin and STORE every result (offers + raw clause rolls) — reload never rerolls.
 * Written to lift into apps/api at the engine phase (ARCH-002/003) with zero changes to the math.
 *
 * INTERIM flags (until the economy/personnel passes, T-018/T-022/T-024):
 *  - negotiation skill: no personnel yet -> caller passes a flagged interim (CamOps findNegotiationSkill = 0 w/o a negotiator);
 *  - offer floor of 1 at campaign start: a deliberate BCE cold-open deviation from RAW (never dead-end, D-014 precedent);
 *  - base pay: contractBase = perMechBase x forceCount (stand-in for Accountant.getContractBase()).
 */
import {
    ContractTerms,
    MISSION_TYPES,
    type MissionTypeId,
    type EmployerPowerTier,
    type CommandRights,
    type SalvageTerms,
    type SupportTerms,
} from './contract-terms';
import { plausibleTargets } from './faction-matchup';

export type MissionColumn = 'is-clan' | 'independent' | 'corporation';

/** An employer the market can offer (a real era-active faction, or a CamOps generic). */
export interface EmployerEntry {
    name: string;
    tier: EmployerPowerTier;
    periphery?: 'major' | 'minor';
    generic: boolean;
    isFaction: boolean;
    group: string | null;
    img: string | null;
    missionColumn: MissionColumn;
}

export interface TargetEntry {
    name: string;
    group: string;
    pirate: boolean;
}

export interface ContractOffer {
    id: string;
    employer: { name: string; tier: EmployerPowerTier; generic: boolean; img: string | null };
    target: string;
    missionType: MissionTypeId;
    missionName: string;
    durationMonths: number;
    command: CommandRights;
    salvage: SalvageTerms;
    support: SupportTerms;
    transportPct: number;
    /** raw unmodified 2d6 per clause — STORED (the renegotiation/reroll hook). */
    rolls: { command: number; salvage: number; support: number; transport: number };
    pay: { total: number; monthly: number; base: number; multiplier: number };
    // ── Lifecycle (D-022) — optional, migration-safe. OFFERED (market) → ACTIVE (accepted) → COMPLETED. ──
    status?: 'OFFERED' | 'ACTIVE' | 'COMPLETED';
    /** per-clause single-renegotiation marker (CamOps one attempt). */
    rerollsUsed?: { command?: boolean; salvage?: boolean; support?: boolean; transport?: boolean };
    paidMonths?: number; // monthly installments credited so far
    paidOut?: number; // C-bills credited so far (sum of installments + remainder)
    acceptedDate?: { y: number; m: number; d: number };
    completedDate?: { y: number; m: number; d: number };
}

export interface ContractMarketMeta {
    year: number;
    eraId: number;
    ratingModifier: number; // interim Green3/Regular5/Veteran7/Elite9
    reputationFactor: number; // ratingModifier*0.2+0.5
    negotiationSkill: number;
    offersMod: number;
    perMechBase: number;
    forceCount: number;
    floored: boolean; // the offer-count floor of 1 kicked in
    employerMisses: string[]; // employer-traits resolve-probe misses
}
export interface ContractMarket {
    offers: ContractOffer[];
    meta: ContractMarketMeta;
}

export interface GenerateParams {
    year: number;
    eraId: number;
    ratingModifier: number;
    negotiationSkill: number;
    hiringHall: { offersMod: number; employersMod: number; missionsMod: number };
    forceCount: number;
    perMechBase: number;
    employers: EmployerEntry[];
    targets: TargetEntry[];
    employerMisses: string[];
    /** D-102 A1 — faction→bordering-factions at this era (systems.json ownerByEra adjacency). Gates the TARGET
     *  draw to a plausible opponent of the employer; absent ⇒ relax to the old any-non-employer behavior. */
    factionAdjacency?: Record<string, string[]>;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** getNumberOfOffers — CamOpsContractMarket margin -> offer count. */
function numberOfOffers(margin: number): number {
    if (margin < 1) return 0;
    if (margin < 3) return 1;
    if (margin < 6) return 2;
    if (margin < 9) return 3;
    if (margin < 11) return 4;
    if (margin < 13) return 5;
    return 6;
}

// ── MissionSelector (CamOps p.40); index = clamp(2d6 + margin, 2, 12). isClan=false (merc player). ──
function special(margin: number, d6: () => number, depth = 0): MissionTypeId {
    const idx = clamp(d6() + d6() + margin, 2, 12);
    switch (idx) {
        case 2:
            return depth > 4 ? 'GUERRILLA_WARFARE' : special(margin, d6, depth + 1); // covert -> special
        case 3:
        case 4:
            return 'GUERRILLA_WARFARE';
        case 5:
        case 8:
            return 'RECON_RAID';
        case 6:
            return 'EXTRACTION_RAID';
        case 7:
            return 'GARRISON_DUTY';
        case 9:
            return 'RELIEF_DUTY';
        case 10:
            return 'DIVERSIONARY_RAID';
        case 11:
            return 'RIOT_DUTY';
        default:
            return 'CADRE_DUTY'; // 12
    }
}
function isClanRow(idx: number, margin: number, d6: () => number): MissionTypeId {
    switch (idx) {
        case 2:
        case 3:
        case 12:
            return special(margin, d6);
        case 4:
            return 'PIRATE_HUNTING';
        case 5:
            return 'PLANETARY_ASSAULT';
        case 6:
        case 7:
            return 'OBJECTIVE_RAID';
        case 8:
            return 'EXTRACTION_RAID';
        case 9:
            return 'RECON_RAID';
        case 10:
            return 'GARRISON_DUTY';
        default:
            return 'CADRE_DUTY'; // 11
    }
}
function independentRow(idx: number, margin: number, d6: () => number): MissionTypeId {
    switch (idx) {
        case 2:
        case 3:
        case 12:
            return special(margin, d6);
        case 4:
            return 'PLANETARY_ASSAULT';
        case 5:
        case 9:
            return 'OBJECTIVE_RAID';
        case 6:
            return 'EXTRACTION_RAID';
        case 7:
            return 'PIRATE_HUNTING';
        case 8:
            return 'SECURITY_DUTY';
        case 10:
            return 'GARRISON_DUTY';
        default:
            return 'CADRE_DUTY'; // 11
    }
}
function corporationRow(idx: number, margin: number, d6: () => number): MissionTypeId {
    switch (idx) {
        case 2:
        case 3:
        case 4:
        case 12:
            return special(margin, d6);
        case 5:
        case 8:
            return 'OBJECTIVE_RAID';
        case 6:
            return 'EXTRACTION_RAID';
        case 7:
            return 'RECON_RAID';
        case 9:
            return 'SECURITY_DUTY';
        case 10:
            return 'GARRISON_DUTY';
        default:
            return 'CADRE_DUTY'; // 11
    }
}
function selectMission(column: MissionColumn, margin: number, d6: () => number): MissionTypeId {
    const idx = clamp(d6() + d6() + margin, 2, 12);
    if (column === 'independent') return independentRow(idx, margin, d6);
    if (column === 'corporation') return corporationRow(idx, margin, d6);
    return isClanRow(idx, margin, d6);
}

// ── Employer columns (CamOps p.42 employer rows) ──
type EmployerCategory = 'minor' | 'major' | 'super' | 'nobility' | 'planetary' | 'merc' | 'periphery-major' | 'periphery-minor' | 'corporation';
function mainCategory(roll: number, hasSuper: boolean): EmployerCategory {
    if (roll < 8) return 'minor'; // 6-7 (roll<6 is routed to the independent column before this)
    if (roll < 11) return 'major'; // 8-10
    return hasSuper ? 'super' : 'major'; // >=11
}
function independentCategory(roll: number): EmployerCategory {
    if (roll < 4) return 'nobility'; // 2-3
    if (roll < 6) return 'planetary'; // 4-5
    if (roll === 6) return 'merc';
    if (roll < 9) return 'periphery-major'; // 7-8
    if (roll < 11) return 'periphery-minor'; // 9-10
    return 'corporation'; // >=11
}

export function generateMarket(p: GenerateParams, rng: () => number = Math.random): ContractMarket {
    const d6 = (): number => Math.floor(rng() * 6) + 1;
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
    const reputationFactor = p.ratingModifier * 0.2 + 0.5;
    const hasSuper = p.employers.some((e) => e.tier === 'super' && !e.generic);

    // Offer count (CamOps negotiation roll) — floor 1 at campaign start (INTERIM, flagged).
    const offerMargin = d6() + d6() + p.negotiationSkill + p.ratingModifier + p.hiringHall.offersMod - 8;
    let n = numberOfOffers(offerMargin);
    let floored = false;
    if (n < 1) {
        n = 1;
        floored = true;
    }

    const resolveEmployer = (cat: EmployerCategory): EmployerEntry => {
        const pool = p.employers;
        let cands: EmployerEntry[];
        switch (cat) {
            case 'minor': cands = pool.filter((e) => e.tier === 'minor' && !e.generic); break;
            case 'major': cands = pool.filter((e) => e.tier === 'major' && !e.generic); break;
            case 'super': cands = pool.filter((e) => e.tier === 'super' && !e.generic); break;
            case 'periphery-major': cands = pool.filter((e) => e.periphery === 'major'); break;
            case 'periphery-minor': cands = pool.filter((e) => e.periphery === 'minor'); break;
            case 'merc': cands = pool.filter((e) => e.tier === 'mercenary'); break;
            case 'nobility': cands = pool.filter((e) => e.generic && e.name === 'Local Nobility'); break;
            case 'planetary': cands = pool.filter((e) => e.generic && e.name === 'Planetary Government'); break;
            case 'corporation': cands = pool.filter((e) => e.generic && e.name === 'Corporate Sponsor'); break;
            default: cands = [];
        }
        if (!cands.length) cands = pool.filter((e) => e.generic); // never dead-end -> a generic
        if (!cands.length) cands = pool;
        return pick(cands);
    };

    const offers: ContractOffer[] = [];
    for (let i = 0; i < n; i++) {
        // Employer: 2d6+mods; <6 -> reroll on the independent column.
        const eMods = p.ratingModifier + p.hiringHall.employersMod;
        const roll1 = d6() + d6() + eMods;
        const cat = roll1 < 6 ? independentCategory(d6() + d6() + eMods) : mainCategory(roll1, hasSuper);
        const employer = resolveEmployer(cat);

        // Mission type (MissionSelector by the employer's column).
        const missionMargin = d6() + d6() + p.negotiationSkill + p.ratingModifier + p.hiringHall.missionsMod - 8;
        const mission = selectMission(employer.missionColumn, missionMargin, d6);
        const def = MISSION_TYPES[mission];

        // Clauses — fresh unmodified 2d6 per clause; modifiers live in ContractTerms.
        const terms = new ContractTerms(mission, employer.tier, p.ratingModifier, p.year);
        const cR = d6() + d6();
        const sR = d6() + d6();
        const uR = d6() + d6();
        const tR = d6() + d6();

        // Pay: contractBase x length x (employMult x opsTempo x reputationFactor). Interim base.
        const multiplier = terms.employmentMultiplier * terms.opsTempoMultiplier * reputationFactor;
        const base = p.perMechBase * Math.max(1, p.forceCount);
        const total = Math.round(base * def.length * multiplier);

        // Target: Pirate Hunting -> a pirate; else a faction PLAUSIBLY OPPOSED to the employer at this era
        // (D-102 A1 territory oracle), never-dead-end relaxing to any era-active non-employer if the plausible
        // pool is empty (sparse territory data / offline). Era is already respected (the pool is era-active).
        let target: string;
        if (mission === 'PIRATE_HUNTING') {
            const pirates = p.targets.filter((t) => t.pirate);
            target = pirates.length ? pick(pirates).name : (p.targets.filter((t) => t.name !== employer.name)[0]?.name ?? 'Pirates');
        } else {
            const non = p.targets.filter((t) => t.name !== employer.name);
            const plausible = plausibleTargets(employer.name, non, { adjacency: p.factionAdjacency ?? {}, year: p.year });
            const pool = plausible.length ? plausible : non; // never-dead-end relax
            target = pool.length ? pick(pool).name : (p.targets[0]?.name ?? 'Unknown');
        }

        offers.push({
            id: `offer-${i + 1}`,
            employer: { name: employer.name, tier: employer.tier, generic: employer.generic, img: employer.img },
            target,
            missionType: mission,
            missionName: def.name,
            durationMonths: def.length,
            command: terms.commandRights(cR),
            salvage: terms.salvage(sR),
            support: terms.support(uR),
            transportPct: terms.transport(tR),
            rolls: { command: cR, salvage: sR, support: uR, transport: tR },
            pay: { total, monthly: Math.round(total / def.length), base, multiplier },
        });
    }

    return {
        offers,
        meta: {
            year: p.year,
            eraId: p.eraId,
            ratingModifier: p.ratingModifier,
            reputationFactor,
            negotiationSkill: p.negotiationSkill,
            offersMod: p.hiringHall.offersMod,
            perMechBase: p.perMechBase,
            forceCount: p.forceCount,
            floored,
            employerMisses: p.employerMisses,
        },
    };
}
