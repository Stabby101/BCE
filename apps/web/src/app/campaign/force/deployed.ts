/*
 * BCE campaign-pack — DEPLOYED-SET accessor (DIRECTIVE-027). Pure TS, no Angular/DOM.
 *
 * The ONE source of truth for "what is deployed", derived from the per-instance condition (the
 * roster dropdown today; the formal deploy-binding slice swaps the SOURCE without changing this
 * signature). This is the future PLAYER-VIEW forcepack feed: at the LAN/roles slice (T-012/T-016,
 * ROLE-002) a logged-in player's MekBay consumes deployedSet() verbatim — keep it one function,
 * one condition constant. Category split is ready — 'Mechs today; armor/infantry/aero return zero
 * until those unit types exist.
 */
import type { ProtoInstance } from './force-generator';

/** The condition value meaning "on the active operation" (matches CONDITIONS in roster/sample-force). */
export const DEPLOYED_CONDITION = 'Deployed';

/** The deployed set — the future player-view forcepack. Single source of truth.
 *  HF-020: a Quick Mission is deployed-only by contract (D-069) — every unit is on the field — so passing
 *  `quickMission=true` returns the WHOLE force, a belt-and-suspenders so a stray Reserve can never strand a
 *  one-shot's BLUFOR. Campaigns (default false) stay honest: only condition==='Deployed' counts. */
/** ODM-18 P1 (ruling 5 — extraction is LAW, duplicated guards drift): conditions a unit can be deployed
 *  FROM. The ONE source for deploy-roster's checkbox gate AND the intent adapter's set-deploy guard —
 *  'In repair' / 'Cold storage' can never take the field, from ANY caller. */
export const DEPLOY_ELIGIBLE: ReadonlySet<string> = new Set(['Active', 'Reserve', 'Deployed']);
export function canDeploy(condition: string | undefined | null): boolean {
    return DEPLOY_ELIGIBLE.has(condition ?? '');
}
/** TESTER-ODM-1 #2 — THE FULL deploy gate, condition AND crew, in one place. The condition test alone let
 *  an UNPILOTED machine onto the field silently, and ODM-18's shared deploy intent made that reachable by
 *  players too. Returns null when the unit may take the field, else the honest reason to show in its place
 *  ('In repair' / 'Cold storage' / 'no crew') — every caller renders the same words. */
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
