import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { UnitIconComponent } from '../../components/unit-icon/unit-icon.component';
import { MechSilhouetteComponent } from './mech-silhouette';
import { SpriteResolverService, type SpriteSubject } from './sprite-resolver.service';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';

@Component({
    selector: 'bce-unit-sprite',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UnitIconComponent, MechSilhouetteComponent],
    template: `
        @if (iconKey()) {
            <unit-icon [unit]="patched()" [size]="size()" [styleClass]="styleClass()"></unit-icon>
        } @else {
            <bce-mech-silhouette [wc]="wc()" [size]="size()"></bce-mech-silhouette>
        }
    `,
    styles: [`:host { display: inline-flex; }`],
})
export class BceUnitSpriteComponent {
    private readonly resolver = inject(SpriteResolverService);

    /** a full Unit, or a {icon, chassis, model, weightClass, tons} subset (e.g. an OpFor row). */
    unit = input<SpriteSubject | Unit | null | undefined>(null);
    size = input<number>(56);
    styleClass = input<string>('');

    private readonly res = computed(() => {
        this.resolver.ready();                               // re-resolve once the manifest indexes finish
        return this.resolver.resolve((this.unit() as SpriteSubject) ?? {});
    });
    protected readonly iconKey = computed(() => this.res().iconKey);
    protected readonly wc = computed(() => this.res().wc);
    /** unit-icon reads only .icon/.chassis/.model — a shallow clone with the resolved key is enough. */
    protected readonly patched = computed<Unit | null>(() => {
        const u = this.unit();
        const key = this.iconKey();
        return key ? ({ ...(u as object), icon: key } as Unit) : null;
    });
}
