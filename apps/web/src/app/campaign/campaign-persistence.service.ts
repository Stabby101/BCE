/*
 * BCE retool — interim client-side campaign persistence. DIRECTIVE-011 (T-019).
 * Snapshots the NewCampaignState SETUP (era … resources) to a single most-recent,
 * versioned localStorage slot at Begin, and rehydrates it on app load so a dashboard
 * refresh stays on the dashboard (rehydrate-before-guard). This is a STAND-IN for the
 * engine/host record (DATA-002) — versioned, serializable, DOM-free — so it migrates
 * cleanly to the server-authoritative store later. Single slot; Begin overwrites.
 * No per-unit / damage / pilot state here (that is T-017 / the engine).
 */
import { contractSummaryOf } from './chaos/chaos-contract'; // GM-2 P2a — the player-safe projection of the primary
import { Injectable, inject } from '@angular/core';
import {
    NewCampaignState,
    type CampaignEra,
    type CampaignStartDate,
    type CampaignUnitSize,
    type CampaignCapital,
    type CampaignLogEntry,
    type IntelState,
    type PayrollShortfall,
    type WarchestEntry,
} from './new-campaign-state';
import type { ChaosContract, VoidedContract } from './chaos/chaos-contract'; // D-110 · GM-3 P1
import type { PresetTrack } from './chaos/chaos-track-preset'; // D-116
import type { GameSystem } from '../models/common.model';
import type { ContractMarket, ContractOffer } from './contract/contract-market';
import type { ProtoInstance } from './force/force-generator';
import type { ForceStructure } from './force/force-structure';
import type { Pilot } from './barracks/pilot-generator';
import type { MissionSpec } from './mission/mission-spec';
import type { MissionBranch, TreeArchiveEntry, OutcomeRecord } from './mission/mission-tree';
import type { Bay, BayHistoryEntry, TechPool } from './repair/repair-bays';
import type { InventoryState } from './inventory/starting-inventory';
import type { ShopOrder } from './inventory/inventory-shop';
import type { PersonnelState, HiringMarket } from './personnel/starting-personnel';

const STORAGE_KEY = 'bce.campaign.v1';
const SCHEMA_VERSION = 1;

