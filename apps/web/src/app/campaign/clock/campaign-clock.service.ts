import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ContractMarketService } from '../contract/contract-market.service';
import { MissionTreeService } from '../mission/mission-tree.service';
import { OrdersService } from '../orders/orders.service';
import { RepairBaysService } from '../repair/repair-bays.service';
import { WarchestService } from '../chaos/warchest.service';
import { resolved } from '../chaos/chaos-contract';
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
    private readonly warchest = inject(WarchestService);

    private readonly registry = new ClockSubscribers();

    constructor() {
        // Ordered registry: pay first (may auto-complete + free the market), refresh second, infirmary third.
        this.registry.register('monthly-pay', (b) => this.payTick(b));
        this.registry.register('monthly-payroll', (b) => this.payrollTick(b));
        this.registry.register('monthly-maintenance', (b) => this.maintenanceTick(b));
        this.registry.register('monthly-warchest', (b) => this.monthlyWarchestTick(b));
        this.registry.register('market-refresh', () => this.refreshTick());
        this.registry.register('pilot-recovery', () => this.recoveryTick());
        this.registry.register('house-orders', () => { if (this.state.packId()) return; this.orders.cutIfDue(); });
    }

    currentDate(): CampaignDate | null {
        return this.state.currentDate() ?? this.state.startDate() ?? null;
    }

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
        // (parts-consuming, no bench rate); its own currentDate-effect drives the burn (classic→odm is fenced).
        if (!this.state.packId()) this.bays.burnDays(daysBetween(from, to));
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
        if (this.state.campaignSystem() === 'hotspots') return;
        if (this.state.packId()) return;
        const ac = this.state.acceptedContract();
        if (!ac || ac.status !== 'ACTIVE') return;
        if (this.state.force() !== 'MERC') return;
        const total = ac.pay.total;
        const duration = Math.max(1, ac.durationMonths);
        const paidMonths = (ac.paidMonths ?? 0) + 1;
        const paidOutPrev = ac.paidOut ?? 0;
        const isFinal = paidMonths >= duration;
        const credit = isFinal ? total - paidOutPrev : Math.round(total / duration);
        const paidOut = paidOutPrev + credit;
        if (credit) {
            this.state.setTreasury((this.state.treasury() ?? 0) + credit);
            this.state.logMoney(`Contract income — ${ac.employer.name}`, credit, boundary, 'income');
        }
        const updated: ContractOffer = { ...ac, paidMonths, paidOut };
        if (isFinal) this.complete({ ...updated, completedDate: boundary });
        else this.state.setAcceptedContract(updated);
    }

    private payrollTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() === 'hotspots') return;
        if (this.state.packId()) return;
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

    private maintenanceTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() === 'hotspots') return;
        if (this.state.packId()) return;
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

    private monthlyWarchestTick(boundary: CampaignDate): void {
        if (this.state.campaignSystem() !== 'hotspots') return;
        // Skip the whole tick so a month advance never bleeds a phantom −500 SP or writes ledger rows to a non-existent
        // company (R0.2 worst-five #2). A plain campaign / a GM who built or brought a company has warchestSP set → runs as today.
        if (this.state.companylessTable()) return;
        const scale = this.state.scaleFor() ?? 1;
        // "Monthly settlement · net ±N SP" toast so a month advance never storms two-per-month.
        const before = this.state.warchestSP() ?? 0;
        this.warchest.post('Maintenance', this.warchest.maintenance(scale), 0, boundary, { silent: true });
        // (negative cost). No contract → no base pay, and Maintenance still bleeds (book-faithful).
        const contract = this.state.contractFor();
        // GM is not a party to it (if he fields, his participant contract pays him per track on the slip). A plain campaign's
        // contract never carries `party` → the branch is dead there, byte-identical.
        if (contract?.status === 'active' && contract.party !== 'session') {
            const basePay = Math.round((500 * scale * resolved(contract.steps).basePay) / 100);
            if (basePay > 0) this.warchest.post('Base Pay', -basePay, 0, boundary, { silent: true });
        }
        const after = this.state.warchestSP() ?? 0;
        this.warchest.announceSettlement('Monthly settlement', before - after, after); // paid = net spend (income → negative)
    }

    private recoveryTick(): void {
        const pilots = this.state.pilots();
        if (!pilots?.length) return;
        let changed = false;
        const next = pilots.map((p) => {
            if (p.status !== 'Injured') return p;
            changed = true;
            const left = (p.recoveryDays ?? 0) - 30;
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
        this.state.setMissionSpec(null);
        this.tree.closeTree(contract);
    }
}
