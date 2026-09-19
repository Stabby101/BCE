import { Injectable, computed, signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { ContractMarket, ContractOffer } from './contract/contract-market';
import { syntheticOfferFromChaos, type ChaosContract, type ContractSummary, type VoidedContract } from './chaos/chaos-contract';
import type { PresetTrack } from './chaos/chaos-track-preset';
import type { HotSpot } from './chaos/hotspots-catalog';
import type { PresentedHotspot } from './gm/presented-hotspot';
import type { ResultsSlip } from './gm/results-slip';
import type { OdmProjection } from './odm/odm-projection';
import type { OdmLedgerEntry, OdmSeatRequest } from './odm/odm-ledger';
import type { OdmGmMission, OdmGmDraft } from './odm/odm-gm-mission';
import type { HiredMerc } from './chaos/hire-personnel';
import type { ProtoInstance } from './force/force-generator';
import type { ForceStructure } from './force/force-structure';
import type { Pilot } from './barracks/pilot-generator';
import type { MissionSpec } from './mission/mission-spec';
import type { MissionBranch, TreeArchiveEntry, OutcomeRecord } from './mission/mission-tree';
import type { Bay, BayHistoryEntry, TechPool } from './repair/repair-bays';
import type { InventoryState } from './inventory/starting-inventory';
import type { ShopOrder } from './inventory/inventory-shop';
import type { PersonnelState, HiringMarket } from './personnel/starting-personnel';

export interface CampaignEra {
    id: number;
    name: string;
    from: number;
    to: number; // 9999 = present
}

export interface CampaignStartDate {
    y: number;
    m: number; // 0-11
    d: number;
}

export interface TableBound {
    sessionId: string;    // the GM session campaign's id
    sessionName?: string; // the GM session's save name (display)
    since: number;        // epoch ms — when this company joined the table
}

export interface CampaignUnitSize {
    id: string;    // 'single' | 'lance' | 'company' | 'battalion' | 'regiment'
    name: string;  // display, e.g. "Lance"
    count: number; // 'Mech count — drives the capital scaling
}

export interface CampaignCapital {
    tier: string;   // 'Low' | 'Standard' | 'High' | 'Custom'
    amount: number; // C-bills
}

export interface CampaignLogEntry {
    date: CampaignStartDate;
    text: string;
    kind?: 'purchase' | 'sale' | 'walk' | 'repair' | 'admin' | 'income' | 'parts';
    amount?: number;
    balance?: number;
}

export interface WarchestEntry {
    month: number; // 1-based campaign month (Month 1 = the campaign's start month)
    event: string;
    cost: number;
    cover: number;
    paid: number;
    balance: number;
    rep: number;
}

export interface PayrollShortfall {
    month: CampaignStartDate;
    unpaid: number;
    kind?: 'payroll' | 'maintenance';
}

export interface OdmStockBin {
    tons: number;
    floorTons: number | null;
    note?: string; // authored one-liner (e.g. why a bin is zero) — GM-side display only
    quarantinedTons?: number;
}

export interface OdmMaintenanceRecord {
    lastDone?: { y: number; m: number; d: number };  // absent = the campaign start anchors the clock
    progressHours?: number;                          // hours burned toward the current due cycle
    needHours?: number;                              // this cycle's price (18 light / 24 heavy) — stamped when the cycle comes due
    lastRollMonths?: number;                         // how many overdue-months have been breakdown-rolled (the monthly cadence marker)
}

export interface OdmSupportCounts { available: number; deployed: number; expended: number }

export interface OdmBenchJob {
    id: string;
    kind: 'assess' | 'inspect' | 'repair' | 'ammo';
    label: string;                 // component label · or the BIN name for kind 'ammo'
    count: number;                 // items (components) · tons (ammo)
    outcome?: { a: number; b: number; c: number }; // 'assess' only — the GM's grading, applied at completion
    hoursRemaining: number;
    startedDate: { y: number; m: number; d: number };
}
export interface OdmStocks {
    fuelTons: number;
    fuelCapacityTons: number;
    fuelFloorTons: number;
    crackerTonsPerDay: number; // the fuel crackers' production rate
    missionBurnTons: number; // baseline fuel burn per operation
    bins: Record<string, OdmStockBin>; // insertion-ordered by seed; keyed by display name (LRM, SRM, …)
    exposure: string;
    invAmmoMigrated?: boolean;
}

export interface IntelNote {
    noteId: string;
    date: CampaignStartDate;
    text: string;
    npcId?: string;
}
export interface IntelState {
    statuses: Record<string, string>; // npcId → active | burned | dead | captured | promoted
    introduced: string[];             // GM-introduced npcIds
    notes: IntelNote[];
    odmFiled?: string[];
}

@Injectable({ providedIn: 'root' })
export class NewCampaignState {
    //    Begin read it to skip the campaign chrome (contract market / economy / barracks / save). In-memory
    //    only (a one-shot is ephemeral — no snapshot field); cleared by reset() so New Campaign is unaffected. ──
    readonly quickMission = signal(false);
    //    (the force-gen pool drops vehicles). In-memory; cleared by reset(); the OpFor matches it. ──
    readonly armsMix = signal<'mechs' | 'combined'>('combined');
    //    armsMix default); 'mechs'/'combined' FORCE it for the next generation. In-memory (a GM choice, not a
    //    save field); cleared by reset(). PRECEDENCE: this override > seed.armsMix > campaign armsMix(). ──
    readonly missionArmsMixOverride = signal<'auto' | 'mechs' | 'combined'>('auto');
    readonly era = signal<CampaignEra | null>(null);
    readonly startDate = signal<CampaignStartDate | null>(null);
    readonly force = signal<string | null>(null);    // step-2 archetype code
    readonly faction = signal<string | null>(null);  // step-3 faction name
    readonly unit = signal<string | null>(null);     // step-3 formation name, or '__custom__'
    readonly unitSize = signal<CampaignUnitSize | null>(null); // step-4 unit size
    readonly capital = signal<CampaignCapital | null>(null);   // step-4 starting capital
    readonly resources = signal<string | null>(null);         // step-4 resource tier id: lean|normal|established

    readonly commandName = signal<string | null>(null);      // the named command (canon-modeled or own)
    readonly commandFaction = signal<string | null>(null);
    readonly rating = signal<string | null>(null);           // Green | Regular | Veteran | Elite
    readonly logisticsProfile = signal<string | null>(null); // 'merc-market' for mercs (display-only now)

    readonly contractMarket = signal<ContractMarket | null>(null);
    readonly acceptedContract = signal<ContractOffer | null>(null);
    readonly houseOrder = signal<ContractOffer | null>(null);

    readonly startingForce = signal<ProtoInstance[] | null>(null);
    readonly forceStructure = signal<ForceStructure | null>(null);
    readonly pilots = signal<Pilot[] | null>(null);
    readonly formation = signal<string | null>(null);

    //    capital value made live; completedContracts is the read-only contract log. ──
    readonly currentDate = signal<CampaignStartDate | null>(null);
    readonly treasury = signal<number | null>(null);
    readonly completedContracts = signal<ContractOffer[]>([]);
    readonly missionSpec = signal<MissionSpec | null>(null);
    //    recurs across missions. flag→npcId and roleFamily→voiceId. ──
    readonly npcAssignments = signal<Record<string, string>>({});
    readonly staffVoices = signal<Record<string, string>>({});
    //    per-thread (contractId→level) escalation, and the campaign-wide fallback tempo. All persisted; old
    //    saves rehydrate neutral (empty/0). The generator drifts the next bvTarget by the active thread's level. ──
    readonly outcomeLedger = signal<OutcomeRecord[]>([]);
    readonly escalationByThread = signal<Record<string, number>>({});
    readonly escalationCampaign = signal<number>(0);
    readonly missionTree = signal<MissionBranch[]>([]);
    readonly treeArchive = signal<TreeArchiveEntry[]>([]);
    readonly campaignLog = signal<CampaignLogEntry[]>([]);
    readonly bays = signal<Bay[] | null>(null);
    readonly bayHistory = signal<BayHistoryEntry[] | null>(null);
    readonly intel = signal<IntelState | null>(null);
    readonly techPool = signal<TechPool | null>(null);
    readonly inventory = signal<InventoryState | null>(null);
    readonly shopOrders = signal<ShopOrder[] | null>(null);
    readonly personnel = signal<PersonnelState | null>(null);
    readonly hiringMarket = signal<HiringMarket | null>(null);
    //    future T-040 turnover/morale system. [] until the first shortfall. ──
    readonly payrollShortfalls = signal<PayrollShortfall[]>([]);

    //    Defaulted at creation (size-capital begin()) to the chosen faction's capital; GM-changeable on the
    //    Overview; persisted. Old saves lack it → hydrate defaults null (the Overview simply shows no line). ──
    readonly currentLocation = signal<string | null>(null);

    //    gated on this; CBT stays byte-identical. Chosen at the FRONT of setup; persisted; old saves → CBT. ──
    readonly gameSystem = signal<GameSystem>(GameSystem.CLASSIC);

    //    vs Hot Spots (Chaos Campaign), + the chosen Hot Spot campaign id. This sits ABOVE era, so it must NOT
    //    cascade-clear downstream force/faction/etc. Persisted; old saves → null (treated as Traditional). ──
    readonly campaignSystem = signal<'traditional' | 'hotspots' | null>(null);
    readonly packId = signal<string | null>(null);
    readonly odmOutcomes = signal<Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }>>({});
    readonly odmActiveNodeId = signal<string | null>(null);
    // the rolled roster is a pure fn(seed, opfor-spec) recomputed GM-side (the snapshot fans to players wholesale).
    readonly odmSeeds = signal<Record<string, string>>({});
    // v1 DISPLAYS + GM-adjusts only (R2: no auto-consumption); seeds lifted from the authored pack ledger.
    // NB comments here reach BOTH bundles — never name pack content (the odm2 dist leak-net greps for it).
    readonly odmStocks = signal<OdmStocks | null>(null);
    readonly odmFleetStatus = signal<Record<string, string>>({});
    readonly odmBench = signal<OdmBenchJob[]>([]);
    readonly odmMaintenance = signal<Record<string, OdmMaintenanceRecord>>({});
    readonly odmSupport = signal<Record<string, OdmSupportCounts>>({});
    readonly hotSpotCampaign = signal<string | null>(null);

    //    warchestSP/reputation null under Traditional (no warchest); contractScale defaults 1; ledger = the
    //    Contract Record Sheet rows. Runtime economy state (persisted via the host store like treasury/log). ──
    readonly warchestSP = signal<number | null>(null);
    readonly reputation = signal<number | null>(null);
    readonly contractScale = signal<number>(1);
    readonly warchestLedger = signal<WarchestEntry[]>([]);

    //    time; drives Base Pay / support Cover / Reputation. Null under Traditional / between contracts. ──
    readonly activeChaosContract = signal<ChaosContract | null>(null);
    //    company, keyed by the P1 participant identity (the home campaign id the mint's provenance carries). GM truth:
    //    rides under gmOnly, never written by a non-GM campaign (the map stays {} there → every accessor below returns
    //    the PRIMARY, byte-identical). `participantContract`: THIS device's own contract, attached per-recipient by the
    //    server fan (never written by a client writer). `contractSummary`: the player-safe projection of the primary
    readonly participantContracts = signal<Record<string, ChaosContract>>({});
    readonly participantContract = signal<ChaosContract | null>(null);
    readonly contractSummary = signal<ContractSummary | null>(null);
    // PD3 P2 — the TERMINAL contract record: the completed singular's player-safe summary (status 'completed'), written at both
    // completion sites (the intensity auto-complete + End Contract) where the singular is nulled; cleared when a new one starts.
    // Top-level in the fan (every device must tell "complete" from "never minted"). Old saves lack it → null.
    readonly completedChaosContract = signal<ContractSummary | null>(null);
    // device's own void, attached per recipient by the fan (never written by a client writer) — the notice + the refund.
    readonly voidedContracts = signal<Record<string, VoidedContract>>({});
    readonly participantVoid = signal<VoidedContract | null>(null);
    /** The ONE accessor the load-bearing sites read "which contract" through: a participant's own contract when one is
     *  signed for that key, else the PRIMARY (the singular). No key → the primary. */
    contractFor(key?: string | null): ChaosContract | null {
        return (key ? this.participantContracts()[key] : undefined) ?? this.activeChaosContract();
    }
    /** The synthetic Traditional offer for the same choice (the shared Forge reads the offer, never the ChaosContract). */
    offerFor(key?: string | null): ContractOffer | null {
        const pc = key ? this.participantContracts()[key] : undefined;
        return pc ? syntheticOfferFromChaos(pc) : this.acceptedContract();
    }
    /** The Contract Scale for the same choice (the hidden second copy `contractScale` is the primary's). */
    scaleFor(key?: string | null): number {
        const pc = key ? this.participantContracts()[key] : undefined;
        return pc?.scale ?? this.contractScale();
    }
    readonly gmDifficulty = signal<number>(1.0);

    //    user's own content). Persisted with the campaign; portable via Export/Import JSON. Empty under Traditional. ──
    readonly chaosTrackPresets = signal<PresetTrack[]>([]);
    //    premade packs; persisted with the campaign; portable via Export/Import JSON. Empty under Traditional. ──
    readonly customHotSpots = signal<HotSpot[]>([]);
    // ── HSFORGE-1 — FORGED hotspots (the Hot Spots Forge's generated content). A SIBLING slice to customHotSpots,
    //    deliberately distinct (ruling D1): forged is ENGINE content — no custom:true stamp (no era-filter bypass),
    //    not read by the api guest gate (ruling D2), not user homebrew for takedown purposes. Persisted with the
    //    campaign (additive optional snapshot field); maps onto the future D-0b HsState slice. Empty under Traditional. ──
    readonly forgedHotSpots = signal<HotSpot[]>([]);
    // ── HSFORGE-1 Phase 2 — the merc command's THEATER (a region id from hsforge-regions.json), picked at
    //    merc-command setup (specific or 🎲 Random, resolved at pick). null = era-only (today's behavior
    //    byte-identical — ruling D11: passing it to hotSpotCatalog activates the dormant region filter).
    //    Persisted (additive optional); HsState slice under D-0b. Null under Traditional. ──
    readonly hsRegion = signal<string | null>(null);
    readonly hiredMercs = signal<HiredMerc[]>([]);
    readonly contractHiredKeys = signal<string[]>([]);
    //    across reloads (re-rolled only by the paid button or when empty + no active contract). HS-only.
    readonly hotSpotOffer = signal<string[]>([]);
    //    deal/reroll are suppressed. Persisted like hotSpotOffer; default false. HS-only.
    readonly hotSpotShowAll = signal<boolean>(false);
    //    (reroll off) instead of the normal chamber. Persisted like hotSpotOffer; default false (old saves → false). HS-only.
    readonly reckoningBegun = signal<boolean>(false);
    //    Additive snapshot flag; default false (every legacy save + plain HS). Resets in reset() — NOT clearMercIdentity(),
    //    which fires on era/archetype change and would wipe the flag mid-wizard (the tile sets it before Setup).
    readonly gmSession = signal<boolean>(false);
    readonly companylessTable = computed(() => this.gmSession() && this.warchestSP() === null);
    readonly presentedHotspot = signal<PresentedHotspot | null>(null);
    // array reaches every joined player, and the field NAMED gmNotes keeps its name's promise for ODM.
    // Rides the snapshot under gmOnly.pilotNotes (the fan strips it); forward-only migration on ODM load.
    readonly gmPilotNotes = signal<Record<string, string>>({});
    // contact rows): the GM device publishes what the pack-401-walled player console may see. Top-level.
    readonly odmProjection = signal<OdmProjection | null>(null);
    // and the seat REQUESTS (top-level: a seat's holder must see its own note and its request's status move).
    readonly odmLedger = signal<OdmLedgerEntry[]>([]);
    readonly odmSeatNotes = signal<Record<string, string>>({});
    readonly odmSeatRequests = signal<OdmSeatRequest[]>([]);
    // TOP-LEVEL so the fan carries them (the player device has no pack path — §S-5); the GM-side DRAFTS carry
    // design truth and ride under gmOnly, which the server deletes unparsed for every non-GM recipient.
    readonly odmGmMissions = signal<OdmGmMission[]>([]);
    readonly gmMissionDrafts = signal<OdmGmDraft[]>([]);
    // must SEE the cap (gmOnly is stripped for players); null = unset → every consumer applies ?? 4 (the
    // directive's default lance). The server enforces it authoritatively at the import handler.
    readonly playerUnitCap = signal<number | null>(null);
    // end-state — export, not write-back; the v1 ruling). Replaced at each resolve; top-level (players
    // must receive it); rows carry NO tokens — the player filters by its own claim rows.
    readonly resultsSlip = signal<ResultsSlip | null>(null);
    readonly appliedSlips = signal<string[]>([]);
    readonly tableBound = signal<TableBound | null>(null);

    setCampaignSystem(m: 'traditional' | 'hotspots'): void {
        this.campaignSystem.set(m);
        if (m === 'traditional') this.hotSpotCampaign.set(null);
    }
    setHotSpotCampaign(id: string): void {
        this.hotSpotCampaign.set(id);
    }

    /** Step 1. Changing era clears everything downstream. */
    setEra(era: CampaignEra): void {
        const prev = this.era();
        this.era.set(era);
        if (prev && prev.id !== era.id) {
            this.startDate.set(null);
            this.force.set(null);
            this.faction.set(null);
            this.unit.set(null);
            this.unitSize.set(null);
            this.capital.set(null);
            this.resources.set(null);
            this.formation.set(null);
            this.clearMercIdentity();
        }
    }

    setStartDate(d: CampaignStartDate): void {
        this.startDate.set(d);
    }

    /** Step-2 archetype. Changing it clears the downstream faction/unit/size/capital/resources + merc identity. */
    setQuickMission(v: boolean): void {
        this.quickMission.set(v);
    }
    setArmsMix(v: 'mechs' | 'combined'): void {
        this.armsMix.set(v);
    }
    setMissionArmsMixOverride(v: 'auto' | 'mechs' | 'combined'): void {
        this.missionArmsMixOverride.set(v);
    }
    setForce(code: string): void {
        const prev = this.force();
        this.force.set(code);
        if (prev && prev !== code) {
            this.faction.set(null);
            this.unit.set(null);
            this.unitSize.set(null);
            this.capital.set(null);
            this.resources.set(null);
            this.formation.set(null);
            this.clearMercIdentity();
        }
    }

    /** Step-3 faction. Changing it clears unit/size/capital/resources + the chosen formation. */
    setFaction(name: string): void {
        const prev = this.faction();
        this.faction.set(name);
        if (prev && prev !== name) {
            this.unit.set(null);
            this.unitSize.set(null);
            this.capital.set(null);
            this.resources.set(null);
            this.formation.set(null);
        }
    }

    /** Step-3 unit. Changing it clears the size/capital/resources chosen for the old command. */
    setUnit(name: string): void {
        const prev = this.unit();
        this.unit.set(name);
        if (prev && prev !== name) {
            this.unitSize.set(null);
            this.capital.set(null);
            this.resources.set(null);
        }
    }

    /** Step-4 unit size. Changing it clears capital + resources — both scale with size
     *  (capital presets, and the provided DropShip), so force a re-pick. */
    setUnitSize(size: CampaignUnitSize): void {
        const prev = this.unitSize();
        this.unitSize.set(size);
        if (prev && prev.id !== size.id) {
            this.capital.set(null);
            this.resources.set(null);
        }
    }

    setCapital(cap: CampaignCapital): void {
        this.capital.set(cap);
    }

    setResources(tierId: string): void {
        this.resources.set(tierId);
    }

    setCurrentLocation(systemId: string | null): void {
        this.currentLocation.set(systemId);
    }

    setGameSystem(gs: GameSystem): void {
        const prev = this.gameSystem();
        this.gameSystem.set(gs);
        if (prev !== gs) {
            this.force.set(null);
            this.faction.set(null);
            this.unit.set(null);
            this.unitSize.set(null);
            this.capital.set(null);
            this.resources.set(null);
            this.formation.set(null);
            this.clearMercIdentity();
        }
    }

    setCommandName(name: string): void {
        this.commandName.set(name);
    }
    /** ORDER-15 (a) — the command's affiliation (a canon MUL key; '' / null = Mercenary). */
    setCommandFaction(faction: string | null): void {
        this.commandFaction.set(faction && faction.trim() ? faction.trim() : null);
    }
    setRating(rating: string): void {
        this.rating.set(rating);
    }
    setLogisticsProfile(profile: string | null): void {
        this.logisticsProfile.set(profile);
    }
    setContractMarket(market: ContractMarket | null): void {
        this.contractMarket.set(market);
    }
    setAcceptedContract(offer: ContractOffer | null): void {
        this.acceptedContract.set(offer);
    }
    setHouseOrder(order: ContractOffer | null): void {
        this.houseOrder.set(order);
    }
    setStartingForce(force: ProtoInstance[] | null): void {
        this.startingForce.set(force);
    }
    setForceStructure(structure: ForceStructure | null): void {
        this.forceStructure.set(structure);
    }
    setPilots(pilots: Pilot[] | null): void {
        this.pilots.set(pilots);
    }
    setFormation(name: string | null): void {
        this.formation.set(name);
    }
    setCurrentDate(d: CampaignStartDate | null): void {
        this.currentDate.set(d);
    }
    setTreasury(amount: number | null): void {
        this.treasury.set(amount);
    }
    //    i.e. Traditional); contractScale stays 1 this slice. pushWarchestEntry appends one Contract Record row. ──
    setWarchestSP(amount: number | null): void {
        this.warchestSP.set(amount);
    }
    setReputation(rep: number | null): void {
        this.reputation.set(rep);
    }
    setContractScale(scale: number): void {
        this.contractScale.set(scale);
    }
    setWarchestLedger(ledger: WarchestEntry[]): void {
        this.warchestLedger.set(ledger);
    }
    pushWarchestEntry(entry: WarchestEntry): void {
        this.warchestLedger.set([...(this.warchestLedger() ?? []), entry]);
    }
    setActiveChaosContract(c: ChaosContract | null): void {
        this.activeChaosContract.set(c);
        if (c) this.completedChaosContract.set(null); // PD3 P2 — a new contract supersedes the terminal record
    }
    /** PD3 P2 — record the completed contract (its player-safe summary, status 'completed') as the phase's terminal witness. */
    setCompletedChaosContract(c: ContractSummary | null): void {
        this.completedChaosContract.set(c);
    }
    setParticipantContract(key: string, c: ChaosContract | null): void {
        if (!this.gmSession()) return;
        this.participantContracts.update((m) => { const next = { ...m }; if (c) next[key] = c; else delete next[key]; return next; });
    }
    clearParticipantContracts(): void { if (Object.keys(this.participantContracts()).length) this.participantContracts.set({}); }
    setVoidedContracts(m: Record<string, VoidedContract>): void { if (!this.gmSession()) return; this.voidedContracts.set(m); }
    setGmDifficulty(v: number): void { this.gmDifficulty.set(Math.max(0.8, Math.min(1.6, v))); }
    setChaosTrackPresets(list: PresetTrack[]): void {
        this.chaosTrackPresets.set([...list]);
    }
    addChaosTrackPreset(p: PresetTrack): void {
        this.chaosTrackPresets.set([...(this.chaosTrackPresets() ?? []), p]);
    }
    updateChaosTrackPreset(p: PresetTrack): void {
        this.chaosTrackPresets.set((this.chaosTrackPresets() ?? []).map((x) => (x.id === p.id ? p : x)));
    }
    removeChaosTrackPreset(id: string): void {
        this.chaosTrackPresets.set((this.chaosTrackPresets() ?? []).filter((x) => x.id !== id));
    }
    setCustomHotSpots(list: HotSpot[]): void { this.customHotSpots.set([...list]); }
    addCustomHotSpot(h: HotSpot): void { this.customHotSpots.set([...(this.customHotSpots() ?? []), h]); }
    removeCustomHotSpot(id: string): void { this.customHotSpots.set((this.customHotSpots() ?? []).filter((x) => x.id !== id)); }
    // ── HSFORGE-1 — forged-hotspot CRUD (immutable-replace; pruning policy lives in HsForgeService) ──
    setForgedHotSpots(list: HotSpot[]): void { this.forgedHotSpots.set([...list]); }
    addForgedHotSpot(h: HotSpot): void { this.forgedHotSpots.set([...(this.forgedHotSpots() ?? []), h]); }
    setHsRegion(id: string | null): void { this.hsRegion.set(id); } // HSFORGE-1 P2
    setHiredMercs(list: HiredMerc[]): void { this.hiredMercs.set([...list]); }
    addHiredMerc(m: HiredMerc): void { this.hiredMercs.set([...(this.hiredMercs() ?? []), m]); }
    removeHiredMerc(instanceId: string): void { this.hiredMercs.set((this.hiredMercs() ?? []).filter((x) => x.instanceId !== instanceId)); }
    addContractHiredKey(key: string): void { if (!this.contractHiredKeys().includes(key)) this.contractHiredKeys.set([...this.contractHiredKeys(), key]); }
    removeContractHiredKey(key: string): void { this.contractHiredKeys.set(this.contractHiredKeys().filter((k) => k !== key)); }
    clearHiredMercs(): void { this.hiredMercs.set([]); }
    clearContractHiredKeys(): void { this.contractHiredKeys.set([]); }
    releasePerTrackMercs(): void {
        const leaving = (this.hiredMercs() ?? []).filter((m) => !m.oneTimeHire);
        if (!leaving.length) return;
        const inst = new Set(leaving.map((m) => m.instanceId));
        const pil = new Set(leaving.map((m) => m.pilotId));
        this.setStartingForce((this.startingForce() ?? []).filter((i) => !inst.has(i.instanceId)));
        this.setPilots((this.pilots() ?? []).filter((p) => !pil.has(p.pilotId)));
        this.hiredMercs.set((this.hiredMercs() ?? []).filter((m) => m.oneTimeHire));
    }
    setHotSpotOffer(ids: string[]): void { this.hotSpotOffer.set([...ids]); }
    setHotSpotShowAll(v: boolean): void { this.hotSpotShowAll.set(v); }
    setReckoningBegun(v: boolean): void { this.reckoningBegun.set(v); }
    setGmSession(v: boolean): void { this.gmSession.set(v); }
    setPresentedHotspot(p: PresentedHotspot | null): void { this.presentedHotspot.set(p); }
    setPlayerUnitCap(n: number | null): void { this.playerUnitCap.set(n); }
    setGmPilotNotes(v: Record<string, string>): void { this.gmPilotNotes.set({ ...v }); }
    setOdmProjection(p: OdmProjection | null): void { this.odmProjection.set(p); }
    setOdmLedger(l: OdmLedgerEntry[]): void { this.odmLedger.set([...l]); }
    setOdmSeatNotes(v: Record<string, string>): void { this.odmSeatNotes.set({ ...v }); }
    setOdmSeatRequests(l: OdmSeatRequest[]): void { this.odmSeatRequests.set([...l]); }
    setOdmGmMissions(list: OdmGmMission[]): void { this.odmGmMissions.set([...list]); }
    setGmMissionDrafts(list: OdmGmDraft[]): void { this.gmMissionDrafts.set([...list]); }
    setResultsSlip(s: ResultsSlip | null): void { this.resultsSlip.set(s); }
    setAppliedSlips(ids: string[]): void { this.appliedSlips.set(ids); }
    setTableBound(t: TableBound | null): void { this.tableBound.set(t); }
    setCompletedContracts(list: ContractOffer[]): void {
        this.completedContracts.set(list);
    }
    setMissionSpec(spec: MissionSpec | null): void {
        this.missionSpec.set(spec);
    }
    setNpcAssignments(a: Record<string, string>): void {
        this.npcAssignments.set(a);
    }
    setStaffVoices(v: Record<string, string>): void {
        this.staffVoices.set(v);
    }
    setOutcomeLedger(v: OutcomeRecord[]): void {
        this.outcomeLedger.set(v);
    }
    setEscalationByThread(v: Record<string, number>): void {
        this.escalationByThread.set(v);
    }
    setEscalationCampaign(v: number): void {
        this.escalationCampaign.set(v);
    }
    escalationLevelFor(threadTag: string | null | undefined): number {
        const tt = threadTag || '__campaign__';
        const byThread = this.escalationByThread();
        return tt in byThread ? byThread[tt] : this.escalationCampaign();
    }
    setEscalationLevel(threadTag: string | null | undefined, level: number): void {
        const tt = threadTag || '__campaign__';
        this.escalationByThread.set({ ...this.escalationByThread(), [tt]: level });
        this.escalationCampaign.set(level);
    }
    setMissionTree(t: MissionBranch[]): void {
        this.missionTree.set(t);
    }
    setTreeArchive(a: TreeArchiveEntry[]): void {
        this.treeArchive.set(a);
    }
    setCampaignLog(l: CampaignLogEntry[]): void {
        this.campaignLog.set(l);
    }
    logMoney(text: string, amount: number, date?: CampaignStartDate | null, kind?: CampaignLogEntry['kind']): void {
        const d = date ?? this.currentDate() ?? this.startDate() ?? { y: 3025, m: 0, d: 1 };
        const entry: CampaignLogEntry = { date: d, text, kind, amount, balance: this.treasury() ?? 0 };
        this.campaignLog.set([...(this.campaignLog() ?? []), entry]);
    }
    logNotice(text: string, date?: CampaignStartDate | null, kind?: CampaignLogEntry['kind']): void {
        const d = date ?? this.currentDate() ?? this.startDate() ?? { y: 3025, m: 0, d: 1 };
        this.campaignLog.set([...(this.campaignLog() ?? []), { date: d, text, kind }]);
    }
    setPayrollShortfalls(s: PayrollShortfall[]): void {
        this.payrollShortfalls.set(s);
    }
    recordPayrollShortfall(month: CampaignStartDate, unpaid: number, kind: 'payroll' | 'maintenance' = 'payroll'): void {
        if (unpaid <= 0) return;
        this.payrollShortfalls.set([...(this.payrollShortfalls() ?? []), { month, unpaid, kind }]);
    }
    setBays(b: Bay[] | null): void {
        this.bays.set(b);
    }
    setBayHistory(h: BayHistoryEntry[] | null): void {
        this.bayHistory.set(h);
    }
    setIntel(i: IntelState | null): void {
        this.intel.set(i);
    }
    setTechPool(t: TechPool | null): void {
        this.techPool.set(t);
    }
    setInventory(i: InventoryState | null): void {
        this.inventory.set(i);
    }
    setShopOrders(o: ShopOrder[] | null): void {
        this.shopOrders.set(o);
    }
    setPersonnel(p: PersonnelState | null): void {
        this.personnel.set(p);
    }
    setHiringMarket(m: HiringMarket | null): void {
        this.hiringMarket.set(m);
    }
    /** Clear derived per-campaign state (merc identity, contract market, starting force)
     *  when the era/archetype changes — they are regenerated at the next Begin. */
    private clearMercIdentity(): void {
        this.commandName.set(null);
        this.commandFaction.set(null); // ORDER-15 (a)
        this.rating.set(null);
        this.logisticsProfile.set(null);
        this.contractMarket.set(null);
        this.acceptedContract.set(null);
        this.houseOrder.set(null);
        this.startingForce.set(null);
        this.forceStructure.set(null);
        this.pilots.set(null);
        this.currentDate.set(null);
        this.treasury.set(null);
        this.warchestSP.set(null);
        this.reputation.set(null);
        this.contractScale.set(1);
        this.gmDifficulty.set(1.0);
        this.warchestLedger.set([]);
        this.activeChaosContract.set(null);
        this.participantContracts.set({}); this.participantContract.set(null); this.contractSummary.set(null);
        this.completedChaosContract.set(null); // PD3 P2
        this.voidedContracts.set({}); this.participantVoid.set(null);
        this.chaosTrackPresets.set([]);
        this.customHotSpots.set([]);
        this.forgedHotSpots.set([]); // HSFORGE-1
        this.hsRegion.set(null); // HSFORGE-1 P2
        this.hiredMercs.set([]); this.contractHiredKeys.set([]);
        this.hotSpotOffer.set([]);
        this.hotSpotShowAll.set(false);
        this.reckoningBegun.set(false);
        this.presentedHotspot.set(null);
        this.gmPilotNotes.set({});
        this.odmProjection.set(null);
        this.odmLedger.set([]); this.odmSeatNotes.set({}); this.odmSeatRequests.set([]);
        this.odmGmMissions.set([]);
        this.gmMissionDrafts.set([]);
        this.playerUnitCap.set(null);
        this.resultsSlip.set(null);
        this.appliedSlips.set([]);
        this.tableBound.set(null);
        this.completedContracts.set([]);
        this.missionSpec.set(null);
        this.npcAssignments.set({});
        this.staffVoices.set({});
        this.outcomeLedger.set([]);
        this.escalationByThread.set({});
        this.escalationCampaign.set(0);
        this.missionTree.set([]);
        this.treeArchive.set([]);
        this.campaignLog.set([]);
        this.bays.set(null);
        this.bayHistory.set(null);
        this.intel.set(null);
        this.techPool.set(null);
        this.inventory.set(null);
        this.shopOrders.set(null);
        this.personnel.set(null);
        this.hiringMarket.set(null);
    }

    /** Start a fresh campaign setup. */
    reset(): void {
        this.quickMission.set(false);
        this.gmSession.set(false);
        this.armsMix.set('combined');
        this.missionArmsMixOverride.set('auto');
        this.campaignSystem.set(null);
        this.packId.set(null);
        this.odmOutcomes.set({}); this.odmActiveNodeId.set(null);
        this.odmSeeds.set({});
        this.odmStocks.set(null);
        this.odmFleetStatus.set({});
        this.odmBench.set([]);
        this.odmMaintenance.set({});
        this.odmSupport.set({});
        this.hotSpotCampaign.set(null);
        this.era.set(null);
        this.startDate.set(null);
        this.force.set(null);
        this.faction.set(null);
        this.unit.set(null);
        this.unitSize.set(null);
        this.capital.set(null);
        this.resources.set(null);
        this.formation.set(null);
        this.clearMercIdentity();
    }

    /** Restore all fields directly from a snapshot (no cascade) — used by persistence
     *  rehydration on app load / Resume. */
    hydrate(s: {
        era?: CampaignEra | null;
        startDate?: CampaignStartDate | null;
        force?: string | null;
        faction?: string | null;
        unit?: string | null;
        unitSize?: CampaignUnitSize | null;
        capital?: CampaignCapital | null;
        resources?: string | null;
        commandName?: string | null;
        commandFaction?: string | null; // ORDER-15 (a) — the Hot Spots command's affiliation (null = Mercenary)
        rating?: string | null;
        logisticsProfile?: string | null;
        contractMarket?: ContractMarket | null;
        acceptedContract?: ContractOffer | null;
        houseOrder?: ContractOffer | null;
        startingForce?: ProtoInstance[] | null;
        forceStructure?: ForceStructure | null;
        pilots?: Pilot[] | null;
        formation?: string | null;
        currentDate?: CampaignStartDate | null;
        treasury?: number | null;
        completedContracts?: ContractOffer[] | null;
        missionSpec?: MissionSpec | null;
        npcAssignments?: Record<string, string> | null;
        outcomeLedger?: OutcomeRecord[] | null;
        escalationByThread?: Record<string, number> | null;
        escalationCampaign?: number | null;
        staffVoices?: Record<string, string> | null;
        missionTree?: MissionBranch[] | null;
        treeArchive?: TreeArchiveEntry[] | null;
        campaignLog?: CampaignLogEntry[] | null;
        bays?: Bay[] | null;
        bayHistory?: BayHistoryEntry[] | null;
        intel?: IntelState | null;
        techPool?: TechPool | null;
        inventory?: InventoryState | null;
        shopOrders?: ShopOrder[] | null;
        personnel?: PersonnelState | null;
        hiringMarket?: HiringMarket | null;
        payrollShortfalls?: PayrollShortfall[] | null;
        currentLocation?: string | null;
        gameSystem?: GameSystem | null;
        campaignSystem?: 'traditional' | 'hotspots' | null;
        packId?: string | null;
        odmOutcomes?: Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }> | null;
        odmActiveNodeId?: string | null;
        odmSeeds?: Record<string, string> | null;
        odmStocks?: OdmStocks | null;
        odmFleetStatus?: Record<string, string> | null;
        odmBench?: OdmBenchJob[] | null;
        odmMaintenance?: Record<string, OdmMaintenanceRecord> | null;
        odmSupport?: Record<string, OdmSupportCounts> | null;
        hotSpotCampaign?: string | null;
        warchestSP?: number | null;
        reputation?: number | null;
        contractScale?: number | null;
        gmDifficulty?: number | null;
        warchestLedger?: WarchestEntry[] | null;
        activeChaosContract?: ChaosContract | null;
        participantContract?: ChaosContract | null;
        participantVoid?: VoidedContract | null;
        contractSummary?: ContractSummary | null;
        completedChaosContract?: ContractSummary | null; // PD3 P2 — the TERMINAL contract record (top-level; the phone's phase gate)
        chaosTrackPresets?: PresetTrack[] | null;
        customHotSpots?: HotSpot[] | null;
        forgedHotSpots?: HotSpot[] | null; // HSFORGE-1
        hsRegion?: string | null; // HSFORGE-1 P2
        hiredMercs?: HiredMerc[] | null;
        contractHiredKeys?: string[] | null;
        hotSpotOffer?: string[] | null;
        hotSpotShowAll?: boolean | null;
        reckoningBegun?: boolean | null;
        gmSession?: boolean | null;
        // for players); hydrate accepts BOTH layouts (gmOnly wins; top-level = plain HS + every legacy save).
        gmOnly?: {
            customHotSpots?: HotSpot[] | null;
            forgedHotSpots?: HotSpot[] | null;
            hsRegion?: string | null;
            hotSpotOffer?: string[] | null;
            hotSpotShowAll?: boolean | null;
            reckoningBegun?: boolean | null;
            activeChaosContract?: ChaosContract | null;
            acceptedContract?: ContractOffer | null;
            participantContracts?: Record<string, ChaosContract> | null;
            voidedContracts?: Record<string, VoidedContract> | null;
            pilotNotes?: Record<string, string> | null;
            gmMissionDrafts?: OdmGmDraft[] | null;
            odmLedger?: OdmLedgerEntry[] | null;
        } | null;
        presentedHotspot?: PresentedHotspot | null;
        odmProjection?: OdmProjection | null;
        odmSeatNotes?: Record<string, string> | null;
        odmSeatRequests?: OdmSeatRequest[] | null;
        odmGmMissions?: OdmGmMission[] | null;
        playerUnitCap?: number | null;
        resultsSlip?: ResultsSlip | null;
        appliedSlips?: string[] | null;
        tableBound?: TableBound | null;
    }): void {
        this.era.set(s.era ?? null);
        this.startDate.set(s.startDate ?? null);
        this.force.set(s.force ?? null);
        this.faction.set(s.faction ?? null);
        this.unit.set(s.unit ?? null);
        this.unitSize.set(s.unitSize ?? null);
        this.capital.set(s.capital ?? null);
        this.resources.set(s.resources ?? null);
        this.commandName.set(s.commandName ?? null);
        this.commandFaction.set(s.commandFaction ?? null); // ORDER-15 (a) — older saves: null = Mercenary
        this.rating.set(s.rating ?? null);
        this.logisticsProfile.set(s.logisticsProfile ?? null);
        this.contractMarket.set(s.contractMarket ?? null);
        // fan to players); hydrate accepts both layouts (gmOnly wins). A player lands on null, exactly as an old save would.
        const gOnly = (s.gmSession ? s.gmOnly : null) ?? {};
        this.acceptedContract.set(gOnly.acceptedContract ?? s.acceptedContract ?? null);
        this.houseOrder.set(s.houseOrder ?? null);
        this.startingForce.set(s.startingForce ?? null);
        this.forceStructure.set(s.forceStructure ?? null);
        this.pilots.set(s.pilots ?? null);
        this.formation.set(s.formation ?? null);
        this.currentDate.set(s.currentDate ?? null);
        this.treasury.set(s.treasury ?? null);
        this.completedContracts.set(s.completedContracts ?? []);
        this.missionSpec.set(s.missionSpec ?? null);
        this.npcAssignments.set(s.npcAssignments ?? {});
        this.staffVoices.set(s.staffVoices ?? {});
        this.outcomeLedger.set(s.outcomeLedger ?? []);
        this.escalationByThread.set(s.escalationByThread ?? {});
        this.escalationCampaign.set(s.escalationCampaign ?? 0);
        this.missionTree.set(s.missionTree ?? []);
        this.treeArchive.set(s.treeArchive ?? []);
        this.campaignLog.set(s.campaignLog ?? []);
        this.bays.set(s.bays ?? null);
        this.bayHistory.set(s.bayHistory ?? null);
        this.intel.set(s.intel ?? null);
        this.techPool.set(s.techPool ?? null);
        this.inventory.set(s.inventory ?? null);
        this.shopOrders.set(s.shopOrders ?? null);
        this.personnel.set(s.personnel ?? null);
        this.hiringMarket.set(s.hiringMarket ?? null);
        this.payrollShortfalls.set(s.payrollShortfalls ?? []);
        this.currentLocation.set(s.currentLocation ?? null);
        this.gameSystem.set(s.gameSystem ?? GameSystem.CLASSIC);
        this.campaignSystem.set(s.campaignSystem ?? null);
        this.packId.set(s.packId ?? null);
        this.odmOutcomes.set(s.odmOutcomes ?? {}); this.odmActiveNodeId.set(s.odmActiveNodeId ?? null);
        this.odmSeeds.set(s.odmSeeds ?? {});
        this.odmStocks.set(s.odmStocks ?? null);
        this.odmFleetStatus.set(s.odmFleetStatus ?? {});
        this.odmBench.set(s.odmBench ?? []);
        this.odmMaintenance.set(s.odmMaintenance ?? {});
        this.odmSupport.set(s.odmSupport ?? {});
        this.hotSpotCampaign.set(s.hotSpotCampaign ?? null);
        this.warchestSP.set(s.warchestSP ?? null);
        this.reputation.set(s.reputation ?? null);
        this.contractScale.set(s.contractScale ?? 1);
        this.gmDifficulty.set(s.gmDifficulty ?? 1.0);
        this.warchestLedger.set(s.warchestLedger ?? []);
        this.activeChaosContract.set(gOnly.activeChaosContract ?? s.activeChaosContract ?? null);
        this.participantContracts.set(gOnly.participantContracts ?? {});
        this.participantContract.set(s.participantContract ?? null);
        this.voidedContracts.set(gOnly.voidedContracts ?? {});
        this.participantVoid.set(s.participantVoid ?? null);
        this.contractSummary.set(s.contractSummary ?? null);
        this.completedChaosContract.set(s.completedChaosContract ?? null); // PD3 P2 — the terminal record; old saves → null
        this.chaosTrackPresets.set(s.chaosTrackPresets ?? []);
        // (gmOnly wins); plain HS + every legacy save keep them top-level. A PLAYER hydrating a stripped
        // GM-session snapshot lands on exactly the old-save defaults ([], false, null) — nothing invented.
        // Defense in depth (panel finding): the unwrap is gmSession-GATED — a crafted gmOnly on a non-GM
        // snapshot never hydrates (the server's gmOnly entitlement belt is the authoritative gate).
        const g = (s.gmSession ? s.gmOnly : null) ?? {};
        this.customHotSpots.set(g.customHotSpots ?? s.customHotSpots ?? []);
        this.forgedHotSpots.set(g.forgedHotSpots ?? s.forgedHotSpots ?? []); // HSFORGE-1 — old saves lack it → [] (nothing forged)
        this.hsRegion.set(g.hsRegion ?? s.hsRegion ?? null); // HSFORGE-1 P2 — old saves lack it → null (era-only, byte-identical)
        this.hiredMercs.set(s.hiredMercs ?? []); this.contractHiredKeys.set(s.contractHiredKeys ?? []);
        this.hotSpotOffer.set(g.hotSpotOffer ?? s.hotSpotOffer ?? []);
        this.hotSpotShowAll.set(g.hotSpotShowAll ?? s.hotSpotShowAll ?? false);
        this.reckoningBegun.set(g.reckoningBegun ?? s.reckoningBegun ?? false);
        this.gmSession.set(s.gmSession ?? false);
        this.presentedHotspot.set(s.presentedHotspot ?? null);
        // gmSession; not a smuggle vector — no server reader, and the entitlement belt gates hosted persists).
        this.gmPilotNotes.set(((s.gmOnly ?? {}) as { pilotNotes?: Record<string, string> | null }).pilotNotes ?? {});
        this.odmProjection.set(s.odmProjection ?? null);
        // a player's fan never carries gmOnly, so a player device always reads an empty ledger.
        this.odmLedger.set(((s.gmOnly ?? {}) as { odmLedger?: OdmLedgerEntry[] | null }).odmLedger ?? []);
        this.odmSeatNotes.set(s.odmSeatNotes ?? {});
        this.odmSeatRequests.set(s.odmSeatRequests ?? []);
        this.odmGmMissions.set(s.odmGmMissions ?? []);
        // drafts unwrap from gmOnly UNGATED (the pilotNotes precedent): ODM carries gmOnly without a gmSession,
        // and the gmSession-gated unwrap above would silently drop every draft on an ODM load.
        this.gmMissionDrafts.set(((s.gmOnly ?? {}) as { gmMissionDrafts?: OdmGmDraft[] | null }).gmMissionDrafts ?? []);
        this.playerUnitCap.set(s.playerUnitCap ?? null);
        this.resultsSlip.set(s.resultsSlip ?? null);
        this.tableBound.set(s.tableBound && typeof s.tableBound === 'object' ? s.tableBound : null);
        this.appliedSlips.set(Array.isArray(s.appliedSlips) ? s.appliedSlips.filter((x) => typeof x === 'string') : []);
    }
}