export interface CampaignSnapshot {
    version: number;
    savedAt: number;
    era: CampaignEra | null;
    startDate: CampaignStartDate | null;
    force: string | null;
    faction: string | null;
    unit: string | null;
    unitSize: CampaignUnitSize | null;
    capital: CampaignCapital | null;
    resources: string | null;
    // Merc command identity (D-016) — optional so older snapshots stay valid (no version bump).
    commandName?: string | null;
    rating?: string | null;
    logisticsProfile?: string | null;
    // Merc contract market (D-017) — optional, migration-safe.
    contractMarket?: ContractMarket | null;
    acceptedContract?: ContractOffer | null;
    houseOrder?: ContractOffer | null;
    // RNG starting force (D-018) — optional; pre-D-018 saves lack it -> generate-on-first-load.
    startingForce?: ProtoInstance[] | null;
    // Force structure (D-019) — optional; pre-D-019 saves lack it -> structure-on-first-load.
    forceStructure?: ForceStructure | null;
    // Pilots (D-020) — optional; pre-D-020 saves lack it -> pilots-on-first-load.
    pilots?: Pilot[] | null;
    // Formation (D-021) — chosen canon OOB command name (non-merc); optional, migration-safe.
    formation?: string | null;
    // Campaign clock + treasury + contract log (D-022) — optional; pre-D-022 saves default the
    // date to the start date and the treasury to the capital value on load.
    currentDate?: CampaignStartDate | null;
    treasury?: number | null;
    completedContracts?: ContractOffer[] | null;
    // Mission spec (D-023) — the active contract's generated mission record; optional, migration-safe.
    missionSpec?: MissionSpec | null;
    // Forge assignments (D-025) — persistent campaign-level NPC + staff-voice casting; optional.
    npcAssignments?: Record<string, string> | null;
    staffVoices?: Record<string, string> | null;
    outcomeLedger?: OutcomeRecord[] | null;            // D-077 — outcome-feedback ledger
    escalationByThread?: Record<string, number> | null; // D-077 — per-thread escalation level
    escalationCampaign?: number | null;                 // D-077 — campaign-wide tempo fallback
    // Mission tree (D-026) — the branching spine for the active contract; optional, migration-safe.
    missionTree?: MissionBranch[] | null;
    // Tree archive (D-028) — closed trees of completed contracts for FLOW recall; optional.
    treeArchive?: TreeArchiveEntry[] | null;
    // Campaign log (D-029) — dated purchase/sale/admin entries; optional.
    campaignLog?: CampaignLogEntry[] | null;
    // Repair & salvage bays (D-033) — the 4 bays + dated bay history; optional, migration-safe (no version bump).
    bays?: Bay[] | null;
    bayHistory?: BayHistoryEntry[] | null;
    // Intel (D-034) — contact statuses + introduced contacts + the GM notebook; optional, migration-safe.
    intel?: IntelState | null;
    // Tech pool (D-037) — the bays' stored identity; optional, migration-safe.
    techPool?: TechPool | null;
    // Starting inventory (D-056) — the rolled stockpile (ammo/armor/components); optional, migration-safe
    // (no version bump). Forward-only ensureStartingInventory() back-fills saves that lack it. DATA-002.
    inventory?: InventoryState | null;
    // Shop orders (D-065) — pending out-of-system orders in transit; optional, migration-safe (no version bump).
    shopOrders?: ShopOrder[] | null;
    // Support personnel (D-058) — the rolled support roster + staffing + payroll; optional, migration-safe
    // (no version bump). Forward-only ensureStartingPersonnel() back-fills saves that lack it. DATA-002.
    personnel?: PersonnelState | null;
    // Hiring hall (D-059) — the refreshing candidate market {periodKey, pool}; optional, migration-safe
    // (no version bump). Rebuilt per campaign month by ensureHiringMarket(). DATA-002.
    hiringMarket?: HiringMarket | null;
    // Payroll shortfalls (D-075) — recorded unpaid-payroll months for the future T-040 turnover system;
    // optional, migration-safe (no version bump). DATA-002.
    payrollShortfalls?: PayrollShortfall[] | null;
    // Star Map (D-079) — the campaign's current location (a systemId in star/systems.json); optional,
    // migration-safe (no version bump). Old saves lack it → hydrate defaults null. DATA-002.
    currentLocation?: string | null;
    // Game system (D-083) — Alpha Strike vs Classic BattleTech; optional, migration-safe (no version bump).
    // Old saves lack it → hydrate defaults Classic BattleTech ('cbt'). DATA-002.
    gameSystem?: GameSystem | null;
    // Campaign system (D-108) — Traditional (Campaign Operations) vs Hot Spots (Chaos Campaign), + the chosen Hot
    // Spot campaign id; optional, migration-safe. Old saves lack them → hydrate defaults null (Traditional). DATA-002.
    campaignSystem?: 'traditional' | 'hotspots' | null;
    packId?: string | null; // ODM-1 — additive campaign-pack discriminator
    odmOutcomes?: Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }> | null; // ODM-3
    odmActiveNodeId?: string | null; // ODM-3
    odmSeeds?: Record<string, string> | null; // ODM-7
    odmStocks?: import('./new-campaign-state').OdmStocks | null; // ODM-11 — additive survival-economy stocks
    odmFleetStatus?: Record<string, string> | null; // ODM-17 P2 — the live vessel-status overlay (empty = the pack's own statuses); STATE, never pack data
    odmBench?: import('./new-campaign-state').OdmBenchJob[] | null; // ODM-17 P3 — the MAC-7 bench queue (IN-SHOP items)
    odmMaintenance?: Record<string, import('./new-campaign-state').OdmMaintenanceRecord> | null; // ODM-17 P4 — 30-day cycle records
    odmSupport?: Record<string, import('./new-campaign-state').OdmSupportCounts> | null; // ODM-17 P4 — live register overlay
    hotSpotCampaign?: string | null;
    // Warchest (D-109) — the Chaos Campaign SP economy (Hot Spots only): balance, Reputation, Contract Scale, and
    // the Contract Record Sheet ledger. Optional, migration-safe. Old/Traditional saves lack them → null/1/[]
    // (no Warchest tab). DATA-002. (Runtime economy state → persisted via the host-store snapshot.)
    warchestSP?: number | null;
    reputation?: number | null;
    contractScale?: number | null;
    gmDifficulty?: number | null; // D-124
    warchestLedger?: WarchestEntry[] | null;
    // Chaos contract (D-110) — the active clean-room contract (Hot Spots); optional, migration-safe. Old saves → null.
    activeChaosContract?: ChaosContract | null;
    participantContract?: ChaosContract | null; // GM-2 P2a — THIS device's own contract (server-attached per recipient; never client-written)
    participantVoid?: VoidedContract | null; // GM-3 P1 — THIS device's own voided contract (server-attached per recipient; never client-written)
    contractSummary?: import('./chaos/chaos-contract').ContractSummary | null; // GM-2 P2a — the player-safe projection of the primary (GM session, top-level)
    completedChaosContract?: import('./chaos/chaos-contract').ContractSummary | null; // PD3 P2 — the TERMINAL contract record (top-level; the phone's phase gate)
    // D-116 — user-authored Hot Spots track presets; optional, migration-safe. Old saves → [].
    chaosTrackPresets?: PresetTrack[] | null;
    customHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null; // D-124
    // HSFORGE-1 — forged (Forge-generated) hotspots; a SIBLING slice to customHotSpots (ruling D1: engine
    // content, never custom-stamped, not read by the api guest gate). Optional, migration-safe (no version
    // bump — the additive pattern every optional field since D-059 uses). Old saves lack it → [].
    forgedHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
    // HSFORGE-1 P2 — the merc command's theater (region id); optional, migration-safe. Old saves → null (era-only).
    hsRegion?: string | null;
    hiredMercs?: import('./chaos/hire-personnel').HiredMerc[] | null; // IMPORT-3 P2
    contractHiredKeys?: string[] | null; // IMPORT-3 P2
    hotSpotOffer?: string[] | null; // D-124b
    hotSpotShowAll?: boolean | null; // D-129
    reckoningBegun?: boolean | null; // D-135
    gmSession?: boolean | null; // GM-1 P1 — Master GM session (absent on every legacy save → false)
    // GM-1 P2 — the ONE well-known GM-only key: in a GM session the offer/chamber state rides here and the
    // server fan strips it for non-GM recipients (snapshot-shape.ts). Absent everywhere else.
    gmOnly?: {
        customHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
        forgedHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
        hsRegion?: string | null;
        hotSpotOffer?: string[] | null;
        hotSpotShowAll?: boolean | null;
        reckoningBegun?: boolean | null;
        // GM-2 P2a — in a GM session the PRIMARY contract, its synthetic offer and the participant map ride here (H14)
        activeChaosContract?: ChaosContract | null;
        acceptedContract?: ContractOffer | null;
        participantContracts?: Record<string, ChaosContract> | null;
        voidedContracts?: Record<string, VoidedContract> | null; // GM-3 P1 — participant contracts voided by un-present (GM truth)
        pilotNotes?: Record<string, string> | null; // ODM-18 P1 — GM-private pilot notes (stripped for players)
        gmMissionDrafts?: import('./odm/odm-gm-mission').OdmGmDraft[] | null; // ODM-18 P3 — composer drafts (GM truth)
    } | null;
    presentedHotspot?: import('./gm/presented-hotspot').PresentedHotspot | null; // GM-1 P2 — the published player-safe brief
    playerUnitCap?: number | null; // GM-1 P3 — the GM-set import cap (top-level: players must see it)
    resultsSlip?: import('./gm/results-slip').ResultsSlip | null; // GM-1 P3 — the take-home resolve record
    appliedSlips?: string[] | null; // GM-2 P1 — slipIds already applied to THIS (home) campaign
    tableBound?: import('./new-campaign-state').TableBound | null; // GM-3 P3 — this home campaign is bound to a GM's table (month advance withheld)
    odmProjection?: import('./odm/odm-projection').OdmProjection | null; // ODM-18 P1 — the company-state projection
    odmGmMissions?: import('./odm/odm-gm-mission').OdmGmMission[] | null; // ODM-18 P3 — published composed missions
}

