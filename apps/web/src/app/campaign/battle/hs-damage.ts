/*
 * BCE — DIRECTIVE-PD3 P1 (PD3-12): ONE damage truth for Hot Spots. Pure TS, no Angular/DOM.
 *
 * A Hot Spots unit is DAMAGED when the digital reconcile wrote a repairable envelope onto it (`damage` — armor /
 * internal / crits, or the destroyed flag) OR the tabletop recorder flagged a level (`chaosDamage`). Before P1 the
 * Repair & Refit list read this predicate inline while the roster header's REPAIR badge counted the Traditional
 * `condition === 'In repair'` — which Hot Spots never sets — so the badge read 0 over a damaged force. Every HS
 * surface that says "how many units need repair" reads THIS function: the repair list, the header badge, the
 * process rail's Repair stop. Traditional keeps `forceReadiness().repair` untouched.
 *
 * DECISION (placement): lives in campaign/battle/ — the UNSCOPED shared engine substrate (BOUNDARY-MAP §4 / scopes.json:
 * battle/{force,damage,reconcile} are deliberately fence-exempt) — because it composes engine-classic's `hasMechDamage`
 * (campaign/repair/) with an engine-hs field (`chaosDamage`) and is read by unscoped surfaces (roster header · rail ·
 * resolve · apply-slip) AND by engine-hs (the repair tab). Under campaign/chaos/ the repair-bays import was a NEW
 * engine-hs → engine-classic edge (`bce-boundary/no-new-cross-boundary` error); here it is the substrate's own.
 */
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
