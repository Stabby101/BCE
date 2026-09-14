/*
 * DIRECTIVE-ODM-17 P4-d — THE SUPPORT REGISTER client. packs/odm/support.json is the seed (the original's
 * battlefield_support, canonical coded rows); LIVE available/deployed/expended is the odmSupport overlay
 * (campaign state — a pack is never a system of record for live counts). COUPLINGS ARE DATA read
 * generically: any asset may carry `coupling { pool, operationalDelta, lostDelta, … }` (RELATIVE by
 * ruling — offsets around the derived pool, never absolutes) — the wrecker
 * (ENG-01) proves the seam; nothing else is hand-wired. An asset is LOST when its live available is 0 and
 * expended > 0 (a thing that existed and was destroyed) — deployed is not lost, it is out working.
 * Server-served, in-memory, C6-cleared. Floors breach in ODM-11 style (below floorMinimum = BREACH).
 */
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

    /** ODM-17 P4-d — the generic pool coupling, RELATIVE by ruling (offsets around the DERIVED pool —
     *  an absolute rots the moment headcount moves): an operational coupled asset adds its
     *  operationalDelta; a LOST one adds its lostDelta. The wrecker: +20 operational / −20 lost
     *  (116 / 76 at today's 96). */
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
