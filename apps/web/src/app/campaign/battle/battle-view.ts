/*
 * BCE — the MEKBAY tab = the BATTLE VIEW (DIRECTIVE-030). Two allegiance-separated sections: the
 * DEPLOYED BLUFOR (deployedSet) + the active mission's OPFOR, both on MekBay's own editable Classic
 * sheets. Sheets load lazily per viewport (bceInView, T-020). No mission -> deployed-only skirmish;
 * nothing deployed -> empty state. GM-facing this slice (ROLE-002 / player view = T-030). BCE chrome
 * on theme tokens; MekBay's sheet UI inside is MekBay's. Height-safe (the dashboard panel owns scroll).
 */
import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { BattleForceService, type Side } from './battle-force.service';
import { BattleSheetComponent } from './battle-sheet';
import { InViewDirective } from '../dashboard/roster/in-view.directive';

@Component({
    selector: 'bce-battle-view',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BattleSheetComponent, InViewDirective],
    providers: [BattleForceService],
    templateUrl: './battle-view.html',
    styleUrl: './battle-view.scss',
})
export class BattleViewComponent {
    private readonly svc = inject(BattleForceService);
    protected readonly blufor = this.svc.bluforEntries;
    protected readonly opfor = this.svc.opforEntries;
    protected readonly hasMission = this.svc.hasMission;
    protected readonly ready = this.svc.ready;
    protected readonly dataError = this.svc.dataError;
    protected readonly nothingDeployed = computed(() => this.ready() && this.blufor().length === 0 && this.opfor().length === 0);
    protected readonly skirmish = computed(() => this.ready() && !this.hasMission() && this.blufor().length > 0);

    constructor() {
        void this.svc.build();
    }

    protected load(side: Side, id: string): void {
        void this.svc.ensureSheet(side, id);
    }
}
