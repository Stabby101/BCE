/*
 * BCE Inventory II (DIRECTIVE-056, T-037 slice 2) — the impure inventory service.
 *
 * Owns the FORWARD-ONLY starting-inventory roll: resolves the fielded force's mounted weapons →
 * ammo classes (DataService, the proven getUnitByName path), fetches the era-legal catalog (D-055),
 * calls the PURE generateStartingInventory, and stores the realized InventoryState on the campaign
 * snapshot (DATA-002 — durable campaign state, travels with saves). Rolls ONCE (guard on a present
 * inventory) so a fresh Begin AND an old save back-fill identically without a re-roll. GM surface only.
 */
import { Injectable, Injector, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { WeaponEquipment } from '../../models/equipment.model';
import { formatDate } from '../clock/campaign-clock';
import type { ProtoInstance } from '../force/force-generator';
import { CatalogClientService } from '../catalog/catalog-client.service';
import { generateStartingInventory, type ForceAmmoInput, type ForceWeaponInput, type InventoryTier, type Logistics } from './starting-inventory';
import { FORMATION_OOB } from '../faction/formation-oob';

@Injectable({ providedIn: 'root' })
export class InventoryService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly catalog = inject(CatalogClientService);
    private readonly injector = inject(Injector);
    private rolling = false; // in-flight guard: the roll is async, so guard against a re-entrant double-roll

    /**
     * Forward-only: roll + store the starting inventory ONCE if absent. Returns true if it stored (the
     * caller persists). Mirrors ensureBios/ensureStaff — called at the dashboard load seam. No-op when
     * an inventory already exists (deterministic: the stored state is authoritative, never re-rolled) OR
     * while a roll is already in flight (the guard — the dashboard ctor can re-fire on re-construction).
     * Never throws: a data/catalog outage returns false (safe default — it rolls on a later load).
     */
    async ensureStartingInventory(): Promise<boolean> {
        if (this.rolling || this.state.inventory()) return false; // in-flight or already rolled → never re-roll
        const force = (this.state.startingForce() ?? []) as ProtoInstance[];
        if (force.length === 0) return false; // no force yet → nothing to stock
        this.rolling = true;
        try {
            await this.ensureData();
            const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? 3025;
            const catalog = await this.catalog.list({ era: year }); // era-legal rows (server pre-filters)
            const { ammo, weapons, jumperCount, fieldedMechTonnage, unitCount } = this.resolveForce(force);
            const tier = (this.state.resources() ?? 'normal') as InventoryTier;
            const seed = `${this.state.commandName() ?? this.state.unit() ?? 'command'}|${this.state.startDate()?.y ?? 0}|${force.length}`;
            const date = this.state.currentDate() ?? this.state.startDate();
            const inv = generateStartingInventory({
                ammo, weapons, jumperCount, fieldedMechTonnage, unitCount, tier, year, catalog, seed,
                generatedAt: date ? formatDate(date) : 'Begin',
                logistics: this.resolveLogistics(), // DIRECTIVE-065 — House MIC starts deep, merc lean
            });
            this.state.setInventory(inv);
            return true;
        } catch {
            return false; // data/catalog unavailable → roll on a later load (no unhandled rejection)
        } finally {
            this.rolling = false;
        }
    }

    /** DIRECTIVE-065 — the campaign's logistics for starting depth. A MERCENARY always buys its own (merc-market
     *  lean), whatever formation it fields; otherwise the chosen formation's `logistics` (formation-oob), else a
     *  House/Clan command draws on its military-industrial complex (house-mic deep). */
    private resolveLogistics(): Logistics {
        if (this.state.force() === 'MERC') return 'merc-market';
        const fname = this.state.formation();
        if (fname) {
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
            const rec = FORMATION_OOB.find((f) => norm(f.name) === norm(fname));
            if (rec) return rec.logistics;
        }
        return 'house-mic';
    }

    /** Resolve the force → ammo classes + a force-wide weapon tally (for the spare-weapon spread) + jump-capable
     *  count + total fielded 'Mech tonnage + unit count. DIRECTIVE-057: ammoType/rackSize come from the slim
     *  build-time stub `comp.at`/`comp.rs` (the hosted dashboard runs off the slim slice with no runtime `eq`,
     *  D-006) OR the full-catalog hydrated `comp.eq` (localhost / market). No 24MB catalog pulled here. */
    private resolveForce(force: ProtoInstance[]): { ammo: ForceAmmoInput[]; weapons: ForceWeaponInput[]; jumperCount: number; fieldedMechTonnage: number; unitCount: number } {
        const ammoMap = new Map<string, ForceAmmoInput>();
        const weaponMap = new Map<string, number>(); // weapon display name → mounted count across the whole force
        let mechTonnage = 0;
        let jumperCount = 0;
        for (const inst of force) {
            const unit = this.data.getUnitByName(inst.unitRef);
            if (!unit) continue;
            if ((inst.unitType ?? 'mech') === 'mech') mechTonnage += unit.tons || inst.tons || 0;
            if ((unit.jump ?? 0) > 0) jumperCount++;
            for (const comp of unit.comp ?? []) {
                const c = comp as { t?: string; n?: string; q?: number; at?: string; rs?: number; eq?: unknown };
                // weapon tally (E/M/B/A or a hydrated WeaponEquipment) by display name → the spare-weapon spread
                const isWeapon = c.t === 'E' || c.t === 'M' || c.t === 'B' || c.t === 'A' || c.eq instanceof WeaponEquipment;
                if (isWeapon && c.n) weaponMap.set(c.n, (weaponMap.get(c.n) ?? 0) + (c.q || 1));
                // ammo class — slim stub at/rs (D-057) first, else the full-catalog hydrated WeaponEquipment
                const eq = c.eq instanceof WeaponEquipment ? c.eq : null;
                const ammoType = c.at ?? eq?.ammoType;
                const rackSize = c.rs ?? eq?.rackSize;
                if (ammoType && ammoType !== 'NA') {
                    const key = `${ammoType}:${rackSize}`;
                    const cur = ammoMap.get(key) ?? { ammoType, rackSize: rackSize ?? 0, weaponCount: 0 };
                    cur.weaponCount += c.q || 1; // q = mounted count of this weapon (≥1 when present)
                    ammoMap.set(key, cur);
                }
            }
        }
        const weapons: ForceWeaponInput[] = [...weaponMap.entries()].map(([name, count]) => ({ name, count }));
        return { ammo: [...ammoMap.values()], weapons, jumperCount, fieldedMechTonnage: mechTonnage, unitCount: force.length };
    }

    // ── catalog/data readiness (mirrors force-generator.service.ts ensureData) ──
    private async ensureData(): Promise<void> {
        if (this.data.isDataReady()) return;
        if (!this.data.isDownloading()) this.data.initialize().catch(() => { /* surfaced via timeout */ });
        await this.whenDataReady();
    }
    private whenDataReady(): Promise<void> {
        if (this.data.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { ref.destroy(); reject(new Error('data timeout')); }, 30000);
            const ref = effect(() => {
                if (this.data.isDataReady()) {
                    clearTimeout(timer);
                    ref.destroy();
                    resolve();
                }
            }, { injector: this.injector });
        });
    }
}
