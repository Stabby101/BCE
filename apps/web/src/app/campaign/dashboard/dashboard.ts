import { Component, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TableReturnService } from '../../shared/table-return.service';
import { NewCampaignState } from '../new-campaign-state';
import { CHAOS_CAMPAIGNS } from '../setup/chaos-campaigns';
import { computeLedger } from '../economy-ledger';
import { ARCH_NAMES, CUSTOM_UNIT } from '../faction/faction-data';
import { shipForSize } from '../size-capital/resources';
import { OrdersService } from '../orders/orders.service';
import { orderText as houseOrderText } from '../orders/house-orders';
import { RosterComponent } from './roster/roster';
import { FlowComponent } from './flow/flow';
import { StarMapTabComponent } from '../star/star-map-tab';
import { CurrentLocationComponent } from './current-location';
import { ExitConfirmComponent } from './exit-confirm';
import { SaveDialogComponent } from './save-dialog';
import { CampaignSaveStore, campaignProgress } from '../campaign-save-store';
import { StarSystemsService } from '../star/star-systems.service';
import { capitalSystemIdFor } from '../star/star-capitals';
import { ContractMarketService, type ClauseId } from '../contract/contract-market.service';
import type { ContractOffer } from '../contract/contract-market';
import type { SupportTerms } from '../contract/contract-terms';
import { CampaignClockService } from '../clock/campaign-clock.service';
import { CLOCK_TUNABLES, formatDate, campaignWeek, type SpanId } from '../clock/campaign-clock';
import { MissionGeneratorService } from '../mission/mission-generator.service';
import { NONE_NARRATOR, MISSION_TUNABLES } from '../mission/mission-spec';
import { MissionPackageComponent } from '../mission/mission-package';
import { DeployRosterComponent } from './deploy-roster';
import { HirePersonnelComponent } from '../chaos/hire-personnel-panel';
import { BattleViewComponent } from '../battle/battle-view';
import { MissionTreeService } from '../mission/mission-tree.service';
import type { MissionBranch } from '../mission/mission-tree'; // the __d110b deployAndActivate seam's test branch
import { deployedSet } from '../force/deployed';
import { FieldWalkComponent } from '../walk/field-walk';
import { FieldWalkService } from '../walk/field-walk.service';
import { RepairBaysComponent } from '../repair/repair-bays.component';
import { InventoryTabComponent } from '../inventory/inventory-tab';
import { InventoryService } from '../inventory/inventory.service';
import { SupportPersonnelComponent } from '../personnel/support-personnel';
import { HiringHallComponent } from '../personnel/hiring-hall';
import { PersonnelService } from '../personnel/personnel.service';
import { AarTabComponent } from '../aar/aar-tab';
import { IntelTabComponent } from '../intel/intel-tab';
import { PilotDetailComponent } from '../barracks/pilot-detail';
import { PilotService } from '../barracks/pilot.service';
import { ResolveService } from './resolve.service';
import { ResolveModalComponent } from './resolve-modal';
import { SpToastComponent } from './sp-toast';
import { SettingsTabComponent } from '../narrator/settings-tab';
import { NarratorConsoleComponent } from '../narrator/narrator-console';
import { LegalFooterComponent } from '../../shared/legal-footer'; // COMPLIANCE-3 — inline notice in the dashboard chrome
import { ClaimsPanelComponent } from '../claims/claims-panel';
import { LobbyPanelComponent } from '../claims/lobby-panel';
import { AuthService } from '../../auth/auth.service';
import { WarchestLedgerComponent } from '../chaos/warchest-ledger';
import { WarchestService } from '../chaos/warchest.service';
import { ChaosRepairComponent } from '../chaos/chaos-repair-tab';
import { ChaosContractsComponent } from '../chaos/chaos-contracts-tab';
import { ChaosMarketComponent } from '../chaos/chaos-market-tab';
import { ChaosHiringComponent } from '../chaos/chaos-hiring-tab';
import { ChaosTrackPresetsComponent } from '../chaos/chaos-track-presets';
import { TrackPickerComponent } from '../chaos/track-picker';
import { GmPanelComponent } from '../gm/gm-panel';
import { TableModeService } from '../gm/table-mode.service';
import { ForceImportService } from '../gm/force-import.service';
import { ContractSignService } from '../gm/contract-sign.service';
import { rollComplications } from '../chaos/chaos-complications';

interface TabDef {
    id: string;
    label: string;
}
const TABS: readonly TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'roster', label: 'Unit Roster' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'barracks', label: 'Barracks' },
    { id: 'missions', label: 'Missions' },
    { id: 'lobby', label: 'Lobby' },
    { id: 'aar', label: 'AAR' },
    { id: 'intel', label: 'Intel' },
    { id: 'flow', label: 'Flow' },
    { id: 'starmap', label: 'Star Map' },
    { id: 'repair', label: 'Repair & Salvage' },
    { id: 'settings', label: 'Settings' },
];
// economy home, standing in for Overview). The Traditional economy tabs (Overview/Inventory/Barracks/Repair &
// Salvage) are EXCLUDED here — they're replaced by from-scratch Chaos economy tabs as those slices land.
const HOTSPOTS_TABS: readonly TabDef[] = [
    // Repair & Refit) are reached through the top-of-sheet Process Rail, not pinned tabs; Intel + Flow are unpinned
    // surface stays ROUTABLE BY ID (select(): the rail + goToStep still navigate them).
    { id: 'warchest', label: 'Warchest' },
    { id: 'chaos-market', label: 'Market' },
    { id: 'roster', label: 'Unit Roster' },
    { id: 'starmap', label: 'Star Map' },
    { id: 'settings', label: 'Settings' },
];
const GM_HOTSPOTS_TABS: readonly TabDef[] = [{ id: 'gm', label: 'GM' }, ...HOTSPOTS_TABS];

