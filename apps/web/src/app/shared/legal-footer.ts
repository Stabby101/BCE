/*
 * BCE — DIRECTIVE-COMPLIANCE-1 Part B: the persistent legal/attribution footer. Mounted at the ROOT of BOTH
 * bundles (AppShellGated for the GM/web app, AppShell for the player app) so the compliance notice shows on
 * EVERY route, every session — Microsoft's Game Content Usage Rules require it "front and center on a regular
 * and consistent basis". Additive + non-blocking: the bar is fixed at the bottom with pointer-events:none on
 * the container (only the links accept clicks). The full notices live on /legal (LegalPageComponent).
 *
 * DIRECTIVE-IMPORT-7 Part A — the bar must NEVER OVERLAY interactive controls (it covered the cover's sign-in row and
 * list tails on iPad) but must ALSO never be fully hidden (GCUR). Two mechanisms:
 *   1. RESERVED SPACE — the footer measures its own rendered height (ResizeObserver, safe-area inset included) and
 *      publishes it as the CSS variable `--bce-footer-h` on <html>; styles.scss gives <body> that much bottom padding
 *      and the fixed overlays (modals, the update banner) sit above it, so nothing interactive ever lands under it.
 *   2. COLLAPSE-TO-CHIP — on narrow screens (≤ 720px) the footer rests as a slim persistent "Legal & Attribution" chip;
 *      tapping expands the full notice in place, tapping again collapses it. The chip and the /legal link are always
 *      visible; there is no dismiss-to-nothing. Wide screens keep the thin full-text bar.
 *
 * DIRECTIVE-COMPLIANCE-3 — conspicuousness (the owner could not FIND the notice): contrast raised to a legible
 * ratio + a border-top so the bar reads as application chrome, and a new INLINE mode ([inline]="true") that
 * renders the SAME notice (same component, same wording — the text must not drift) in-flow inside a surface's
 * own panel footer (the console's HOST/ENGINE/Reset block, the dashboards' footer). While ANY inline instance
 * is mounted, the root FIXED bar suppresses itself (display:none — it stays in the DOM so the --bce-footer-h
 * reserve machinery keeps publishing an honest 0) so the notice never doubles on one screen.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

const NARROW_MQ = '(max-width: 720px)';
export const FOOTER_HEIGHT_VAR = '--bce-footer-h';
/** COMPLIANCE-3 — live count of mounted INLINE instances; the fixed root bar hides while any exist. */
const inlineMounts = signal(0);

