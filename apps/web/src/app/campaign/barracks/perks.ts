/*
 * BCE campaign-pack — PERKS governance (DIRECTIVE-036). Pure TS, no Angular/DOM.
 *
 * Enforces SPA_GOVERNANCE (CamOps p.72, in pilot-abilities.ts) AS DATA: slots by the pilot's
 * skill rating, the combined point cap, and the force-wide SPA-pilot cap. Every refusal comes
 * back with the GATE NAMED (the HOTFIX-004 no-silent-no-op standard — disabled controls say why).
 * Display + print only this slice: SPAs never touch the record sheet; the table adjudicates.
 *
 * NOTE (recon, reported): canon's formation-rules variant (1 per 12) is STRICTER than standard
 * (1 per 4) — it does not "lift" anything. The lift the GM reaches for is variant 'off' (a table
 * call). The variant rides a localStorage knob until the D-038 Settings surface adopts it.
 */
import { PILOT_ABILITIES, SPA_GOVERNANCE, type PilotAbility } from './pilot-abilities';
import type { Pilot } from './pilot-generator';

export type SkillRating = 'green' | 'regular' | 'veteran' | 'elite';
export type CapVariant = 'standard' | 'formation' | 'off';

export const PERK_TUNABLES = {
    /** Force-wide cap variant default; 'bce.spa.cap' in localStorage overrides (D-038 Settings adopts it). */
    capVariant: 'standard' as CapVariant,
    capStorageKey: 'bce.spa.cap',
} as const;

/** The pilot's skill rating, derived from the STORED skills (the D-020 canon table inverted:
 *  Elite 2/3 · Veteran 3/4 · Regular 4/5 · Green 5/6 — by combined TN, jitter straddles honestly). */
export function ratingOf(gunnery: number, piloting: number): SkillRating {
    const tn = gunnery + piloting;
    if (tn <= 5) return 'elite';
    if (tn <= 7) return 'veteran';
    if (tn <= 9) return 'regular';
    return 'green';
}

export const slotsFor = (r: SkillRating): number => SPA_GOVERNANCE.slotsByRating[r] ?? 0;
export const pointCapFor = (r: SkillRating): number =>
    r === 'green' ? 0 : (SPA_GOVERNANCE.pointCapByRating as Record<string, number>)[r] ?? 0;

export function abilityById(id: string): PilotAbility | undefined {
    return PILOT_ABILITIES.find((a) => a.id === id);
}
export function pointsOf(perkIds: string[]): number {
    return perkIds.reduce((s, id) => s + (abilityById(id)?.points ?? 0), 0);
}

/** Force-wide SPA-pilot cap for `fielded` units under a variant; null = cap disabled. */
export function forceWideCap(fielded: number, variant: CapVariant): number | null {
    if (variant === 'off') return null;
    return Math.floor(fielded / (variant === 'formation' ? 12 : 4));
}

export interface GrantGate {
    ok: boolean;
    gate: string | null; // the NAMED reason a grant is refused (renders on the disabled control)
}

/** Can this pilot take this ability now? Every refusal names its gate. */
export function grantGate(
    pilot: Pilot,
    abilityId: string,
    fielded: number,
    spaPilotCount: number, // pilots with >=1 perk, force-wide (this pilot counted if already perked)
    variant: CapVariant,
): GrantGate {
    const a = abilityById(abilityId);
    if (!a) return { ok: false, gate: 'unknown ability' };
    if (pilot.status === 'KIA') return { ok: false, gate: 'KIA — the dead take no new abilities' };
    const held = pilot.perks ?? [];
    if (held.includes(abilityId)) return { ok: false, gate: 'already held' };
    const rating = ratingOf(pilot.gunnery, pilot.piloting);
    const slots = slotsFor(rating);
    if (held.length >= slots) {
        return { ok: false, gate: slots === 0 ? `SLOTS — ${rating} rating takes no SPAs (CamOps p.72)` : `SLOTS — ${rating} rating allows ${slots} (CamOps p.72)` };
    }
    const cap = pointCapFor(rating);
    const after = pointsOf(held) + a.points;
    if (after > cap) return { ok: false, gate: `POINTS — ${rating} cap is ${cap}; this grant reaches ${after} (CamOps p.72)` };
    const fw = forceWideCap(fielded, variant);
    if (fw !== null && held.length === 0 && spaPilotCount >= fw) {
        return { ok: false, gate: `FORCE CAP — ${fw} SPA pilot${fw === 1 ? '' : 's'} per ${fielded} fielded (1 per ${variant === 'formation' ? '12, formation rules' : '4'}; CamOps p.72)` };
    }
    return { ok: true, gate: null };
}