@Component({
    selector: 'bce-campaign-dashboard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'theme-dossier' },
    imports: [RosterComponent, FlowComponent, ExitConfirmComponent, SaveDialogComponent, MissionPackageComponent, DeployRosterComponent, BattleViewComponent, FieldWalkComponent, RepairBaysComponent, InventoryTabComponent, SupportPersonnelComponent, HiringHallComponent, AarTabComponent, IntelTabComponent, PilotDetailComponent, SettingsTabComponent, NarratorConsoleComponent, ClaimsPanelComponent, LobbyPanelComponent, StarMapTabComponent, CurrentLocationComponent, ResolveModalComponent, SpToastComponent, WarchestLedgerComponent, ChaosRepairComponent, ChaosContractsComponent, ChaosMarketComponent, ChaosHiringComponent, ChaosTrackPresetsComponent, HirePersonnelComponent, TrackPickerComponent, LegalFooterComponent, GmPanelComponent],
    providers: [ResolveService],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.scss',
    // DEPLOY-009: the guest recovery banner — AMBER/GOLD, deliberately distinct from the blue player-join QR
    // (this restores the GM's OWN identity, not a game-join code). A separate stylesheet so dashboard.scss
    // stays under its 20kB per-component budget. Shown once per device until "I've saved it".
    styles: [`
        .rec-banner { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:14px; padding:11px 14px;
            border:1.6px solid #c79a3a; border-left-width:5px; background:linear-gradient(90deg, rgba(199,154,58,.14), var(--paper2)); }
        .rec-banner .rec-ico { font-size:20px; line-height:1; }
        .rec-banner .rec-body { flex:1 1 280px; min-width:0; }
        .rec-banner .rec-code { font-family:var(--mono); font-weight:700; font-size:19px; letter-spacing:3px; color:#8a6410; }
        .rec-banner .rec-msg { font-family:var(--type); font-size:12px; line-height:1.5; color:var(--ink2); margin-top:2px; }
        .rec-banner .rec-acts { display:flex; gap:8px; align-items:center; }
        .rec-banner .rec-copy, .rec-banner .rec-ack { font-family:var(--label); font-size:12px; font-weight:700; letter-spacing:.5px;
            text-transform:uppercase; padding:7px 13px; border:1.4px solid #c79a3a; background:var(--paper); color:#8a6410; cursor:pointer; }
        .rec-banner .rec-ack { background:#c79a3a; color:#1a1407; }
        .qm-intro { font-family:var(--type); font-size:13px; color:var(--ink2); line-height:1.5; max-width:640px; margin:0 0 14px; }
        .qm-gen { font-family:var(--label); font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:14px; padding:13px 22px;
            border:2px solid var(--stamp); background:var(--stamp); color:var(--paper); cursor:pointer; }
        .qm-gen:disabled { opacity:.5; cursor:not-allowed; }
        .qm-brief { margin-top:16px; border:1.5px solid var(--ink); background:var(--paper2); padding:14px 16px; max-width:720px; }
        .qm-row { display:flex; gap:14px; padding:5px 0; font-family:var(--type); font-size:13.5px; align-items:baseline; }
        .qm-row .qm-k { flex:0 0 92px; font-family:var(--label); font-weight:600; letter-spacing:1px; text-transform:uppercase; font-size:10px; color:var(--ink2); }
        .qm-row .qm-v { color:var(--ink); }
        .qm-row.bvmatch { border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin:5px 0; padding:8px 0; }
        .qm-row.bvmatch .qm-v b { font-family:var(--mono); color:var(--stamp); }
        .qm-sit { font-family:var(--type); font-size:13px; color:var(--ink2); line-height:1.55; margin:12px 0; }
        .qm-deploy { font-family:var(--label); font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:13px; padding:11px 18px;
            border:1.8px solid var(--ok, #3a7d44); background:var(--paper); color:var(--ok, #3a7d44); cursor:pointer; }
        .qm-deploy:hover { background:var(--ok, #3a7d44); color:var(--paper); }
        /* HF-016 — collapsible combat-pilot (MechWarriors) group header */
        .bk-grouphd { display:flex; align-items:center; gap:8px; width:100%; background:var(--paper); border:none; border-bottom:1.4px solid var(--ink); padding:8px 4px; margin-bottom:10px; cursor:pointer; text-align:left; font-family:var(--label); font-weight:600; letter-spacing:1.5px; text-transform:uppercase; font-size:13px; color:var(--ink); }
        .bk-grouphd:hover { background:var(--paper2); }
        .bk-grouphd .caret { display:inline-block; transition:transform .12s; color:var(--ink2); font-size:11px; }
        .bk-grouphd .caret.open { transform:rotate(90deg); }
        .econ { display:grid; grid-template-columns:1fr 1.4fr; gap:14px; margin:14px 0; }
        @media (max-width:760px) { .econ { grid-template-columns:1fr; } }
        .econ .box, .econ-led, .econ-log { border:1.5px solid var(--ink); background:var(--paper); padding:11px 13px; }
        .el-row { display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-family:var(--type); font-size:13px; padding:4px 0; }
        .el-l { font-family:var(--label); font-weight:600; letter-spacing:.5px; text-transform:uppercase; font-size:11px; color:var(--ink2); }
        .el-v { font-family:var(--mono); font-size:13px; color:var(--ink); }
        .el-v.pos { color:var(--ok,#3a7d44); } .el-v.neg { color:var(--warn,#c2622a); }
        .el-row.net { border-top:1px solid var(--line); margin-top:4px; padding-top:7px; }
        .el-row.net.black .el-v { color:var(--ok,#3a7d44); font-weight:700; } .el-row.net.red .el-v { color:var(--warn,#c2622a); font-weight:700; }
        .tx-scroll { max-height:240px; overflow-y:auto; margin-top:6px; }
        .tx { display:grid; grid-template-columns:88px 1fr auto auto; gap:10px; align-items:baseline; font-family:var(--type); font-size:12.5px; padding:5px 2px; border-bottom:1px solid color-mix(in srgb, var(--ink2) 20%, transparent); }
        .tx-d { font-family:var(--mono); font-size:11px; color:var(--ink2); }
        .tx-a { font-family:var(--mono); font-weight:700; text-align:right; } .tx.neg .tx-a { color:var(--warn,#c2622a); } .tx.pos .tx-a { color:var(--ok,#3a7d44); }
        .tx-b { font-family:var(--mono); font-size:11px; color:var(--ink2); text-align:right; min-width:74px; }
        .el-cue { font-family:var(--mono); font-size:11px; color:var(--ink2); margin-top:8px; padding-top:7px; border-top:1px dashed var(--line); }
        .el-warn, .el-short { font-family:var(--type); font-size:12px; line-height:1.4; margin-top:8px; padding:7px 9px; border:1.4px solid #c2622a; border-left-width:4px; background:color-mix(in srgb, #c2622a 8%, var(--paper)); color:#8a3d12; }
        .el-short { border-color:var(--stamp); background:color-mix(in srgb, var(--stamp) 9%, var(--paper)); color:var(--stamp); font-weight:600; }
        .msub { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 16px; border-bottom:1.5px solid var(--ink); padding-bottom:8px; }
        .msub-b { font-family:var(--label); font-weight:600; letter-spacing:1px; text-transform:uppercase; font-size:12px; padding:8px 14px; border:1.4px solid var(--ink2); background:var(--paper); color:var(--ink2); cursor:pointer; }
        .msub-b:hover { color:var(--ink); }
        .msub-b.on { background:var(--ink); color:var(--paper); border-color:var(--ink); }
    `],
})
export class CampaignDashboardComponent {
    private readonly router = inject(Router);
    protected readonly tableReturn = inject(TableReturnService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);
    private readonly contracts = inject(ContractMarketService);
    private readonly clock = inject(CampaignClockService);
    private readonly missionGen = inject(MissionGeneratorService);
    protected readonly emptyField = computed(() => {
        const spec = this.state.missionSpec();
        return this.state.gmSession() && !!spec && (spec.playerBv ?? 0) <= 1 && !spec.opforManual;
    });
    private readonly tree = inject(MissionTreeService);
    private readonly pilotSvc = inject(PilotService);
    protected readonly res = inject(ResolveService);
    protected readonly tableMode = inject(TableModeService);
    private readonly inventorySvc = inject(InventoryService);
    private readonly personnelSvc = inject(PersonnelService);
    private readonly auth = inject(AuthService); // DEPLOY-009: drives the guest recovery-code banner
    private readonly star = inject(StarSystemsService);

