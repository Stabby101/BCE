import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { BattleForceService, type Side } from '../battle/battle-force.service';
import { BattleSheetComponent } from '../battle/battle-sheet';
import { InViewDirective } from '../dashboard/roster/in-view.directive';

@Component({
    selector: 'bce-odm-battle-view',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BattleSheetComponent, InViewDirective],
    providers: [BattleForceService],
    templateUrl: './odm-battle-view.html',
    styleUrl: '../battle/battle-view.scss' /* SHARED */,
})
export class OdmBattleViewComponent {
    private readonly svc = inject(BattleForceService);
    private readonly state = inject(NewCampaignState);
    protected readonly blufor = this.svc.bluforEntries;
    protected readonly opfor = this.svc.opforEntries;
    protected readonly hasMission = this.svc.hasMission;
    protected readonly ready = this.svc.ready;
    protected readonly dataError = this.svc.dataError;
    protected readonly nothingDeployed = computed(() => this.ready() && this.blufor().length === 0 && this.opfor().length === 0);
    protected readonly skirmish = computed(() => this.ready() && !this.hasMission() && this.blufor().length > 0);
    protected readonly operationName = computed(() => this.state.missionSpec()?.typeName ?? null);
    protected readonly isComposed = computed(() => {
        const id = this.state.odmActiveNodeId();
        return !!id && this.state.odmGmMissions().some((m) => m.id === id);
    });

    constructor() {
        void this.svc.build();
    }

    protected load(side: Side, id: string): void {
        void this.svc.ensureSheet(side, id);
    }
}
