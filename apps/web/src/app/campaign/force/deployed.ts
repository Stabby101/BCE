import type { ProtoInstance } from './force-generator';

/** The condition value meaning "on the active operation" (matches CONDITIONS in roster/sample-force). */
export const DEPLOYED_CONDITION = 'Deployed';

export const DEPLOY_ELIGIBLE: ReadonlySet<string> = new Set(['Active', 'Reserve', 'Deployed']);
export function canDeploy(condition: string | undefined | null): boolean {
    return DEPLOY_ELIGIBLE.has(condition ?? '');
}
export function deployBlocker(condition: string | undefined | null, hasCrew: boolean): string | null {
    if (!canDeploy(condition)) return condition || 'unavailable';
    return hasCrew ? null : 'no crew';
}

export function deployedSet(force: readonly ProtoInstance[] | null | undefined, quickMission = false): ProtoInstance[] {
    const f = force ?? [];
    return quickMission ? [...f] : f.filter((i) => i.condition === DEPLOYED_CONDITION);
}

export interface ForceReadiness {
    total: number;
    deployed: number;
    ready: number; // condition 'Active'
    repair: number; // condition 'In repair'
}

/** Readiness summary for the ACTIVE MISSION status bar (all 'Mechs this slice). */
export function forceReadiness(force: readonly ProtoInstance[] | null | undefined): ForceReadiness {
    const f = force ?? [];
    return {
        total: f.length,
        deployed: f.filter((i) => i.condition === DEPLOYED_CONDITION).length,
        ready: f.filter((i) => i.condition === 'Active').length,
        repair: f.filter((i) => i.condition === 'In repair').length,
    };
}

export interface CategoryCount {
    key: string;
    label: string;
    deployed: number;
    total: number;
}

/** Per-category deployed/total counts for the cell. 'Mechs are the only unit type today. */
export function categoryCounts(force: readonly ProtoInstance[] | null | undefined): CategoryCount[] {
    const f = force ?? [];
    return [
        { key: 'mechs', label: "'MECHS", deployed: deployedSet(f).length, total: f.length },
        { key: 'armor', label: 'ARMOR', deployed: 0, total: 0 },
        { key: 'infantry', label: 'INFANTRY', deployed: 0, total: 0 },
        { key: 'aerospace', label: 'AEROSPACE', deployed: 0, total: 0 },
    ];
}
