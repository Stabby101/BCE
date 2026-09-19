import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'bce-shutdown',
    standalone: true,
    host: { class: 'theme-dossier' },
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="sheet">
            <div class="classbar">Battletech Campaign Engine · Host Operations Console · Session Terminated</div>
            <div class="body">
                <div class="big">SESSION ENDED</div>
                <p class="lead">The host operations console has powered down. Your campaign is saved.</p>
                <div class="status">
                    <div><span class="dot off" aria-hidden="true"></span><span class="k">HOST</span> OFFLINE</div>
                    <div><span class="dot off" aria-hidden="true"></span><span class="k">ENGINE</span> OFFLINE</div>
                </div>
                <p class="safe">It is safe to close this window.</p>
                <button type="button" class="relaunch" (click)="relaunch()">&lsaquo; Relaunch console</button>
            </div>
            <footer class="meta">BCE v0.1 · host-authoritative · saved campaign preserved (Relaunch → 02 LOAD A CAMPAIGN)</footer>
        </main>
    `,
    styles: `
        :host { display: flex; align-items: center; justify-content: center; min-height: 100dvh; width: 100%; padding: 28px; box-sizing: border-box; color: var(--ink); font-family: var(--type); background: var(--desk);
            background-image: repeating-linear-gradient(90deg, transparent 0 38px, rgba(0,0,0,.18) 38px 39px), repeating-linear-gradient(0deg, transparent 0 38px, rgba(0,0,0,.18) 38px 39px); }
        * { box-sizing: border-box; }
        .sheet { position: relative; width: 100%; max-width: 680px; background: var(--paper); border: 2px solid var(--ink);
            background-image: repeating-linear-gradient(0deg, transparent 0 23px, rgba(70,58,28,.06) 23px 24px); }
        .classbar { background: var(--ink); color: var(--paper); font-family: var(--mono); font-size: 10px; letter-spacing: 2px; text-align: center; padding: 6px; text-transform: uppercase; }
        .body { padding: 32px 28px; text-align: center; }
        .big { font-family: var(--stencil); font-size: 30px; letter-spacing: 2px; color: var(--stamp); line-height: 1; }
        .lead { font-family: var(--type); font-size: 14px; color: var(--ink2); margin: 12px 0 20px; }
        .status { display: inline-flex; flex-direction: column; gap: 7px; border: 1.5px solid var(--ink); background: var(--paper2); padding: 12px 20px; font-family: var(--mono); font-size: 13px; align-items: flex-start; }
        .status .k { color: var(--ink2); }
        .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; vertical-align: 0; background: var(--stamp); box-shadow: inset 0 0 0 1px rgba(0,0,0,.4); }
        .safe { font-family: var(--mono); font-size: 12px; color: var(--ink2); margin: 20px 0 0; letter-spacing: 1px; }
        .relaunch { font-family: var(--label); font-weight: 600; letter-spacing: 2px; font-size: 13px; text-transform: uppercase; border: 1.6px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 11px 18px; cursor: pointer; margin-top: 22px; min-height: 44px; }
        .relaunch:hover, .relaunch:focus-visible { background: var(--ink); color: var(--paper); outline: none; }
        .meta { font-family: var(--mono); font-size: 10px; color: var(--ink2); border-top: 2px solid var(--ink); padding: 10px 28px; text-align: center; }
    `,
})
export class ShutdownComponent {
    private readonly router = inject(Router);

    constructor() {
        // Attempt to close the window. Browsers honor window.close() only for
        // script-opened windows; otherwise this OFFLINE screen stands as the terminal state.
        setTimeout(() => {
            try {
                window.close();
            } catch {
                /* blocked — the shutdown screen stands */
            }
        }, 60);
    }

    protected relaunch(): void {
        void this.router.navigate(['/']);
    }
}
