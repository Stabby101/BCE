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
import { Injectable, computed, signal } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { ContractMarket, ContractOffer } from './contract/contract-market';
import { syntheticOfferFromChaos, type ChaosContract, type ContractSummary, type VoidedContract } from './chaos/chaos-contract'; // D-110 — the clean-room Chaos contract (Hot Spots) · GM-2 P2a — the accessor's synthetic offer
import type { PresetTrack } from './chaos/chaos-track-preset'; // D-116 — user-authored Hot Spots track presets
import type { HotSpot } from './chaos/hotspots-catalog'; // D-124 — user-authored custom hotspots (type-only; no runtime cycle)
import type { PresentedHotspot } from './gm/presented-hotspot'; // GM-1 P2 — the published player-safe brief (type-only)
import type { ResultsSlip } from './gm/results-slip'; // GM-1 P3 — the take-home resolve record (type-only)
import type { OdmProjection } from './odm/odm-projection'; // ODM-18 P1 (type-only)
import type { OdmGmMission, OdmGmDraft } from './odm/odm-gm-mission'; // ODM-18 P3 (type-only)
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

/** GM-3 P3 — a home campaign bound to a GM's table: its month advance is withheld until the player leaves the table. */
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

/** D-029: a dated campaign-log entry (purchases, sales, GM admin). Persisted; merged into the Overview log.
 *  kind (D-034, optional — pre-D-034 entries render untyped): the Intel notebook's type chip. */
