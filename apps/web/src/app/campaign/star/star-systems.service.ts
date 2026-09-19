import { Injectable, signal } from '@angular/core';
import { ERA_3025_BASELINE, type StarSystem, type SystemsPack } from './star-types';

@Injectable({ providedIn: 'root' })
export class StarSystemsService {
    private cache: StarSystem[] | null = null;
    private loading: Promise<void> | null = null;
    /** Flips true once the pack is resolved — lets signal-based views (Overview) re-render after lazy load. */
    readonly ready = signal(false);

    ensureLoaded(): Promise<void> {
        if (this.cache) return Promise.resolve();
        if (!this.loading) this.loading = this.load();
        return this.loading;
    }
    isLoaded(): boolean {
        return this.cache !== null;
    }
    private async load(): Promise<void> {
        try {
            const m = await import('./systems.json');
            const pack = (m as { default: SystemsPack }).default;
            this.cache = Array.isArray(pack?.systems) ? pack.systems : [];
        } catch {
            this.cache = []; // pack unavailable -> empty; callers degrade (no location line) rather than throw.
        }
        this.ready.set(true);
    }

    systems(): StarSystem[] {
        return this.cache ?? [];
    }
    byId(id: string | null | undefined): StarSystem | undefined {
        return id ? this.systems().find((s) => s.id === id) : undefined;
    }

    ownerAt(sys: StarSystem | undefined, eraId: number | string | null | undefined): string {
        if (!sys) return 'Unknown';
        const exact = sys.ownerByEra[String(eraId ?? '')];
        if (exact) return exact;
        const target = Number(eraId);
        const keys = Object.keys(sys.ownerByEra).map(Number).filter((n) => !Number.isNaN(n));
        if (keys.length && !Number.isNaN(target)) {
            keys.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
            return sys.ownerByEra[String(keys[0])];
        }
        return sys.ownerByEra[String(ERA_3025_BASELINE)] ?? Object.values(sys.ownerByEra)[0] ?? 'Unknown';
    }

    /** A read-only one-line descriptor (owner + derived locale) for the Overview. */
    descriptor(sys: StarSystem | undefined, eraId?: number | string | null): string {
        if (!sys) return '';
        const { settlement, regionRole } = sys.localeAttrs;
        if (settlement === 'capital') return `${this.ownerAt(sys, eraId)} capital world`;
        return `${regionRole} ${settlement} world`;
    }

    // each owns sits within BORDER_LY light-years of the other's (euclidean over x/y). The same ownerByEra
    // territory the localizer uses, lifted to the FACTION level to gate plausible contract matchups. Empty
    // until the pack loads (callers degrade to the old any-non-employer target). Names are the catalog vocab.
    private static readonly BORDER_LY = 60;
    private readonly adjCache = new Map<number, Record<string, string[]>>();
    factionAdjacency(eraId: number): Record<string, string[]> {
        const cached = this.adjCache.get(eraId);
        if (cached) return cached;
        const sys = this.systems();
        const R = StarSystemsService.BORDER_LY;
        const adj: Record<string, Set<string>> = {};
        for (let i = 0; i < sys.length; i++) {
            const oi = this.ownerAt(sys[i], eraId);
            if (!oi || oi === 'Unknown') continue;
            for (let j = i + 1; j < sys.length; j++) {
                const oj = this.ownerAt(sys[j], eraId);
                if (!oj || oj === 'Unknown' || oj === oi) continue;
                if (Math.hypot(sys[i].x - sys[j].x, sys[i].y - sys[j].y) <= R) {
                    (adj[oi] ??= new Set()).add(oj);
                    (adj[oj] ??= new Set()).add(oi);
                }
            }
        }
        const out: Record<string, string[]> = {};
        for (const k of Object.keys(adj)) out[k] = [...adj[k]];
        if (this.isLoaded()) this.adjCache.set(eraId, out); // only cache once the pack is real (don't pin an empty pre-load result)
        return out;
    }

    /** Systems within jumpLy light-years of the given system (euclidean over x/y), nearest first, self excluded. */
    systemsInRange(systemId: string | null | undefined, jumpLy = 30): StarSystem[] {
        const origin = this.byId(systemId);
        if (!origin) return [];
        return this.systems()
            .filter((s) => s.id !== origin.id)
            .map((s) => ({ s, d: Math.hypot(s.x - origin.x, s.y - origin.y) }))
            .filter((o) => o.d <= jumpLy)
            .sort((a, b) => a.d - b.d)
            .map((o) => o.s);
    }
}
