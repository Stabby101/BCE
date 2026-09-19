import { Injectable, inject, signal } from '@angular/core';
import { NewCampaignState, type WarchestEntry, type CampaignStartDate } from '../new-campaign-state';
import { type OutcomeGate } from '../mission/mission-tree';
import { CHAOS_START, CHAOS_MONTHLY, combatPayFor, salvageFractionFor } from './chaos-sp-costs';

export interface SpTx { id: number; event: string; paid: number; balance: number; settlement?: boolean; note?: boolean; action?: 'ledger' | 'repair'; }


// The OutcomeGate→pay-tier map + pay/salvage arithmetic live in chaos-sp-costs.ts (COMBAT_TIER_BY_GATE /

@Injectable({ providedIn: 'root' })
export class WarchestService {
    private readonly state = inject(NewCampaignState);

    /** The 1-based campaign month (Month 1 = the campaign's start month) for the ledger's Month column. */
    private campaignMonth(date?: CampaignStartDate | null): number {
        const start = this.state.startDate();
        const cur = date ?? this.state.currentDate() ?? start;
        if (!start || !cur) return 1;
        return Math.max(1, (cur.y - start.y) * 12 + (cur.m - start.m) + 1);
    }

    seed(p?: { warchestSP: number; reputation: number; scale: number }): void {
        const s = this.state;
        const sp = p?.warchestSP ?? CHAOS_START.warchestSP;
        const rep = p?.reputation ?? CHAOS_START.reputation;
        const scale = p?.scale ?? CHAOS_START.contractScale;
        s.setReputation(rep);
        s.setContractScale(scale);
        s.setWarchestSP(sp);
        s.setWarchestLedger([
            { month: 1, event: 'Starting Warchest', cost: 0, cover: 0, paid: 0, balance: sp, rep }, // opening = Month 1
        ]);
    }

    //    dashboard-mounted toast can confirm "you spent SP, and it's recorded". AUTOMATED posts (the month tick's
    //    Maintenance/Base Pay, the resolve settlement) pass { silent: true } and are coalesced/suppressed instead
    //    of storming — see announceSettlement + the callers. The signal is transient (never persisted). ──
    private txSeq = 0;
    private readonly _tx = signal<SpTx | null>(null);
    /** The last player-facing transaction announcement (a fresh id each time). The toast reads this via effect(). */
    readonly transaction = this._tx.asReadonly();
    announceSettlement(event: string, net: number, balance: number): void {
        this._tx.set({ id: (this.txSeq += 1), event, paid: net, balance, settlement: true });
    }
    announceNote(event: string, action: 'ledger' | 'repair' = 'ledger'): void {
        this._tx.set({ id: (this.txSeq += 1), event, paid: 0, balance: this.state.warchestSP() ?? 0, note: true, action });
    }

    post(event: string, cost: number, cover = 0, date?: CampaignStartDate | null, opts?: { silent?: boolean }): void {
        const s = this.state;
        const prev = s.warchestSP() ?? 0;
        const paid = cost - cover;
        const balance = prev - paid;
        const entry: WarchestEntry = {
            month: this.campaignMonth(date),
            event,
            cost,
            cover,
            paid,
            balance,
            rep: s.reputation() ?? CHAOS_START.reputation,
        };
        s.pushWarchestEntry(entry);
        s.setWarchestSP(balance);
        if (!opts?.silent) this._tx.set({ id: (this.txSeq += 1), event, paid, balance });
    }

    /** Monthly maintenance debit (§6): 500 SP × Contract Scale. */
    maintenance(scale: number): number {
        return CHAOS_MONTHLY.maintenancePerScale * scale;
    }

    /** Combat pay earned for a resolved track (§7): the outcome tier's SP × Track Scale. */
    combatPay(tier: OutcomeGate, scale: number): number {
        return combatPayFor(tier, scale);
    }

    salvageFraction(tier: OutcomeGate): number {
        return salvageFractionFor(tier);
    }
}
