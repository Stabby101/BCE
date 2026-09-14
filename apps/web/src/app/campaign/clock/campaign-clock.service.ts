/*
 * BCE retool — campaign clock service (DIRECTIVE-022). The Angular seam around the pure clock:
 * holds the current date, advances it through GM controls, and fires the ordered month-boundary
 * subscriber registry (a prior-prototype concept — advance + subscribers in one transaction; the single
 * persistCurrent() at the end IS that transaction). Two subscribers this slice:
 *   1. monthly pay — while a contract is ACTIVE, credit baseAmount÷lengthMonths to the treasury
 *      (CamOps monthly payment basis, cited via the D-017 reference), settling the remainder + auto-
 *      completing on the final installment;
 *   2. market refresh — on a boundary with NO active contract (merc), reroll the market (D-017).
 * All mutations route through persistCurrent (no autosaves). ODM snapshots/preview/notifications OUT.
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ContractMarketService } from '../contract/contract-market.service';
import { MissionTreeService } from '../mission/mission-tree.service';
import { OrdersService } from '../orders/orders.service';
import { RepairBaysService } from '../repair/repair-bays.service';
import { WarchestService } from '../chaos/warchest.service'; // D-109
import { resolved } from '../chaos/chaos-contract'; // D-110 — Base Pay from the active contract's terms
import { addSpan, addDays, daysBetween, monthBoundariesBetween, ClockSubscribers, type CampaignDate, type SpanId } from './campaign-clock';
import { forceMaintenance } from '../economy-ledger';
import type { ContractOffer } from '../contract/contract-market';

@Injectable({ providedIn: 'root' })
export class CampaignClockService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly market = inject(ContractMarketService);
    private readonly tree = inject(MissionTreeService);
    private readonly orders = inject(OrdersService);
    private readonly bays = inject(RepairBaysService);
    private readonly warchest = inject(WarchestService); // D-109 — Hot Spots monthly maintenance (SP)

    private readonly registry = new ClockSubscribers();

    constructor() {
        // Ordered registry: pay first (may auto-complete + free the market), refresh second, infirmary third.
        this.registry.register('monthly-pay', (b) => this.payTick(b));
        this.registry.register('monthly-payroll', (b) => this.payrollTick(b)); // D-074: the recurring personnel burn (Traditional only)
        this.registry.register('monthly-maintenance', (b) => this.maintenanceTick(b)); // D-076: unit upkeep (after payroll — people before parts; Traditional only)
        this.registry.register('monthly-warchest', (b) => this.monthlyWarchestTick(b)); // D-109: Hot Spots SP maintenance (−500×scale)
        this.registry.register('market-refresh', () => this.refreshTick());
        this.registry.register('pilot-recovery', () => this.recoveryTick()); // D-031 infirmary seed
        this.registry.register('house-orders', () => { if (this.state.packId()) return; this.orders.cutIfDue(); }); // D-032: non-merc new orders — ODM-1: never under a pack (no contract layer)
    }

    /** The live campaign date (falls back to the start date pre-clock / pre-D-022 saves). */
    currentDate(): CampaignDate | null {
        return this.state.currentDate() ?? this.state.startDate() ?? null;
    }

    /** Migration-on-load: a save with no clock/treasury (pre-D-022) gets them from the start date +
     *  capital, once. Returns true if it changed something (caller persists in place). */
    ensureClock(): boolean {
        let changed = false;
        if (this.state.currentDate() === null && this.state.startDate()) {
            this.state.setCurrentDate(this.state.startDate());
            changed = true;
        }
        if (this.state.treasury() === null && this.state.capital()) {
            this.state.setTreasury(this.state.capital()!.amount);
            changed = true;
        }
        return changed;
    }

    /** Advance the clock by one span, firing every crossed month boundary once (in order), then
     *  persist the whole advance in place (the ODM single-transaction shape). */
    advance(span: SpanId): void {
        const from = this.currentDate();
        if (!from) return;
        this.advanceTo(from, addSpan(from, span));
    }

    /** D-099 — advance by an arbitrary N days through the SAME ripple as a span advance (the mission AAR's
     *  transit + insertion + operation span; the spans can't express it). Reuses advanceTo — the clock path is
     *  NOT forked. No-op for N ≤ 0 or no current date (migration-safe). */
    advanceDays(days: number): void {
        const from = this.currentDate();
        if (!from || days <= 0) return;
        this.advanceTo(from, addDays(from, days));
    }

    /** The single advance transaction (ODM shape): fire each crossed month boundary once in order, set the new
     *  date, burn repair tech-hours over the elapsed days, persist once. advance(span) + advanceDays(n) share it. */
    private advanceTo(from: CampaignDate, to: CampaignDate): void {
        this.registry.fire(monthBoundariesBetween(from, to));
        this.state.setCurrentDate(to);
        // ODM-13 P2 (sanctioned gate #5, the payTick:packId pattern) — a pack campaign's bays are the ODM fork's
        // (parts-consuming, no bench rate); its own currentDate-effect drives the burn (classic→odm is fenced).
        if (!this.state.packId()) this.bays.burnDays(daysBetween(from, to)); // D-033: burn repair tech-hours over the elapsed days (settles completions)
        void this.store.persistCurrent();
    }

    /** Manual COMPLETE — settle the remaining pay, log the contract, free the market. Persists. */
    completeManually(): void {
        const ac = this.state.acceptedContract();
        if (!ac) return;
        const remainder = Math.max(0, ac.pay.total - (ac.paidOut ?? 0));
        if (remainder) this.state.setTreasury((this.state.treasury() ?? 0) + remainder);
        this.complete({ ...ac, paidOut: ac.pay.total, completedDate: this.currentDate() ?? undefined });
        void this.store.persistCurrent();
    }

    // ── subscribers ──
    /** Credit one monthly installment; the final installment settles the remainder + auto-completes. */
    private payTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() === 'hotspots') return; // D-110b — Hot Spots uses the SP Warchest; the synthetic offer's zero pay never touches C-bills
        if (this.state.packId()) return; // ODM-1 (ruling 4, sanctioned) — a pack campaign has NO contract layer: no contract income
        const ac = this.state.acceptedContract();
        if (!ac || ac.status !== 'ACTIVE') return;
        if (this.state.force() !== 'MERC') return; // D-032: House orders have no pay / no pay-driven auto-complete
        const total = ac.pay.total;
        const duration = Math.max(1, ac.durationMonths);
        const paidMonths = (ac.paidMonths ?? 0) + 1;
        const paidOutPrev = ac.paidOut ?? 0;
        const isFinal = paidMonths >= duration;
        const credit = isFinal ? total - paidOutPrev : Math.round(total / duration);
        const paidOut = paidOutPrev + credit;
        if (credit) {
            this.state.setTreasury((this.state.treasury() ?? 0) + credit);
            this.state.logMoney(`Contract income — ${ac.employer.name}`, credit, boundary, 'income'); // D-074
        }
        const updated: ContractOffer = { ...ac, paidMonths, paidOut };
        if (isFinal) this.complete({ ...updated, completedDate: boundary });
        else this.state.setAcceptedContract(updated);
    }

    /** DIRECTIVE-074 / D-075 — debit the predicted personnel payroll once per month boundary (realizes the
     *  D-058 ledger's monthly BURN as an actual money event — single source with computeLedger, so the runway
     *  is real and the spend shows in the transaction log). Fires for every campaign with support staff (merc
     *  + house). Quick Mission is ephemeral with no clock, so it never reaches here.
     *
     *  D-075 SHORTFALL — when the treasury can't cover payroll: pay what's possible (never crash / spiral
     *  wildly negative), record the unpaid remainder + month (for the future T-040 turnover/morale system),
     *  and log a clear "Payroll shortfall: −X unpaid" notice. The Overview surfaces both the notice + a flag. */
    private payrollTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() === 'hotspots') return; // D-109 — Hot Spots uses SP maintenance, not C-bill payroll
        if (this.state.packId()) return; // ODM-11 (sanctioned gate, the payTick:packId pattern) — a survival campaign pays NOBODY: no payroll drain
        const payroll = this.state.personnel()?.monthlyPayroll ?? 0;
        if (payroll <= 0) return;
        const treasury = this.state.treasury() ?? 0;
        const paid = Math.min(payroll, Math.max(0, treasury)); // pay only what's on hand
        if (paid > 0) {
            this.state.setTreasury(treasury - paid);
            this.state.logMoney(`Personnel payroll${paid < payroll ? ' (partial)' : ''}`, -paid, boundary, 'admin');
        }
        const shortfall = payroll - paid;
        if (shortfall > 0) {
            this.state.recordPayrollShortfall(boundary, shortfall, 'payroll');
            this.state.logNotice(`Payroll shortfall: −${shortfall.toLocaleString('en-US')} unpaid`, boundary, 'admin');
        }
    }

    /** DIRECTIVE-076 — debit the monthly UNIT MAINTENANCE (CamOps spare-parts upkeep, forceMaintenance — Σ over
     *  the FIELDED force; Cold-storage units cost nothing) once per month boundary, single source with
     *  computeLedger. Fires AFTER payroll (people before parts), shortfall-aware exactly like payroll: pay
     *  what's possible (treasury floors at 0), record the unpaid remainder + month, log a clear notice. */
    private maintenanceTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() === 'hotspots') return; // D-109 — Hot Spots uses SP maintenance (monthlyWarchestTick)
        if (this.state.packId()) return; // ODM-11 (sanctioned gate) — ODM attrition is STOCKS (ODM-11), not a C-bill maintenance drain
        const maintenance = forceMaintenance(this.state.startingForce());
        if (maintenance <= 0) return;
        const treasury = this.state.treasury() ?? 0;
        const paid = Math.min(maintenance, Math.max(0, treasury));
        if (paid > 0) {
            this.state.setTreasury(treasury - paid);
            this.state.logMoney(`Unit maintenance${paid < maintenance ? ' (partial)' : ''}`, -paid, boundary, 'admin');
        }
        const shortfall = maintenance - paid;
        if (shortfall > 0) {
            this.state.recordPayrollShortfall(boundary, shortfall, 'maintenance');
            this.state.logNotice(`Maintenance shortfall: −${shortfall.toLocaleString('en-US')} unpaid`, boundary, 'admin');
        }
    }

    /** DIRECTIVE-109 — Hot Spots monthly economy (§6): debit Maintenance = 500 SP × Contract Scale to the
     *  Warchest ledger, keyed to the crossed month boundary. Base Pay income is deferred to D-110 (no active
     *  contract this slice). No-op under Traditional (the C-bill payroll/maintenance ticks run there instead). */
    private monthlyWarchestTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() !== 'hotspots') return;
        // GM-3 P2 — a TABLE WITH NO COMPANY has no warchest of its own (warchestSP null): nothing to maintain, nobody to pay.
        // Skip the whole tick so a month advance never bleeds a phantom −500 SP or writes ledger rows to a non-existent
        // company (R0.2 worst-five #2). A plain campaign / a GM who built or brought a company has warchestSP set → runs as today.
        if (this.state.companylessTable()) return;
        const scale = this.state.scaleFor() ?? 1; // GM-2 P2a — through the ONE accessor
        // D-139 — the Maintenance + Base Pay pair post SILENTLY (automated), then coalesce into ONE
        // "Monthly settlement · net ±N SP" toast so a month advance never storms two-per-month.
        const before = this.state.warchestSP() ?? 0;
        this.warchest.post('Maintenance', this.warchest.maintenance(scale), 0, boundary, { silent: true });
        // D-110 — Base Pay (§6): while under an ACTIVE contract, collect 500 SP × scale × basePay% as income
        // (negative cost). No contract → no base pay, and Maintenance still bleeds (book-faithful).
        const contract = this.state.contractFor();
        // GM-3 P1 — the SESSION CONTRACT (a GM session's party-less primary) pays nobody's warchest from the month tick: the
        // GM is not a party to it (if he fields, his participant contract pays him per track on the slip). A plain campaign's
        // contract never carries `party` → the branch is dead there, byte-identical.
        if (contract?.status === 'active' && contract.party !== 'session') {
            const basePay = Math.round((500 * scale * resolved(contract.steps).basePay) / 100);
            if (basePay > 0) this.warchest.post('Base Pay', -basePay, 0, boundary, { silent: true });
        }
        const after = this.state.warchestSP() ?? 0;
        this.warchest.announceSettlement('Monthly settlement', before - after, after); // paid = net spend (income → negative)
    }

    /** D-031: per month boundary, tick down Injured pilots' recovery; at ≤0 they return to Active (the
     *  infirmary SEED — full surface is D-032/034). KIA never recovers (the dead-stays-dead guard). */
    private recoveryTick(): void {
        const pilots = this.state.pilots();
        if (!pilots?.length) return;
        let changed = false;
        const next = pilots.map((p) => {
            if (p.status !== 'Injured') return p;
            changed = true;
            const left = (p.recoveryDays ?? 0) - 30; // ~a month per boundary (INTERIM; full model D-032/034)
            return left <= 0 ? { ...p, status: 'Active' as const, recoveryDays: undefined, hits: undefined } : { ...p, recoveryDays: left };
        });
        if (changed) this.state.setPilots(next);
    }

    /** On a boundary with no active contract, reroll the merc market (CamOps 1st-of-month). */
    private refreshTick(): void {
        if (this.state.force() !== 'MERC') return;
        if (this.state.acceptedContract()) return; // no offers while a contract runs
        this.market.refreshMarket();
    }

    private complete(contract: ContractOffer): void {
        this.state.setCompletedContracts([...(this.state.completedContracts() ?? []), { ...contract, status: 'COMPLETED' }]);
        this.state.setAcceptedContract(null);
        this.state.setMissionSpec(null); // the active mission belonged to this contract (D-023)
        this.tree.closeTree(contract); // D-026/D-028 — retire the unplayed branches + archive the closed tree
    }
}
