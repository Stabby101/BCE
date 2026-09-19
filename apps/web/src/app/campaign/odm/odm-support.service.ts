import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState, type OdmSupportCounts } from '../new-campaign-state';

export interface OdmSupportAsset {
    id: string; name: string; category: string;
    total: number; available: number; deployed: number; expended: number; // pack SEED counts
    authLevel: string; floorMinimum: number; status: string;
    dependency: string | null; resupplyPath: string | null; notes: string | null;
    coupling?: { pool: string; operationalDelta?: number; lostDelta?: number; redTriageRecoveryDoubles?: boolean };
}
export interface OdmUnsalvageable { item: string; reason: string }
interface OdmSupportFile { packId: string; version: number; assets: OdmSupportAsset[]; unsalvageable?: OdmUnsalvageable[] }

/** A register row with the LIVE counts applied (overlay wins where set; else the pack seed). */
export interface OdmSupportRow extends OdmSupportAsset {
    live: OdmSupportCounts;
    lost: boolean;      // available 0 AND expended > 0 — destroyed, not merely out working
    breach: boolean;    // live available below the authored floor
}

@Injectable({ providedIn: 'root' })
export class OdmSupportService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    readonly file = signal<OdmSupportFile | null>(null);
    private inflight: Promise<void> | null = null;

    constructor() {
        effect(() => { if (this.state.packId() !== 'odm') this.clear(); }); // the C6 rule
    }

    ensureLoaded(): Promise<void> {
        if (this.file()) return Promise.resolve();
        if (this.inflight) return this.inflight;
        this.inflight = firstValueFrom(this.http.get<OdmSupportFile>(`${this.base()}/pack/odm/file/support.json`, { withCredentials: true }))
            .then((f) => { if (f?.assets?.length) this.file.set(f); })
            .catch(() => { /* honest nulls — unentitled/offline; couplings simply don't apply */ })
            .then(() => { this.inflight = null; });
        return this.inflight;
    }
    clear(): void { this.file.set(null); this.inflight = null; }

    readonly unsalvageable = computed<OdmUnsalvageable[]>(() => this.file()?.unsalvageable ?? []);

    /** The register, live: overlay counts win where set; floors and LOST derive per row. */
    readonly rows = computed<OdmSupportRow[]>(() => {
        const f = this.file();
        if (!f) return [];
        const over = this.state.odmSupport();
        return f.assets.map((a) => {
            const live = over[a.id] ?? { available: a.available, deployed: a.deployed, expended: a.expended };
            return { ...a, live, lost: live.available <= 0 && live.expended > 0, breach: live.available < a.floorMinimum };
        });
    });

    poolModifier(pool: string): number {
        let delta = 0;
        for (const r of this.rows()) {
            if (r.coupling?.pool !== pool) continue;
            if (r.lost) delta += r.coupling.lostDelta ?? 0;
            else if (r.live.available > 0 && r.coupling.operationalDelta) delta += r.coupling.operationalDelta;
        }
        return delta;
    }
    /** The wrecker's RED-triage penalty (doctrine: recovery time doubles while it is lost). */
    readonly redRecoveryDoubled = computed(() => this.rows().some((r) => r.coupling?.redTriageRecoveryDoubles && r.lost));

    /** GM steppers — deploy / return / expend / recover-one (clamped; overlay-persisted by the caller). */
    adjust(id: string, patch: Partial<OdmSupportCounts>): void {
        const row = this.rows().find((r) => r.id === id);
        if (!row) return;
        const next: OdmSupportCounts = {
            available: Math.max(0, patch.available ?? row.live.available),
            deployed: Math.max(0, patch.deployed ?? row.live.deployed),
            expended: Math.max(0, patch.expended ?? row.live.expended),
        };
        this.state.odmSupport.set({ ...this.state.odmSupport(), [id]: next });
    }
}
