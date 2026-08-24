/*
 * BCE retool — New Campaign wizard state spine. DIRECTIVE-004
 * (+ faction/unit, D-005; + unitSize/capital, D-006; + resources, D-007;
 *  + merc command identity, D-016).
 * Accumulates the wizard's choices and survives navigation across campaign/new/*
 * (provided in root). Each setter clears stale downstream choices when its value
 * changes, so a later step never carries a selection from an abandoned branch.
 * Cascade order: era → startDate → force → faction → unit → unitSize → capital + resources.
 * The merc identity (commandName/rating/logisticsProfile) is set on the MERC faction
 * path and cleared when the era/archetype changes.
 */
import { Injectable, signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { ContractMarket, ContractOffer } from './contract/contract-market';
import type { ChaosContract } from './chaos/chaos-contract'; // D-110 — the clean-room Chaos contract (Hot Spots)
import type { PresetTrack } from './chaos/chaos-track-preset'; // D-116 — user-authored Hot Spots track presets
import type { HotSpot } from './chaos/hotspots-catalog'; // D-124 — user-authored custom hotspots (type-only; no runtime cycle)
import type { HiredMerc } from './chaos/hire-personnel'; // IMPORT-3 P2 — hireable named mercs fielded per track (type-only)
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

export interface CampaignUnitSize {
    id: string;    // 'single' | 'lance' | 'company' | 'battalion' | 'regiment'
    name: string;  // display, e.g. "Lance"
    count: number; // 'Mech count — drives the capital scaling
}

export interface CampaignCapital {
    tier: string;   // 'Low' | 'Standard' | 'High' | 'Custom'
    amount: number; // C-bills
}

/** D-029: a dated campaign-log entry (purchases, sales, GM admin). Persisted; merged into the Overview log.
 *  kind (D-034, optional — pre-D-034 entries render untyped): the Intel notebook's type chip. */
export interface CampaignLogEntry {
    date: CampaignStartDate;
    text: string;
    kind?: 'purchase' | 'sale' | 'walk' | 'repair' | 'admin' | 'income';
    // DIRECTIVE-074 — the money columns for the Overview transaction log: the signed C-bill delta and the
    // resulting treasury balance AFTER the change. Optional (pre-D-074 + non-money entries omit them).
    amount?: number;
    balance?: number;
}

/** DIRECTIVE-109 — one line of the Chaos Campaign Contract Record Sheet (the Hot Spots fork's SP ledger).
 *  A DEDICATED schema (NOT CampaignLogEntry): Month | Event | Cost | Cover | Paid | Balance | Rep, all in SP.
 *  cost = gross SP (spend positive, income negative); cover = employer reimbursement (0 this slice); paid =
 *  cost − cover; balance = resulting Warchest SP; rep = Reputation at the time. */
export interface WarchestEntry {
    month: number; // 1-based campaign month (Month 1 = the campaign's start month)
    event: string;
    cost: number;
    cover: number;
    paid: number;
    balance: number;
    rep: number;
}

/** DIRECTIVE-075 — a recorded payroll SHORTFALL: the month it occurred + the unpaid C-bills. This slice only
 *  RECORDS them; the T-040 turnover/morale system (loyalty / desertion) will consume them later. Persisted. */
export interface PayrollShortfall {
    month: CampaignStartDate;
    unpaid: number;
    kind?: 'payroll' | 'maintenance'; // D-076 — which obligation went unpaid (default 'payroll' for pre-D-076 records)
}

/** D-034: a GM notebook note (the Intel tab's free-text entries, interleaved with auto-entries). */
export interface IntelNote {
    noteId: string;
    date: CampaignStartDate;
    text: string;
    npcId?: string;
}
/** D-034: campaign-known intel — GM status overrides (registry status stays read-only pack data),
 *  GM-introduced contacts (met OUTSIDE missions; met-through-play derives from npcAssignments),
 *  and the notebook. ONE optional snapshot field (migration-safe, no version bump). */
export interface IntelState {
    statuses: Record<string, string>; // npcId → active | burned | dead | captured | promoted
    introduced: string[];             // GM-introduced npcIds
    notes: IntelNote[];
}

@Injectable({ providedIn: 'root' })
export class NewCampaignState {
    // ── DIRECTIVE-067 — Quick Mission one-shot: set before the trimmed setup; the dashboard + size-capital
    //    Begin read it to skip the campaign chrome (contract market / economy / barracks / save). In-memory
    //    only (a one-shot is ephemeral — no snapshot field); cleared by reset() so New Campaign is unaffected. ──
    readonly quickMission = signal(false);
    // ── DIRECTIVE-068 — Quick Mission arms style: 'combined' = the D-046 Mek+vehicle mix; 'mechs' = 'Mechs only
    //    (the force-gen pool drops vehicles). In-memory; cleared by reset(); the OpFor matches it. ──
    readonly armsMix = signal<'mechs' | 'combined'>('combined');
    // ── D-076 — GM per-mission OpFor arms-mix toggle (campaign only): 'auto' honors the seed (else the campaign
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

    // ── Merc command identity (D-016, MERC path) ──
    readonly commandName = signal<string | null>(null);      // the named command (canon-modeled or own)
    readonly rating = signal<string | null>(null);           // Green | Regular | Veteran | Elite
    readonly logisticsProfile = signal<string | null>(null); // 'merc-market' for mercs (display-only now)

    // ── Merc contract market (D-017) ──
    readonly contractMarket = signal<ContractMarket | null>(null);
    readonly acceptedContract = signal<ContractOffer | null>(null);
    // ── House orders (D-032) — the non-merc standing order awaiting ACKNOWLEDGE; null = none / awaiting. ──
    readonly houseOrder = signal<ContractOffer | null>(null);

    // ── RNG starting force (D-018) — null=not generated yet; []=build-own empty roster. ──
    readonly startingForce = signal<ProtoInstance[] | null>(null);
    // ── Force structure (D-019) — lances/Stars + RESERVE; null until assigned. ──
    readonly forceStructure = signal<ForceStructure | null>(null);
    // ── Pilots (D-020) — entities + assignment links; null=not generated; []=build-own. ──
    readonly pilots = signal<Pilot[] | null>(null);
    // ── Formation (D-021) — chosen canon OOB command name (non-merc); null = MAKE YOUR OWN. ──
    readonly formation = signal<string | null>(null);

    // ── Campaign clock + treasury (D-022) — currentDate starts at the start date; treasury is the
    //    capital value made live; completedContracts is the read-only contract log. ──
    readonly currentDate = signal<CampaignStartDate | null>(null);
    readonly treasury = signal<number | null>(null);
    readonly completedContracts = signal<ContractOffer[]>([]);
    // ── Mission spec (D-023) — the active contract's generated mission RECORD (DATA-003); null until generated. ──
    readonly missionSpec = signal<MissionSpec | null>(null);
    // ── Forge assignments (D-025) — campaign-level + persistent: the same intel source / chief armorer
    //    recurs across missions. flag→npcId and roleFamily→voiceId. ──
    readonly npcAssignments = signal<Record<string, string>>({});
    readonly staffVoices = signal<Record<string, string>>({});
    // ── D-077 — outcome-feedback escalation. The rolling OutcomeRecord ledger (newest last, capped), the
    //    per-thread (contractId→level) escalation, and the campaign-wide fallback tempo. All persisted; old
    //    saves rehydrate neutral (empty/0). The generator drifts the next bvTarget by the active thread's level. ──
    readonly outcomeLedger = signal<OutcomeRecord[]>([]);
    readonly escalationByThread = signal<Record<string, number>>({});
    readonly escalationCampaign = signal<number>(0);
    // ── Mission tree (D-026) — the branching campaign spine for the active contract; [] until accept. ──
    readonly missionTree = signal<MissionBranch[]>([]);
    // ── Tree archive (D-028) — closed trees of completed contracts, for FLOW's read-only recall. ──
    readonly treeArchive = signal<TreeArchiveEntry[]>([]);
    // ── Campaign log (D-029) — dated purchase/sale/admin entries; merged into the Overview log. ──
    readonly campaignLog = signal<CampaignLogEntry[]>([]);
    // ── Repair & salvage bays (D-033) — the 4 bays + dated bay history; null until first mutation
    //    (the service renders the defaults; pre-D-033 saves are migration-safe). ──
    readonly bays = signal<Bay[] | null>(null);
    readonly bayHistory = signal<BayHistoryEntry[] | null>(null);
    // ── Intel (D-034) — GM contact statuses + introduced contacts + the notebook; null until first use. ──
    readonly intel = signal<IntelState | null>(null);
    // ── Tech pool (D-037) — the bays' stored identity; null until first repair-tab visit generates it. ──
    readonly techPool = signal<TechPool | null>(null);
    // ── Starting inventory (D-056) — the rolled stockpile; null until ensureStartingInventory() rolls it. ──
    readonly inventory = signal<InventoryState | null>(null);
    // ── Shop orders (D-065) — pending out-of-system orders in transit; null until the first request. ──
    readonly shopOrders = signal<ShopOrder[] | null>(null);
    // ── Support personnel (D-058) — the rolled support roster + staffing + payroll; null until ensureStartingPersonnel(). ──
    readonly personnel = signal<PersonnelState | null>(null);
    // ── Hiring hall (D-059) — the refreshing candidate market {periodKey, pool}; null until ensureHiringMarket(). ──
    readonly hiringMarket = signal<HiringMarket | null>(null);
    // ── Payroll shortfalls (D-075) — months where the treasury couldn't cover payroll; recorded for the
    //    future T-040 turnover/morale system. [] until the first shortfall. ──
    readonly payrollShortfalls = signal<PayrollShortfall[]>([]);

    // ── Star Map Phase 1 (D-079) — the campaign's CURRENT LOCATION (a systemId in star/systems.json).
    //    Defaulted at creation (size-capital begin()) to the chosen faction's capital; GM-changeable on the
    //    Overview; persisted. Old saves lack it → hydrate defaults null (the Overview simply shows no line). ──
    readonly currentLocation = signal<string | null>(null);

    // ── DIRECTIVE-083 — game system: Classic BattleTech (default) vs Alpha Strike. The unit-card swap is
    //    gated on this; CBT stays byte-identical. Chosen at the FRONT of setup; persisted; old saves → CBT. ──
    readonly gameSystem = signal<GameSystem>(GameSystem.CLASSIC);

    // ── DIRECTIVE-108 — Campaign System (chosen on the Setup card, before Era): Traditional (Campaign Operations)
    //    vs Hot Spots (Chaos Campaign), + the chosen Hot Spot campaign id. This sits ABOVE era, so it must NOT
    //    cascade-clear downstream force/faction/etc. Persisted; old saves → null (treated as Traditional). ──
    readonly campaignSystem = signal<'traditional' | 'hotspots' | null>(null);
    /** DIRECTIVE-ODM-1 — the additive campaign-pack discriminator (null = no pack; 'odm' routes the shell to the
     *  fenced odm container). NOT a campaignSystem value — packs ride ON a base system (ODM rides Traditional). */
    readonly packId = signal<string | null>(null);
    // ODM-3 — the recorded per-node mission outcomes (the TRUE 4-tier + GM flags; keyed by tree-node id) and
    // the authored node the ACTIVE mission is bound to. Additive D-108 wire — old saves default clean.
    readonly odmOutcomes = signal<Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }>>({});
    readonly odmActiveNodeId = signal<string | null>(null);
    // ODM-7 — per-node mission-INSTANCE seeds (opaque uuids). The ONLY OpFor-related thing that ever persists:
    // the rolled roster is a pure fn(seed, opfor-spec) recomputed GM-side (the snapshot fans to players wholesale).
    readonly odmSeeds = signal<Record<string, string>>({});
    readonly hotSpotCampaign = signal<string | null>(null);

    // ── DIRECTIVE-109 — the Chaos Campaign Warchest (SP economy), active only when campaignSystem==='hotspots'.
    //    warchestSP/reputation null under Traditional (no warchest); contractScale defaults 1; ledger = the
    //    Contract Record Sheet rows. Runtime economy state (persisted via the host store like treasury/log). ──
    readonly warchestSP = signal<number | null>(null);
    readonly reputation = signal<number | null>(null);
    readonly contractScale = signal<number>(1);
    readonly warchestLedger = signal<WarchestEntry[]>([]);

    // ── DIRECTIVE-110 — the active Chaos contract (clean-room; NOT the Traditional acceptedContract). One at a
    //    time; drives Base Pay / support Cover / Reputation. Null under Traditional / between contracts. ──
    readonly activeChaosContract = signal<ChaosContract | null>(null);
    readonly gmDifficulty = signal<number>(1.0); // D-124 — HS OpFor danger multiplier (0.8–1.6; Traditional never reads it)

    // ── DIRECTIVE-116 — user-authored Hot Spots track presets (build-your-own track). IP-safe (empty builder; the
    //    user's own content). Persisted with the campaign; portable via Export/Import JSON. Empty under Traditional. ──
    readonly chaosTrackPresets = signal<PresetTrack[]>([]);
    // ── DIRECTIVE-124 — user-authored CUSTOM hotspots (whole-hotspot editable model). Same catalog/registry as the
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
    // IMPORT-3 P2 — hireable named mercs: those fielded for the current track + the oneTimeHire keys already paid this contract.
    readonly hiredMercs = signal<HiredMerc[]>([]);
    readonly contractHiredKeys = signal<string[]>([]);
    // D-124b — the Hot Spots OFFER BOARD: up to 5 hotspot ids dealt from the eligible chamber, persisted + stable
    //    across reloads (re-rolled only by the paid button or when empty + no active contract). HS-only.
    readonly hotSpotOffer = signal<string[]>([]);
    // D-129 — GM "Show all contracts": when true the offer board shows the WHOLE era chamber (not the dealt 5) and the
    //    deal/reroll are suppressed. Persisted like hotSpotOffer; default false. HS-only.
    readonly hotSpotShowAll = signal<boolean>(false);
    // DIRECTIVE-135 — the endgame "Begin the Reckoning" gate: once true, the offer board deals from the CAPSTONE pool
    //    (reroll off) instead of the normal chamber. Persisted like hotSpotOffer; default false (old saves → false). HS-only.
    readonly reckoningBegun = signal<boolean>(false);

    /** D-108 — set the campaign system. Switching to Traditional clears the Hot Spot campaign; NO downstream cascade. */
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
        this.missionArmsMixOverride.set(v); // D-076 — GM per-mission OpFor arms-mix toggle
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

    /** D-079 — set the campaign's current location (GM-changeable; persisted). */
    setCurrentLocation(systemId: string | null): void {
        this.currentLocation.set(systemId);
    }

    /** D-083 — the front-of-setup game-system choice. Changing it cascades downstream like setEra (force/
     *  faction/unit/size/capital/resources are system-dependent). For a fresh setup these are already null. */
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

    // ── Merc identity setters (D-016) ──
    setCommandName(name: string): void {
        this.commandName.set(name);
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
    // ── DIRECTIVE-109 — Warchest (SP) setters. warchestSP/reputation are number|null (null = no warchest,
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
    }
    setGmDifficulty(v: number): void { this.gmDifficulty.set(Math.max(0.8, Math.min(1.6, v))); } // D-124
    // ── D-116 — track-preset CRUD (immutable-replace) ──
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
    // ── D-124 — custom-hotspot CRUD (immutable-replace) ──
    setCustomHotSpots(list: HotSpot[]): void { this.customHotSpots.set([...list]); }
    addCustomHotSpot(h: HotSpot): void { this.customHotSpots.set([...(this.customHotSpots() ?? []), h]); }
    removeCustomHotSpot(id: string): void { this.customHotSpots.set((this.customHotSpots() ?? []).filter((x) => x.id !== id)); }
    // ── HSFORGE-1 — forged-hotspot CRUD (immutable-replace; pruning policy lives in HsForgeService) ──
    setForgedHotSpots(list: HotSpot[]): void { this.forgedHotSpots.set([...list]); }
    addForgedHotSpot(h: HotSpot): void { this.forgedHotSpots.set([...(this.forgedHotSpots() ?? []), h]); }
    setHsRegion(id: string | null): void { this.hsRegion.set(id); } // HSFORGE-1 P2
    // IMPORT-3 P2 — hired-merc lifecycle mutators (immutable replace).
    setHiredMercs(list: HiredMerc[]): void { this.hiredMercs.set([...list]); }
    addHiredMerc(m: HiredMerc): void { this.hiredMercs.set([...(this.hiredMercs() ?? []), m]); }
    removeHiredMerc(instanceId: string): void { this.hiredMercs.set((this.hiredMercs() ?? []).filter((x) => x.instanceId !== instanceId)); }
    addContractHiredKey(key: string): void { if (!this.contractHiredKeys().includes(key)) this.contractHiredKeys.set([...this.contractHiredKeys(), key]); }
    removeContractHiredKey(key: string): void { this.contractHiredKeys.set(this.contractHiredKeys().filter((k) => k !== key)); }
    clearHiredMercs(): void { this.hiredMercs.set([]); }
    clearContractHiredKeys(): void { this.contractHiredKeys.set([]); }
    /** IMPORT-3 P2 — at a NEW track, per-track (non-oneTime) hired mercs LEAVE the field (their minted instance +
     *  pilot are dropped so they don't ride the next track for free); oneTime mercs stay for the contract. */
    releasePerTrackMercs(): void {
        const leaving = (this.hiredMercs() ?? []).filter((m) => !m.oneTimeHire);
        if (!leaving.length) return;
        const inst = new Set(leaving.map((m) => m.instanceId));
        const pil = new Set(leaving.map((m) => m.pilotId));
        this.setStartingForce((this.startingForce() ?? []).filter((i) => !inst.has(i.instanceId)));
        this.setPilots((this.pilots() ?? []).filter((p) => !pil.has(p.pilotId)));
        this.hiredMercs.set((this.hiredMercs() ?? []).filter((m) => m.oneTimeHire));
    }
    setHotSpotOffer(ids: string[]): void { this.hotSpotOffer.set([...ids]); } // D-124b
    setHotSpotShowAll(v: boolean): void { this.hotSpotShowAll.set(v); } // D-129
    setReckoningBegun(v: boolean): void { this.reckoningBegun.set(v); } // D-135
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
    // D-077 — outcome ledger + escalation setters (the move/clamp math lives in mission-tree.service on resolve).
    setOutcomeLedger(v: OutcomeRecord[]): void {
        this.outcomeLedger.set(v);
    }
    setEscalationByThread(v: Record<string, number>): void {
        this.escalationByThread.set(v);
    }
    setEscalationCampaign(v: number): void {
        this.escalationCampaign.set(v);
    }
    /** D-077 — the active thread's escalation level: the thread's own (contract chain) if it has history, else
     *  the campaign-wide fallback. The generator drifts the next bvTarget by this; the Overview cue shows it. */
    escalationLevelFor(threadTag: string | null | undefined): number {
        const tt = threadTag || '__campaign__';
        const byThread = this.escalationByThread();
        return tt in byThread ? byThread[tt] : this.escalationCampaign();
    }
    /** D-077 — GM reset/adjust of the tempo (D-075-style GM edit). Sets BOTH the active thread + the campaign
     *  fallback so the next generation reflects it immediately. */
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
    /** DIRECTIVE-074 — append a MONEY event to the campaign log (the Overview transaction log reads these).
     *  Call AFTER setTreasury so `balance` captures the RESULTING treasury. `amount` is the signed delta
     *  (− debit, + credit). One seam for every money path (shop, payroll, contract income, hiring, salvage). */
    logMoney(text: string, amount: number, date?: CampaignStartDate | null, kind?: CampaignLogEntry['kind']): void {
        const d = date ?? this.currentDate() ?? this.startDate() ?? { y: 3025, m: 0, d: 1 };
        const entry: CampaignLogEntry = { date: d, text, kind, amount, balance: this.treasury() ?? 0 };
        this.campaignLog.set([...(this.campaignLog() ?? []), entry]);
    }
    /** D-075 — append a plain NOTICE to the campaign log (no money moved — e.g. the payroll shortfall warning).
     *  Distinct from logMoney so it lands in the campaign log but NOT the money transaction view. */
    logNotice(text: string, date?: CampaignStartDate | null, kind?: CampaignLogEntry['kind']): void {
        const d = date ?? this.currentDate() ?? this.startDate() ?? { y: 3025, m: 0, d: 1 };
        this.campaignLog.set([...(this.campaignLog() ?? []), { date: d, text, kind }]);
    }
    setPayrollShortfalls(s: PayrollShortfall[]): void {
        this.payrollShortfalls.set(s);
    }
    /** D-075/D-076 — record a month's unpaid obligation (payroll or unit maintenance). The future T-040
     *  turnover/morale system reads these. */
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
        this.warchestSP.set(null); // D-109 — a fresh campaign has no Warchest until seeded (Hot Spots only)
        this.reputation.set(null);
        this.contractScale.set(1);
        this.gmDifficulty.set(1.0); // D-124
        this.warchestLedger.set([]);
        this.activeChaosContract.set(null); // D-110
        this.chaosTrackPresets.set([]); // D-116
        this.customHotSpots.set([]); // D-124
        this.forgedHotSpots.set([]); // HSFORGE-1
        this.hsRegion.set(null); // HSFORGE-1 P2
        this.hiredMercs.set([]); this.contractHiredKeys.set([]); // IMPORT-3 P2
        this.hotSpotOffer.set([]); // D-124b
        this.hotSpotShowAll.set(false); // D-129
        this.reckoningBegun.set(false); // D-135
        this.completedContracts.set([]);
        this.missionSpec.set(null);
        this.npcAssignments.set({});
        this.staffVoices.set({});
        this.outcomeLedger.set([]); // D-077 — fresh campaign: no escalation history
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
        this.personnel.set(null); // D-058: a new campaign re-rolls its own support roster (don't inherit the prior one)
        this.hiringMarket.set(null); // D-059: and its own hiring pool
    }

    /** Start a fresh campaign setup. */
    reset(): void {
        this.quickMission.set(false); // D-067 — New Campaign / Create always clears the one-shot flag
        this.armsMix.set('combined'); // D-068 — default to the combined-arms mix
        this.missionArmsMixOverride.set('auto'); // D-076 — GM toggle back to seed-honoring
        this.campaignSystem.set(null); // D-108 — the Setup card re-chooses each campaign (null → Traditional until picked)
        this.packId.set(null); // ODM-1
        this.odmOutcomes.set({}); this.odmActiveNodeId.set(null); // ODM-3
        this.odmSeeds.set({}); // ODM-7
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
        outcomeLedger?: OutcomeRecord[] | null;            // D-077
        escalationByThread?: Record<string, number> | null; // D-077
        escalationCampaign?: number | null;                 // D-077
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
        packId?: string | null; // ODM-1 — additive (old saves lack it → null)
        odmOutcomes?: Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }> | null; // ODM-3
        odmActiveNodeId?: string | null; // ODM-3
        odmSeeds?: Record<string, string> | null; // ODM-7
        hotSpotCampaign?: string | null;
        warchestSP?: number | null;
        reputation?: number | null;
        contractScale?: number | null;
        gmDifficulty?: number | null; // D-124
        warchestLedger?: WarchestEntry[] | null;
        activeChaosContract?: ChaosContract | null;
        chaosTrackPresets?: PresetTrack[] | null;
        customHotSpots?: HotSpot[] | null; // D-124
        forgedHotSpots?: HotSpot[] | null; // HSFORGE-1
        hsRegion?: string | null; // HSFORGE-1 P2
        hiredMercs?: HiredMerc[] | null; // IMPORT-3 P2
        contractHiredKeys?: string[] | null; // IMPORT-3 P2
        hotSpotOffer?: string[] | null; // D-124b
        hotSpotShowAll?: boolean | null; // D-129
        reckoningBegun?: boolean | null; // D-135
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
        this.rating.set(s.rating ?? null);
        this.logisticsProfile.set(s.logisticsProfile ?? null);
        this.contractMarket.set(s.contractMarket ?? null);
        this.acceptedContract.set(s.acceptedContract ?? null);
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
        this.outcomeLedger.set(s.outcomeLedger ?? []);           // D-077 — old saves → no escalation history
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
        this.currentLocation.set(s.currentLocation ?? null); // D-079 — old saves lack it → null (Overview shows no line)
        this.gameSystem.set(s.gameSystem ?? GameSystem.CLASSIC); // D-083 — old/CBT saves default to Classic BattleTech
        this.campaignSystem.set(s.campaignSystem ?? null); // D-108 — old saves lack it → null (treated as Traditional)
        this.packId.set(s.packId ?? null); // ODM-1 — additive
        this.odmOutcomes.set(s.odmOutcomes ?? {}); this.odmActiveNodeId.set(s.odmActiveNodeId ?? null); // ODM-3
        this.odmSeeds.set(s.odmSeeds ?? {}); // ODM-7
        this.hotSpotCampaign.set(s.hotSpotCampaign ?? null);
        this.warchestSP.set(s.warchestSP ?? null); // D-109 — old/Traditional saves lack it → null (no Warchest tab)
        this.reputation.set(s.reputation ?? null);
        this.contractScale.set(s.contractScale ?? 1);
        this.gmDifficulty.set(s.gmDifficulty ?? 1.0); // D-124 — old saves default to Standard (1.0)
        this.warchestLedger.set(s.warchestLedger ?? []);
        this.activeChaosContract.set(s.activeChaosContract ?? null); // D-110 — old saves lack it → null (no contract)
        this.chaosTrackPresets.set(s.chaosTrackPresets ?? []); // D-116 — old saves lack it → [] (no presets)
        this.customHotSpots.set(s.customHotSpots ?? []); // D-124 — old saves lack it → [] (no custom hotspots)
        this.forgedHotSpots.set(s.forgedHotSpots ?? []); // HSFORGE-1 — old saves lack it → [] (nothing forged)
        this.hsRegion.set(s.hsRegion ?? null); // HSFORGE-1 P2 — old saves lack it → null (era-only, byte-identical)
        this.hiredMercs.set(s.hiredMercs ?? []); this.contractHiredKeys.set(s.contractHiredKeys ?? []); // IMPORT-3 P2 — old saves → []
        this.hotSpotOffer.set(s.hotSpotOffer ?? []); // D-124b — persisted offer hand (stable across reloads)
        this.hotSpotShowAll.set(s.hotSpotShowAll ?? false); // D-129 — old saves lack it → false (dealt-5 board)
        this.reckoningBegun.set(s.reckoningBegun ?? false); // D-135 — old saves lack it → false (reckoning not begun)
    }
}
