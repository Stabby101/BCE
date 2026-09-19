import { Injectable, Injector, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { eraActivePool, resolveMekbayEraId } from '../faction/faction-select';
import { PIRATE_FACTIONS } from '../faction/faction-flavor';
import { EMPLOYER_TRAITS, DEFAULT_TIER_BY_GROUP, type EmployerTraits } from './employer-traits';
import {
    generateMarket,
    type ContractMarket,
    type ContractOffer,
    type EmployerEntry,
    type TargetEntry,
    type MissionColumn,
} from './contract-market';
import { ContractTerms } from './contract-terms';
import type { Faction } from '../../models/factions.model';
import { StarSystemsService } from '../star/star-systems.service';
import { plausibleTargets } from './faction-matchup';

/** Renegotiable clause keys (the four stored 2d6 rolls). */
export type ClauseId = 'command' | 'salvage' | 'support' | 'transport';
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** Interim rating -> CamOps reputation MODIFIER (Green3/Regular5/Veteran7/Elite9; T-022). */
const RATING_MODIFIER: Record<string, number> = { Green: 3, Regular: 5, Veteran: 7, Elite: 9 };
/** STANDARD hiring hall column (CamOpsContractMarket.HiringHallModifiers). */
const STANDARD_HALL = { offersMod: 2, employersMod: 1, missionsMod: 1 };
/** INTERIM: no negotiator personnel yet (T-018) -> CamOps findNegotiationSkill returns 0. */
const NEGOTIATION_SKILL_INTERIM = 0;
/** INTERIM: stand-in for Accountant.getContractBase() (force monthly value); C-bills/'Mech. (T-022) */
const PER_MECH_MONTHLY_BASE = 100_000;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const PIRATE_NORM = new Set(PIRATE_FACTIONS.map(norm));
const isClanGroup = (g: string): boolean => g === 'IS Clan' || g === 'HW Clan';

@Injectable({ providedIn: 'root' })
export class ContractMarketService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly injector = inject(Injector);
    private readonly star = inject(StarSystemsService);

    constructor() {
        // current era, so a headless render can prove no era-implausible matchup (Capellan→Clan-Wolf) is offered.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d102')) {
            (window as unknown as Record<string, unknown>)['__d102market'] = (): unknown => {
                const eraId = this.data.isDataReady() ? resolveMekbayEraId(this.state.era(), this.data.getEras()) : null; // MekBay id (pools)
                const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
                const adjacency = this.factionAdjacencyForTerritory(); // systems.json era-id space (territory)
                const factions = this.data.getFactions();
                const employers = this.buildEmployers(factions, eraId).employers.filter((e) => !e.generic && e.isFaction);
                const allTargets = this.buildTargets(factions, eraId, []);
                const matrix = employers.map((e) => ({
                    employer: e.name,
                    plausible: plausibleTargets(e.name, allTargets.filter((t) => t.name !== e.name), { adjacency, year }).map((t) => t.name),
                }));
                return { eraId, year, employers: employers.map((e) => e.name), targets: allTargets.map((t) => t.name), matrix, adjacencyKeys: Object.keys(adjacency).length };
            };
        }
    }

    /** Background-warm the catalog (called from the merc step so Begin is fast). Fire-and-forget. */
    warm(): void {
        if (!this.data.isDataReady() && !this.data.isDownloading()) {
            this.data.initialize().catch(() => { /* surfaced at generation time */ });
        }
    }

    /** Generate the market once for the current MERC campaign and store it on the state. */
    async generateForCampaign(): Promise<ContractMarket> {
        let dataOk = true;
        try {
            await this.ensureData();
            await this.star.ensureLoaded();
        } catch {
            dataOk = false; // offline -> generics-only fallback (never dead-end)
        }
        const market = this.buildMarketCore(dataOk);
        this.state.setContractMarket(market);
        this.state.setAcceptedContract(null);
        return market;
    }

    refreshMarket(): boolean {
        if (!this.data.isDataReady()) return false;
        this.state.setContractMarket(this.buildMarketCore(true));
        return true;
    }

    private factionAdjacencyForTerritory(): Record<string, string[]> {
        const sysEraId = this.state.era()?.id;
        return sysEraId != null ? this.star.factionAdjacency(sysEraId) : {};
    }

    private buildMarketCore(dataOk: boolean): ContractMarket {
        const eraId = dataOk ? resolveMekbayEraId(this.state.era(), this.data.getEras()) : null;
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
        const ratingModifier = RATING_MODIFIER[this.state.rating() ?? 'Regular'] ?? 5;
        const forceCount = this.state.unitSize()?.count ?? 1;

        const factions = dataOk ? this.data.getFactions() : [];
        const { employers, misses } = this.buildEmployers(factions, eraId);
        const targets = this.buildTargets(factions, eraId, employers);

        if (misses.length) {
            console.warn(`[employers] ${employers.filter((e) => !e.generic).length - misses.length}/${employers.filter((e) => !e.generic).length} faction employers classified; ${misses.length} via group fallback: ${misses.join(', ')}`);
        }

        return generateMarket({
            year,
            eraId: eraId ?? 0,
            ratingModifier,
            negotiationSkill: NEGOTIATION_SKILL_INTERIM,
            hiringHall: STANDARD_HALL,
            forceCount,
            perMechBase: PER_MECH_MONTHLY_BASE,
            employers,
            targets,
            employerMisses: misses,
            factionAdjacency: this.factionAdjacencyForTerritory(),
        });
    }

    accept(offer: ContractOffer): void {
        const date = this.state.currentDate() ?? this.state.startDate() ?? undefined;
        this.state.setAcceptedContract({ ...offer, status: 'ACTIVE', acceptedDate: date ?? undefined, paidMonths: 0, paidOut: 0 });
        this.state.setMissionSpec(null);
    }

    acceptQuickMissionContract(): void {
        let offer = this.buildMarketCore(this.data.isDataReady()).offers[0];
        if (!offer) return;
        const enemy = this.pickEnemyFaction();
        if (enemy) offer = { ...offer, target: enemy };
        this.accept(offer);
    }
    /** A plausible opponent: an era-active, non-pirate faction other than the player's, preferring a
     *  different faction group (a real adversary), else any. Null if the catalog isn't loaded. */
    private pickEnemyFaction(): string | null {
        if (!this.data.isDataReady()) return null;
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
        const playerName = this.state.faction() ?? '';
        const player = norm(playerName);
        const pool = eraActivePool(this.data.getFactions(), eraId).filter((f) => norm(f.name) !== player && !PIRATE_NORM.has(norm(f.name)));
        if (!pool.length) return null;
        // market uses); relax to the prior different-group preference, then any (never dead-ends).
        const plausible = plausibleTargets(playerName, pool.map((f) => ({ name: f.name, group: f.group })), { adjacency: this.factionAdjacencyForTerritory(), year });
        if (plausible.length) return plausible[Math.floor(Math.random() * plausible.length)].name;
        const playerGroup = this.data.getFactions().find((f) => norm(f.name) === player)?.group;
        const diff = playerGroup ? pool.filter((f) => f.group !== playerGroup) : pool;
        const arr = diff.length ? diff : pool;
        return arr[Math.floor(Math.random() * arr.length)].name;
    }

    /**
     * Renegotiate ONE clause of a pre-acceptance offer (CamOps RAW single attempt; MekHQ rerollClause).
     * Opposed roll = (2d6 + negotiationSkill[interim 0] + ratingMod) − (2d6 + 5 employer skill);
     * change = round(margin/2) applied to the STORED clause roll, re-derived through the unchanged
     * ContractTerms math. Terms CAN worsen (RAW). Marks the clause used; caller persists. No-op if
     * already used / offer gone. Returns true on a successful (re)roll.
     */
    renegotiate(offerId: string, clause: ClauseId, rng: () => number = Math.random): boolean {
        const market = this.state.contractMarket();
        if (!market) return false;
        const idx = market.offers.findIndex((o) => o.id === offerId);
        if (idx < 0) return false;
        const offer = market.offers[idx];
        if (offer.rerollsUsed?.[clause]) return false; // one attempt per clause

        const d6 = (): number => Math.floor(rng() * 6) + 1;
        const ratingMod = market.meta.ratingModifier;
        const margin = d6() + d6() + NEGOTIATION_SKILL_INTERIM + ratingMod - (d6() + d6() + 5);
        const change = Math.round(margin / 2);
        const newRoll = clamp(offer.rolls[clause] + change, 2, 12);

        const terms = new ContractTerms(offer.missionType, offer.employer.tier, ratingMod, market.meta.year);
        const updated: ContractOffer = {
            ...offer,
            rolls: { ...offer.rolls, [clause]: newRoll },
            rerollsUsed: { ...(offer.rerollsUsed ?? {}), [clause]: true },
        };
        if (clause === 'command') updated.command = terms.commandRights(newRoll);
        else if (clause === 'salvage') updated.salvage = terms.salvage(newRoll);
        else if (clause === 'support') updated.support = terms.support(newRoll);
        else updated.transportPct = terms.transport(newRoll);

        const offers = [...market.offers];
        offers[idx] = updated;
        this.state.setContractMarket({ ...market, offers });
        return true;
    }

    // ── pools ──
    private classify(name: string): EmployerTraits | null {
        const n = norm(name);
        for (const t of EMPLOYER_TRAITS) {
            if (t.generic) continue;
            if (t.match.some((m) => norm(m) === n)) return t;
        }
        return null;
    }

    private buildEmployers(factions: Faction[], eraId: number | null): { employers: EmployerEntry[]; misses: string[] } {
        const misses: string[] = [];
        const pool = eraActivePool(factions, eraId).filter((f) => !isClanGroup(f.group)); // Clans excluded
        const employers: EmployerEntry[] = pool.map((f) => {
            const t = this.classify(f.name);
            if (!t) misses.push(f.name);
            const tier = t?.tier ?? DEFAULT_TIER_BY_GROUP[f.group] ?? 'minor';
            return {
                name: f.name,
                tier,
                periphery: t?.periphery,
                generic: false,
                isFaction: true,
                group: f.group,
                img: f.img ?? null,
                missionColumn: 'is-clan' as MissionColumn,
            };
        });
        // The 4 CamOps generic employers — always era-eligible.
        for (const g of EMPLOYER_TRAITS.filter((e) => e.generic)) {
            const column: MissionColumn = g.tier === 'corporation' ? 'corporation' : g.tier === 'mercenary' ? 'is-clan' : 'independent';
            employers.push({
                name: g.match[0],
                tier: g.tier,
                periphery: g.periphery,
                generic: true,
                isFaction: false,
                group: null,
                img: null,
                missionColumn: column,
            });
        }
        return { employers, misses };
    }

    private buildTargets(factions: Faction[], eraId: number | null, employers: EmployerEntry[]): TargetEntry[] {
        const pool = eraActivePool(factions, eraId);
        const targets: TargetEntry[] = pool.map((f) => ({ name: f.name, group: f.group, pirate: PIRATE_NORM.has(norm(f.name)) }));
        if (!targets.length) {
            // offline / no data -> minimal plausible targets so the market still resolves a foe
            return [
                { name: 'Pirates', group: 'Periphery', pirate: true },
                { name: 'local garrison', group: 'Other', pirate: false },
            ];
        }
        return targets;
    }

    // ── catalog readiness (mirrors the roster's ensureData) ──
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
