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
    // boot must not leave the "still loading" panel behind).
    constructor() { afterNextRender(() => clearBootFallback()); }
}
