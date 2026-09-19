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
