import { Injectable, inject, signal } from '@angular/core';
import { NewCampaignState, type WarchestEntry, type CampaignStartDate } from '../new-campaign-state';
import { type OutcomeGate } from '../mission/mission-tree';
import { CHAOS_START, CHAOS_MONTHLY, combatPayFor, salvageFractionFor } from './chaos-sp-costs';

/** DIRECTIVE-139 — a player-facing SP transaction announcement (drives the transaction toast). `paid` > 0 is a
 *  spend (−SP), `paid` < 0 is income (+SP); `settlement` marks the coalesced month roll-up. The `id` increments
 *  per announcement so two identical transactions still fire distinct toasts. Transient; never persisted. */
export interface SpTx { id: number; event: string; paid: number; balance: number; settlement?: boolean; note?: boolean; action?: 'ledger' | 'repair'; }

/**
 * DIRECTIVE-109 — the Chaos Campaign Warchest (SP economy) service. The Hot Spots fork's accounting core:
 * a dedicated, book-faithful Support-Point ledger run through the Contract Record Sheet format
 * (Month | Event | Cost | Cover | Paid | Balance | Rep). Only active when campaignSystem()==='hotspots' —
 * callers gate on that; this service just moves SP. Cover is 0 this slice (no active contract → D-110).
 */

// The OutcomeGate→pay-tier map + pay/salvage arithmetic live in chaos-sp-costs.ts (COMBAT_TIER_BY_GATE /
// combatPayFor / salvageFractionFor) — moved there by DIRECTIVE-HARDEN-1 so they're pure + unit-tested.

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

    /** Seed a fresh Hot Spots campaign's Warchest + Reputation + Scale + the opening ledger line. D-113 — the
     *  values come from the chosen Start Profile; a no-arg call (D-109 default caller) uses CHAOS_START (Merc). */
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

    // ── DIRECTIVE-139 — the transaction-feedback channel: every PLAYER-INITIATED post announces itself here so a
    //    dashboard-mounted toast can confirm "you spent SP, and it's recorded". AUTOMATED posts (the month tick's
    //    Maintenance/Base Pay, the resolve settlement) pass { silent: true } and are coalesced/suppressed instead
    //    of storming — see announceSettlement + the callers. The signal is transient (never persisted). ──
    private txSeq = 0;
    private readonly _tx = signal<SpTx | null>(null);
    /** The last player-facing transaction announcement (a fresh id each time). The toast reads this via effect(). */
    readonly transaction = this._tx.asReadonly();
    /** DIRECTIVE-139 — a COALESCED settlement announcement (the month roll-up): one "Monthly settlement · net ±N SP"
     *  toast instead of a Maintenance + Base Pay pair per boundary. Called by monthlyWarchestTick after its silent posts. */
    announceSettlement(event: string, net: number, balance: number): void {
        this._tx.set({ id: (this.txSeq += 1), event, paid: net, balance, settlement: true });
    }
    /** DIRECTIVE-PD3 P1 (PD3-12) — a plain NOTE on the same toast channel: no SP moved, the message renders verbatim, and the
     *  toast's action is `action` ('repair' jumps to Repair & Refit, 'ledger' to the Contract Record Sheet). The resolve's
     *  battle-state reconcile speaks through this — "N units damaged — record or repair" / the LOUD sync failure. */
    announceNote(event: string, action: 'ledger' | 'repair' = 'ledger'): void {
        this._tx.set({ id: (this.txSeq += 1), event, paid: 0, balance: this.state.warchestSP() ?? 0, note: true, action });
    }

    /**
     * Post one Contract-Record-Sheet line. `cost` is the gross SP (a spend is positive; income is NEGATIVE —
     * e.g. combat pay is posted as -pay). `cover` is the employer's reimbursement (0 this slice). paid = cost −
     * cover; the balance drops by paid (so income, a negative cost, raises it). Sets warchestSP to the new balance.
     * DIRECTIVE-139 — `opts.silent` suppresses the transaction toast for AUTOMATED posts (month tick / resolve
     * settlement); the default (a player-initiated spend) announces itself on `transaction`.
     */
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
        if (!opts?.silent) this._tx.set({ id: (this.txSeq += 1), event, paid, balance }); // D-139 — announce the player transaction
    }

    /** Monthly maintenance debit (§6): 500 SP × Contract Scale. */
    maintenance(scale: number): number {
        return CHAOS_MONTHLY.maintenancePerScale * scale;
    }

    /** Combat pay earned for a resolved track (§7): the outcome tier's SP × Track Scale. */
    combatPay(tier: OutcomeGate, scale: number): number {
        return combatPayFor(tier, scale);
    }

    /** D-110b — the ESTIMATED-salvage fraction of the OpFor BV for a resolved track's outcome tier (reuses the
     *  same gate→tier map as combat pay; fractions tunable in TIER_SALVAGE_FRACTION). Failure/override → 0. */
    salvageFraction(tier: OutcomeGate): number {
        return salvageFractionFor(tier);
    }
}
