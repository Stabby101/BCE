import type { UnitSummary as Unit } from '../../../models/unit-summary.model';

export interface ResolvableInstance {
    unitRef: string;
    chassis: string;
    model: string;
    mulId?: number | null;
}

export function resolveInstanceUnit(inst: ResolvableInstance, byName: Unit | undefined, units: Unit[] | undefined): Unit | undefined {
    if (byName) return byName;
    if (!units?.length) return undefined;
    return (inst.mulId != null && inst.mulId > 0 ? units.find((u) => u.id === inst.mulId) : undefined)
        ?? units.find((u) => u.chassis === inst.chassis && u.model === inst.model)
        ?? units.find((u) => u.chassis === inst.chassis);
}
