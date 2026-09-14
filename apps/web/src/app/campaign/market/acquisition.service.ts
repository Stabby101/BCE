/*
 * BCE retool — UNIT ACQUISITION service (DIRECTIVE-029). The Angular seam around the market: builds the
 * BUY browse rows (D-018 eligibility ∩ the four MARKET GATES, GM-override-aware) and the SELL rows from
 * the force, and runs BUY / GM-ADD / SELL / DELETE against the live D-022 treasury. Mints into RESERVE
 * pristine + pilotless with provenance (D-029); SELL/DELETE unassign the pilot to spares (never sell
 * people), prune an emptied lance (D-027), and re-designate the commander (D-019). All mutations persist
 * in place + write a dated campaign-log entry. Market money is flagged INTERIM (T-022/T-025 valuation).
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../force/force-generator.service';
import { PilotService } from '../barracks/pilot.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { pruneLance, redesignateCommander } from '../force/force-structure';
import { MARKET_TUNABLES, priceOf, resaleOf, priceIsFallback, evalGates, passesAllGates, overriddenGates, type GateFlags } from '../force/market';
import type { UnitSummary as Unit, WeightClass } from '../../models/unit-summary.model';
import type { TechBase } from '../../models/tech.model';
import type { ProtoInstance, Provenance } from '../force/force-generator';

export interface BuyRow {
    unit: Unit;
    price: number;
    fallback: boolean; // price came from the BV fallback (no catalog cost)
    gates: GateFlags;
    passes: boolean; // clears all four gates (buyable without GM override)
    overrides: string[]; // the gate-failure labels (shown when GM override is on)
    // DIRECTIVE-063 (D): the sort/filter dimensions mirrored flat onto the row so the market's sort + filter
    // read a stable VM (not the Unit shape). year = D-055 intro_year; techBase/weightClass/tons/bv from the unit.
    tons: number;
    bv: number;
    year: number; // intro year
    techBase: TechBase; // 'Inner Sphere' | 'Clan' (REBASE-1: upstream split mixed-tech into the `mixed` flag below)
    mixed: boolean; // BCE-EDIT (REBASE-1 P1 c): mixed-tech is now a separate boolean on UnitSummary, not a techBase value
    weightClass: WeightClass;
}
export interface OwnedRow {
    instance: ProtoInstance;
    name: string;
    variant: string;
    tons: number;
    resale: number;
    deployed: boolean; // can't sell/delete while deployed
    pilotName: string;
    commander: boolean;
}

@Injectable({ providedIn: 'root' })
export class AcquisitionService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly forceGen = inject(ForceGeneratorService);
    private readonly pilots = inject(PilotService);
    private readonly store = inject(CampaignSaveStore);

    readonly resaleRatio = MARKET_TUNABLES.resaleRatio;
    readonly treasury = computed(() => this.state.treasury() ?? 0);

    // HOTFIX-005 + DEPLOY-005: the market's GM-override browses the FULL catalog (the era slice has only the
    // era's units), so readiness here = isFullLoaded — and opening the market LAZY-LOADS the full catalog
    // (the one place the 24MB loads), showing a loading state until then. A per-era slice does NOT satisfy it.
    readonly catalogReady = computed(() => this.data.isFullLoaded());
    readonly catalogLoading = computed(() => this.data.isDownloading());
    // HOTFIX-012: surface a genuine failure (or a hang past the timeout) so the BUY tab shows an error + Retry
    // instead of an endless "Loading the unit catalog…". Set when the load resolves without isFullLoaded, or
    // after a hard timeout; cleared on a fresh attempt.
    readonly catalogError = signal(false);
    private loadTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly LOAD_TIMEOUT_MS = 15_000;
    retryCatalog(): void {
        if (this.data.isFullLoaded()) return;
        this.catalogError.set(false);
        // ALWAYS arm the timeout (even if a load is already in-flight) so a hung/failed load can never sit on a
        // silent "Loading the unit catalog…" forever — at the deadline, if it still isn't loaded, surface the error.
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => { if (!this.data.isFullLoaded()) this.catalogError.set(true); }, this.LOAD_TIMEOUT_MS);
        // Only KICK a fresh load when one isn't already running (avoid a duplicate 24MB fetch); either way the
        // timeout above governs the failure surface.
        if (!this.data.isDownloading()) {
            void this.data.ensureFullCatalog().finally(() => {
                if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
                this.catalogError.set(!this.data.isFullLoaded()); // resolved without the full catalog → a real failure
            });
        }
    }

    /** All combat-'Mech rows with gate eval + price (reactive to the campaign era + catalog). */
    readonly marketRows = computed<BuyRow[]>(() => {
        const ctx = this.forceGen.marketContext();
        return this.forceGen.allCombatMeks().map((u) => {
            const gates = evalGates(u, ctx);
            return {
                unit: u, price: priceOf(u), fallback: priceIsFallback(u), gates, passes: passesAllGates(gates), overrides: overriddenGates(gates),
                tons: u.tons, bv: u.bv, year: u.year, techBase: u.techBase, mixed: u.mixed, weightClass: u.weightClass, // DIRECTIVE-063 (D); REBASE-1: mixed flag
            };
        });
    });

    /** The force's own units as SELL/DELETE rows. */
    readonly ownedRows = computed<OwnedRow[]>(() => {
        const force = this.state.startingForce() ?? [];
        const pilots = this.state.pilots() ?? [];
        return force.map((i) => {
            const u = this.unitFor(i);
            const p = pilots.find((x) => x.assignedInstanceId === i.instanceId);
            return {
                instance: i,
                name: u?.chassis ?? i.chassis,
                variant: u?.model ?? i.model,
                tons: u?.tons ?? i.tons,
                resale: this.resaleFor(i, u),
                deployed: i.condition === 'Deployed',
                pilotName: p ? (p.callsign ? `${p.name} "${p.callsign}"` : p.name) : '',
                commander: !!i.isCommander,
            };
        });
    });

    canBuy(price: number): boolean {
        return this.treasury() >= price; // no debt this slice — BUY is gated
    }

    /** BUY at catalog price → debit (never negative), mint to RESERVE (purchased), recruit crew, log. */
    buy(unit: Unit): boolean {
        const price = priceOf(unit);
        if (this.treasury() < price) return false;
        this.state.setTreasury(this.treasury() - price);
        this.mint(unit, { origin: 'purchased', acquiredDate: this.today() });
        this.pilots.mintRecruit();
        this.state.logMoney(`Purchased ${unit.chassis} ${unit.model}`, -price, null, 'purchase'); // D-074 (±amount + balance)
        void this.store.persistCurrent();
        return true;
    }

    /** GM ADD — no cost; mint to RESERVE (gm-added), recruit crew, log. */
    gmAdd(unit: Unit): void {
        this.mint(unit, { origin: 'gm-added', acquiredDate: this.today() });
        this.pilots.mintRecruit();
        this.log(`GM added ${unit.chassis} ${unit.model} (no cost)`);
        void this.store.persistCurrent();
    }

    sell(instanceId: string): boolean {
        return this.remove(instanceId, 'sell');
    }
    del(instanceId: string): boolean {
        return this.remove(instanceId, 'delete');
    }

    private remove(instanceId: string, mode: 'sell' | 'delete'): boolean {
        const force = this.state.startingForce() ?? [];
        const inst = force.find((i) => i.instanceId === instanceId);
        if (!inst || inst.condition === 'Deployed') return false; // deployed units can't leave the field
        if (mode === 'sell') {
            const resale = this.resaleFor(inst, this.unitFor(inst));
            this.state.setTreasury(this.treasury() + resale);
            this.state.logMoney(`Sold ${inst.chassis} ${inst.model}`, resale, null, 'sale'); // D-074 (±amount + balance)
        } else {
            this.log(`Struck ${inst.chassis} ${inst.model} from the rolls (write-off)`);
        }
        // Return the pilot to spares (never sell people).
        const pilot = (this.state.pilots() ?? []).find((p) => p.assignedInstanceId === instanceId);
        if (pilot) this.pilots.assign(pilot.pilotId, null);
        // Remove the instance, then the structure edges: re-designate the commander if it left, prune the lance if emptied.
        const next = redesignateCommander(force.filter((i) => i.instanceId !== instanceId));
        this.state.setStartingForce(next);
        const struct = this.state.forceStructure();
        if (struct && inst.lanceId) this.state.setForceStructure(pruneLance(struct, next, inst.lanceId));
        void this.store.persistCurrent();
        return true;
    }

    private mint(u: Unit, provenance: Provenance): void {
        // RESERVE = no lanceId; pristine (Active); pilotless. The player crews + assigns a lance via D-020/27.
        // HF-020: a Quick Mission is DEPLOYED-ONLY — D-069 removed the per-cell deploy dropdown, so a unit added
        // here (a CUSTOM quick force builds entirely through this seam) must be DEPLOYED on add, matching the
        // begin-time deploy-all that pre-made forces get (size-capital). Otherwise it lands in Reserve with no
        // way to deploy → deployedSet empty → the one-shot can't field/start. Ordering-proof: it doesn't matter
        // whether the add happens before or after Begin. Campaigns keep 'Active' (Reserve) + the dropdown.
        const inst: ProtoInstance = {
            instanceId: `buy-${Math.floor(Math.random() * 1e9)}`,
            unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv,
            condition: this.state.quickMission() ? 'Deployed' : 'Active', provenance,
        };
        this.state.setStartingForce([...(this.state.startingForce() ?? []), inst]);
    }

    private unitFor(i: ProtoInstance): Unit | undefined {
        // PLATFORM-1 Part C — the id fallback is guarded to POSITIVE ids: 1,545 catalog units share id:-1,
        // so a persisted -1 must read as absent (never resolve some unrelated -1 unit).
        return this.data.getUnitByName(i.unitRef) ?? (i.mulId != null && i.mulId > 0 ? this.data.getUnits().find((u) => u.id === i.mulId) : undefined);
    }
    private resaleFor(i: ProtoInstance, u: Unit | undefined): number {
        return u ? resaleOf(u) : Math.round((i.bv || 0) * MARKET_TUNABLES.bvCostFallback * MARKET_TUNABLES.resaleRatio);
    }
    private today(): { y: number; m: number; d: number } {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
    }
    private log(text: string, kind: 'purchase' | 'sale' | 'admin' = 'admin'): void {
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: this.today(), text, kind }]);
    }
    private fmt(n: number): string {
        return n.toLocaleString('en-US');
    }
}