export interface CampaignLogEntry {
    date: CampaignStartDate;
    text: string;
    kind?: 'purchase' | 'sale' | 'walk' | 'repair' | 'admin' | 'income' | 'parts'; // 'parts' — ODM-17 P3 (additive): the materiel-lifecycle ledger rows (INSTALLED/CONSUMED/BARTERED…); Classic never writes it
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

/** ODM-11 — one munitions bin of the survival economy (tons on hand vs the authored floor; null floor = no
 *  floor authored — a zero bin like Arrow IV renders as ZERO, never as absent). */
export interface OdmStockBin {
    tons: number;
    floorTons: number | null;
    note?: string; // authored one-liner (e.g. why a bin is zero) — GM-side display only
    /** ODM-17 P3-d (additive) — ASSESS-FIRST tonnage held OUT of the usable pool (the doctrine's ammo
     *  quarantine: Inferno/Precision/NARC lots land here; rearm reads `tons` only, so quarantined tonnage
     *  is structurally unusable until a bench assessment clears it back into `tons`). */
    quarantinedTons?: number;
}

/** ODM-17 P4-a (additive, D-0b) — one machine's maintenance record: the 30-day cycle's last completion,
 *  the in-progress hours, and the overdue/breakdown bookkeeping. Keyed by instanceId in odmMaintenance;
 *  absent = never cycled (the campaign start date anchors the first cycle). */
export interface OdmMaintenanceRecord {
    lastDone?: { y: number; m: number; d: number };  // absent = the campaign start anchors the clock
    progressHours?: number;                          // hours burned toward the current due cycle
    needHours?: number;                              // this cycle's price (18 light / 24 heavy) — stamped when the cycle comes due
    lastRollMonths?: number;                         // how many overdue-months have been breakdown-rolled (the monthly cadence marker)
}

/** ODM-17 P4-d (additive, D-0b) — the LIVE support-register overlay by asset id (available/deployed/
 *  expended move in play; the pack ships the seed — packs are never a system of record for live counts). */
export interface OdmSupportCounts { available: number; deployed: number; expended: number }

/** ODM-17 P3-b (additive, D-0b) — one bench job at MAC-7 (the doctrine's IN-SHOP state): items pulled OUT
 *  of the stores while the assessment/inspection/repair/ammo-clearance work burns MAC-7 hours (the bays
 *  burn first; the bench takes the day's leftover — strict priority arrives with P4). */
export interface OdmBenchJob {
    id: string;
    kind: 'assess' | 'inspect' | 'repair' | 'ammo';
    label: string;                 // component label · or the BIN name for kind 'ammo'
    count: number;                 // items (components) · tons (ammo)
    outcome?: { a: number; b: number; c: number }; // 'assess' only — the GM's grading, applied at completion
    hoursRemaining: number;
    startedDate: { y: number; m: number; d: number };
}
/** ODM-11 — the ODM survival-economy stocks (attrition, not cash flow). v1 is DISPLAY + GM manual adjust
 *  only (R2); numbers come from the authored pack ledger, never invented. Additive to the snapshot (D-0b). */
export interface OdmStocks {
    fuelTons: number;
    fuelCapacityTons: number;
    fuelFloorTons: number;
    crackerTonsPerDay: number; // the fuel crackers' production rate
    missionBurnTons: number; // baseline fuel burn per operation
    bins: Record<string, OdmStockBin>; // insertion-ordered by seed; keyed by display name (LRM, SRM, …)
    exposure: string; // ODM-11 Part B — GM-SET assessment (v1: no automatic rise/decay model, by ruling)
    /** ODM-13 Ruling 1 — the one-shot inventory-ammo→bins migration ran (or the campaign was born after it).
     *  Additive within the additive object; absent = a pre-ODM-13 save the quartermaster reconciles once. */
    invAmmoMigrated?: boolean;
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
    /** ODM-12 (additive, optional) — pack CONTACT ids whose first-encounter entry has FILED (the channel
     *  was used / their operation began). Day-one entries never appear here; Classic never writes it. */
    odmFiled?: string[];
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
    // ODM-11 — the SURVIVAL economy stocks (pack campaigns only; null elsewhere). Additive D-108 wire.
    // v1 DISPLAYS + GM-adjusts only (R2: no auto-consumption); seeds lifted from the authored pack ledger.
    // NB comments here reach BOTH bundles — never name pack content (the odm2 dist leak-net greps for it).
    readonly odmStocks = signal<OdmStocks | null>(null);
    /** ODM-17 P2 — LIVE fleet-status overlay by vessel id (a future mission may un-ground a ship; the
     *  pack ships the defaults and this overlay wins where set). Additive; empty = pack truth. */
    readonly odmFleetStatus = signal<Record<string, string>>({});
    /** ODM-17 P3-b — the MAC-7 bench queue (IN-SHOP items; burned by the repair-bays day driver). Additive. */
    readonly odmBench = signal<OdmBenchJob[]>([]);
    /** ODM-17 P4-a — per-machine 30-day maintenance records (instanceId-keyed). Additive. */
    readonly odmMaintenance = signal<Record<string, OdmMaintenanceRecord>>({});
    /** ODM-17 P4-d — the live support-register overlay (asset-id-keyed counts; pack seeds). Additive. */
    readonly odmSupport = signal<Record<string, OdmSupportCounts>>({});
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
    // ── GM-2 P2a — PER-PARTICIPANT contracts (GM as broker). `participantContracts`: one ChaosContract per joined
    //    company, keyed by the P1 participant identity (the home campaign id the mint's provenance carries). GM truth:
    //    rides under gmOnly, never written by a non-GM campaign (the map stays {} there → every accessor below returns
    //    the PRIMARY, byte-identical). `participantContract`: THIS device's own contract, attached per-recipient by the
    //    server fan (never written by a client writer). `contractSummary`: the player-safe projection of the primary
    //    (identity, never terms — H14), written top-level by the GM writers in a GM session. ──
    readonly participantContracts = signal<Record<string, ChaosContract>>({});
    readonly participantContract = signal<ChaosContract | null>(null);
    readonly contractSummary = signal<ContractSummary | null>(null);
    // PD3 P2 — the TERMINAL contract record: the completed singular's player-safe summary (status 'completed'), written at both
    // completion sites (the intensity auto-complete + End Contract) where the singular is nulled; cleared when a new one starts.
    // Top-level in the fan (every device must tell "complete" from "never minted"). Old saves lack it → null.
    readonly completedChaosContract = signal<ContractSummary | null>(null);
    // GM-3 P1 — participant contracts VOIDED by un-present (GM truth under gmOnly; cleared at the next Present ▸) and THIS
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
    // GM-1 P1 — MASTER GM SESSION: an HS campaign run as a table session (GM tab + table mode + presented hotspots).
    //    Additive snapshot flag; default false (every legacy save + plain HS). Resets in reset() — NOT clearMercIdentity(),
    //    which fires on era/archetype change and would wipe the flag mid-wizard (the tile sets it before Setup).
    readonly gmSession = signal<boolean>(false);
    /** GM-3 P2 — a TABLE WITH NO COMPANY: a gmSession minted empty (era + theater only, warchestSP left null — the GM hosts
     *  and referees, fielding nobody of his own). The five shared sites branch on this: the monthly Maintenance tick skips
     *  it (nothing to bleed), the dashboard does not seed it a warchest, resolve refuses a zero-deployed table. A plain
     *  campaign is NEVER company-less (the wizard seeds it), and a GM who built/brought a company has warchestSP set → false. */
    readonly companylessTable = computed(() => this.gmSession() && this.warchestSP() === null);
    // GM-1 P2 — the PRESENTED hotspot: the player-safe brief the GM published to the table (null = nothing
    // presented; present replaces, retract clears — one live hotspot at a time, the Pendragon default).
    readonly presentedHotspot = signal<PresentedHotspot | null>(null);
    // ODM-18 P1 (ruling 1) — GM-PRIVATE pilot notes, relocated OUT of pilots[].gmNotes: the fanned pilots
    // array reaches every joined player, and the field NAMED gmNotes keeps its name's promise for ODM.
    // Rides the snapshot under gmOnly.pilotNotes (the fan strips it); forward-only migration on ODM load.
    readonly gmPilotNotes = signal<Record<string, string>>({});
    // ODM-18 P1 (ruling 2) — the company-state PROJECTION (pool hours · fleet lines · support counts ·
    // contact rows): the GM device publishes what the pack-401-walled player console may see. Top-level.
    readonly odmProjection = signal<OdmProjection | null>(null);
    // ODM-18 P3 (§S-4, the presented-hotspot split): PUBLISHED composed missions are PLAYER-SAFE and ride
    // TOP-LEVEL so the fan carries them (the player device has no pack path — §S-5); the GM-side DRAFTS carry
    // design truth and ride under gmOnly, which the server deletes unparsed for every non-GM recipient.
    readonly odmGmMissions = signal<OdmGmMission[]>([]);
    readonly gmMissionDrafts = signal<OdmGmDraft[]>([]);
    // GM-1 P3 — the GM-set per-player import cap (join-with-force). TOP-LEVEL by design: the player device
    // must SEE the cap (gmOnly is stripped for players); null = unset → every consumer applies ?? 4 (the
    // directive's default lance). The server enforces it authoritatively at the import handler.
    readonly playerUnitCap = signal<number | null>(null);
    // GM-1 P3 — the RESULTS SLIP: each player's take-home record from the last resolve (their units'
    // end-state — export, not write-back; the v1 ruling). Replaced at each resolve; top-level (players
    // must receive it); rows carry NO tokens — the player filters by its own claim rows.
    readonly resultsSlip = signal<ResultsSlip | null>(null);
    /** GM-2 P1 — the slipIds this campaign has ALREADY applied (the idempotency key of "Apply to my campaign"). Persisted
     *  top-level; written by the player device through the campaign store on its own token. Empty on every other campaign. */
    readonly appliedSlips = signal<string[]>([]);
    /** GM-3 P3 — when THIS (home) campaign is bound to a GM's table (the player joined it with this company): month advance is
     *  withheld while bound (the table's clock is the GM's). Written by the player device on its own token at join-with-company
     *  (beside appliedSlips); "Leave the table" clears it. Null on every plain campaign and every non-joined home campaign. */
    readonly tableBound = signal<TableBound | null>(null);

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
        if (c) this.completedChaosContract.set(null); // PD3 P2 — a new contract supersedes the terminal record
    }
    /** PD3 P2 — record the completed contract (its player-safe summary, status 'completed') as the phase's terminal witness. */
    setCompletedChaosContract(c: ContractSummary | null): void {
        this.completedChaosContract.set(c);
    }
    /** GM-2 P2a — sign / release ONE participant's contract (GM sessions only; a plain campaign never writes the map). */
    setParticipantContract(key: string, c: ChaosContract | null): void {
        if (!this.gmSession()) return;
        this.participantContracts.update((m) => { const next = { ...m }; if (c) next[key] = c; else delete next[key]; return next; });
    }
    clearParticipantContracts(): void { if (Object.keys(this.participantContracts()).length) this.participantContracts.set({}); }
    /** GM-3 P1 — the voided map (GM sessions only; a plain campaign never writes it). */
    setVoidedContracts(m: Record<string, VoidedContract>): void { if (!this.gmSession()) return; this.voidedContracts.set(m); }
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
    setGmSession(v: boolean): void { this.gmSession.set(v); } // GM-1 P1
    setPresentedHotspot(p: PresentedHotspot | null): void { this.presentedHotspot.set(p); } // GM-1 P2
    setPlayerUnitCap(n: number | null): void { this.playerUnitCap.set(n); } // GM-1 P3
    setGmPilotNotes(v: Record<string, string>): void { this.gmPilotNotes.set({ ...v }); } // ODM-18 P1
    setOdmProjection(p: OdmProjection | null): void { this.odmProjection.set(p); } // ODM-18 P1
    setOdmGmMissions(list: OdmGmMission[]): void { this.odmGmMissions.set([...list]); } // ODM-18 P3
    setGmMissionDrafts(list: OdmGmDraft[]): void { this.gmMissionDrafts.set([...list]); } // ODM-18 P3
    setResultsSlip(s: ResultsSlip | null): void { this.resultsSlip.set(s); } // GM-1 P3
    setAppliedSlips(ids: string[]): void { this.appliedSlips.set(ids); } // GM-2 P1
    setTableBound(t: TableBound | null): void { this.tableBound.set(t); } // GM-3 P3
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
        this.participantContracts.set({}); this.participantContract.set(null); this.contractSummary.set(null); // GM-2 P2a
        this.completedChaosContract.set(null); // PD3 P2
        this.voidedContracts.set({}); this.participantVoid.set(null); // GM-3 P1
        this.chaosTrackPresets.set([]); // D-116
        this.customHotSpots.set([]); // D-124
        this.forgedHotSpots.set([]); // HSFORGE-1
        this.hsRegion.set(null); // HSFORGE-1 P2
        this.hiredMercs.set([]); this.contractHiredKeys.set([]); // IMPORT-3 P2
        this.hotSpotOffer.set([]); // D-124b
        this.hotSpotShowAll.set(false); // D-129
        this.reckoningBegun.set(false); // D-135
        this.presentedHotspot.set(null); // GM-1 P2 — a fresh campaign presents nothing
        this.gmPilotNotes.set({}); // ODM-18 P1
        this.odmProjection.set(null); // ODM-18 P1
        this.odmGmMissions.set([]); // ODM-18 P3
        this.gmMissionDrafts.set([]); // ODM-18 P3
        this.playerUnitCap.set(null); // GM-1 P3 — back to the default cap
        this.resultsSlip.set(null); // GM-1 P3 — no slip on a fresh campaign
        this.appliedSlips.set([]); // GM-2 P1
        this.tableBound.set(null); // GM-3 P3
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
        this.gmSession.set(false); // GM-1 P1 — deliberately here, not clearMercIdentity (era change must not wipe it)
        this.armsMix.set('combined'); // D-068 — default to the combined-arms mix
        this.missionArmsMixOverride.set('auto'); // D-076 — GM toggle back to seed-honoring
        this.campaignSystem.set(null); // D-108 — the Setup card re-chooses each campaign (null → Traditional until picked)
        this.packId.set(null); // ODM-1
        this.odmOutcomes.set({}); this.odmActiveNodeId.set(null); // ODM-3
        this.odmSeeds.set({}); // ODM-7
        this.odmStocks.set(null); // ODM-11
        this.odmFleetStatus.set({}); // ODM-17 P2
        this.odmBench.set([]); // ODM-17 P3
        this.odmMaintenance.set({}); // ODM-17 P4
        this.odmSupport.set({}); // ODM-17 P4
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
        odmStocks?: OdmStocks | null; // ODM-11
        odmFleetStatus?: Record<string, string> | null; // ODM-17 P2 — the live vessel-status overlay
        odmBench?: OdmBenchJob[] | null; // ODM-17 P3 — the MAC-7 bench queue
        odmMaintenance?: Record<string, OdmMaintenanceRecord> | null; // ODM-17 P4 — the 30-day cycle records
        odmSupport?: Record<string, OdmSupportCounts> | null; // ODM-17 P4 — the live register overlay
        hotSpotCampaign?: string | null;
        warchestSP?: number | null;
        reputation?: number | null;
        contractScale?: number | null;
        gmDifficulty?: number | null; // D-124
        warchestLedger?: WarchestEntry[] | null;
        activeChaosContract?: ChaosContract | null;
        participantContract?: ChaosContract | null; // GM-2 P2a — THIS device's own contract (server-attached per recipient)
        participantVoid?: VoidedContract | null; // GM-3 P1 — THIS device's own voided contract (server-attached per recipient)
        contractSummary?: ContractSummary | null; // GM-2 P2a — the player-safe projection of the primary (GM session, top-level)
        completedChaosContract?: ContractSummary | null; // PD3 P2 — the TERMINAL contract record (top-level; the phone's phase gate)
        chaosTrackPresets?: PresetTrack[] | null;
        customHotSpots?: HotSpot[] | null; // D-124
        forgedHotSpots?: HotSpot[] | null; // HSFORGE-1
        hsRegion?: string | null; // HSFORGE-1 P2
        hiredMercs?: HiredMerc[] | null; // IMPORT-3 P2
        contractHiredKeys?: string[] | null; // IMPORT-3 P2
        hotSpotOffer?: string[] | null; // D-124b
        hotSpotShowAll?: boolean | null; // D-129
        reckoningBegun?: boolean | null; // D-135
        gmSession?: boolean | null; // GM-1 P1
        // GM-1 P2 — in a GM session the offer/chamber state rides under the gmOnly key (the fan strips it
        // for players); hydrate accepts BOTH layouts (gmOnly wins; top-level = plain HS + every legacy save).
        gmOnly?: {
            customHotSpots?: HotSpot[] | null;
            forgedHotSpots?: HotSpot[] | null;
            hsRegion?: string | null;
            hotSpotOffer?: string[] | null;
            hotSpotShowAll?: boolean | null;
            reckoningBegun?: boolean | null;
            // GM-2 P2a — in a GM session the PRIMARY contract, its synthetic offer and the participant map ride here (H14)
            activeChaosContract?: ChaosContract | null;
            acceptedContract?: ContractOffer | null;
            participantContracts?: Record<string, ChaosContract> | null;
            voidedContracts?: Record<string, VoidedContract> | null; // GM-3 P1
            pilotNotes?: Record<string, string> | null; // ODM-18 P1 — GM-private pilot notes (any pack; stripped for players)
            gmMissionDrafts?: OdmGmDraft[] | null; // ODM-18 P3 — composer drafts (GM truth; stripped for players)
        } | null;
        presentedHotspot?: PresentedHotspot | null; // GM-1 P2 — the published player-safe brief (top-level: players must receive it)
        odmProjection?: OdmProjection | null; // ODM-18 P1 — the company-state projection (top-level: players must receive it)
        odmGmMissions?: OdmGmMission[] | null; // ODM-18 P3 — PUBLISHED composed missions (top-level: players must receive them)
        playerUnitCap?: number | null; // GM-1 P3 — the GM-set import cap (top-level: players must see it)
        resultsSlip?: ResultsSlip | null; // GM-1 P3 — the take-home record from the last resolve
        appliedSlips?: string[] | null; // GM-2 P1
        tableBound?: TableBound | null; // GM-3 P3
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
        // GM-2 P2a — in a GM session the primary contract + its synthetic offer ride under gmOnly (H14: the terms never
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
        this.odmStocks.set(s.odmStocks ?? null); // ODM-11 — additive; old saves default null (the fork displays the authored seed)
        this.odmFleetStatus.set(s.odmFleetStatus ?? {}); // ODM-17 P2 — additive; empty = the pack's own statuses
        this.odmBench.set(s.odmBench ?? []); // ODM-17 P3 — additive; a legacy save has no bench queue
        this.odmMaintenance.set(s.odmMaintenance ?? {}); // ODM-17 P4 — additive; empty = never cycled (the start date anchors)
        this.odmSupport.set(s.odmSupport ?? {}); // ODM-17 P4 — additive; empty = the pack's seed counts
        this.hotSpotCampaign.set(s.hotSpotCampaign ?? null);
        this.warchestSP.set(s.warchestSP ?? null); // D-109 — old/Traditional saves lack it → null (no Warchest tab)
        this.reputation.set(s.reputation ?? null);
        this.contractScale.set(s.contractScale ?? 1);
        this.gmDifficulty.set(s.gmDifficulty ?? 1.0); // D-124 — old saves default to Standard (1.0)
        this.warchestLedger.set(s.warchestLedger ?? []);
        this.activeChaosContract.set(gOnly.activeChaosContract ?? s.activeChaosContract ?? null); // D-110 — old saves lack it → null (no contract) · GM-2 P2a: gmOnly wins in a GM session
        this.participantContracts.set(gOnly.participantContracts ?? {}); // GM-2 P2a — GM truth; a player's stripped snapshot → {}
        this.participantContract.set(s.participantContract ?? null); // GM-2 P2a — this device's own contract, attached by the fan
        this.voidedContracts.set(gOnly.voidedContracts ?? {}); // GM-3 P1 — GM truth; a player's stripped snapshot → {}
        this.participantVoid.set(s.participantVoid ?? null); // GM-3 P1 — this device's own void, attached by the fan
        this.contractSummary.set(s.contractSummary ?? null); // GM-2 P2a — the player-safe primary
        this.completedChaosContract.set(s.completedChaosContract ?? null); // PD3 P2 — the terminal record; old saves → null
        this.chaosTrackPresets.set(s.chaosTrackPresets ?? []); // D-116 — old saves lack it → [] (no presets)
        // GM-1 P2 — the gmOnly unwrap: a GM-session snapshot carries the offer/chamber keys under gmOnly
        // (gmOnly wins); plain HS + every legacy save keep them top-level. A PLAYER hydrating a stripped
        // GM-session snapshot lands on exactly the old-save defaults ([], false, null) — nothing invented.
        // Defense in depth (panel finding): the unwrap is gmSession-GATED — a crafted gmOnly on a non-GM
        // snapshot never hydrates (the server's gmOnly entitlement belt is the authoritative gate).
        const g = (s.gmSession ? s.gmOnly : null) ?? {};
        this.customHotSpots.set(g.customHotSpots ?? s.customHotSpots ?? []); // D-124 — old saves lack it → [] (no custom hotspots)
        this.forgedHotSpots.set(g.forgedHotSpots ?? s.forgedHotSpots ?? []); // HSFORGE-1 — old saves lack it → [] (nothing forged)
        this.hsRegion.set(g.hsRegion ?? s.hsRegion ?? null); // HSFORGE-1 P2 — old saves lack it → null (era-only, byte-identical)
        this.hiredMercs.set(s.hiredMercs ?? []); this.contractHiredKeys.set(s.contractHiredKeys ?? []); // IMPORT-3 P2 — old saves → []
        this.hotSpotOffer.set(g.hotSpotOffer ?? s.hotSpotOffer ?? []); // D-124b — persisted offer hand (stable across reloads)
        this.hotSpotShowAll.set(g.hotSpotShowAll ?? s.hotSpotShowAll ?? false); // D-129 — old saves lack it → false (dealt-5 board)
        this.reckoningBegun.set(g.reckoningBegun ?? s.reckoningBegun ?? false); // D-135 — old saves lack it → false (reckoning not begun)
        this.gmSession.set(s.gmSession ?? false); // GM-1 P1 — old saves lack it → false (a plain campaign)
        this.presentedHotspot.set(s.presentedHotspot ?? null); // GM-1 P2 — nothing presented on old saves
        // ODM-18 P1 — pilotNotes unwrap from gmOnly REGARDLESS of gmSession (ODM carries gmOnly without a
        // gmSession; not a smuggle vector — no server reader, and the entitlement belt gates hosted persists).
        this.gmPilotNotes.set(((s.gmOnly ?? {}) as { pilotNotes?: Record<string, string> | null }).pilotNotes ?? {});
        this.odmProjection.set(s.odmProjection ?? null); // ODM-18 P1 — old saves lack it → the console degrades honestly
        this.odmGmMissions.set(s.odmGmMissions ?? []); // ODM-18 P3 — old saves lack it → no composed missions
        // drafts unwrap from gmOnly UNGATED (the pilotNotes precedent): ODM carries gmOnly without a gmSession,
        // and the gmSession-gated unwrap above would silently drop every draft on an ODM load.
        this.gmMissionDrafts.set(((s.gmOnly ?? {}) as { gmMissionDrafts?: OdmGmDraft[] | null }).gmMissionDrafts ?? []);
        this.playerUnitCap.set(s.playerUnitCap ?? null); // GM-1 P3 — old saves lack it → the ??4 default applies downstream
        this.resultsSlip.set(s.resultsSlip ?? null); // GM-1 P3 — no slip on old saves
        this.tableBound.set(s.tableBound && typeof s.tableBound === 'object' ? s.tableBound : null); // GM-3 P3 — old/plain saves lack it → null
        this.appliedSlips.set(Array.isArray(s.appliedSlips) ? s.appliedSlips.filter((x) => typeof x === 'string') : []); // GM-2 P1 — oldsaves → none
    }
}
