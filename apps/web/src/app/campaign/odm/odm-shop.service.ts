/*
 * DIRECTIVE-ODM-17 P1 — the SHOP client. packs/odm/shop.json is facility truth: the authored pool
 * identity (MAC-7 Station — MacCready's, per the doctrine; never the Forge's rolled syllable names)
 * and the two D39 pools whose hours are DERIVED (headcount × hoursPerTechDay — the frozen-numbers
 * law; no stored totals). Server-served, in-memory only, cleared on pack switch (the C6 residue rule);
 * null-tolerant — an unloaded shop renders honest placeholders and the burn driver waits for it.
 */
import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { OdmSupportService } from './odm-support.service'; // ODM-17 P4-d — the register's pool couplings (the wrecker)

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
    private inflight: Promise<void> | null = null;

    constructor() {
        effect(() => { if (this.state.packId() !== 'odm') this.clear(); }); // the C6 rule — pack data never outlives its campaign
    }

    ensureLoaded(): Promise<void> {
        void this.support.ensureLoaded(); // ODM-17 P4-d — the register rides with the shop (couplings need it)
        if (this.shop()) return Promise.resolve();
        if (this.inflight) return this.inflight;
        this.inflight = firstValueFrom(this.http.get<OdmShopFile>(`${this.base()}/pack/odm/file/shop.json`, { withCredentials: true }))
            .then((f) => { if (f?.pools?.length) this.shop.set(f); })
            .catch(() => { /* not entitled / offline — honest nulls; the bays wait */ })
            .then(() => { this.inflight = null; });
        return this.inflight;
    }

    clear(): void { this.shop.set(null); this.inflight = null; }

    private readonly support = inject(OdmSupportService);

    /** Pool hours/day, DERIVED — headcount × hoursPerTechDay. Null shop → null (callers wait, never guess).
     *  ODM-17 P4-d — the SINGLE choke point for equipment→hours couplings: the support register's pool
     *  modifiers apply here, so EVERY poolHours consumer (the walk's extraction window, the bay burn, the
     *  renders) sees the coupled truth. The wrecker: operational → field +20; LOST → −20 (RELATIVE by
     *  ruling — offsets ride the derived base). The null-until-loaded contract is preserved — an unloaded REGISTER applies no
     *  modifier (base derivation), an unloaded SHOP still returns null (the walk waits on the shop alone). */
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
