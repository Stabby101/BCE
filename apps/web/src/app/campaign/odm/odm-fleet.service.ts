/*
 * DIRECTIVE-ODM-17 P2 — THE FLEET client. packs/odm/fleet.json is transport truth, INGESTED ONE-WAY from
 * the PM-authored canonical-lift master (ODM_FLEET_R1.json — TM p.239/209 · SO p.22/41-43/324 · TRO:3057R
 * via Sarna). Rulings carried: R1 Union cargo 74 t · R2 Leopard fuel 137 t · R3 THE LIFT ARC — the two
 * operational hulls are 350 t of bay tonnage short of a one-wave company lift, and that STAYS true (the
 * Grieving Star restoration + refit is the earned fix; render the shortfall, never patch it in data).
 * DOORS ARE DATA AND GATE (SO p.42: cargo moves only through a door): a 0-door cargo bay loads NOTHING
 * afield — the walk's cargo capacity counts DOORED holds only (the Union's 74 t is the only spaceborne
 * cargo path). Fighter bays stay data-no-gate (no aerospace in ODM content). The per-bay 150 t cubicle
 * tonnage is the CONVERSION basis of the lift budget (TM p.239), derived at render — never stored totals.
 * STATUS IS LIVE — pack defaults + the additive state overlay. Server-served, in-memory, C6-cleared.
 */
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';

export interface OdmFleetBay { type: 'mech' | 'fighter' | 'cargo'; count?: number; tons?: number; doors: number }
export interface OdmVessel {
    id: string; name: string; class: string; type: string; hull: string;
    status: string;                 // pack default; the state overlay wins where set
    mass: number;
    fuelCapacityTons: number;
    thrustPoints?: { safe: number; max: number };
    bays: OdmFleetBay[];
    doorsMax?: number; bayPersonnel?: number;
    dockingCollars?: number; gravDecks?: number; lfBattery?: boolean;
    smallCraftBays?: number; smallCraftCapacity?: number; // corrected per the premise-check: ONE bay holding TWO craft
    cargoDiscrepancy?: { recordedTons: number; currentRulesTons: number };
    note: string;
}
export interface OdmFleetOps {
    unitLoadSeconds: Record<string, number>; weatherMultipliers: Record<string, number>;
    throughputRule: string; cargoReadyMinutes: number; cargoReadyNote: string; dropRules: string;
}
interface OdmFleetFile { packId: string; version: number; vessels: OdmVessel[]; opsData?: OdmFleetOps }

/** TM p.239 — a 'Mech or fighter cubicle is 150 t of bay; vehicle bays are 50 t (≤50 t vehicle) / 100 t
 *  (51–100 t). These are the CONVERSION constants of the lift arithmetic, cited, not tunables. */
const CUBICLE_TONS = 150;
const LIGHT_VEHICLE_BAY_TONS = 50;
const HEAVY_VEHICLE_BAY_TONS = 100;

export const mechBayCount = (v: OdmVessel): number => v.bays.filter((b) => b.type === 'mech').reduce((s, b) => s + (b.count ?? 0), 0);
export const fighterBayCount = (v: OdmVessel): number => v.bays.filter((b) => b.type === 'fighter').reduce((s, b) => s + (b.count ?? 0), 0);
export const cargoTonsOf = (v: OdmVessel): number => v.bays.filter((b) => b.type === 'cargo').reduce((s, b) => s + (b.tons ?? 0), 0);
/** DOORED cargo only — a 0-door hold loads/unloads NOTHING while spaceborne or afield (SO p.42). */
export const dooredCargoTonsOf = (v: OdmVessel): number => v.bays.filter((b) => b.type === 'cargo' && b.doors > 0).reduce((s, b) => s + (b.tons ?? 0), 0);
export const doorsUsed = (v: OdmVessel): number => v.bays.reduce((s, b) => s + b.doors, 0);

