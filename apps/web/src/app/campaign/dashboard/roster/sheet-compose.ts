/*
 * BCE — shared record-sheet composition (DIRECTIVE-070 / D-071). One source of truth for "the composed
 * sheet": a clone of the MekBay live SVG (the pilot box — name + Gunnery/Piloting — already rides IN the
 * SVG via roster-force applyCrew) PLUS the D-070 Special-Pilot-Ability overlay line. The roster thumbnail
 * (sheet-view), the explode modal, and the D-071 print path all reuse THIS — they must not fork the overlay.
 */
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { GameSystem } from '../../../models/common.model';
import type { UnitSummary as Unit } from '../../../models/unit-summary.model';

/** DIRECTIVE-083 — the result of the game-system card selector. */
export type ComposedCard =
    | { mode: 'cbt'; svg: SVGSVGElement | null }
    | { mode: 'as'; unit: Unit | null; ready: boolean };

/** DIRECTIVE-083 — the ONE game-system selector for "the unit card": Alpha Strike → the unit's `as` stats
 *  (rendered by <alpha-strike-card> / asprint), Classic → the UNCHANGED cloneSheetSvg record sheet. `ready`
 *  is false when the AS stats are slice-stripped → callers degrade gracefully (no crash). */
export function composeUnitCard(fu: CBTForceUnit | null, gameSystem: GameSystem): ComposedCard {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        const unit = fu?.getUnit() ?? null;
        return { mode: 'as', unit, ready: !!unit?.as };
    }
    return { mode: 'cbt', svg: cloneSheetSvg(fu) };
}

/** Clone a ForceUnit's live record-sheet SVG for read-only display/print. Null when the sheet isn't loaded. */
export function cloneSheetSvg(fu: CBTForceUnit | null): SVGSVGElement | null {
    const svg = fu?.svg();
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute('id');
    return clone;
}

/** D-070 (E) — draw "Abilities: Sniper · Sandblaster" into a sheet SVG, just below the Consciousness # box
 *  in the Warrior Data area. The svg MUST be laid out (in the DOM) when this runs — getBBox needs layout.
 *  Font-size is in SVG USER UNITS (derived from the anchor box) so it scales with the sheet like the crew
 *  text. No-op when there are no abilities or the anchor can't be found (e.g. a unit type with no crew box).
 *
 *  HOTFIX-015: getBBox() returns the anchor's coords in its OWN local user space, but the Warrior Data box
 *  sits inside a translated <g>. Appending the text at the SVG ROOT with those local coords dropped it at the
 *  sheet origin (top-left, over the logo). FIX: append the line as a SIBLING of the anchor (into its parent
 *  <g>) so it inherits the same ancestor transforms — the local bbox coords then place it correctly below the
 *  Consciousness row. */
export function injectSheetAbilities(svg: SVGSVGElement, abilities: string[]): void {
    svg.querySelector('#bce-spa-line')?.remove(); // idempotent: never stack two lines
    if (!abilities.length) return;
    const texts = Array.from(svg.querySelectorAll('text')) as SVGTextElement[];
    const anchor =
        texts.find((t) => /consciousness/i.test(t.textContent || '')) ||
        texts.find((t) => /piloting/i.test(t.textContent || '')) ||
        texts.find((t) => /gunnery/i.test(t.textContent || '')) ||
        null;
    if (!anchor) return;
    let box: { x: number; y: number; height: number };
    try { const b = anchor.getBBox(); box = { x: b.x, y: b.y, height: b.height }; } catch { return; }
    if (!box.height) return;
    const NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(NS, 'text');
    line.setAttribute('id', 'bce-spa-line');
    line.setAttribute('x', String(box.x));
    line.setAttribute('y', String(box.y + box.height * 2.6)); // clears the Consciousness row + its TN numbers
    line.setAttribute('font-size', String(box.height * 0.92)); // user units → scales with the viewBox
    line.setAttribute('font-weight', '700');
    line.setAttribute('fill', '#111');
    const full = `Abilities: ${abilities.join(' · ')}`;
    line.textContent = full.length > 52 ? full.slice(0, 51) + '…' : full; // HOTFIX-015: clip a very long list
    // HOTFIX-015: SIBLING of the anchor → inherits the same translate(<g>) so the local bbox coords land
    // below the Consciousness box (was svg.appendChild → root space → top-left over the logo).
    (anchor.parentNode ?? svg).appendChild(line);
}
