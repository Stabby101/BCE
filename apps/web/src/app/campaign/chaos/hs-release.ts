import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';
import { pruneLance, redesignateCommander, type ForceStructure } from '../force/force-structure';

export interface ReleaseInput { force: readonly ProtoInstance[]; pilots: readonly Pilot[] | null | undefined; structure: ForceStructure | null | undefined; instanceId: string }
export type ReleaseOutcome =
    | { ok: true; force: ProtoInstance[]; pilots: Pilot[] | null; structure: ForceStructure | null; released: ProtoInstance; pilotFreed: string | null }
    | { ok: false; reason: 'not-found' };

export function releaseFromForce(a: ReleaseInput): ReleaseOutcome {
    const inst = a.force.find((i) => i.instanceId === a.instanceId);
    if (!inst) return { ok: false, reason: 'not-found' };
    const freed = (a.pilots ?? []).find((p) => p.assignedInstanceId === a.instanceId) ?? null;
    const pilots = a.pilots ? a.pilots.map((p) => (p.assignedInstanceId === a.instanceId ? { ...p, assignedInstanceId: undefined } : p)) : null;
    const force = redesignateCommander(a.force.filter((i) => i.instanceId !== a.instanceId));
    const structure = a.structure && inst.lanceId ? pruneLance(a.structure, force, inst.lanceId) : (a.structure ?? null);
    return { ok: true, force, pilots, structure, released: inst, pilotFreed: freed?.pilotId ?? null };
}
