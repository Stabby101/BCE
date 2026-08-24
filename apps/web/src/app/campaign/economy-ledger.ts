/*
 * BCE — the monthly ECONOMY LEDGER (DIRECTIVE-058), extracted to ONE place (DIRECTIVE-074) so the inventory
 * tab AND the Overview economy summary read the SAME numbers (single source, no drift / no double-count).
 * Pure read over NewCampaignState signals — call it inside a computed() to stay reactive.
 *   treasury  — live treasury (falls back to the seeded capital).
 *   payroll   — predicted monthly personnel burn (Σ active salaries; PersonnelState.monthlyPayroll).
 *   income    — predicted monthly contract income (MERC + ACTIVE only: pay.total / durationMonths).
 *   net       — income − payroll (the recurring net).
 *   runway    — months of treasury left at the current net burn (null when net ≥ 0).
 */
import type { NewCampaignState } from './new-campaign-state';
import type { ProtoInstance } from './force/force-generator';

export interface EconomyLedger {
    treasury: number;
    payroll: number;       // monthly personnel salaries (the tech/support LABOR — D-058)
    maintenance: number;    // monthly unit maintenance / spare parts (D-076 — separate from labor; no double-count)
    income: number;         // monthly contract income (MERC active contract)
    net: number;            // income − payroll − maintenance
    runway: number | null;  // months of treasury left at the current net burn (null when net ≥ 0)
}

/*
 * DIRECTIVE-076 — monthly UNIT MAINTENANCE (CamOps "operating costs"). CamOps splits a unit's upkeep into
 * technician LABOR (tech-hours → the support salaries we already debit as payroll, D-058/D-074) and SPARE
 * PARTS / consumables. This is the spare-parts share, so it does NOT double-count the payroll. CamOps scales
 * maintenance with the machine; we carry tonnage + type on the instance (not the C-bill cost), so the upkeep
 * is tonnage × a per-type rate — the canon BattleTech maintenance driver. COLD-STORAGE units are mothballed
 * (CamOps: a stored unit needs no active maintenance) → zero upkeep. Rates are tunable C-bills/ton/month.
 */
export const MAINTENANCE_TUNABLES = {
    /** C-bills per ton per month. 'Mechs are maintenance-intensive; combat vehicles roughly half (CamOps). */
    perTonMonthly: { mech: 120, vehicle: 60 } as Record<string, number>,
};
/** A single unit's monthly maintenance; 0 when mothballed in Cold storage (D-076). */
export function unitUpkeep(inst: ProtoInstance): number {
    if (inst.condition === 'Cold storage') return 0;
    const rate = MAINTENANCE_TUNABLES.perTonMonthly[inst.unitType ?? 'mech'] ?? MAINTENANCE_TUNABLES.perTonMonthly['mech'];
    return Math.round((inst.tons ?? 0) * rate);
}
/** Σ monthly maintenance across the FIELDED force (Cold-storage units contribute 0). */
export function forceMaintenance(force: readonly ProtoInstance[] | null | undefined): number {
    return (force ?? []).reduce((sum, i) => sum + unitUpkeep(i), 0);
}

export function computeLedger(state: NewCampaignState): EconomyLedger {
    const treasury = state.treasury() ?? state.capital()?.amount ?? 0;
    const payroll = state.personnel()?.monthlyPayroll ?? 0;
    const maintenance = forceMaintenance(state.startingForce());
    const ac = state.acceptedContract();
    const income = ac && ac.status === 'ACTIVE' && state.force() === 'MERC' ? Math.round(ac.pay.total / Math.max(1, ac.durationMonths)) : 0;
    const net = income - payroll - maintenance;
    const runway = net < 0 ? Math.floor(treasury / Math.max(1, -net)) : null;
    return { treasury, payroll, maintenance, income, net, runway };
}