@Component({
    selector: 'bce-legal-footer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    template: `
        <div class="lf" [class.inline]="inline()" [class.suppressed]="suppressed()" [class.narrow]="narrow()" [class.expanded]="showText()" role="contentinfo" aria-label="Legal and attribution" data-testid="bce-legal-footer">
            @if (showText()) {
                <span class="lf-txt" data-testid="lf-text">BCE is an unofficial, non-commercial fan project — not affiliated with or endorsed by Microsoft,
                    The Topps Company, Catalyst Game Labs, or MegaMek. MechWarrior &copy; Microsoft Corporation. Uses
                    <a href="https://megamek.org" target="_blank" rel="noopener noreferrer">MegaMek</a> data (CC BY-NC-SA 4.0)
                    under Microsoft's <a href="https://www.xbox.com/en-US/developers/rules" target="_blank" rel="noopener noreferrer">Game Content Usage Rules</a>.
                    GPLv3 — <a href="https://github.com/Stabby101/BCE" target="_blank" rel="noopener noreferrer">source</a>.</span>
            }
            @if (narrow() && !inline()) {
                <!-- the CHIP: always visible on narrow screens; toggles the full notice in place -->
                <button type="button" class="lf-chip" (click)="toggle()" [attr.aria-expanded]="expanded()" data-testid="lf-chip">&#9878; Legal &amp; Attribution {{ expanded() ? '▾' : '▴' }}</button>
            }
            <a class="lf-legal" routerLink="/legal" data-testid="lf-legal">Legal &amp; Attribution</a>
        </div>
    `,
    styles: [`
        /* fixed, thin; pointer-events only on the links/chip so it never blocks the UI it sits over.
           COMPLIANCE-3: legible contrast (was #8b95a1 on translucent near-black) + a border-top so the bar
           reads as application chrome, not page furniture. */
        .lf { position:fixed; left:0; right:0; bottom:0; z-index:6; pointer-events:none; display:flex; gap:10px;
            align-items:baseline; justify-content:center; flex-wrap:wrap; padding:4px 10px calc(4px + env(safe-area-inset-bottom, 0px));
            background:rgba(8,10,13,.9); border-top:1px solid #33475c; backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
            font:11px/1.4 system-ui,Segoe UI,Roboto,sans-serif; color:#b9c4d2; }
        .lf-txt { max-width:1100px; text-align:center; }
        .lf a { pointer-events:auto; color:#aecdf0; text-decoration:none; }
        .lf a:hover, .lf a:focus-visible { text-decoration:underline; outline:none; }
        .lf-legal { pointer-events:auto; flex:0 0 auto; font-weight:700; color:#d7e3f2; white-space:nowrap; }
        /* IMPORT-7 Part A — narrow screens: a slim persistent CHIP (tap = expand/collapse the notice); never absent. */
        .lf.narrow { justify-content:flex-end; align-items:center; gap:8px; padding:4px 12px calc(4px + env(safe-area-inset-bottom, 0px)); }
        .lf.narrow.expanded { flex-direction:column; align-items:stretch; padding-top:8px; }
        .lf.narrow.expanded .lf-txt { text-align:left; padding:0 2px 6px; }
        .lf-chip { pointer-events:auto; border:1px solid #3d5a78; border-radius:999px; background:rgba(18,50,74,.9); color:#c9d6e6;
            font:700 11px/1 system-ui,Segoe UI,Roboto,sans-serif; padding:6px 10px; cursor:pointer; white-space:nowrap; }
        .lf-chip:hover, .lf-chip:focus-visible { background:#1d4a6e; outline:none; }
        .lf.narrow .lf-legal { font-size:10.5px; }
        /* COMPLIANCE-3 — INLINE mode: the same notice in-flow inside a surface's own panel chrome. The panels
           are parchment (field-dossier), so the inline instance uses the PANEL'S ink, not the dark bar's text. */
        .lf.inline { position:static; z-index:auto; background:transparent; backdrop-filter:none; -webkit-backdrop-filter:none;
            border-top:1px solid rgba(58,69,80,.4); margin-top:10px; padding:8px 2px 0; justify-content:flex-start;
            color:var(--ink, #2b3640); }
        .lf.inline .lf-txt { text-align:left; max-width:none; }
        .lf.inline a { color:var(--ink, #23303c); text-decoration:underline; }
        .lf.inline .lf-legal { color:var(--ink, #23303c); }
        /* an inline instance is mounted → the fixed root bar yields (stays in DOM so the height reserve publishes 0) */
        .lf.suppressed { display:none; }
    `],
})
export class LegalFooterComponent {
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    /** COMPLIANCE-3 — inline mode: render in-flow inside the mounting surface's panel chrome. */
    readonly inline = input(false);
    /** The fixed root bar hides while any inline instance is mounted (never two notices on one screen). */
    protected readonly suppressed = computed(() => !this.inline() && inlineMounts() > 0);
    /** narrow viewport → chip mode (collapsed by default). Inline instances always show the full text. */
    protected readonly narrow = signal(false);
    protected readonly expanded = signal(false);
    /** the full notice shows inline always, on wide screens always, and on narrow screens while expanded */
    protected readonly showText = computed(() => this.inline() || !this.narrow() || this.expanded());
    protected toggle(): void { this.expanded.update((v) => !v); }

    private bar: HTMLElement | null = null;
    /** Publish the FIXED bar's rendered height as --bce-footer-h (0 while suppressed/absent). Inline never publishes. */
    private publishHeight(): void {
        if (this.inline()) return;
        const h = this.bar && !this.suppressed() ? Math.ceil(this.bar.getBoundingClientRect().height) : 0;
        document.documentElement.style.setProperty(FOOTER_HEIGHT_VAR, `${h}px`);
    }

    constructor() {
        // COMPLIANCE-3 — suppression flips re-publish the reserved height (display:none → 0 and back).
        effect(() => { this.suppressed(); if (this.bar) this.publishHeight(); });
        afterNextRender(() => {
            // COMPLIANCE-3 — inline instances register so the fixed root bar can yield.
            if (this.inline()) {
                inlineMounts.update((n) => n + 1);
                this.destroyRef.onDestroy(() => inlineMounts.update((n) => n - 1));
                return; // no viewport/height machinery for in-flow instances
            }
            // viewport class
            try {
                const mq = window.matchMedia(NARROW_MQ);
                this.narrow.set(mq.matches);
                const onChange = (e: MediaQueryListEvent): void => { this.narrow.set(e.matches); if (!e.matches) this.expanded.set(false); };
                mq.addEventListener('change', onChange);
                this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
            } catch { /* no matchMedia (SSR/tests) → wide-screen bar */ }
            // reserved space: publish the rendered height as --bce-footer-h on <html> (styles.scss pads <body> by it)
            this.bar = this.host.nativeElement.querySelector('.lf') as HTMLElement | null;
            this.publishHeight();
            if (this.bar && typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(() => this.publishHeight());
                ro.observe(this.bar);
                this.destroyRef.onDestroy(() => { ro.disconnect(); document.documentElement.style.removeProperty(FOOTER_HEIGHT_VAR); });
            }
        });
    }
}
