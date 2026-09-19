import type { NewCampaignState } from './new-campaign-state';
import type { ProtoInstance } from './force/force-generator';

export interface EconomyLedger {
    treasury: number;
    payroll: number;
    maintenance: number;
    income: number;         // monthly contract income (MERC active contract)
    net: number;            // income − payroll − maintenance
    runway: number | null;  // months of treasury left at the current net burn (null when net ≥ 0)
}

export const MAINTENANCE_TUNABLES = {
    /** C-bills per ton per month. 'Mechs are maintenance-intensive; combat vehicles roughly half (CamOps). */
    perTonMonthly: { mech: 120, vehicle: 60 } as Record<string, number>,
};
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
