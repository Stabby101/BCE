/*
 * BCE retool — New Campaign, step 1: select era (field-dossier). DIRECTIVE-003.
 * Static-fallback era list: MekBay's live era feed needs unit data (mm-data,
 * T-006) absent from this build, so these are the 12 canonical eras + placeholder
 * sigils per the directive's fallback clause.
 */
import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { NewCampaignState } from '../new-campaign-state';
import { type EraCard, type SigilKey, ERAS, toCampaignEra } from './eras';

const SIGILS: Record<SigilKey, string> = {
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.2 7.2L21 9l-5.6 3.4L17 20l-5-4.2L7 20l1.6-7.6L3 9l6.8-.8z"/></svg>',
    tower: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l3 5h-6z"/><rect x="9.2" y="6" width="5.6" height="15"/><path d="M5 21h14v1.4H5z"/><path d="M7.2 9.5l-2 1.2v-2.4zM16.8 9.5l2 1.2v-2.4z"/></svg>',
    fist: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="10" width="12" height="9" rx="1.2"/><rect x="6.4" y="7.2" width="2.3" height="3.2"/><rect x="9.4" y="6.2" width="2.3" height="4.2"/><rect x="12.4" y="6.6" width="2.3" height="3.8"/><rect x="15.4" y="7.6" width="2.3" height="2.8"/></svg>',
    sword: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9.2"/><path d="M6 18L18 6M15 5l4 4-2 2"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="8" rx="8.4" ry="4.2"/><path d="M10.4 11h3.2l1.4 9h-6z"/></svg>',
    wreath: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3.5a10 10 0 000 17M15 3.5a10 10 0 010 17"/><path d="M12 8.5l1.1 2.4 1.6.2-1.2 1.4.3 2.4-1.8-1-1.8 1 .3-2.4-1.2-1.4 1.6-.2z" fill="currentColor" stroke="none"/></svg>',
};

@Component({
    selector: 'bce-era',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './era.html',
    styleUrl: './era.scss',
})
export class EraComponent {
    private readonly router = inject(Router);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly state = inject(NewCampaignState);

    protected readonly eras = ERAS;
    // D-108 — the game-system choice moved to the Campaign Setup card (the new first step); state.gameSystem
    // is unchanged and still drives everything downstream (unit-card swap, Star Map mount).
    // Restore the previously-chosen era (e.g. Back from step 2), else default.
    protected readonly selected = signal<EraCard>(
        ERAS.find((e) => e.id === this.state.era()?.id) ?? ERAS[5],
    );

    constructor() {
        // Seed the wizard state so Proceed always carries an era.
        this.state.setEra(toCampaignEra(this.selected()));
    }

    // SVG sigils are static literals → safe to trust; precompute so we don't re-sanitize per CD.
    protected readonly sigilSafe: Record<SigilKey, SafeHtml> = {
        star: this.sanitizer.bypassSecurityTrustHtml(SIGILS.star),
        tower: this.sanitizer.bypassSecurityTrustHtml(SIGILS.tower),
        fist: this.sanitizer.bypassSecurityTrustHtml(SIGILS.fist),
        sword: this.sanitizer.bypassSecurityTrustHtml(SIGILS.sword),
        cloud: this.sanitizer.bypassSecurityTrustHtml(SIGILS.cloud),
        wreath: this.sanitizer.bypassSecurityTrustHtml(SIGILS.wreath),
    };

    protected yr(e: EraCard): string {
        return `${e.from}–${e.to >= 9999 ? 'present' : e.to}`;
    }

    protected select(e: EraCard): void {
        this.selected.set(e);
        this.state.setEra(toCampaignEra(e));
    }

    /** Back → the Setup card (D-108 — the new step immediately before Era; was cover when Era was step 1). */
    protected back(): void {
        void this.router.navigate(['/campaign/new/setup']);
    }

    /** Proceed → the next step. D-113 — a FULL Hot Spots campaign (not Quick Mission) forks to the Mercenary
     *  Command step instead of the Traditional date-force tail; Traditional + Quick Mission keep date-force. */
    protected proceed(): void {
        this.state.setEra(toCampaignEra(this.selected()));
        const hotspots = this.state.campaignSystem() === 'hotspots' && !this.state.quickMission();
        void this.router.navigate([hotspots ? '/campaign/new/merc-command' : '/campaign/new/date-force']);
    }
}
