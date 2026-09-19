import type { MissionBranch } from '../mission/mission-tree';

export function engagementKeyOf(tree: MissionBranch[] | null | undefined): string {
    const t = tree ?? [];
    const active = t.find((b) => b.state === 'ACTIVE');
    if (active) return active.branchId;
    const resolved = t.filter((b) => b.state === 'RESOLVED');
    return resolved.length ? resolved[resolved.length - 1].branchId : 'none';
}

export function engagementFrozen(tree: MissionBranch[] | null | undefined): boolean {
    return !(tree ?? []).some((b) => b.state === 'ACTIVE');
}
