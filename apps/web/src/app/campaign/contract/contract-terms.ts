
/** The contract/mission types the CamOps Missions Table (p.40) can yield for a merc. */
export type MissionTypeId =
    | 'GARRISON_DUTY'
    | 'CADRE_DUTY'
    | 'SECURITY_DUTY'
    | 'RIOT_DUTY'
    | 'PLANETARY_ASSAULT'
    | 'RELIEF_DUTY'
    | 'GUERRILLA_WARFARE'
    | 'PIRATE_HUNTING'
    | 'DIVERSIONARY_RAID'
    | 'OBJECTIVE_RAID'
    | 'RECON_RAID'
    | 'EXTRACTION_RAID';

export interface ClauseMods {
    command: number;
    salvage: number;
    support: number;
    transport: number;
}

interface MissionDef {
    name: string; // display
    /** constantLength in months (AtBContractType, base length). */
    length: number;
    /** operationsTempoMultiplier (AtBContractType, pay multiplier). */
    opsTempo: number;
    /** per-type clause modifiers (ContractTerms.addMissionTypeModifiers). */
    mod: ClauseMods;
}

/** AtBContractType length + ops-tempo + ContractTerms per-mission clause modifiers, verbatim. */
export const MISSION_TYPES: Record<MissionTypeId, MissionDef> = {
    GARRISON_DUTY: { name: 'Garrison Duty', length: 18, opsTempo: 1.0, mod: { command: 1, salvage: 0, support: 1, transport: 0 } },
    CADRE_DUTY: { name: 'Cadre Duty', length: 12, opsTempo: 0.8, mod: { command: 0, salvage: 0, support: 1, transport: 0 } },
    SECURITY_DUTY: { name: 'Security Duty', length: 6, opsTempo: 1.2, mod: { command: -3, salvage: 0, support: 2, transport: 1 } },
    RIOT_DUTY: { name: 'Riot Duty', length: 4, opsTempo: 1.0, mod: { command: -2, salvage: 1, support: 2, transport: 0 } },
    PLANETARY_ASSAULT: { name: 'Planetary Assault', length: 9, opsTempo: 1.5, mod: { command: -2, salvage: 0, support: 2, transport: 3 } },
    RELIEF_DUTY: { name: 'Relief Duty', length: 9, opsTempo: 1.4, mod: { command: -1, salvage: 1, support: 1, transport: 1 } },
    GUERRILLA_WARFARE: { name: 'Guerrilla Warfare', length: 24, opsTempo: 2.1, mod: { command: -2, salvage: 3, support: -2, transport: -1 } },
    PIRATE_HUNTING: { name: 'Pirate Hunting', length: 6, opsTempo: 1.0, mod: { command: 2, salvage: 2, support: -1, transport: -1 } },
    DIVERSIONARY_RAID: { name: 'Diversionary Raid', length: 3, opsTempo: 1.8, mod: { command: 0, salvage: 2, support: 2, transport: 1 } },
    OBJECTIVE_RAID: { name: 'Objective Raid', length: 3, opsTempo: 1.6, mod: { command: -1, salvage: 0, support: 1, transport: 2 } },
    RECON_RAID: { name: 'Recon Raid', length: 3, opsTempo: 1.6, mod: { command: -1, salvage: -2, support: 1, transport: -1 } },
    EXTRACTION_RAID: { name: 'Extraction Raid', length: 3, opsTempo: 1.6, mod: { command: -1, salvage: -1, support: 2, transport: 1 } },
};

/** Employer power tier (CamOps employer rows) → terms modifiers (ContractTerms.addEmployerModifiers). */
export type EmployerPowerTier = 'super' | 'major' | 'minor' | 'corporation' | 'mercenary' | 'independent';

interface EmployerMod {
    employMult: number; // added to employmentMultiplier (starts at 1.0)
    mod: ClauseMods;
}
const EMPLOYER_MODS: Record<EmployerPowerTier, EmployerMod> = {
    super: { employMult: 0.3, mod: { command: 0, salvage: 0, support: 1, transport: 2 } },
    major: { employMult: 0.2, mod: { command: 0, salvage: -1, support: 0, transport: 1 } },
    minor: { employMult: 0.1, mod: { command: 0, salvage: -2, support: 0, transport: 0 } },
    corporation: { employMult: 0.1, mod: { command: -1, salvage: 2, support: 1, transport: 1 } },
    mercenary: { employMult: 0.1, mod: { command: -1, salvage: 2, support: 1, transport: 1 } },
    independent: { employMult: 0.0, mod: { command: 0, salvage: -1, support: -1, transport: 0 } },
};

/**
 * Unit-reputation clause row (ContractTerms.addUnitReputationModifiers), indexed 0..10.
 * MekHQ indexes this by floor(reputationFactor) (a quirk that leaves rows 6-10 unreachable);
 * BCE indexes by the reputation MODIFIER per the CamOps table semantics so the interim
 * Green3/Regular5/Veteran7/Elite9 map produces the intended Green->Elite spread. (INTERIM, T-022.)
 */
