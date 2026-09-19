import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { OdmSupportService } from './odm-support.service';

export interface OdmShopPool { id: string; name: string; headcount: number; role: string }
export interface OdmShopFile {
    packId: string; version: number;
    facility: { name: string; location: string; chief: string; character: string };
    hoursPerTechDay: number;
    pools: OdmShopPool[];
}

@Injectable({ providedIn: 'root' })
export class OdmShopService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    readonly shop = signal<OdmShopFile | null>(null);
    /** P8 — a failed fetch is SAID: "shop.json 403" / "shop.json 0" (network) / "shop.json empty". */
    readonly loadError = signal<string | null>(null);
    private inflight: Promise<void> | null = null;

    constructor() {
        effect(() => { if (this.state.packId() !== 'odm') this.clear(); }); // the C6 rule — pack data never outlives its campaign
    }

    ensureLoaded(): Promise<void> {
        void this.support.ensureLoaded();
        if (this.shop()) return Promise.resolve();
        if (this.inflight) return this.inflight;
        this.loadError.set(null);
        this.inflight = firstValueFrom(this.http.get<OdmShopFile>(`${this.base()}/pack/odm/file/shop.json`, { withCredentials: true }))
            .then((f) => { if (f?.pools?.length) this.shop.set(f); else this.loadError.set('shop.json empty'); })
            .catch((e: unknown) => { this.loadError.set(`shop.json ${(e as { status?: number })?.status ?? 0}`); }) // not entitled / offline — honest nulls; the bays wait; P8: and SAYS why
            .then(() => { this.inflight = null; });
        return this.inflight;
    }
    /** P8 — the walk's Retry: a fresh fetch after a failure (a no-op while loaded or in flight). */
    retry(): Promise<void> { if (this.shop() || this.inflight) return this.ensureLoaded(); this.loadError.set(null); return this.ensureLoaded(); }

    clear(): void { this.shop.set(null); this.inflight = null; }

    private readonly support = inject(OdmSupportService);

    readonly hoursPerDay = computed<Record<string, number> | null>(() => {
        const s = this.shop();
        if (!s) return null;
        const out = Object.fromEntries(s.pools.map((p) => [p.id, p.headcount * s.hoursPerTechDay]));
        for (const id of Object.keys(out)) {
            out[id] = Math.max(0, out[id] + this.support.poolModifier(id)); // relative by ruling — offsets ride the derived base
        }
        return out;
    });
    poolHours(id: string): number | null { return this.hoursPerDay()?.[id] ?? null; }
}
