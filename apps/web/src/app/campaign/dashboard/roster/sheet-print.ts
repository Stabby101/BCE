import { ApplicationRef, EnvironmentInjector, createComponent } from '@angular/core';
import { cloneSheetSvg, injectSheetAbilities } from './sheet-compose';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { GameSystem } from '../../../models/common.model';
import { AlphaStrikeCardComponent } from '../../../components/alpha-strike-card/alpha-strike-card.component';

export interface PrintSheet {
    fu: CBTForceUnit | null;
    abilities: string[];
}

export interface PrintOpts {
    gameSystem?: GameSystem;
    appRef?: ApplicationRef;
    environmentInjector?: EnvironmentInjector;
}

const STYLE_ID = 'bce-print-style';
const PRINT_CSS = `
.bce-print-root { position: fixed; left: -10000px; top: 0; width: 816px; background: #fff; z-index: -1; }
.bce-print-root .bce-print-page { width: 100%; display: flex; align-items: flex-start; justify-content: center; }
.bce-print-root svg { width: 100%; height: auto; background: #fff; }
@media print {
    body.bce-printing-sheets > *:not(.bce-print-root) { display: none !important; }
    .bce-print-root { position: static !important; left: auto !important; top: auto !important; width: auto !important; z-index: auto !important; }
    .bce-print-root .bce-print-page { page-break-after: always; break-after: page; min-height: 100vh; }
    .bce-print-root .bce-print-page:last-child { page-break-after: auto; break-after: auto; min-height: 0; }
    @page { margin: 8mm; }
}
`;

export function printSheets(items: PrintSheet[], opts?: PrintOpts): void {
    if (opts?.gameSystem === GameSystem.ALPHA_STRIKE && opts.appRef && opts.environmentInjector) {
        return printAsCards(items, opts.appRef, opts.environmentInjector);
    }
    const root = document.createElement('div');
    root.className = 'bce-print-root';
    const pending: { svg: SVGSVGElement; abilities: string[] }[] = [];
    for (const it of items) {
        const svg = cloneSheetSvg(it.fu);
        if (!svg) continue; // sheet not loaded → skip (e.g. not-in-catalog unit)
        const page = document.createElement('div');
        page.className = 'bce-print-page';
        page.appendChild(svg);
        root.appendChild(page);
        pending.push({ svg, abilities: it.abilities });
    }
    if (!pending.length) return;

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = PRINT_CSS;
        document.head.appendChild(style);
    }
    document.body.appendChild(root); // off-screen but laid out → getBBox works
    for (const pg of pending) injectSheetAbilities(pg.svg, pg.abilities);
    document.body.classList.add('bce-printing-sheets');

    let done = false;
    const cleanup = () => {
        if (done) return;
        done = true;
        document.body.classList.remove('bce-printing-sheets');
        root.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // print on the next frame so the off-screen layout (and the SPA overlay) is settled first.
    setTimeout(() => { try { window.print(); } catch { /* */ } }, 60);
    setTimeout(cleanup, 120000); // safety net if afterprint never fires (e.g. dialog dismissed oddly)
}

function printAsCards(items: PrintSheet[], appRef: ApplicationRef, environmentInjector: EnvironmentInjector): void {
    const root = document.createElement('div');
    root.className = 'bce-print-root';
    const refs: { destroy: () => void }[] = [];
    let any = false;
    for (const it of items) {
        const unit = it.fu?.getUnit() ?? null;
        if (!unit?.as) { if (unit) console.warn(`[] AS print: "${unit.name}" has no AS stats (slice-stripped) — skipped.`); continue; }
        const page = document.createElement('div');
        page.className = 'bce-print-page';
        const ref = createComponent(AlphaStrikeCardComponent, { environmentInjector });
        ref.setInput('unit', unit);
        appRef.attachView(ref.hostView);
        page.appendChild(ref.location.nativeElement);
        root.appendChild(page);
        refs.push({ destroy: () => { try { appRef.detachView(ref.hostView); ref.destroy(); } catch { /* */ } } });
        any = true;
    }
    if (!any) return;
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = PRINT_CSS;
        document.head.appendChild(style);
    }
    document.body.appendChild(root);
    appRef.tick(); // render the attached AS card views off-screen
    document.body.classList.add('bce-printing-sheets');
    let done = false;
    const cleanup = () => {
        if (done) return;
        done = true;
        document.body.classList.remove('bce-printing-sheets');
        refs.forEach((r) => r.destroy());
        root.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => { try { window.print(); } catch { /* */ } }, 120);
    setTimeout(cleanup, 120000);
}
