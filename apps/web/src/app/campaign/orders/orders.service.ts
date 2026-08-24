/*
 * BCE — HOUSE ORDERS service (DIRECTIVE-032). The non-merc mission ignition, a SIBLING of the merc
 * contract market (not a fork): it cuts a standing order (a synthetic ContractOffer), ACKNOWLEDGE mints
 * the root exactly as contract-accept (the identical D-025/26 pipeline), the clock cuts new orders on a
 * boundary with no open operation, REQUEST pulls early, REPORT COMPLETION closes the tree. No pay/clauses;
 * the walk reads the order's HOUSE_SALVAGE_DEFAULTS (10%) through the unchanged acceptedContract seam.
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { MissionTreeService } from '../mission/mission-tree.service';
import { ContractMarketService } from '../contract/contract-market.service';
import { eraActivePool, resolveMekbayEraId } from '../faction/faction-select';
import { generateOrder } from './house-orders';
import type { ContractOffer } from '../contract/contract-market';

@Injectable({ providedIn: 'root' })
export class OrdersService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly store = inject(CampaignSaveStore);
    private readonly tree = inject(MissionTreeService);
    private readonly contracts = inject(ContractMarketService);

    private isNonMerc(): boolean { return this.state.force() !== 'MERC' && !!this.state.faction(); }
    private ownFaction(): string { return this.state.faction() ?? 'Command'; }
    private eraActiveNames(): string[] {
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        return eraActivePool(this.data.getFactions(), eraId).map((f) => f.name);
    }
    private makeOrder(): ContractOffer {
        return generateOrder({ ownFaction: this.ownFaction(), ownTier: 'major', eraActiveNames: this.eraActiveNames(), seq: Math.floor(Math.random() * 1e9), rng: () => Math.random() });
    }

    /** Begin: cut the first standing order for a non-merc campaign (the sibling of market.generateForCampaign). */
    async generateForCampaign(): Promise<void> {
        if (!this.isNonMerc()) return;
        if (!this.data.isDataReady() && !this.data.isDownloading()) this.data.initialize().catch(() => { /* generics fallback */ });
        this.state.setHouseOrder(this.makeOrder());
        this.state.setAcceptedContract(null);
    }

    /** ACKNOWLEDGE — mints the root EXACTLY as contract-accept → the identical pipeline. Persists. */
    acknowledge(): void {
        const order = this.state.houseOrder();
        if (!order) return;
        this.contracts.accept(order); // → acceptedContract ACTIVE (House order: no pay, salvage 10%)
        this.tree.mintRoot(order);
        this.state.setHouseOrder(null);
        void this.store.persistCurrent();
    }

    /** REQUEST ORDERS — the GM pull; only when nothing is open. Persists. */
    requestOrders(): void {
        if (!this.canCutOrders()) return;
        this.state.setHouseOrder(this.makeOrder());
        void this.store.persistCurrent();
    }

    /** REPORT COMPLETION — D-026 closure of the operation tree + clear the active order; next orders at the
     *  next month boundary or on request. Persists. */
    reportCompletion(): void {
        const ac = this.state.acceptedContract();
        this.tree.closeTree(ac ?? undefined);
        this.state.setAcceptedContract(null);
        this.state.setMissionSpec(null);
        void this.store.persistCurrent();
    }

    /** Clock subscriber: on a boundary with no open operation, cut new orders. Caller persists (D-022 txn). */
    cutIfDue(): void {
        if (!this.canCutOrders()) return;
        this.state.setHouseOrder(this.makeOrder());
    }

    /** Eligible to cut: non-merc, no active order, no standing order, no open tree (ACTIVE/AVAILABLE/LOCKED). */
    canCutOrders(): boolean {
        if (!this.isNonMerc()) return false;
        if (this.state.acceptedContract()) return false;
        if (this.state.houseOrder()) return false;
        return !(this.state.missionTree() ?? []).some((b) => b.state === 'ACTIVE' || b.state === 'AVAILABLE' || b.state === 'LOCKED');
    }

    /** REPORT COMPLETION is GM-anytime (with confirm) whenever an order is active — the natural trigger is
     *  a tree with no open branches, but the GM may close out early (the dashboard notes open operations). */
    canReportCompletion(): boolean {
        return this.isNonMerc() && !!this.state.acceptedContract();
    }
    /** True when the operation tree still has open (ACTIVE/AVAILABLE) branches — an informational hint. */
    hasOpenOperations(): boolean {
        return (this.state.missionTree() ?? []).some((b) => b.state === 'ACTIVE' || b.state === 'AVAILABLE');
    }
}
