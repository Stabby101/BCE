/*
 * FORKED FROM campaign/battle/battle-view.ts @ 1ab399b — DIRECTIVE-ODM-9 Part C (a DRIFT SURFACE).
 * Divergences: the OPFOR empty-state copy (Classic's advice is wrong in ODM; DOCTRINE §7b) + the ODM-10
 * header chip naming the ACTIVE OPERATION (the ODM-9 verify promised the Force Preview names it).
 */
import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state'; // ODM-10 — the operation-name chip reads the carrier
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
    private readonly state = inject(NewCampaignState); // ODM-10
    protected readonly blufor = this.svc.bluforEntries;
    protected readonly opfor = this.svc.opforEntries;
    protected readonly hasMission = this.svc.hasMission;
    protected readonly ready = this.svc.ready;
    protected readonly dataError = this.svc.dataError;
    protected readonly nothingDeployed = computed(() => this.ready() && this.blufor().length === 0 && this.opfor().length === 0);
    protected readonly skirmish = computed(() => this.ready() && !this.hasMission() && this.blufor().length > 0);
    /** ODM-10 — the header names the operation (the ODM-9 carrier's typeName = the authored title). */
    protected readonly operationName = computed(() => this.state.missionSpec()?.typeName ?? null);

    constructor() {
        void this.svc.build();
    }

    protected load(side: Side, id: string): void {
        void this.svc.ensureSheet(side, id);
    }
}
