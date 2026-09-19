import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { GameSystem } from '../../../models/common.model';
import type { UnitSummary as Unit } from '../../../models/unit-summary.model';

export type ComposedCard =
    | { mode: 'cbt'; svg: SVGSVGElement | null }
    | { mode: 'as'; unit: Unit | null; ready: boolean };

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
    line.textContent = full.length > 52 ? full.slice(0, 51) + '…' : full;
    // below the Consciousness box (was svg.appendChild → root space → top-left over the logo).
    (anchor.parentNode ?? svg).appendChild(line);
}
