/*
 * PLATFORM-1 Part C — the instance→catalog resolution chain, extracted PURE so the id:-1 failure mode is
 * spec-pinned (the ruled follow-on to the COMPLIANCE-3 rider recon).
 *
 * Order (behavior-identical to the original roster-force resolveUnit, plus THE GUARD):
 *   1. the name lookup result wins (HOTFIX-013 dual-path — passed in, the caller owns DataService);
 *   2. the MUL-id fallback — GUARDED to POSITIVE ids: 1,545 catalog units share the id:-1 sentinel, so a
 *      persisted -1 must read as ABSENT. Un-guarded, `find(u => u.id === -1)` short-circuited the CORRECT
 *      chassis/model fallback with the FIRST -1 unit in the loaded catalog — an infantry suit (1 t, BV 11)
 *      rendering the wrong sheet, wrong sprite and wrong BV for a bought 'Mech. The guard makes every
 *      already-persisted -1 (and the hire path's 0) inert with ZERO data writes — no repair pass.
 *   3. chassis+model, then bare chassis (the loose matches, unchanged).
 */
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
