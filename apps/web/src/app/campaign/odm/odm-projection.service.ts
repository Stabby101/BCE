import { Injectable, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { OdmFleetService } from './odm-fleet.service';
import { OdmRepairBaysService } from './odm-repair-bays.service';
import { OdmSupportService } from './odm-support.service';
import { OdmContactsService } from './odm-contacts.service';
import { fuelPct } from './odm-stocks';
import type { OdmProjection } from './odm-projection';

@Injectable({ providedIn: 'root' })
export class OdmProjectionService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly fleet = inject(OdmFleetService);
    private readonly bays = inject(OdmRepairBaysService);
    private readonly support = inject(OdmSupportService);
    private readonly contacts = inject(OdmContactsService);

    constructor() {
        void this.fleet.ensureLoaded();
        void this.support.ensureLoaded();
        void this.contacts.ensureLoaded();
        effect(() => {
            if (this.state.packId() !== 'odm') return;
            const next = this.build();
            const cur = this.state.odmProjection();
            // compare WITHOUT the timestamp — `at` is a staleness cue, not data; comparing it would loop
            const changed = JSON.stringify({ ...next, at: 0 }) !== JSON.stringify(cur ? { ...cur, at: 0 } : null);
            if (!changed) return;
            this.state.setOdmProjection(next);
            void this.store.persistCurrent();
        });
    }

    /** THE ENUMERATION (ruling 2 — this list must never quietly grow): pool hours · fleet lines ·
     *  support counts · contact display rows. Display strings only. */
    private build(): OdmProjection {
        const stocks = this.state.odmStocks();
        const pct = stocks ? fuelPct(stocks) : null;
        return {
            poolHours: [
                { pool: 'mac7', label: 'MAC-7 shop', committedPerDay: this.bays.committedHours(), perDay: this.bays.perDayHours() },
                { pool: 'field', label: 'Field techs', committedPerDay: 0, perDay: this.bays.fieldPoolHours() },
            ],
            fleet: (this.fleet.vessels() ?? []).map((v) => ({
                name: v.name,
                klass: v.class,
                status: v.status,
                fuelPct: v.type === 'DropShip' ? pct : null,
                kf: v.type === 'JumpShip' ? (v.lfBattery ? 'LF battery' : 'no LF battery') : null,
            })),
            support: this.support.rows().map((r) => ({ id: r.id, label: r.name, count: r.available })),
            contacts: (this.contacts.contacts() ?? []).map((c) => ({ name: c.name, rank: c.rank ?? null, status: c.status ?? null })),
            at: Date.now(),
        };
    }
}