@Injectable({ providedIn: 'root' })
export class CampaignPersistenceService {
    private readonly state = inject(NewCampaignState);

    /** Snapshot the assembled campaign setup to the single most-recent slot (overwrites). */
    save(): void {
        const s = this.state;
        const snap: CampaignSnapshot = {
            version: SCHEMA_VERSION,
            savedAt: Date.now(),
            era: s.era(),
            startDate: s.startDate(),
            force: s.force(),
            faction: s.faction(),
            unit: s.unit(),
            unitSize: s.unitSize(),
            capital: s.capital(),
            resources: s.resources(),
            gameSystem: s.gameSystem(), // D-083
            campaignSystem: s.campaignSystem(), // D-108
            packId: s.packId(), // ODM-1
            odmOutcomes: s.odmOutcomes(), odmActiveNodeId: s.odmActiveNodeId(), // ODM-3 — additive
            odmSeeds: s.odmSeeds(), // ODM-7 — the seed is the only OpFor artifact in the fanned snapshot
            odmStocks: s.odmStocks(), // ODM-11 — the survival-economy stocks (GM-adjusted; display-only v1)
            odmFleetStatus: s.odmFleetStatus(), // ODM-17 P2 — the live vessel-status overlay
            odmBench: s.odmBench(), // ODM-17 P3 — the MAC-7 bench queue
            odmMaintenance: s.odmMaintenance(), // ODM-17 P4
            odmSupport: s.odmSupport(), // ODM-17 P4
            hotSpotCampaign: s.hotSpotCampaign(),
            warchestSP: s.warchestSP(), // D-109 (runtime economy; the authoritative round-trip is the host store)
            reputation: s.reputation(),
            contractScale: s.contractScale(),
            gmDifficulty: s.gmDifficulty(), // D-124
            warchestLedger: s.warchestLedger(),
            ...(s.gmSession() ? { contractSummary: contractSummaryOf(s.activeChaosContract()) } : { activeChaosContract: s.activeChaosContract() }), // D-110 · GM-2 P2a — mirrors writer A: GM session → terms under gmOnly (H14), summary top-level
            chaosTrackPresets: s.chaosTrackPresets(), // D-116
            // GM-1 P2 — writer B mirrors writer A's gmOnly split EXACTLY (the two writers move in lockstep;
            // hydrate accepts both layouts). Plain HS byte-identical. ODM-18 P1 — gmOnly ALSO carries
            // pilotNotes when present (ODM, no gmSession): the gmOnly emit condition is gmSession OR notes.
            ...(s.gmSession() ? {} : { customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion() }), // D-124 · HSFORGE-1 · P2
            hiredMercs: s.hiredMercs(), contractHiredKeys: s.contractHiredKeys(), // IMPORT-3 P2
            ...(s.gmSession()
                ? { gmOnly: { activeChaosContract: s.activeChaosContract(), acceptedContract: s.acceptedContract(), participantContracts: s.participantContracts(), voidedContracts: s.voidedContracts(), customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion(), hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}) } }
                : { hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...((Object.keys(s.gmPilotNotes()).length || s.gmMissionDrafts().length) ? { gmOnly: { ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}) } } : {}) }), // D-124b · D-129 · D-135 · ODM-18
            gmSession: s.gmSession(), // GM-1 P1
            presentedHotspot: s.presentedHotspot(), // GM-1 P2
            completedChaosContract: s.completedChaosContract(), // PD3 P2 — writer B mirrors writer A: top-level, the terminal contract record
            playerUnitCap: s.playerUnitCap(), // GM-1 P3
            resultsSlip: s.resultsSlip(), // GM-1 P3
            appliedSlips: s.appliedSlips(), // GM-2 P1
            tableBound: s.tableBound(), // GM-3 P3
            odmProjection: s.odmProjection(), // ODM-18 P1
            odmGmMissions: s.odmGmMissions(), // ODM-18 P3 — top-level: PUBLISHED composed missions must reach players
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
        } catch {
            /* storage full / unavailable — non-fatal for a scaffold snapshot */
        }
    }

    /** Load + validate the snapshot, or null if absent / corrupt / unknown version. */
    load(): CampaignSnapshot | null {
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
        if (!raw) return null;
        try {
            const snap = JSON.parse(raw) as CampaignSnapshot;
            // Migration hook: when SCHEMA_VERSION bumps, upgrade older snapshots here.
            if (!snap || snap.version !== SCHEMA_VERSION) return null;
            return snap;
        } catch {
            return null;
        }
    }

    /** A usable saved campaign exists (enough to render the dashboard). */
    exists(): boolean {
        const snap = this.load();
        return !!snap && !!snap.era && !!snap.resources;
    }

    /** Restore the saved snapshot into NewCampaignState. Returns true if rehydrated. */
    rehydrate(): boolean {
        const snap = this.load();
        if (!snap) return false;
        this.state.hydrate(snap);
        return true;
    }

    /** Clear the single slot. */
    clear(): void {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* ignore */
        }
    }
}
