import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { formatDate } from '../clock/campaign-clock';
import type { ProtoInstance } from '../force/force-generator';
import {
    generateStartingPersonnel, generateCandidatePool, computeStaffing, computePayroll, commandAvgSkill,
    PERSONNEL_TUNABLES, type PersonnelTier,
} from './starting-personnel';

@Injectable({ providedIn: 'root' })
export class PersonnelService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private rolling = false; // re-entrancy guard (the dashboard ctor can re-fire on re-construction)

    /**
     * Forward-only: roll + store the starting SUPPORT roster ONCE if absent. Returns true if it stored (the
     * caller persists). Mirrors ensureStartingInventory/ensureBios at the dashboard-ctor ensure seam. No-op when
     * a roster already exists (deterministic: the stored state is authoritative, never re-rolled) OR while a
     * roll is already in flight. Never throws (safe default — rolls on a later load).
     */
    ensureStartingPersonnel(): boolean {
        if (this.rolling || this.state.personnel()) return false; // in-flight or already rolled → never re-roll
        const force = (this.state.startingForce() ?? []) as ProtoInstance[];
        if (force.length === 0) return false; // no force yet → nothing to staff
        this.rolling = true;
        try {
            const tier = (this.state.resources() ?? 'normal') as PersonnelTier;
            // distinct seed from the inventory roll (independent stream) but stable per campaign + force size
            const seed = `${this.state.commandName() ?? this.state.unit() ?? 'command'}|${this.state.startDate()?.y ?? 0}|${force.length}|personnel`;
            const date = this.state.currentDate() ?? this.state.startDate();
            const personnel = generateStartingPersonnel({
                unitCount: force.length, tier, seed, generatedAt: date ? formatDate(date) : 'Begin',
            });
            this.state.setPersonnel(personnel);
            return true;
        } catch {
            return false;
        } finally {
            this.rolling = false;
        }
    }

    /** The refreshing personnel market — keyed by campaign MONTH. STABLE within a month (deterministic per
     *  seed+periodKey); rebuilds (clear-and-rebuild) when the clock crosses into a new month (forward-only-
     *  per-period). Returns true if it (re)built (the caller persists). Lazy: called on Barracks view + a
     *  currentDate-change effect, so a clock advance rebuilds on the next look. */
    ensureHiringMarket(): boolean {
        const date = this.state.currentDate() ?? this.state.startDate();
        if (!date) return false;
        const periodKey = `${date.y}-${date.m}`;
        const cur = this.state.hiringMarket();
        if (cur && cur.periodKey === periodKey) return false; // already current for this month → no re-roll
        const force = (this.state.startingForce() ?? []) as ProtoInstance[];
        const tier = (this.state.resources() ?? 'normal') as PersonnelTier;
        const seed = `${this.state.commandName() ?? this.state.unit() ?? 'command'}|${this.state.startDate()?.y ?? 0}`;
        const pool = generateCandidatePool({ unitCount: force.length, tier, periodKey, seed, commandAvgLevel: commandAvgSkill(this.state.personnel()?.roster ?? []) });
        this.state.setHiringMarket({ periodKey, pool });
        return true;
    }

    /** HIRE: a pool candidate → the support roster (active), removed from the pool; payroll + staffing + ledger
     *  recompute live (shared personnel() signal); the signing bonus is debited from the treasury. Persists. */
    hire(candidateId: string): boolean {
        const market = this.state.hiringMarket();
        if (!market) return false;
        const cand = market.pool.find((c) => c.id === candidateId);
        if (!cand) return false;
        // lands: ensureStartingPersonnel rolls the starting staff when a force exists, else fall back to an empty base.
        let pn = this.state.personnel();
        if (!pn) {
            this.ensureStartingPersonnel();
            const date = this.state.currentDate() ?? this.state.startDate();
            pn = this.state.personnel() ?? { roster: [], staffing: computeStaffing([]), monthlyPayroll: 0, generatedAt: date ? formatDate(date) : 'Begin', tier: (this.state.resources() ?? 'normal') as PersonnelTier };
        }
        const { signingBonus, ...person } = cand; // drop the one-time bonus; the rest becomes a roster member
        const roster = [...pn.roster, person];
        this.state.setPersonnel({ ...pn, roster, staffing: computeStaffing(roster), monthlyPayroll: computePayroll(roster) });
        this.state.setHiringMarket({ ...market, pool: market.pool.filter((c) => c.id !== candidateId) });
        if (signingBonus > 0) {
            this.state.setTreasury((this.state.treasury() ?? 0) - signingBonus);
            this.state.logMoney(`Signing bonus — ${person.name}`, -signingBonus, null, 'admin');
        }
        void this.store.persistCurrent();
        return true;
    }

    /** FIRE: a roster member → off the roster + payroll (a reversible mutation, not a hard delete); an optional
     *  severance (severanceMonths × salary) is debited. Staffing/payroll/ledger recompute live. Persists. */
    fire(personId: string): boolean {
        const pn = this.state.personnel();
        if (!pn) return false;
        const person = pn.roster.find((p) => p.id === personId);
        if (!person) return false;
        const roster = pn.roster.filter((p) => p.id !== personId);
        this.state.setPersonnel({ ...pn, roster, staffing: computeStaffing(roster), monthlyPayroll: computePayroll(roster) });
        const severance = Math.round(person.salary * PERSONNEL_TUNABLES.severanceMonths);
        if (severance > 0) {
            this.state.setTreasury((this.state.treasury() ?? 0) - severance);
            this.state.logMoney(`Severance — ${person.name}`, -severance, null, 'admin');
        }
        void this.store.persistCurrent();
        return true;
    }
}
