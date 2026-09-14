// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

import { REMOTE_HOST } from '../../models/common.model';
import { EMPTY_EQUIPMENT_REGISTRY, EquipmentRegistry } from '../../models/equipment-lookup';
import { Equipment, type EquipmentMap, type RawEquipmentData, createEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { UnitSummary } from '../../models/unit-summary.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { CatalogBaseService } from './catalog-base.service';

// BCE-EDIT (REBASE-1 P1 c, SLICE-1 re-home ruling #2): same-origin build-asset base for the per-era slices
// and the component-flag side-car (generate-slices.mjs). Shared with the DataService slice COORDINATOR — the
// two halves of SLICE-1 must fetch from the same tree. (DEPLOY-005 / HOTFIX-011: NOT REMOTE_HOST, so it works
// on dev where there is no remote.)
export const SLICE_BASE = '/mekbay/slim';

// REBASE-1 P1 (e): the flags whose presence makes a comp-flag stand-in a HEAT SINK — must match
// MiscEquipment.isHeatSink (equipment.model.ts). A stand-in carrying any of these is built as a
// MiscEquipment (not base Equipment) so the pin's heatSinkDissipation (`instanceof MiscEquipment && isHeatSink`)
// resolves it on a slice-resident session.
const HEATSINK_FLAGS = new Set(['F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE', 'F_LASER_HEAT_SINK']);

@Injectable({
    providedIn: 'root'
})
export class EquipmentCatalogService extends CatalogBaseService<RawEquipmentData, RawEquipmentData, RawEquipmentData> {
    private readonly dbService = inject(DbService);
    private readonly catalogLogger = inject(LoggerService);

    private equipmentRegistry = EMPTY_EQUIPMENT_REGISTRY;

    protected override get catalogKey(): string {
        return 'equipment';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/equipment2.json`;
    }

    public getEquipmentRegistry(): EquipmentRegistry {
        return this.equipmentRegistry;
    }

    protected override hasHydratedData(): boolean {
        return this.equipmentRegistry.size > 0;
    }

    protected override async loadFromCache(): Promise<RawEquipmentData | undefined> {
        return await this.dbService.getEquipments() ?? undefined;
    }

    protected override saveToCache(data: RawEquipmentData): Promise<void> {
        return this.dbService.saveEquipment(data);
    }

    protected override hydrate(data: RawEquipmentData): void {
        const normalizedEquipment: EquipmentMap = {};

        for (const [internalName, cachedEquipment] of Object.entries(data.equipment ?? {})) {
            try {
                normalizedEquipment[internalName] = createEquipment(cachedEquipment);
            } catch (error) {
                this.catalogLogger.error(`Failed to hydrate cached equipment ${internalName}: ${error}`);
            }
        }

        this.equipmentRegistry = new EquipmentRegistry(normalizedEquipment);
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: RawEquipmentData, etag: string): RawEquipmentData {
        return {
            ...data,
            etag,
        };
    }

    protected override getDatasetSize(data: RawEquipmentData): number {
        return Object.keys(data.equipment ?? {}).length;
    }

    protected override getMinimumDatasetSize(): number {
        return 3000;
    }

    // ────────────────────────────────────────────────────────────────────────────────────────────────
    // BCE-EDIT (REBASE-1 P1 c, SLICE-1 re-home ruling #2): the EQUIPMENT arm of SLICE-1 lives here (the
    // era-slice COORDINATOR that swaps units/factions lives on the DataService facade — see ensureSlice
    // there). This half is the component-flag side-car and the comp-aware equipment resolver.
    // ────────────────────────────────────────────────────────────────────────────────────────────────

    // SLICE-1: the component-flag side-car (generate-slices.mjs), fetched ONCE per page and reused across
    // era swaps. It is the slice path's stand-in for the full equipment registry, which is a full-catalog
    // store and therefore empty on a resumed session — leaving every `comp.eq`-gated rule inert. Null until
    // first load.
    private compFlagEq: Map<string, Equipment> | null = null;

    /**
     * SLICE-1 — resolve an equipment entry for a COMPONENT or CRIT SLOT: the full registry first, then the
     * slice side-car. `initCritSlots` binds `critSlot.eq` from the full registry, which is empty on a resumed
     * (slice-resident) session — with no `eq`, `baseDissipation`'s destroyed-heat-sink loop skipped every
     * slot silently. The key spaces coincide (SVG crit-slot `name` and a comp's `id` are both the equipment
     * internalName). Returns the FULL entry whenever the real registry has it — the side-car is a fallback,
     * never an override, so a market-loaded session keeps stats/type/weapon data the flag-only stand-ins lack.
     */
    public compEquipment(internalName: string): Equipment | undefined {
        return this.equipmentRegistry.findEquipment(internalName) ?? this.compFlagEq?.get(internalName) ?? undefined;
    }

    /**
     * SLICE-1 — bind `comp.eq` on slice units from the component-flag side-car. See the long-form rationale in
     * the original fork (data.service.ts): the vendored rules read `comp.eq.hasFlag(...)`, `eq` is bound only
     * inside the FULL-catalog postprocess, so on a slice-resident session every `comp.eq`-gated rule was inert.
     * The stand-ins carry flags and nothing else (bv=0). REBASE-1: heat-sink stand-ins are MiscEquipment (the
     * pin's heatSinkDissipation needs `instanceof MiscEquipment`); every OTHER stand-in stays BASE `Equipment` so
     * `eq instanceof WeaponEquipment/AmmoEquipment/ArmorEquipment` stays false (tagBV's semi-guided branch, the
     * weapon tally, and the BV-affecting instanceof paths are unchanged — no BV movement). The side-car contains
     * NO weapon ids by construction (generate-slices.mjs scopes it to C/X comp rows).
     * NON-FATAL and it degrades to the STATUS QUO: a failed side-car fetch STRIPS the C/X rows back out (an
     * un-hydrated C row inverts five `comp.eq?.hasAnyFlag(...)` suppression rules), restoring the pre-SLICE-1
     * weapons-only shape rather than a shape that never shipped.
     */
    public async hydrateSliceEq(units: readonly UnitSummary[]): Promise<void> {
        if (!this.compFlagEq) {
            try {
                const raw = await firstValueFrom(
                    this.http.get<Record<string, string[]>>(`${SLICE_BASE}/comp-flags.json`).pipe(timeout(12000))
                );
                const map = new Map<string, Equipment>();
                for (const [id, flags] of Object.entries(raw ?? {})) {
                    if (!Array.isArray(flags) || !flags.length) continue;
                    const data = { id, name: id, type: 'misc', flags: flags as EquipmentFlag[] } as unknown as RawEquipmentData['equipment'][string];
                    // REBASE-1 P1 (e): the pin's heatSinkDissipation requires `eq instanceof MiscEquipment && eq.isHeatSink`
                    // (the fork read `eq.hasFlag('F_HEAT_SINK')` on a base Equipment). So a HEAT-SINK stand-in must be a
                    // MiscEquipment (createEquipment(type:'misc') → MiscEquipment; isHeatSink is flag-derived). It stays
                    // BV-safe: flags-only → bv=0 (MountedMisc.getBV), not explosive, not Ammo/Armor/Weapon, so every
                    // BV-affecting instanceof path skips it exactly as the base stand-in did. Non-heat-sink comps keep
                    // the BASE Equipment stand-in — a real subclass there would trip AmmoEquipment.getAmmoBV /
                    // ArmorEquipment BV / the misc-explosion path (the "BV movement" gen-slices' side-car avoids).
                    const isHeatSink = (flags as string[]).some((f) => HEATSINK_FLAGS.has(f));
                    map.set(id, isHeatSink ? createEquipment(data) : new Equipment(data));
                }
                this.compFlagEq = map;
            } catch {
                this.compFlagEq = new Map(); // cached miss: one attempt per page, not one per era swap
            }
        }
        const eqMap = this.compFlagEq;
        if (!eqMap.size) {
            // THE DEGRADE: no side-car → no rule can read the rows this change added, and leaving them in
            // inverts five suppression rules. Restore the pre-SLICE-1 shape instead.
            for (const u of units) {
                if (u.comp?.length) u.comp = u.comp.filter((c) => c.t === 'E' || c.t === 'M' || c.t === 'B' || c.t === 'A');
            }
            this.catalogLogger.warn('[SLICE-1] comp-flag side-car unavailable — C/X comps stripped; the slice degrades to the pre-SLICE-1 weapons-only shape.');
            return;
        }
        for (const u of units) {
            for (const c of (u.comp ?? [])) {
                if (c.eq || c.id == null) continue;
                const hit = eqMap.get(String(c.id));
                if (hit) c.eq = hit;
            }
        }
    }
}