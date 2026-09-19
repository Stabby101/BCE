import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState, type CampaignLogEntry } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import type { InventoryLine } from '../inventory/starting-inventory';
import { odmStartingStocks, binNameForAmmo, round1 } from './odm-stocks';
import { effGrades } from './odm-materiel';

const DEPOT_EDITS: { label: string; old: number; now: number }[] = [
    { label: 'Double Heat Sink', old: 49, now: 10 },
    { label: 'Lower Arm Actuator', old: 23, now: 6 },
    { label: 'Hand Actuator', old: 22, now: 7 },
    { label: 'Upper Arm Actuator', old: 8, now: 4 },
    { label: 'Jump Jet', old: 14, now: 8 },
];
const DEPOT_ENGINE_OLD = { label: 'Standard Fusion Engine', old: 8 };
const DEPOT_ENGINE_RATED = ['XL 250 Fusion Engine', 'Standard 300 Fusion Engine', 'Standard 190 Fusion Engine'];
const DEPOT_NEW_LINES = ['Ferro-Fibrous Armor', 'Endo Steel Structure', 'Heat Sink'];

@Injectable({ providedIn: 'root' })
export class OdmQuartermasterService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly http = inject(HttpClient);
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    private packDepot: Promise<{ tier?: string; lines?: InventoryLine[] } | null> | null = null;
    /** One credentialed fetch of the authored pack depot per service lifetime; null on failure (retry next app load). */
    private fetchDepot(): Promise<{ tier?: string; lines?: InventoryLine[] } | null> {
        this.packDepot ??= firstValueFrom(this.http.get<{ tier?: string; lines?: InventoryLine[] }>(`${this.base()}/pack/odm/file/inventory.json`, { withCredentials: true })).catch(() => null);
        return this.packDepot;
    }

    /** The fork-ctor ensure: seed (the AUTHORED pack depot) + the one-shot migration. Idempotent; persists only on change. */
    async ensure(): Promise<void> {
        if (this.state.packId() !== 'odm') return; // belt — only the fork calls this anyway
        let changed = false;

        // ── THE AUTHORED DEPOT (2026-08-28 ruling) — packs/odm/inventory.json seeds the fork's stores;
        //    Classic's roll is byte-untouched — this call site is fork-owned). The pack file is the
        //    Ruling-3e ammo filter stays as a belt (the authored file ships none). ──
        if (!this.state.inventory()) {
            const f = await this.fetchDepot();
            if (f?.lines?.length) {
                const date = this.state.currentDate() ?? this.state.startDate();
                this.state.setInventory({
                    lines: f.lines.filter((l) => l.category !== 'ammunition').map((l) => ({ ...l })),
                    generatedAt: date ? `${date.y}-${String(date.m + 1).padStart(2, '0')}-${String(date.d).padStart(2, '0')} (pack depot)` : 'Begin (pack depot)',
                    tier: f.tier ?? 'normal',
                });
                changed = true;
            }
            // fetch failed / empty → NO fallback roll: the depot seeds on a later load; nothing rolled, nothing invented
        }

        const inv = this.state.inventory();
        const stocks = this.state.odmStocks() ?? odmStartingStocks(); // a null-stocks campaign materializes the authored seed on write
        const ammoLines = (inv?.lines ?? []).filter((l) => l.category === 'ammunition');
        if (ammoLines.length && !stocks.invAmmoMigrated) {
            const bins = { ...stocks.bins };
            let moved = 0;
            for (const l of ammoLines) {
                if (l.unit !== 'tons' || l.onHand <= 0) continue;
                const name = binNameForAmmo(l.label);
                bins[name] = bins[name] ? { ...bins[name], tons: round1(bins[name].tons + l.onHand) } : { tons: round1(l.onHand), floorTons: null };
                moved = round1(moved + l.onHand);
            }
            this.state.setInventory({ ...inv!, lines: inv!.lines.filter((l) => l.category !== 'ammunition') });
            this.state.odmStocks.set({ ...stocks, bins, invAmmoMigrated: true });
            const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
            this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: today, text: `Quartermaster reconciliation — ammunition consolidated to magazine (${moved} t across ${ammoLines.length} line${ammoLines.length === 1 ? '' : 's'})`, kind: 'admin' as const }]);
            changed = true;
        } else if (!stocks.invAmmoMigrated && this.state.odmStocks()) {
            this.state.odmStocks.set({ ...stocks, invAmmoMigrated: true });
            changed = true;
        }

        //    (everything a pre-P3 save held — and everything the depot seeds — was installable before
        //    grades existed; the doctrine's "depot stock is A"). Strips land RAW from here on. An
        //    identity fill, not a tonnage move — silent by design, idempotent by absence-trigger. ──
        const invG = this.state.inventory();
        if (invG?.lines.some((l) => l.category === 'component' && !l.grades)) {
            this.state.setInventory({ ...invG, lines: invG.lines.map((l) => l.category === 'component' && !l.grades ? { ...l, grades: { a: l.onHand, b: 0, c: 0, raw: 0 } } : l) });
            changed = true;
        }

        // ── THE AUTHORED-DEPOT RECONCILIATION (order-5, 2026-08-28) — LEGACY campaigns only (a
        //    pack-seeded depot is born current; generatedAt carries the '(pack depot)' stamp). Runs
        //    AFTER the grades fill so pre-P3 lines carry all-A grades before the zero-consumption
        //    check. Forward-only; every apply/leave logs once (text-dedupe, kind 'parts'). ──
        const invD = this.state.inventory();
        if (invD?.lines.length && !invD.generatedAt?.includes('(pack depot)')) {
            const pack = (await this.fetchDepot())?.lines;
            if (pack?.length) {
                const packOf = (label: string) => pack.find((p) => p.label === label);
                const untouched = (l: InventoryLine, old: number) => { const g = effGrades(l); return l.onHand === old && g.a === old && !g.b && !g.c && !g.raw; };
                const lines = invD.lines.map((l) => ({ ...l }));
                const applied: string[] = []; const left: string[] = [];
                for (const e of DEPOT_EDITS) {
                    const i = lines.findIndex((l) => l.category === 'component' && l.label === e.label);
                    if (i < 0 || lines[i].onHand === e.now) continue; // absent, or already current — nothing to do
                    const pk = packOf(e.label);
                    if (pk && untouched(lines[i], e.old)) {
                        lines[i] = { ...lines[i], onHand: e.now, floor: pk.floor, grades: { a: e.now, b: 0, c: 0, raw: 0 } };
                        applied.push(`${e.label} ${e.old} → ${e.now}`);
                    } else left.push(`${e.label} left at ${lines[i].onHand} (play-touched)`);
                }
                const ei = lines.findIndex((l) => l.category === 'component' && l.label === DEPOT_ENGINE_OLD.label);
                if (ei >= 0) {
                    const rated = DEPOT_ENGINE_RATED.map(packOf).filter((p): p is InventoryLine => !!p);
                    if (rated.length === DEPOT_ENGINE_RATED.length && untouched(lines[ei], DEPOT_ENGINE_OLD.old)) {
                        lines.splice(ei, 1, ...rated.map((p) => ({ ...p, grades: { a: p.onHand, b: 0, c: 0, raw: 0 } })));
                        applied.push(`${DEPOT_ENGINE_OLD.label} ×${DEPOT_ENGINE_OLD.old} → rated engine lines (XL 250 ×2 · Standard 300 ×1 · Standard 190 ×1)`);
                    } else left.push(`${DEPOT_ENGINE_OLD.label} left at ${lines[ei].onHand} (play-touched — the rated-engine split is yours to settle by hand)`);
                }
                // the new authored lines — add ONLY where the label is absent. A present namesake is
                // skipped SILENTLY (never merged over, never logged): after a successful pass the added
                // lines themselves are present on every later load, and a leave-log here would mint junk.
                // DECISION: silent skip over left-log for the adds — the ruling's leave-and-log clause is
                // about the ten edited lines; the adds are bounded by absence alone.
                for (const label of DEPOT_NEW_LINES) {
                    const pk = packOf(label);
                    if (!pk || lines.some((l) => l.label === label)) continue;
                    lines.push(pk.category === 'component' ? { ...pk, grades: { a: pk.onHand, b: 0, c: 0, raw: 0 } } : { ...pk });
                    applied.push(`${label} added (${pk.onHand} ${pk.unit})`);
                }
                if (applied.length) { this.state.setInventory({ ...invD, lines }); changed = true; }
                const log = this.state.campaignLog() ?? [];
                const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
                const fresh: CampaignLogEntry[] = [
                    ...applied.map((t) => `Depot reconciliation — ${t} (authored pack depot, 2026-08-28)`),
                    ...left.map((t) => `Depot reconciliation — ${t}`),
                ].filter((text) => !log.some((e) => e.text === text)).map((text) => ({ date: today, text, kind: 'parts' as const }));
                if (fresh.length) { this.state.setCampaignLog([...log, ...fresh]); changed = true; }
            }
        }

        if (changed) void this.store.persistCurrent();
    }
}