const REPUTATION_ROW: ClauseMods[] = [
    { command: -2, salvage: -1, support: -1, transport: -3 }, // 0
    { command: -1, salvage: -1, support: -1, transport: -2 }, // 1
    { command: -1, salvage: 0, support: 0, transport: -2 }, // 2
    { command: -1, salvage: 0, support: 0, transport: -1 }, // 3
    { command: 0, salvage: 0, support: 0, transport: -1 }, // 4
    { command: 0, salvage: 0, support: 0, transport: 0 }, // 5 (no case in MekHQ -> zero)
    { command: 1, salvage: 1, support: 0, transport: 0 }, // 6
    { command: 1, salvage: 1, support: 0, transport: 0 }, // 7
    { command: 1, salvage: 1, support: 1, transport: 0 }, // 8
    { command: 2, salvage: 2, support: 1, transport: 1 }, // 9
    { command: 3, salvage: 2, support: 2, transport: 2 }, // 10 (default, >=10)
];

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

export type CommandRights = 'Integrated' | 'House' | 'Liaison' | 'Independent';
export interface SalvageTerms {
    exchange: boolean;
    pct: number;
}
export interface SupportTerms {
    kind: 'straight' | 'battle-loss' | 'none';
    pct: number;
}

/**
 * Resolves + stores the per-clause modifiers for one contract (CamOps Contract Terms Tables,
 * p.42-43), then maps a fresh unmodified 2d6 roll per clause to an outcome. 1-1 with
 * ContractTerms.java; the merc command-rights thresholds are AbstractContractMarket's.
 */
export class ContractTerms {
    readonly employmentMultiplier: number;
    readonly opsTempoMultiplier: number;
    readonly baseLength: number;
    private readonly cmod: ClauseMods;

    constructor(mission: MissionTypeId, employer: EmployerPowerTier, reputationModifier: number, year: number) {
        const m = MISSION_TYPES[mission];
        this.opsTempoMultiplier = m.opsTempo;
        this.baseLength = m.length;

        const em = EMPLOYER_MODS[employer];
        let employMult = 1.0 + em.employMult;
        const mod: ClauseMods = {
            command: m.mod.command + em.mod.command,
            salvage: m.mod.salvage + em.mod.salvage,
            support: m.mod.support + em.mod.support,
            transport: m.mod.transport + em.mod.transport,
        };
        // Temperament (stingy/generous/controlling/lenient) is neutral this slice (T-022) -> skipped.
        // Era window: salvage -2 outside 2781-3062 inclusive (ContractTerms.java:310-312).
        if (year < 2781 || year > 3062) mod.salvage -= 2;
        // Reputation row, indexed by the reputation modifier (clamped 0-10).
        const rep = REPUTATION_ROW[clamp(Math.floor(reputationModifier), 0, 10)];
        mod.command += rep.command;
        mod.salvage += rep.salvage;
        mod.support += rep.support;
        mod.transport += rep.transport;

        this.employmentMultiplier = employMult;
        this.cmod = mod;
    }

    /** Merc command rights: AbstractContractMarket.determineMercenaryCommandRights on (2d6 + commandMod). */
    commandRights(roll2d6: number): CommandRights {
        const t = roll2d6 + this.cmod.command;
        if (t < 3) return 'Integrated';
        if (t < 8) return 'House';
        if (t < 12) return 'Liaison';
        return 'Independent';
    }

    /** Salvage (ContractTerms.isSalvageExchange / getSalvagePercentage). */
    salvage(roll2d6: number): SalvageTerms {
        const t = roll2d6 + this.cmod.salvage;
        if (t === 2 || t === 3) return { exchange: true, pct: 0 };
        return { exchange: false, pct: (clamp(t, 3, 13) - 3) * 10 };
    }

    /** Support (ContractTerms.isStraightSupport / isBattleLossComp / getSupportPercentage). */
    support(roll2d6: number): SupportTerms {
        const t = roll2d6 + this.cmod.support;
        const pct = SUPPORT_PCT[clamp(t, 2, 13)];
        if (t > 2 && t < 8) return { kind: 'straight', pct };
        if (t > 7) return { kind: 'battle-loss', pct };
        return { kind: 'none', pct: 0 };
    }

    /** Transport (ContractTerms.getTransportTerms). */
    transport(roll2d6: number): number {
        const t = roll2d6 + this.cmod.transport;
        return TRANSPORT_PCT[clamp(t, 1, 10)];
    }
}

/** Support % by clamped total 2..13 (ContractTerms.getSupportPercentage) — non-monotonic by design. */
const SUPPORT_PCT: Record<number, number> = { 2: 0, 3: 20, 4: 40, 5: 60, 6: 80, 7: 100, 8: 10, 9: 20, 10: 40, 11: 60, 12: 80, 13: 100 };
/** Transport % by clamped total 1..10 (ContractTerms.getTransportTerms). */
const TRANSPORT_PCT: Record<number, number> = { 1: 0, 2: 20, 3: 25, 4: 30, 5: 35, 6: 45, 7: 50, 8: 55, 9: 60, 10: 100 };
