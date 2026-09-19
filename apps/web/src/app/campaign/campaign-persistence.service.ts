import { contractSummaryOf } from './chaos/chaos-contract';
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
import type { ChaosContract, VoidedContract } from './chaos/chaos-contract';
import type { PresetTrack } from './chaos/chaos-track-preset';
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
    // date to the start date and the treasury to the capital value on load.
    currentDate?: CampaignStartDate | null;
    treasury?: number | null;
    completedContracts?: ContractOffer[] | null;
    missionSpec?: MissionSpec | null;
    npcAssignments?: Record<string, string> | null;
    staffVoices?: Record<string, string> | null;
    outcomeLedger?: OutcomeRecord[] | null;
    escalationByThread?: Record<string, number> | null;
    escalationCampaign?: number | null;
    missionTree?: MissionBranch[] | null;
    treeArchive?: TreeArchiveEntry[] | null;
    campaignLog?: CampaignLogEntry[] | null;
    bays?: Bay[] | null;
    bayHistory?: BayHistoryEntry[] | null;
    intel?: IntelState | null;
    techPool?: TechPool | null;
    // (no version bump). Forward-only ensureStartingInventory() back-fills saves that lack it. DATA-002.
    inventory?: InventoryState | null;
    shopOrders?: ShopOrder[] | null;
    // (no version bump). Forward-only ensureStartingPersonnel() back-fills saves that lack it. DATA-002.
    personnel?: PersonnelState | null;
    // (no version bump). Rebuilt per campaign month by ensureHiringMarket(). DATA-002.
    hiringMarket?: HiringMarket | null;
    // optional, migration-safe (no version bump). DATA-002.
    payrollShortfalls?: PayrollShortfall[] | null;
    // migration-safe (no version bump). Old saves lack it → hydrate defaults null. DATA-002.
    currentLocation?: string | null;
    // Old saves lack it → hydrate defaults Classic BattleTech ('cbt'). DATA-002.
    gameSystem?: GameSystem | null;
    // Spot campaign id; optional, migration-safe. Old saves lack them → hydrate defaults null (Traditional). DATA-002.
    campaignSystem?: 'traditional' | 'hotspots' | null;
    packId?: string | null;
    odmOutcomes?: Record<string, { tier: 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE'; flags: string[] }> | null;
    odmActiveNodeId?: string | null;
    odmSeeds?: Record<string, string> | null;
    odmStocks?: import('./new-campaign-state').OdmStocks | null;
    odmFleetStatus?: Record<string, string> | null;
    odmBench?: import('./new-campaign-state').OdmBenchJob[] | null;
    odmMaintenance?: Record<string, import('./new-campaign-state').OdmMaintenanceRecord> | null;
    odmSupport?: Record<string, import('./new-campaign-state').OdmSupportCounts> | null;
    hotSpotCampaign?: string | null;
    // the Contract Record Sheet ledger. Optional, migration-safe. Old/Traditional saves lack them → null/1/[]
    // (no Warchest tab). DATA-002. (Runtime economy state → persisted via the host-store snapshot.)
    warchestSP?: number | null;
    reputation?: number | null;
    contractScale?: number | null;
    gmDifficulty?: number | null;
    warchestLedger?: WarchestEntry[] | null;
    activeChaosContract?: ChaosContract | null;
    participantContract?: ChaosContract | null;
    participantVoid?: VoidedContract | null;
    contractSummary?: import('./chaos/chaos-contract').ContractSummary | null;
    completedChaosContract?: import('./chaos/chaos-contract').ContractSummary | null; // PD3 P2 — the TERMINAL contract record (top-level; the phone's phase gate)
    chaosTrackPresets?: PresetTrack[] | null;
    customHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
    // HSFORGE-1 — forged (Forge-generated) hotspots; a SIBLING slice to customHotSpots (ruling D1: engine
    // content, never custom-stamped, not read by the api guest gate). Optional, migration-safe (no version
    forgedHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
    // HSFORGE-1 P2 — the merc command's theater (region id); optional, migration-safe. Old saves → null (era-only).
    hsRegion?: string | null;
    hiredMercs?: import('./chaos/hire-personnel').HiredMerc[] | null;
    contractHiredKeys?: string[] | null;
    hotSpotOffer?: string[] | null;
    hotSpotShowAll?: boolean | null;
    reckoningBegun?: boolean | null;
    gmSession?: boolean | null;
    // server fan strips it for non-GM recipients (snapshot-shape.ts). Absent everywhere else.
    gmOnly?: {
        customHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
        forgedHotSpots?: import('./chaos/hotspots-catalog').HotSpot[] | null;
        hsRegion?: string | null;
        hotSpotOffer?: string[] | null;
        hotSpotShowAll?: boolean | null;
        reckoningBegun?: boolean | null;
        activeChaosContract?: ChaosContract | null;
        acceptedContract?: ContractOffer | null;
        participantContracts?: Record<string, ChaosContract> | null;
        voidedContracts?: Record<string, VoidedContract> | null;
        pilotNotes?: Record<string, string> | null;
        odmLedger?: import('./odm/odm-ledger').OdmLedgerEntry[] | null;
        gmMissionDrafts?: import('./odm/odm-gm-mission').OdmGmDraft[] | null;
    } | null;
    presentedHotspot?: import('./gm/presented-hotspot').PresentedHotspot | null;
    playerUnitCap?: number | null;
    resultsSlip?: import('./gm/results-slip').ResultsSlip | null;
    appliedSlips?: string[] | null;
    tableBound?: import('./new-campaign-state').TableBound | null;
    odmProjection?: import('./odm/odm-projection').OdmProjection | null;
    odmSeatNotes?: Record<string, string> | null;
    odmSeatRequests?: import('./odm/odm-ledger').OdmSeatRequest[] | null;
    odmGmMissions?: import('./odm/odm-gm-mission').OdmGmMission[] | null;
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
            gameSystem: s.gameSystem(),
            campaignSystem: s.campaignSystem(),
            packId: s.packId(),
            odmOutcomes: s.odmOutcomes(), odmActiveNodeId: s.odmActiveNodeId(),
            odmSeeds: s.odmSeeds(),
            odmStocks: s.odmStocks(),
            odmFleetStatus: s.odmFleetStatus(),
            odmBench: s.odmBench(),
            odmMaintenance: s.odmMaintenance(),
            odmSupport: s.odmSupport(),
            hotSpotCampaign: s.hotSpotCampaign(),
            warchestSP: s.warchestSP(),
            reputation: s.reputation(),
            contractScale: s.contractScale(),
            gmDifficulty: s.gmDifficulty(),
            warchestLedger: s.warchestLedger(),
            ...(s.gmSession() ? { contractSummary: contractSummaryOf(s.activeChaosContract()) } : { activeChaosContract: s.activeChaosContract() }),
            chaosTrackPresets: s.chaosTrackPresets(),
            // pilotNotes when present (ODM, no gmSession): the gmOnly emit condition is gmSession OR notes.
            ...(s.gmSession() ? {} : { customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion() }),
            hiredMercs: s.hiredMercs(), contractHiredKeys: s.contractHiredKeys(),
            ...(s.gmSession()
                ? { gmOnly: { activeChaosContract: s.activeChaosContract(), acceptedContract: s.acceptedContract(), participantContracts: s.participantContracts(), voidedContracts: s.voidedContracts(), customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion(), hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}), ...(s.odmLedger().length ? { odmLedger: s.odmLedger() } : {}) } }
                : { hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...((Object.keys(s.gmPilotNotes()).length || s.gmMissionDrafts().length || s.odmLedger().length) ? { gmOnly: { ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}), ...(s.odmLedger().length ? { odmLedger: s.odmLedger() } : {}) } } : {}) }),
            gmSession: s.gmSession(),
            presentedHotspot: s.presentedHotspot(),
            completedChaosContract: s.completedChaosContract(), // PD3 P2 — writer B mirrors writer A: top-level, the terminal contract record
            playerUnitCap: s.playerUnitCap(),
            resultsSlip: s.resultsSlip(),
            appliedSlips: s.appliedSlips(),
            tableBound: s.tableBound(),
            odmProjection: s.odmProjection(),
            ...(Object.keys(s.odmSeatNotes()).length ? { odmSeatNotes: s.odmSeatNotes() } : {}), ...(s.odmSeatRequests().length ? { odmSeatRequests: s.odmSeatRequests() } : {}),
            odmGmMissions: s.odmGmMissions(),
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
