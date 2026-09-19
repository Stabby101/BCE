import { Injectable, signal } from '@angular/core';

/** The world-facts.json per-system shape (HSFORGE-1b) — the subset the gazetteer renders. Declared HERE (not imported
 *  from chaos/forge/hs-forge-data) so platform star/ never imports engine code — the JSON is the shared contract. */
export interface WorldFacts {
    starType?: string; position?: number; gravity?: number; pressure?: string; tempC?: number; waterPct?: number;
    lifeForm?: string; landmasses?: string[]; capitalCity?: string; satellites?: string[]; rechargeHours?: number;
    popByEra?: Record<string, number>; socioByEra?: Record<string, string>; hpgByEra?: Record<string, string>; stationByEra?: Record<string, string>;
}

/** One history fact row (the Phase 1 pack schema — see world-history.json _meta.fields). */
export interface WorldEvent {
    systemId: string;
    year: number;
    endYear?: number;
    eraId: number;
    kind: 'battle' | 'raid' | 'change-of-hands' | 'founding' | 'event';
    name: string;
    planet?: string;
    participants: string[];
    from?: string[];
    to?: string[];
    commanders?: string[];
    commands?: string[];
    partOf?: string;
    confidence: 'high' | 'medium';
    source: string;
    sarnaUrl: string;
    cited: boolean;
}

/** The viewed era's rows (start-year filing — multi-year events belong to their start era). Pure, spec-pinned. */
export function eventsForEra(events: readonly WorldEvent[], eraId: number): WorldEvent[] {
    return events.filter((e) => e.eraId === eraId);
}
/** Sparse era-keyed map (popByEra/hpgByEra…): the value at the NEAREST era ≤ the viewed one, else null. Pure, spec-pinned. */
export function sparseEraValue<T>(map: Record<string, T> | undefined, eraId: number): T | null {
    if (!map) return null;
    for (let e = eraId; e >= 1; e--) { const v = map[String(e)]; if (v !== undefined) return v; }
    return null;
}
/** A change-of-hands row's display label: "A/B → C" (the generic name is dull; the transition is the fact). Pure, spec-pinned. */
export function changeLabel(ev: WorldEvent): string {
    if (ev.kind !== 'change-of-hands' || !ev.from?.length || !ev.to?.length) return ev.name;
    return `${ev.from.join(' / ')} → ${ev.to.join(' / ')}`;
}

@Injectable({ providedIn: 'root' })
export class WorldHistoryService {
    /** Flips true once both packs are resolved (either may be empty — sparse-legal). */
    readonly ready = signal(false);
    private events = new Map<string, WorldEvent[]>();
    private facts: Record<string, WorldFacts> = {};
    private loading: Promise<void> | null = null;

    ensureLoaded(): Promise<void> {
        if (!this.loading) this.loading = this.load();
        return this.loading;
    }
    private async load(): Promise<void> {
        const [hist, wf] = await Promise.all([
            import('./world-history.json').catch(() => null),
            import('./world-facts.json').catch(() => null),
        ]);
        const rows = ((hist as { default?: { events?: WorldEvent[] } } | null)?.default?.events ?? []) as WorldEvent[];
        for (const r of rows) { const a = this.events.get(r.systemId); if (a) a.push(r); else this.events.set(r.systemId, [r]); }
        for (const a of this.events.values()) a.sort((x, y) => x.year - y.year || x.name.localeCompare(y.name));
        this.facts = ((wf as { default?: { facts?: Record<string, WorldFacts> } } | null)?.default?.facts ?? {}) as Record<string, WorldFacts>;
        this.ready.set(true);
    }
    /** All history rows for a system (year-sorted), or []. */
    eventsFor(systemId: string): WorldEvent[] { return this.events.get(systemId) ?? []; }
    /** The world profile facts for a system, or null. */
    factsFor(systemId: string): WorldFacts | null { return this.facts[systemId] ?? null; }
}