    protected readonly quickMission = computed(() => this.state.quickMission());

    protected readonly campaignSystemLabel = computed(() => (this.state.campaignSystem() === 'hotspots' ? 'Hot Spots' : 'Traditional'));
    protected readonly hotSpotCampaignName = computed(() => {
        if (this.state.campaignSystem() !== 'hotspots') return null;
        return CHAOS_CAMPAIGNS.find((c) => c.id === this.state.hotSpotCampaign())?.name ?? null;
    });
    private static readonly QUICK_TABS: readonly TabDef[] = [
        { id: 'roster', label: 'Unit Roster' }, // roster + Acquire/Market + pilot assignment
        { id: 'quickmission', label: 'Mission' },
        { id: 'lobby', label: 'Lobby' },
    ];
    // Traditional TABS. Quick Mission wins if both (a one-shot is never the Hot Spots economy set).
    protected readonly tabs = computed<readonly TabDef[]>(() =>
        this.quickMission() ? CampaignDashboardComponent.QUICK_TABS
            : this.state.campaignSystem() === 'hotspots' ? (this.state.gmSession() ? GM_HOTSPOTS_TABS : HOTSPOTS_TABS)
                : TABS);
    protected readonly activeTab = signal<string>('overview');
    // HF-016: the barracks combat-pilot (MechWarriors) group is collapsible + starts COLLAPSED.
    protected readonly pilotsOpen = signal(false);
    // AAR (resolve). One signal serves both hubs (campaign 'missions' + Quick Mission 'quickmission').
    // join QR + roster). Deep-links to the old 'claims' sub route to the Lobby tab (see goToStep).
    protected readonly missionsSub = signal<'brief' | 'force' | 'aar'>('brief');
    protected selectMissionSub(s: 'brief' | 'force' | 'aar'): void { this.missionsSub.set(s); }

