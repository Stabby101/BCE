/*
 * BCE Inventory II (DIRECTIVE-056) — read-only client for the D-055 catalog API (/api/catalog).
 * Mirrors CampaignSaveStore's engine base()+HttpClient+timeout pattern. Era-legality is server-side
 * (availableInEra): pass era= and the server returns only era-legal rows — no client-side re-gating.
 * Engine-offline → returns []/null (the Begin roll degrades to ammo+armor; the tab shows what it has).
 */
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import type { CatalogItem } from '../inventory/starting-inventory';

const ENGINE_URL_KEY = 'bce.engine.url';
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api';
const TIMEOUT_MS = 6000;

@Injectable({ providedIn: 'root' })
export class CatalogClientService {
    private readonly http = inject(HttpClient);
    /** last call reached the host (UI-advisory; the catalog isn't campaign state). */
    readonly reachable = signal(true);

    private base(): string {
        return localStorage.getItem(ENGINE_URL_KEY) || DEFAULT_ENGINE_URL;
    }

    /** Era-legal, optionally category/techBase-filtered catalog rows (server pre-filters via availableInEra). */
    async list(opts: { era?: number; category?: string; techBase?: string } = {}): Promise<CatalogItem[]> {
        const q = new URLSearchParams();
        if (opts.era != null && Number.isFinite(opts.era)) q.set('era', String(opts.era));
        if (opts.category) q.set('category', opts.category);
        if (opts.techBase) q.set('techBase', opts.techBase);
        const qs = q.toString();
        const url = `${this.base()}/catalog${qs ? '?' + qs : ''}`;
        try {
            const rows = await firstValueFrom(this.http.get<CatalogItem[]>(url).pipe(timeout(TIMEOUT_MS)));
            this.reachable.set(true);
            return rows ?? [];
        } catch {
            this.reachable.set(false);
            return [];
        }
    }

    async get(id: string): Promise<CatalogItem | null> {
        try {
            const row = await firstValueFrom(this.http.get<CatalogItem>(`${this.base()}/catalog/${encodeURIComponent(id)}`).pipe(timeout(TIMEOUT_MS)));
            this.reachable.set(true);
            return row ?? null;
        } catch {
            this.reachable.set(false);
            return null;
        }
    }
}
