/*
 * BCE — the engagement key (D-042/D-048). The claim + battle-state rooms are keyed (campaignId,
 * engagementKey); the GM and every player MUST compute the IDENTICAL key or they land in different
 * rooms-within-the-room and never see each other. So it lives here, ONE pure function, shared by the
 * GM claims panel and the port-isolated player surface. = the ACTIVE mission branch's id (the live
 * engagement); else the most-recently-RESOLVED (a freeze still shows the record); else 'none'.
 */
import type { MissionBranch } from '../mission/mission-tree';

export function engagementKeyOf(tree: MissionBranch[] | null | undefined): string {
    const t = tree ?? [];
    const active = t.find((b) => b.state === 'ACTIVE');
    if (active) return active.branchId;
    const resolved = t.filter((b) => b.state === 'RESOLVED');
    return resolved.length ? resolved[resolved.length - 1].branchId : 'none';
}

/** Frozen = no ACTIVE engagement (resolved, or none yet) → claim/release locked (D-031). */
export function engagementFrozen(tree: MissionBranch[] | null | undefined): boolean {
    return !(tree ?? []).some((b) => b.state === 'ACTIVE');
}
