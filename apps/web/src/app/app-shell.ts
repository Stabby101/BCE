/*
 * BCE retool — application shell. DIRECTIVE-003.
 * Thin router host bootstrapped in place of App: the cover is the default entry
 * ('') and MekBay's App is the '/app' route. Lets a cover sit in front of MekBay
 * without touching MekBay-proper (App keeps its code, template and styles).
 */
import { Component, ChangeDetectionStrategy, afterNextRender } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UpdateBannerComponent } from './shared/update-banner';
import { LegalFooterComponent } from './shared/legal-footer'; // COMPLIANCE-1 — persistent legal footer (every route)
import { clearBootFallback } from './shared/boot-fallback';

@Component({
    selector: 'app-root',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterOutlet, UpdateBannerComponent, LegalFooterComponent],
    template: '<router-outlet></router-outlet><bce-update-banner /><bce-legal-footer />',
})
export class AppShell {
    // HOTFIX-028 — the player app painted: dismiss the index.html boot-watchdog fallback (a slow-but-successful
    // boot must not leave the "still loading" panel behind).
    constructor() { afterNextRender(() => clearBootFallback()); }
}
