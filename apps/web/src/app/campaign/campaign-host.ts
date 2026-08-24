/*
 * DIRECTIVE-ODM-1 Phase 1 — the /campaign SHELL HOST (the ruled minimal-shared-touch routing). Reads the
 * additive packId and mounts the matching container: 'odm' -> the fenced odm fork (<bce-odm-dashboard>),
 * else the untouched Classic/HS dashboard. Classic files are NOT edited; no branch-pinned file gains a
 * branch (packId is a new axis, not a campaignSystem value). This file is the ONLY shared routing touch.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { NewCampaignState } from './new-campaign-state';
import { CampaignDashboardComponent } from './dashboard/dashboard';
import { OdmDashboardComponent } from './odm/odm-dashboard';

@Component({
    selector: 'bce-campaign-host',
    standalone: true,
    imports: [CampaignDashboardComponent, OdmDashboardComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (state.packId() === 'odm') { <bce-odm-dashboard /> } @else { <bce-campaign-dashboard /> }
    `,
})
export class CampaignHostComponent {
    protected readonly state = inject(NewCampaignState);
}