@Injectable({ providedIn: 'root' })
export class OdmFleetService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    readonly fleet = signal<OdmVessel[] | null>(null);
    readonly opsData = signal<OdmFleetOps | null>(null);
    private inflight: Promise<void> | null = null;

    constructor() {
        effect(() => { if (this.state.packId() !== 'odm') this.clear(); }); // the C6 rule
    }

    ensureLoaded(): Promise<void> {
        if (this.fleet()) return Promise.resolve();
        if (this.inflight) return this.inflight;
        this.inflight = firstValueFrom(this.http.get<OdmFleetFile>(`${this.base()}/pack/odm/file/fleet.json`, { withCredentials: true }))
            .then((f) => { if (f?.vessels?.length) { this.fleet.set(f.vessels); this.opsData.set(f.opsData ?? null); } })
            .catch(() => { /* honest nulls — the walk refuses to cap-check blind (it waits) */ })
            .then(() => { this.inflight = null; });
        return this.inflight;
    }
    clear(): void { this.fleet.set(null); this.opsData.set(null); this.inflight = null; }

    /** Vessels with the LIVE status applied (the overlay wins; empty overlay = pack truth). */
    readonly vessels = computed<OdmVessel[] | null>(() => {
        const f = this.fleet();
        if (!f) return null;
        const over = this.state.odmFleetStatus();
        return f.map((v) => ({ ...v, status: over[v.id] ?? v.status }));
    });
    private operational(): OdmVessel[] { return (this.vessels() ?? []).filter((x) => x.status === 'OPERATIONAL' && x.type === 'DropShip'); }

    /** The lift: operational DropShips' 'Mech bays (COUNT — a bay slot is a bay slot; GROUNDED = 0). */
    readonly liftBays = computed<number | null>(() => this.vessels() ? this.operational().reduce((s, x) => s + mechBayCount(x), 0) : null);
    /** The holds the walk can actually USE: operational DropShips' DOORED cargo tonnage only — the
     *  Leopards' 0-door 34 t holds exist and load nothing afield (the Union's 74 t is the cargo path). */
    readonly cargoTons = computed<number | null>(() => this.vessels() ? this.operational().reduce((s, x) => s + dooredCargoTonsOf(x), 0) : null);

    /** ODM-17 P2-e/f — THE LIFT BUDGET (ruling R3), derived AT RENDER from ships + the live roster —
     *  never stored totals. TONNAGE-based (this superseded the count-based first cut): required = each
     *  'Mech a 150 t cubicle + each vehicle its TM p.239 bay (light 50 t / heavy 100 t); available =
     *  operational hulls' convertible bay tonnage ('Mech + fighter cubicles × 150 — scrapping every
     *  fighter cubicle still leaves the fleet short today, which is the point). The master's authored
     *  arithmetic (3,350 needed / 3,000 available / short 350; 3,900 restored) is the HARNESS pin. */
    readonly liftBudget = computed<{ requiredTons: number; availableTons: number; shortTons: number; waves: number; meks: number; lightVehicles: number; heavyVehicles: number; oversize: number } | null>(() => {
        const v = this.vessels();
        if (!v) return null;
        const force = this.state.startingForce() ?? [];
        let requiredTons = 0, meks = 0, lightVehicles = 0, heavyVehicles = 0, oversize = 0;
        for (const i of force) {
            if ((i.unitType ?? 'mech') === 'mech') { meks++; requiredTons += CUBICLE_TONS; }
            else if (i.tons <= 50) { lightVehicles++; requiredTons += LIGHT_VEHICLE_BAY_TONS; }
            else if (i.tons <= 100) { heavyVehicles++; requiredTons += HEAVY_VEHICLE_BAY_TONS; }
            else { oversize++; requiredTons += CUBICLE_TONS; } // over-100 t vehicle: no TM p.239 bin — priced as a cubicle and REPORTED via the count
        }
        const availableTons = this.operational().reduce((s, x) => s + (mechBayCount(x) + fighterBayCount(x)) * CUBICLE_TONS, 0);
        const shortTons = Math.max(0, requiredTons - availableTons);
        return { requiredTons, availableTons, shortTons, waves: availableTons > 0 ? Math.ceil(requiredTons / availableTons) : 0, meks, lightVehicles, heavyVehicles, oversize };
    });
}
