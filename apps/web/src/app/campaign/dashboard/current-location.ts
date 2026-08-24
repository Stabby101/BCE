/*
 * BCE — the Overview CURRENT-LOCATION line + the minimal GM location setter (DIRECTIVE-079 — Star Map Phase 1:
 * system · owner(era) · derived locale descriptor; the full map / jump-travel UI is D-081). Extracted verbatim
 * from the dashboard god file by DIRECTIVE-HARDEN-2 (pure move — markup, styles, and logic byte-identical).
 */
import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { StarSystemsService } from '../star/star-systems.service';

@Component({
    selector: 'bce-current-location',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (locationSystem(); as ls) {
            <div class="loc" data-testid="overview-location">
                <span class="loc-l">Current location</span>
                <span class="loc-v" data-testid="location-line">{{ ls.name }} &middot; {{ locationOwner() }} ({{ locationEraName() }}) &middot; {{ locationDescriptor() }}</span>
                <label class="loc-set no-print">GM
                    <select class="loc-sel" (change)="onLocationChange($event)" data-testid="location-set">
                        @for (s of allSystems(); track s.id) {
                            <option [value]="s.id" [selected]="s.id === currentLocationId()">{{ s.name }}</option>
                        }
                    </select>
                </label>
            </div>
        }
    `,
    styles: [`
        :host { display:block; } /* layout insurance: the host must be a block like the markup it replaced */
        .loc { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:12px 0 0; padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:var(--panel2,rgba(255,255,255,.02)); }
        .loc-l { font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink2); }
        .loc-v { font-family:var(--type); font-size:13px; font-weight:600; color:var(--ink); }
        .loc-set { margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--ink2); display:flex; align-items:center; gap:6px; }
        .loc-sel { font-family:var(--type); font-size:12px; padding:2px 6px; background:var(--panel,#1a1a1a); color:var(--ink); border:1px solid var(--line); border-radius:4px; max-width:220px; }
    `],
})
export class CurrentLocationComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly star = inject(StarSystemsService); // D-079 — Star Map systems (lazy chunk)

    protected readonly currentLocationId = computed(() => this.state.currentLocation());
    protected readonly locationSystem = computed(() => { this.star.ready(); return this.star.byId(this.state.currentLocation()); });
    protected readonly locationEraId = computed(() => this.state.era()?.id ?? 5);
    protected readonly locationEraName = computed(() => this.state.era()?.name ?? '');
    protected readonly locationOwner = computed(() => this.star.ownerAt(this.locationSystem(), this.locationEraId()));
    protected readonly locationDescriptor = computed(() => this.star.descriptor(this.locationSystem(), this.locationEraId()));
    protected readonly allSystems = computed(() => { this.star.ready(); return [...this.star.systems()].sort((a, b) => a.name.localeCompare(b.name)); });
    /** GM-change the current location (persisted so it survives reload). */
    protected onLocationChange(e: Event): void {
        const id = (e.target as HTMLSelectElement).value;
        if (!id) return;
        this.state.setCurrentLocation(id);
        void this.store.persistCurrent();
    }
}
