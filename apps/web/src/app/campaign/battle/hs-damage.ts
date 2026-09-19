import type { ProtoInstance } from '../force/force-generator';
import { hasMechDamage } from '../repair/repair-bays'; // engine-classic's canonical repair-eligibility predicate (unscoped consumer)

/** Damaged by the reconcile (a repairable envelope or the destroyed flag) or flagged on the tabletop recorder. */
export function hsDamaged(inst: Pick<ProtoInstance, 'damage' | 'chaosDamage'> | null | undefined): boolean {
    if (!inst) return false;
    return hasMechDamage(inst.damage) || !!inst.damage?.destroyed || !!inst.chaosDamage;
}

/** The count behind the HS REPAIR badge + the rail's Repair stop. */
export function hsDamagedCount(force: readonly Pick<ProtoInstance, 'damage' | 'chaosDamage'>[] | null | undefined): number {
    return (force ?? []).filter((i) => hsDamaged(i)).length;
}