    // DEPLOY-009 — the "write it down" recovery banner: shown to a guest, once per device, until acked.
    protected readonly bannerDismissed = signal(false);
    protected readonly copied = signal(false);
    protected showRecoveryBanner(): boolean {
        return !this.bannerDismissed() && this.auth.isGuest() && this.auth.recoveryBannerOwed();
    }
    protected recoveryCode(): string { return this.auth.recoveryCode() ?? ''; }
    protected ackBanner(): void { this.auth.ackRecoveryBanner(); this.bannerDismissed.set(true); }
    protected copyCode(): void {
        const c = this.auth.recoveryCode();
        if (!c) return;
        try { void navigator.clipboard?.writeText(c); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); } catch { /* */ }
    }

    constructor() {
        this.res.bindHostUi({ packageOpen: this.packageOpen, walkOpen: this.walkOpen });
        // tab need not be open for a player's join-with-force to land).
        inject(ForceImportService);
        inject(ContractSignService);
        // A refresh / direct nav with an empty state → back to cover.
        if (!this.state.era() || !this.state.resources()) {
            void this.router.navigate(['/']);
            return;
        }
        // (mission tree, support personnel/payroll, starting parts inventory, autosave) — no economy/clock
        // side-effects. The date is already set at Begin; the roster + Acquire market lazy-load on their own.
        if (this.quickMission()) {
            this.activeTab.set('roster');
            return;
        }
        // mirrors ensureClock/ensureTree. A seeded campaign (warchestSP set) is left untouched.
        if (this.state.campaignSystem() === 'hotspots') {
            const table = this.state.companylessTable();
            this.activeTab.set(table ? 'gm' : 'warchest');
            if (this.state.warchestSP() === null && !table) { this.warchest.seed(); void this.store.persistCurrent(); }
        }
        if (this.clock.ensureClock()) void this.store.persistCurrent();
        if (this.tree.ensureTree()) void this.store.persistCurrent();
        if (this.pilotSvc.ensureBios()) void this.store.persistCurrent();
        // MekBay data + the era-legal catalog; forward-only, persists only when it actually stored).
        void this.inventorySvc.ensureStartingInventory().then((changed) => { if (changed) void this.store.persistCurrent(); });
        // purely from force size × tier × seed; forward-only, persists only when it actually stored).
        if (this.personnelSvc.ensureStartingPersonnel()) void this.store.persistCurrent();
        // Hiring Hall is never a blank tab — not only lazily when the bce-hiring-hall component effect happens to run.
        if (this.personnelSvc.ensureHiringMarket()) void this.store.persistCurrent();
        // then lazy-load the star map (its own ~72 KB chunk) so the Overview location line + GM setter resolve.
        if (!this.state.currentLocation() && this.state.faction()) { this.state.setCurrentLocation(capitalSystemIdFor(this.state.faction())); void this.store.persistCurrent(); }
        void this.star.ensureLoaded();
        // OPT-IN test seam (only when localStorage['bce.test.d110b'] is set — NEVER present in normal use), matching
        // the repo convention (hf024/d111 seams). Battle deployment is a per-unit roster action out of the headless
        // harness's scope, so deployAll() sets the whole force 'Deployed' (== the roster dropdown) to reach a
        // non-FAILURE resolve; snap() reads the SP-economy state (treasury null / no C-bill lines / track count /
        // auto-complete) for assertions without DOM scraping. No production effect.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && (localStorage.getItem('bce.test.d110b') || localStorage.getItem('bce.test.d110c'))) {
            (window as unknown as Record<string, unknown>)['__d110b'] = {
                deployAll: (): void => this.state.setStartingForce((this.state.startingForce() ?? []).map((u) => ({ ...u, condition: 'Deployed' }))),
                // all units Deployed) so a harness can exercise the gated join/copy/QR affordances.
// engagement key and refuses battle writes to it, so a fixed 'test-active' re-activated after a resolve was a closed
// key (gm2p2a T2k went red — a fixture artefact: a real re-generate mints a new branch id). Dev-seam only (localStorage-gated).
                deployAndActivate: (): void => {
                    this.state.setStartingForce((this.state.startingForce() ?? []).map((u) => ({ ...u, condition: 'Deployed' })));
                    this.state.setMissionTree([{ branchId: `test-active-${Date.now().toString(36)}`, state: 'ACTIVE', name: 'Test Engagement' } as MissionBranch]);
                    void this.store.persistCurrent(); // persist so a joined player's snapshot sees the deploy
                },
                // Deployed from the mint, so this proves the referee field (zero own units) end to end.
                activate: (): void => {
                    const t = this.state.missionTree() ?? [];
                    if (!t.some((b) => b.state === 'ACTIVE')) {
                        const av = t.find((b) => b.state === 'AVAILABLE');
                        this.state.setMissionTree(av ? t.map((b) => (b.branchId === av.branchId ? { ...b, state: 'ACTIVE' as const } : b)) : [{ branchId: `test-active-${Date.now().toString(36)}`, state: 'ACTIVE', name: 'Test Engagement' } as MissionBranch]);
                    }
                    void this.store.persistCurrent();
                },
                snap: (): unknown => ({
                    treasury: this.state.treasury(),
                    rep: this.state.reputation(),
                    tracksDone: this.state.activeChaosContract()?.tracksDone ?? null,
                    intensity: this.state.activeChaosContract()?.intensity ?? null,
                    hasContract: !!this.state.activeChaosContract(),
                    hasOffer: !!this.state.acceptedContract(),
                    ledger: (this.state.warchestLedger() ?? []).map((e) => e.event),
                    treeStates: (this.state.missionTree() ?? []).map((b) => b.state),
                    enemyFaction: this.state.activeChaosContract()?.enemyFaction ?? null,
                    acceptedTarget: this.state.acceptedContract()?.target ?? null,
                    opforCount: this.state.missionSpec()?.opforForce?.length ?? null,
                    opforBv: this.state.missionSpec()?.opforBv ?? null,
                    ledgerFull: (this.state.warchestLedger() ?? []).map((e) => ({ event: e.event, cost: e.cost })),
                    presetCount: (this.state.chaosTrackPresets() ?? []).length,
                    forgeSeedId: this.state.missionSpec()?.forge?.seedId ?? null,
                    activeBranchName: (this.state.missionTree() ?? []).find((b) => b.state === 'ACTIVE')?.name ?? null,
                    command: this.state.missionSpec()?.clauses?.command ?? null,
                    rolledComps: (this.state.missionSpec()?.forge?.rolledComplications ?? []).map((c) => c.name),
                    rollCounts: { Independent: rollComplications('Independent', [], 'k').length, Liaison: rollComplications('Liaison', [], 'k').length, House: rollComplications('House', [], 'k').length, Integrated: rollComplications('Integrated', [], 'k').length },
                }),
            };
        }
        // verdict/pay + the resolved tier + the posted combat pay + the available forks, so a headless render proves the
        // two-column checklist, the verdict/pay cases, and the tree unlock from a two-sided resolve.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d134')) {
            (window as unknown as Record<string, unknown>)['__d134'] = {
                twoSided: (): unknown => this.res.twoSided(),
                view: (): unknown => { const v = this.res.twoSidedView(); return v ? { tier: v.tier, ourVp: v.ourVp, oppVp: v.oppVp, ourMetCount: v.ourMetCount, ourTotal: v.ourTotal, oppTotal: v.oppObjs.length } : null; },
                verdict: (): unknown => this.res.verdictLabel(),
                pay: (): unknown => this.res.combatPayPreview(),
                scale: (): unknown => this.state.contractScale() ?? 1,
                setOur: (i: number, v: boolean): void => this.res.setObjMet('our', i, v),
                setOpp: (i: number, v: boolean): void => this.res.setObjMet('opp', i, v),
                setBroke: (v: boolean): void => this.res.setBroke(v),
                resolvedTier: (): unknown => (this.state.missionTree() ?? []).find((b) => b.state === 'RESOLVED')?.resolution?.outcomeTier ?? null,
                availCount: (): unknown => (this.state.missionTree() ?? []).filter((b) => b.state === 'AVAILABLE').length,
                combatPayPosted: (): unknown => (this.state.warchestLedger() ?? []).filter((e) => e.event.startsWith('Combat pay:')).map((e) => Math.abs(e.paid ?? e.cost ?? 0)),
                model: (): unknown => this.res.resolveModel(),
                oneSided: (): unknown => this.res.oneSided(),
                ssView: (): unknown => { const v = this.res.oneSidedView(); return v ? { tier: v.tier, ourVp: v.ourVp, totalVp: v.totalVp, ourMetCount: v.ourMetCount, ourTotal: v.ourTotal, texts: v.ourObjs.map((o) => o.text) } : null; },
                trackObjectives: (): unknown => this.state.missionSpec()?.forge?.trackObjectives ?? null,
                hotspotObjectives: (): unknown => this.state.missionSpec()?.forge?.hotspot?.objectives ?? null,
                singleSided: (): unknown => this.state.missionSpec()?.forge?.hotspot?.singleSided ?? null,
                trackTemplate: (): unknown => this.state.missionSpec()?.forge?.trackTemplate ?? null,
                // resolvedTier() above = the FIRST resolved branch (stale after a contract's first resolve); this = the LATEST
                lastResolvedTier: (): unknown => { const r = (this.state.missionTree() ?? []).filter((b) => b.state === 'RESOLVED'); return r.length ? r[r.length - 1].resolution?.outcomeTier ?? null : null; },
                lastResolvedMarks: (): unknown => { const r = (this.state.missionTree() ?? []).filter((b) => b.state === 'RESOLVED'); const a = r.length ? r[r.length - 1].resolution?.aar : undefined; return a ? { model: a.model ?? null, marks: a.objectiveMarks ?? null } : null; },
                hiredWithYou: (): unknown => this.state.missionSpec()?.forge?.hiredWithYou ?? null,
                continuityLead: (): unknown => this.state.missionSpec()?.forge?.continuityLead ?? null,
                // NONE-narrator situation line for the employer-echo check; Part D — the brief's authored/signed Scale.
                terrain: (): unknown => this.state.missionSpec()?.terrain ?? null,
                trackTexts: (): unknown => { const s = this.state.missionSpec(); const hb = s?.forge?.hotspot; return s ? [hb?.trackName ?? s.forge?.opName ?? null, hb?.trackSituation ?? null, hb?.deployment ?? null, s.forge?.trackSheet?.deployment ?? null, hb?.situation ?? null, hb?.systemProfile?.climate ?? null, hb?.systemProfile?.description ?? null] : null; },
                briefSituation: (): unknown => this.briefing()?.situation ?? null,
                scales: (): unknown => { const hb = this.state.missionSpec()?.forge?.hotspot; return hb ? { authored: hb.authoredScale ?? null, signed: hb.signedScale ?? null } : null; },
            };
        }
    }


    protected select(id: string): void {
        // Force Preview afterwards (prepareDeploy sets the sub AFTER this).
        if (id === 'missions' || id === 'quickmission' || id === 'chaos-contracts') this.missionsSub.set('brief');
        this.activeTab.set(id);
    }

    protected readonly confirmAction = signal<'main' | 'exit' | null>(null);
    protected readonly confirmLabel = computed(() => (this.confirmAction() === 'main' ? 'Exit to Main' : 'Exit'));
    protected readonly saveProgress = computed(() =>
        campaignProgress({
            startDate: this.state.startDate(),
            currentDate: this.state.currentDate(),
            missionTree: this.state.missionTree(),
            treeArchive: this.state.treeArchive(),
        }),
    );
    protected readonly saveOpen = signal(false);
    private readonly exitAfterSave = signal(false);

    /** Dashboard SAVE control → the save dialog (Save As / Quick Save). */
    protected openSave(): void {
        this.exitAfterSave.set(false);
        this.saveOpen.set(true);
    }
    protected onSaved(): void {
        this.saveOpen.set(false);
        if (this.exitAfterSave()) {
            this.exitAfterSave.set(false);
            this.doExit();
        }
    }
    protected onSaveCancel(): void {
        // A plain SAVE just closes (confirmAction null); a save opened from the exit confirm
        // returns to that confirm (confirmAction is still set, saveOpen goes false).
        this.saveOpen.set(false);
        this.exitAfterSave.set(false);
    }

    protected exitToMain(): void {
        this.confirmAction.set('main');
    }
    protected exit(): void {
        this.confirmAction.set('exit');
    }
    protected onCancel(): void {
        this.confirmAction.set(null);
    }
    protected exitSaveAs(): void {
        this.exitAfterSave.set(true);
        this.saveOpen.set(true); // the exit confirm hides while the save dialog is open
    }
    protected async exitQuickSave(): Promise<void> {
        await this.store.quickSave();
        this.doExit();
    }
    protected doExit(): void {
        const a = this.confirmAction();
        this.confirmAction.set(null);
        this.exitAfterSave.set(false);
        // Exit to Main: leave NewCampaignState + the saves intact → cover Resume / Load works.
        if (a === 'main') void this.router.navigate(['/']);
        else if (a === 'exit') void this.router.navigate(['/shutdown']);
    }

    // ── Command identity ──
    protected readonly commandName = computed(() => {
        const name = this.state.commandName();
        if (name) return name;
        const u = this.state.unit();
        if (!u) return '—';
        return u === CUSTOM_UNIT ? 'Custom command' : u;
    });
    protected readonly factionName = computed(() => this.state.faction() ?? '—');
    protected readonly archetypeName = computed(() => {
        const c = this.state.force();
        return c ? ARCH_NAMES[c] ?? c : '—';
    });
    protected readonly rating = computed(() => this.state.rating());
    protected readonly mercFraming = computed(() =>
        this.state.force() === 'MERC' && this.state.logisticsProfile() === 'merc-market'
            ? 'Mercenary command · free agent · market logistics'
            : null,
    );
    protected readonly formationFraming = computed(() => {
        if (this.state.force() === 'MERC') return null;
        const f = this.state.formation();
        if (!f) return null;
        const size = this.state.unitSize()?.name ?? '';
        const logi = this.state.logisticsProfile() === 'merc-market' ? 'market logistics' : 'house logistics';
        return [size, f, this.factionName(), logi].filter(Boolean).join(' · ');
    });

    protected readonly isMerc = computed(() => this.state.force() === 'MERC');
    protected readonly offers = computed<ContractOffer[]>(() => this.state.contractMarket()?.offers ?? []);
    protected readonly accepted = computed(() => this.state.acceptedContract());
    protected readonly hasOffers = computed(() => this.isMerc() && this.offers().length > 0);
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly hasChaosContract = computed(() => !!this.state.activeChaosContract());
    protected readonly isHotspotContract = computed(() => !!this.state.activeChaosContract()?.hotspotId);
    protected readonly acceptTarget = signal<ContractOffer | null>(null);

    protected askAccept(o: ContractOffer): void {
        this.acceptTarget.set(o);
    }
    protected cancelAccept(): void {
        this.acceptTarget.set(null);
    }
    protected async confirmAccept(): Promise<void> {
        const o = this.acceptTarget();
        if (!o) return;
        this.contracts.accept(o);
        this.tree.mintRoot(o);
        this.acceptTarget.set(null);
        await this.store.persistCurrent(); // in-place (no autosave); reload restores the ACTIVE contract
    }

    protected rerollUsed(o: ContractOffer, clause: ClauseId): boolean {
        return !!o.rerollsUsed?.[clause];
    }
    protected readonly negTarget = signal<{ offerId: string; clause: ClauseId; label: string } | null>(null);
    protected askRenegotiate(o: ContractOffer, clause: ClauseId, label: string): void {
        if (o.rerollsUsed?.[clause]) return; // one attempt per clause
        this.negTarget.set({ offerId: o.id, clause, label });
    }
    protected cancelRenegotiate(): void {
        this.negTarget.set(null);
    }
    protected async confirmRenegotiate(): Promise<void> {
        const t = this.negTarget();
        if (!t) return;
        this.contracts.renegotiate(t.offerId, t.clause);
        this.negTarget.set(null);
        await this.store.persistCurrent();
    }

    protected readonly completeOpen = signal(false);
    protected askComplete(): void {
        this.completeOpen.set(true);
    }
    protected cancelComplete(): void {
        this.completeOpen.set(false);
    }
    protected confirmComplete(): void {
        this.clock.completeManually(); // settles remaining pay + logs + frees the market; persists in place
        this.completeOpen.set(false);
    }

    /** Active-contract progress: installments paid / remaining + remaining pay. */
    protected readonly contractProgress = computed(() => {
        const ac = this.state.acceptedContract();
        if (!ac) return null;
        const paid = ac.paidMonths ?? 0;
        const dur = ac.durationMonths;
        return { paid, dur, remaining: Math.max(0, dur - paid), remainingPay: Math.max(0, ac.pay.total - (ac.paidOut ?? 0)) };
    });
    protected readonly completedLog = computed<ContractOffer[]>(() => this.state.completedContracts() ?? []);

    protected readonly spans = CLOCK_TUNABLES.spans;
    protected advance(span: SpanId): void {
        this.clock.advance(span);
    }

    /** The active mission spec, only when it belongs to the current contract (else stale → none). */
    protected readonly missionSpec = computed(() => {
        const spec = this.state.missionSpec();
        const ac = this.state.acceptedContract();
        return spec && ac && spec.contractId === ac.id ? spec : null;
    });
    protected readonly hasMission = computed(() => !!this.missionSpec());
    /** Briefing prose — a VIEW rendered from the spec (DATA-003); NONE-mode narrator this slice. */
    protected readonly briefing = computed(() => {
        const s = this.missionSpec();
        return s ? NONE_NARRATOR.narrate(s, this.state.acceptedContract()?.employer.name ?? '—') : null;
    });
    protected generateMission(): void {
        void this.missionGen.generate();
    }
    //    Mech-only / Combined-arms. The next campaign generation (opener, reroll, branch) reads it; precedence
    //    GM toggle > seed.armsMix > campaign default. Quick Mission is unaffected (own arms style). ──
    protected readonly missionArmsMixOverride = this.state.missionArmsMixOverride;
    protected setMissionArmsMixOverride(v: 'auto' | 'mechs' | 'combined'): void {
        this.state.setMissionArmsMixOverride(v);
    }
    protected readonly tempoLevel = computed(() => this.state.escalationLevelFor(this.state.acceptedContract()?.id));
    protected readonly tempoPrior = computed(() => {
        const ac = this.state.acceptedContract();
        const led = this.state.outcomeLedger();
        return ac ? ([...led].reverse().find((r) => r.threadTag === ac.id) ?? null) : (led.length ? led[led.length - 1] : null);
    });
    protected tempoLabel(level: number): string {
        if (level > 0) return `+${level} — enemy response heightened`;
        if (level < 0) return `${level} — enemy pressure eased`;
        return '0 — baseline';
    }
    protected adjustTempo(delta: number): void {
        const e = MISSION_TUNABLES.escalation;
        const next = Math.max(e.min, Math.min(e.max, this.tempoLevel() + delta));
        this.state.setEscalationLevel(this.state.acceptedContract()?.id, next);
        void this.store.persistCurrent();
    }
    protected resetTempo(): void {
        this.state.setEscalationLevel(this.state.acceptedContract()?.id, 0);
        void this.store.persistCurrent();
    }
    //    a sensible enemy) then BV-match the OpFor via the existing generator. No contract market. ──
    protected readonly generatingQuick = signal(false);
    protected async generateQuickMission(): Promise<void> {
        if (this.generatingQuick()) return;
        this.generatingQuick.set(true);
        try {
            this.contracts.acceptQuickMissionContract();
            await this.missionGen.generate();
        } finally {
            this.generatingQuick.set(false);
        }
    }
    protected readonly rerollOpen = signal(false);
    protected askReroll(): void {
        this.rerollOpen.set(true);
    }
    protected cancelReroll(): void {
        this.rerollOpen.set(false);
    }
    protected confirmReroll(): void {
        void this.tree.rerollActive();
        this.rerollOpen.set(false);
        this.packageOpen.set(false); // the package belonged to the prior spec
    }

    protected readonly branches = computed(() => this.state.missionTree() ?? []);
    protected readonly activeBranch = computed(() => this.branches().find((b) => b.state === 'ACTIVE'));
    protected readonly availableBranches = computed(() => this.branches().filter((b) => b.state === 'AVAILABLE'));
    protected readonly lockedBranches = computed(() => this.branches().filter((b) => b.state === 'LOCKED'));
    protected readonly historyBranches = computed(() => this.branches().filter((b) => b.state === 'RESOLVED' || b.state === 'RETIRED'));
    /** One ACTIVE mission at a time — branch GENERATE is gated on no active mission. */
    protected readonly canGenerateBranch = computed(() => !this.activeBranch());
    protected generateBranch(id: string): void {
        void this.tree.generateBranch(id);
    }
    // pickRandomTrack/generateBranchFromPreset) moved into the shared <bce-track-picker> component (chaos/track-picker.ts),
    // mounted both here (operations board, dashboard.html) and on the active-contract card. Plain "Generate »" stays above.

    //    focuses the MEKBAY tab with the engagement loaded (deployed BLUFOR + the active OpFor).
    protected readonly deployedCount = computed(() => deployedSet(this.state.startingForce(), this.state.quickMission()).length); // HF-020: quick one-shot counts the whole force
    protected prepareDeploy(): void {
        // uses the Missions hub; Quick Mission uses its own 'quickmission' hub. Set the sub AFTER select().
        // activeTab would land on 'missions' (no longer in HOTSPOTS_TABS) and de-highlight the whole HS tab bar.
        this.select(this.quickMission() ? 'quickmission' : (this.isHotspots() ? 'chaos-contracts' : 'missions'));
        this.missionsSub.set('force');
    }

    protected goToStep(d: { tab: string; sub?: string }): void {
        // Lobby, not a now-removed Missions sub. Other subs route as before.
        if (d.sub === 'claims') { this.select('lobby'); return; }
        this.select(d.tab);
        if (d.sub) this.selectMissionSub(d.sub as 'brief' | 'force' | 'aar');
    }

    private readonly fieldWalk = inject(FieldWalkService);
    protected readonly walkPending = this.fieldWalk.pendingCount;
    protected readonly walkOpen = signal(false);
    protected openWalk(): void { this.walkOpen.set(true); }

    private readonly orders = inject(OrdersService);
    protected readonly houseOrder = this.state.houseOrder;
    protected readonly canReportOrders = computed(() => this.orders.canReportCompletion());
    protected readonly hasOpenOps = computed(() => this.orders.hasOpenOperations());
    protected acknowledgeOrders(): void { this.orders.acknowledge(); }
    protected requestOrders(): void { this.orders.requestOrders(); }
    protected orderText(o: ContractOffer): string { return houseOrderText(o); }
    protected orderThreat(o: ContractOffer): string { return (o as ContractOffer & { threat?: string }).threat ?? 'MEDIUM'; }
    protected readonly reportConfirm = signal(false);
    protected askReportOrders(): void { this.reportConfirm.set(true); }
    protected cancelReportOrders(): void { this.reportConfirm.set(false); }
    protected confirmReportOrders(): void { this.orders.reportCompletion(); this.reportConfirm.set(false); }

    protected readonly hasPackage = computed(() => !!this.missionSpec()?.forge?.seedId);
    protected readonly genericMission = computed(() => !!this.missionSpec()?.forge?.generic);
    protected readonly packageOpen = signal(false);
    protected openPackage(): void {
        if (this.hasPackage()) this.packageOpen.set(true);
    }
    protected closePackage(): void {
        this.packageOpen.set(false);
    }
    // is pure navigation (Force Preview) — the required setup is just landing on the right surface; here that is the
    // Lobby, so we route straight there. The deployed force + active engagement (already set) drive the lobby gate.
    protected playMission(): void {
        this.select('lobby');
    }
    // (Traditional) is shown, not just the WARNORD masthead.
    protected viewTrack(): void {
        try { localStorage.setItem('bce.order.fragord', '1'); } catch { /* private mode / no storage */ }
        this.openPackage();
    }
    // (monthly maintenance + base pay run through the existing clock-advance ripple), mark the resolved branch
    // finalized so the flow rail leaves it (→ idle/CONTRACT, no double-advance), then return to CONTRACT for the next
    // track. HS-only — Traditional's `outcome` node navigates and never reaches this.
    protected advancePhase(): void {
        const resolved = (this.state.missionTree() ?? []).filter((b) => b.state === 'RESOLVED' && b.resolution && !b.resolution.advanced);
        const target = resolved[resolved.length - 1];
        this.clock.advance('month');
        if (target) this.tree.markPhaseAdvanced(target.branchId);
        this.select('chaos-contracts');
    }
    protected supportText(s: SupportTerms): string {
        return s.kind === 'straight' ? `${s.pct}% straight` : s.kind === 'battle-loss' ? `${s.pct}% BLC` : 'None';
    }
    protected salvageText(o: ContractOffer): string {
        return o.salvage.exchange ? 'Exchange' : `${o.salvage.pct}%`;
    }
    protected onEmpLogoError(ev: Event): void {
        (ev.target as HTMLImageElement).style.display = 'none';
    }
    protected readonly classbar = computed(
        () => `${this.factionName()} · ${this.commandName()} · Operational Use Only`,
    );

    protected readonly dateText = computed(() => {
        const d = this.clock.currentDate();
        return d ? formatDate(d) : '—';
    });
    protected readonly eraText = computed(() => this.state.era()?.name ?? '—');
    /** PD3 P3 (S54) — the header's WK: the campaign week off the one clock (the same source the autosave's "Day N" derives from). */
    protected readonly weekText = computed(() => String(campaignWeek(this.state.startDate(), this.clock.currentDate())));

    // ── Overview stat cards ──
    protected readonly forceCount = computed(() => this.state.unitSize()?.count ?? 0);
    protected readonly treasuryShort = computed(() => {
        const t = this.state.treasury() ?? this.state.capital()?.amount;
        return t != null ? this.short(t) : '—';
    });
    protected readonly treasuryTier = computed(() => this.state.capital()?.tier ?? '—');
    protected readonly transport = computed<{ value: string; sub: string }>(() => {
        const res = this.state.resources();
        const ship = shipForSize(this.state.unitSize()?.id);
        if (res === 'established') return { value: '1+', sub: `${ship} + Invader JumpShip` };
        if (res === 'normal') return { value: '1', sub: `${ship} DropShip` };
        if (res === 'lean') return { value: '—', sub: 'Lean — no transport' };
        return { value: '—', sub: '' };
    });

    // ── Campaign log (templated from state) ──
    protected readonly log = computed(() => {
        const d = this.dateText();
        const c = this.state.capital();
        const n = this.forceCount();
        const lines = [
            `Campaign initiated. ${this.commandName()} deployed.`,
            this.isMerc() ? 'Contract market opened.' : 'Orders received from your chain of command.',
            `Force mustered: ${n} ’Mechs, ${n} warriors.`,
            `Treasury seeded: ${c ? c.amount.toLocaleString('en-US') : '—'} C-bills.`,
        ];
        const base = lines.map((text) => ({ t: d, text }));
        const entries = (this.state.campaignLog() ?? []).map((e) => ({ t: `${e.date.y}-${String(e.date.m + 1).padStart(2, '0')}-${String(e.date.d).padStart(2, '0')}`, text: e.text }));
        return [...base, ...entries];
    });

    protected short(n: number): string {
        return n >= 1e9 ? (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B' : Math.round(n / 1e6) + 'M';
    }

    //    as the inventory tab, single source) + a transaction log of recent money in/out. ──
    protected readonly ledger = computed(() => computeLedger(this.state));
    /** Recent MONEY events only (signed amount + resulting balance), reverse-chron, capped at 15 (scroll for the rest). */
    protected readonly txnLog = computed(() => (this.state.campaignLog() ?? []).filter((e) => e.amount != null).slice().reverse().slice(0, 15));
    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected absVal(n: number): number { return Math.abs(n); }
    protected txnDate(d: { y: number; m: number; d: number }): string { return `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }

    /** The latest "Personnel payroll" debit (the visible monthly cue that the tick fired — not silent). */
    protected readonly lastPayroll = computed(() => {
        const e = [...(this.state.campaignLog() ?? [])].reverse().find((x) => /^Personnel payroll/.test(x.text) && x.amount != null);
        return e ? { amount: Math.abs(e.amount as number), date: this.txnDate(e.date) } : null;
    });
    protected readonly payrollShortfall = computed(() => {
        const list = this.state.payrollShortfalls() ?? [];
        if (!list.length) return null;
        const last = list[list.length - 1];
        const kinds = [...new Set(list.map((x) => x.kind ?? 'payroll'))].join(' + ');
        return { count: list.length, total: list.reduce((s, x) => s + x.unpaid, 0), lastMonth: this.txnDate(last.month), kinds };
    });
    /** Pre-warning: next month's obligations (payroll + unit maintenance) won't be covered by treasury + income. */
    protected readonly costsAtRisk = computed(() => {
        const l = this.ledger();
        const due = l.payroll + l.maintenance;
        return due > 0 && l.treasury + l.income < due;
    });

    protected readonly pilotRoster = computed(() => {
        const pilots = this.state.pilots() ?? [];
        const byId = new Map((this.state.startingForce() ?? []).map((i) => [i.instanceId, i]));
        return pilots
            .filter((p) => p.status !== 'KIA')
            .map((p) => {
                const inst = p.assignedInstanceId ? byId.get(p.assignedInstanceId) : undefined;
                return {
                    id: p.pilotId,
                    name: p.name,
                    callsign: p.callsign ?? '',
                    skills: `${p.gunnery}/${p.piloting}`,
                    g: p.gunnery,
                    pp: p.piloting,
                    status: p.status,
                    injured: p.status === 'Injured',
                    perks: (p.perks ?? []).length,
                    missions: p.missionCount ?? 0,
                    assignment: inst ? `${inst.chassis} ${inst.model}`.trim() : 'SPARE',
                    assigned: !!inst,
                    commander: !!inst?.isCommander,
                };
            })
            .sort(
                (a, b) =>
                    Number(b.assigned) - Number(a.assigned) ||
                    Number(b.commander) - Number(a.commander) ||
                    a.g - b.g ||
                    a.pp - b.pp ||
                    a.name.localeCompare(b.name),
            );
    });
    protected readonly hasBarracks = computed(() => (this.state.pilots() ?? []).length > 0);
    protected readonly barracksCount = computed(() => {
        const all = this.state.pilots() ?? [];
        const kia = all.filter((p) => p.status === 'KIA').length;
        const assigned = all.filter((p) => p.status !== 'KIA' && p.assignedInstanceId).length;
        return { total: all.length, assigned, spares: all.length - kia - assigned, kia };
    });
    protected readonly infirmary = computed(() =>
        (this.state.pilots() ?? [])
            .filter((p) => p.status === 'Injured')
            .map((p) => ({ id: p.pilotId, name: p.name, callsign: p.callsign ?? '', hits: p.hits ?? null, recoveryDays: p.recoveryDays ?? 0 }))
            .sort((a, b) => b.recoveryDays - a.recoveryDays),
    );
    protected readonly fallen = computed(() =>
        (this.state.pilots() ?? [])
            .filter((p) => p.status === 'KIA')
            .map((p) => ({ id: p.pilotId, name: p.name, callsign: p.callsign ?? '', date: p.kiaDate ? formatDate(p.kiaDate) : '', missions: p.missionCount ?? 0 })),
    );
    protected readonly detailPilot = signal<string | null>(null);
    protected openPilot(id: string): void {
        this.detailPilot.set(id);
    }
}
