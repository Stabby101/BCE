import { Component, ChangeDetectionStrategy, computed, effect, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState, type OdmStocks } from '../new-campaign-state';
import { odmStartingStocks, fuelPct, opsRemaining, daysCrackingPerOp, fuelState, binBreach, ODM_EXPOSURE_LEVELS } from './odm-stocks';
import { tradeForInstance, TRADE_LABEL, TRADE_ORDER, UNASSIGNED_LABEL, type OdmTrade } from './odm-trades';
import { identityOf, foldPilots, reconcileRosterSkills } from './odm-stables';
import { ARCH_NAMES, CUSTOM_UNIT } from '../faction/faction-data';
import { OrdersService } from '../orders/orders.service';
import { orderText as houseOrderText } from '../orders/house-orders';
import { OdmRosterComponent as RosterComponent } from './odm-roster';
import { OdmFlowComponent as FlowComponent } from './odm-flow';
import { StarMapTabComponent } from '../star/star-map-tab';
import { CurrentLocationComponent } from '../dashboard/current-location';
import { ExitConfirmComponent } from '../dashboard/exit-confirm';
import { SaveDialogComponent } from '../dashboard/save-dialog';
import { CampaignSaveStore, campaignProgress } from '../campaign-save-store';
import { StarSystemsService } from '../star/star-systems.service';
import { capitalSystemIdFor } from '../star/star-capitals';
import type { ContractOffer } from '../contract/contract-market';
import type { SupportTerms } from '../contract/contract-terms';
import { CampaignClockService } from '../clock/campaign-clock.service';
import { CLOCK_TUNABLES, formatDate, addDays, campaignWeek, type SpanId } from '../clock/campaign-clock'; // S60 — the header week off the one clock
import { OdmGmFactsComponent } from './odm-gm-facts';
import { NONE_NARRATOR, MISSION_TUNABLES } from '../mission/mission-spec';
import { OdmMissionPackageComponent as MissionPackageComponent } from './odm-mission-package';
import { DeployRosterComponent } from '../dashboard/deploy-roster';
import { OdmBattleViewComponent as BattleViewComponent } from './odm-battle-view';
import { MissionTreeService } from '../mission/mission-tree.service';
import type { MissionBranch } from '../mission/mission-tree'; // the __d110b deployAndActivate seam's test branch
import { deployedSet } from '../force/deployed';
import { OdmFieldWalkComponent as FieldWalkComponent } from './odm-field-walk';
import { OdmFieldWalkService } from './odm-field-walk.service';
import { OdmFleetService } from './odm-fleet.service';
import { OdmReassignService } from './odm-reassign.service';
import { TRADE_CHOICES } from './odm-trades';
import { OdmIntentApplyService } from './odm-intent-apply.service';
import { filterLedger, ledgerActors, mergeLedgers } from './odm-ledger';
import { playerJoinUrl } from '../claims/join-link';
import { OdmProjectionService } from './odm-projection.service';
import { OdmRepairBaysComponent as RepairBaysComponent } from './odm-repair-bays.component';
import { OdmInventoryTabComponent as InventoryTabComponent } from './odm-inventory-tab';
import { OdmQuartermasterService } from './odm-quartermaster.service';
import { OdmSupportPersonnelComponent as SupportPersonnelComponent } from './odm-support-personnel';
import { PersonnelService } from '../personnel/personnel.service';
import { OdmAarTabComponent as AarTabComponent } from './odm-aar-tab';
import { OdmIntelTabComponent as IntelTabComponent } from './odm-intel-tab';
import { PilotDetailComponent } from '../barracks/pilot-detail';
import { PilotService } from '../barracks/pilot.service';
import { OdmResolveService as ResolveService } from './odm-resolve.service';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import type { CampaignSnapshot } from '../campaign-persistence.service';
import { OdmCreateService } from './odm-create.service';
import { hasAuthoredNodes, mintOdmBranches, odmSpecIsCurrent, reconcileOdmTree, type OdmDate, type OdmTreeData } from './odm-tree';
import { mergeGmMissions } from './odm-gm-mission';
import { OdmComposerComponent } from './odm-composer';
import { rollOpfor, seedToNumber } from './odm-opfor-roll';
import { DataService } from '../../services/data.service';
import type { MissionSpec } from '../mission/mission-spec';
import type { ProtoInstance } from '../force/force-generator';
import { OdmResolveModalComponent as ResolveModalComponent } from './odm-resolve-modal';
import { OdmBriefingComponent } from './odm-briefing';
import { SettingsTabComponent } from '../narrator/settings-tab';
import { OdmRollbackComponent } from './odm-rollback';
import { NarratorConsoleComponent } from '../narrator/narrator-console';
import { LegalFooterComponent } from '../../shared/legal-footer'; // COMPLIANCE-3 — inline notice in the dashboard chrome
import { OdmClaimsPanelComponent as ClaimsPanelComponent } from './odm-claims-panel';
import { OdmSeatsPanelComponent } from './odm-seats-panel';
import { LobbyPanelComponent } from '../claims/lobby-panel';
import { AuthService } from '../../auth/auth.service';

interface TabDef {
    id: string;
    label: string;
}
const TABS: readonly TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'roster', label: 'Unit Roster' },
    { id: 'inventory', label: 'Quartermaster' },
    { id: 'barracks', label: 'Barracks' },
    { id: 'missions', label: 'Missions' },
    { id: 'briefing', label: 'Briefing' },
    { id: 'lobby', label: 'Lobby' },
    { id: 'aar', label: 'AAR' },
    { id: 'intel', label: 'Intel' },
    { id: 'starmap', label: 'Star Map' },
    { id: 'repair', label: 'Repair & Salvage' },
    { id: 'settings', label: 'Settings' },
];
// economy home, standing in for Overview). The Traditional economy tabs (Overview/Inventory/Barracks/Repair &
// Salvage) are EXCLUDED here — they're replaced by from-scratch Chaos economy tabs as those slices land.
function hashSeedFallback(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}


@Component({
    selector: 'bce-odm-dashboard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'theme-dossier' },
    imports: [RosterComponent, FlowComponent, ExitConfirmComponent, SaveDialogComponent, MissionPackageComponent, DeployRosterComponent, BattleViewComponent, FieldWalkComponent, RepairBaysComponent, InventoryTabComponent, SupportPersonnelComponent, AarTabComponent, IntelTabComponent, PilotDetailComponent, SettingsTabComponent, OdmRollbackComponent, OdmGmFactsComponent, OdmComposerComponent, NarratorConsoleComponent, ClaimsPanelComponent, LobbyPanelComponent, StarMapTabComponent, CurrentLocationComponent, ResolveModalComponent, OdmBriefingComponent, LegalFooterComponent, OdmSeatsPanelComponent],
    providers: [ResolveService],
    templateUrl: './odm-dashboard.html',
    styleUrls: ['../dashboard/dashboard.scss', './odm-dashboard.scss'],
    // DEPLOY-009: the guest recovery banner — AMBER/GOLD, deliberately distinct from the blue player-join QR
    // (this restores the GM's OWN identity, not a game-join code). A separate stylesheet so dashboard.scss
    // stays under its 20kB per-component budget. Shown once per device until "I've saved it".
    styles: [`
        .ccorr { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:6px; }
        .ccorrb { font-size:11px; padding:2px 10px; cursor:pointer; }
        .ccorrb:disabled { opacity:.45; cursor:not-allowed; }
        .ccorrn { font-size:11px; opacity:.7; max-width:60ch; line-height:1.35; }
        .strip-queue { border:1.6px solid var(--stamp); border-left-width:5px; padding:10px 14px; margin-top:14px; background:var(--paper2, var(--paper)); }
        .sq-h { font-family:var(--label); font-weight:700; letter-spacing:1.2px; font-size:10.5px; color:var(--stamp); margin-bottom:6px; }
        .sq-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:4px 0; font-size:13px; }
        .sq-who { font-weight:700; }
        .sq-btn { font:inherit; font-size:12px; padding:4px 12px; border:1.4px solid var(--ink2); background:transparent; cursor:pointer; }
        .sq-btn.ok { border-color:var(--ok, #3a7d44); color:var(--ok, #3a7d44); font-weight:700; }
        .sq-btn.no { border-color:var(--stamp); color:var(--stamp); }
        .led-sel { float:right; font:inherit; font-size:11px; padding:2px 6px; border:1.2px solid var(--ink2); background:var(--paper); color:var(--ink); max-width:60%; }
        .led { font-family:var(--mono); font-size:11.5px; line-height:1.6; max-height:320px; overflow-y:auto; }
        .led-row { display:flex; flex-wrap:wrap; gap:4px 10px; padding:3px 0; border-top:1px dotted var(--rule, rgba(0,0,0,.18)); }
        .led-row .t { color:var(--ink2); }
        .led-seat { color:var(--ink2); }
        .led-field { font-weight:700; }
        .led-chg { flex:1 1 220px; min-width:0; overflow-wrap:anywhere; }
        .led-out { text-transform:uppercase; letter-spacing:.6px; font-size:10px; border:1px solid var(--stamp); color:var(--stamp); padding:0 5px; }
        .led-role { text-transform:uppercase; letter-spacing:.6px; font-size:10px; color:var(--ink2); border:1px solid var(--ink2); padding:0 5px; opacity:.85; } /* ORDER-13 — the acting role on a server-written seat line */
        .led-none { font-family:var(--type); font-size:12.5px; color:var(--ink2); font-style:italic; padding:6px 0; }
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
        .ro-banner { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:14px; padding:10px 14px;
            border:1.6px solid #5b7a99; border-left-width:5px; background:linear-gradient(90deg, rgba(91,122,153,.20), var(--paper2)); }
        .ro-banner .ro-ico { font-size:18px; line-height:1; }
        .ro-banner .ro-body { flex:1 1 280px; min-width:0; font-family:var(--type); font-size:13px; line-height:1.5; color:var(--ink); }
        .ro-banner .ro-body b { color:#3f5b76; letter-spacing:.5px; }
        .ro-banner .ro-btn { font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:.8px; text-transform:uppercase;
            padding:8px 13px; min-height:36px; border:1.4px solid #5b7a99; background:var(--paper); color:#2f4a63; cursor:pointer; }
        .ro-banner .ro-btn.take { background:#5b7a99; color:#f4f1e8; }
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
        .bk-grouphd { display:flex; align-items:center; gap:8px; width:100%; background:var(--paper); border:none; border-bottom:1.4px solid var(--ink); padding:8px 4px; margin-bottom:10px; cursor:pointer; text-align:left; font-family:var(--label); font-weight:600; letter-spacing:1.5px; text-transform:uppercase; font-size:13px; color:var(--ink); }
        .bk-trade { font-family:var(--mono); font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--ink2); border:1px solid color-mix(in srgb, var(--ink2) 45%, transparent); border-radius:3px; padding:0 5px; margin-left:7px; vertical-align:1px; }
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
export class OdmDashboardComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly create = inject(OdmCreateService);
    private readonly data = inject(DataService);
    // removed — both fed only the stripped Forge affordances (Quick Mission / reroll / dead generateMission).
    private readonly clock = inject(CampaignClockService);
    private readonly tree = inject(MissionTreeService);
    private readonly pilotSvc = inject(PilotService);
    protected readonly res = inject(ResolveService);
    private readonly quartermaster = inject(OdmQuartermasterService);
    private readonly personnelSvc = inject(PersonnelService);
    private readonly auth = inject(AuthService); // DEPLOY-009: drives the guest recovery-code banner
    private readonly star = inject(StarSystemsService);

    protected readonly quickMission = computed(() => this.state.quickMission());

    // (store.persistCurrent no-ops) and the host refuses every write (A2). The header says the table is held
    // elsewhere; the Save controls step aside. Presentation only — the server is the control (ROLE-001).
    protected readonly readOnly = this.store.readOnly;
    // names whoever actually holds it. UX only: the server validates the target and decides every write.
    protected readonly isRecordOwner = this.store.isRecordOwner;
    protected readonly mySeatUrl = computed(() => playerJoinUrl(this.store.campaignId()));
    protected readonly openSeatRequests = computed(() => this.state.odmSeatRequests().filter((r) => r.status === 'open'));
    protected readonly ledgerActor = signal<string>('');
    /** ORDER-13 — the view is ONE list over two ledgers: the snapshot's (the writer device's intents/overrides/rollbacks) and the
     *  SERVER's seat ledger (every seat change, whoever performed it — a handed-away owner's seating included), by time. */
    protected readonly ledgerAll = computed(() => mergeLedgers(this.state.odmLedger(), this.rt.seatLedger()));
    protected readonly ledgerActorList = computed(() => ledgerActors(this.ledgerAll()));
    protected readonly ledgerTotal = computed(() => this.ledgerAll().length);
    protected readonly ledgerRows = computed(() => filterLedger(this.ledgerAll(), this.ledgerActor()).slice(0, 200));
    protected ledgerTime(ts: number): string {
        const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    protected readonly holderName = computed(() => this.rt.writerHolderName());
    protected readonly holderLine = computed(() => {
        const h = this.rt.writerHolder(); const me = this.auth.user()?.id ?? null; const label = this.rt.writerHolderLabel();
        if (h != null && h === me) return `your other device${label ? ` (${label})` : ''}`;
        const name = this.rt.writerHolderName() ?? 'the GM';
        return label ? `${name} · ${label}` : name;
    });
    protected readonly canTakeHere = computed(() => { const me = this.auth.user()?.id ?? null; return !!me && (this.isRecordOwner() || this.rt.writerHolder() === me); });
    protected readonly tableReaders = computed(() => { const me = this.auth.user()?.id ?? null; return this.rt.readers().filter((r) => r.userId !== me); });
    /** this account holds the table BY HAND-OFF (a co-GM the owner handed it to) */
    protected readonly holdsByHandOff = computed(() => { const h = this.rt.writerHolder(); return h != null && h === (this.auth.user()?.id ?? null) && !this.isRecordOwner() && !this.readOnly(); });
    protected handTableTo(userId: string, deviceId: string): void { this.rt.handTable(userId, deviceId); }
    protected takeTableHere(): void { const me = this.auth.user()?.id; if (me) this.rt.takeTableHere(me); }

    // 'Traditional' label wrong-footed a GM on live (it names the Classic ruleset). The pack identity is the label.
    protected readonly campaignSystemLabel = computed(() => 'Dark Meridian');
    protected readonly hotSpotCampaignName = computed(() => null as string | null);

    // Traditional TABS. Quick Mission wins if both (a one-shot is never the Hot Spots economy set).
    protected readonly tabs = computed<readonly TabDef[]>(() => TABS);
    protected readonly activeTab = signal<string>('overview');
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

    protected readonly intentApply = inject(OdmIntentApplyService);
    private readonly rt = inject(ClaimRealtimeService);
    constructor() {
        // fans the FULL snapshot to the room on every owner write (ClaimsGateway.fanCampaign, widened for a
        // co-GM reader); the co-GM's socket is already in the room (OdmResolveService ensures it for the
        // dashboard's life). Hydrate it — GATED to readOnly() so the OWNER never hydrates over its own in-flight
        // edits (the owner is not readOnly, so it ignores the fan exactly as before — no re-save loop).
        effect(() => {
            if (!this.readOnly()) return;
            const snap = this.rt.campaignSnapshot();
            if (snap) this.store.hydrateFromSocket(snap as CampaignSnapshot);
        });
        void this.fleetSvc.ensureLoaded();
        // for player devices); the intent apply is the `intentApply` field (the pending-strips card reads it).
        inject(OdmProjectionService);
        // (legacy saves, the stables fold, a shared-editor write) moves under gmOnly.pilotNotes and the row
        // is stripped — the fanned pilots array reaches every joined player, and the field NAMED gmNotes
        // keeps its name's promise. Idempotent; fires before any persist can fan a note.
        effect(() => {
            const pilots = this.state.pilots() ?? [];
            if (!pilots.some((p) => p.gmNotes)) return;
            const notes = { ...this.state.gmPilotNotes() };
            for (const p of pilots) if (p.gmNotes) notes[p.pilotId] = notes[p.pilotId] ? `${notes[p.pilotId]}\n${p.gmNotes}` : p.gmNotes;
            this.state.setGmPilotNotes(notes);
            this.state.setPilots(pilots.map((p) => (p.gmNotes ? { ...p, gmNotes: undefined } : p)));
            void this.store.persistCurrent();
        });
        this.res.bindHostUi({ packageOpen: this.packageOpen, walkOpen: this.walkOpen });
        // MERGED set, so a composed mission resolves through the SAME ODM block — the 4-tier picker renders,
        // odmOutcomes records, and clock.advanceDays(node.opDays) books the real time cost. Bound to the
        // authored data alone, odmNodeDef() would return null and all three would vanish silently.
        this.res.bindOdmTree(this.odmTreeAll);
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
            this.activeTab.set('warchest');
        }
        if (this.clock.ensureClock()) void this.store.persistCurrent();
        void this.odmEnsureTree();
        if (this.pilotSvc.ensureBios()) void this.store.persistCurrent();
        void this.quartermaster.ensure();
        // assignment gets the trade stamped from the currently-assigned instance's catalog type, ONCE.
        // Spares with no assignment stay unstamped (ruling A4 — they render "Unassigned", never a guess).
        if (this.ensureTrades()) void this.store.persistCurrent();
        // records folds each duplicated authored identity to ONE person on their primary ride; the
        // secondary hull is unassigned (a spare machine, its stable linkage preserved on the pilot).
        void this.ensureStables();
        // ODM roster skill reconciliation (2026-08-28) — forward-only, triple-bounded (identity + msn 0 +
        // exact pre-edit pair); log lines dedupe by exact text so nothing refires on later loads.
        {
            const rsk = reconcileRosterSkills(this.state.pilots() ?? []);
            const existing = new Set((this.state.campaignLog() ?? []).map((e) => e.text));
            const lines = [
                ...rsk.applied.map((s) => `Roster reconciliation — ${s} (authored skill edit; msn 0, pre-edit pair matched)`),
                ...rsk.leftAlone.map((s) => `Roster reconciliation — ${s}`),
            ].filter((s) => !existing.has(s));
            if (rsk.applied.length) this.state.setPilots(rsk.pilots);
            if (lines.length) {
                const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
                this.state.setCampaignLog([...(this.state.campaignLog() ?? []), ...lines.map((text) => ({ date: today, text, kind: 'admin' as const }))]);
            }
            if (rsk.applied.length || lines.length) void this.store.persistCurrent();
        }
        // purely from force size × tier × seed; forward-only, persists only when it actually stored).
        if (this.personnelSvc.ensureStartingPersonnel()) void this.store.persistCurrent();
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
                    rollCounts: null,
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
        if (id === 'missions' || id === 'chaos-contracts') this.missionsSub.set('brief');
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
        if (this.readOnly()) { this.doExit(); return; }
        this.exitAfterSave.set(true);
        this.saveOpen.set(true); // the exit confirm hides while the save dialog is open
    }
    protected async exitQuickSave(): Promise<void> {
        if (!this.readOnly()) await this.store.quickSave();
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

    // any market/negotiation surface (those are stripped above).
    protected readonly accepted = computed(() => this.state.acceptedContract());

    protected readonly spans = CLOCK_TUNABLES.spans;
    protected advance(span: SpanId): void {
        this.clock.advance(span);
    }

    /** HARD FLOOR — the campaign start. Below it there is no coherent state to describe. */
    protected readonly canCorrectClock = computed(() => {
        const cur = this.state.currentDate(), start = this.state.startDate();
        if (!cur) return false;
        if (!start) return true; // no start on record — nothing to floor against
        return Date.UTC(cur.y, cur.m, cur.d) > Date.UTC(start.y, start.m, start.d);
    });
    /** The most recent resolved-mission date, if any — a CONFIRM-PAST, never a block (see below). */
    private lastResolutionDate(): { y: number; m: number; d: number } | null {
        const dates = (this.state.missionTree() ?? [])
            .map((b) => b.resolution?.resolvedDate)
            .filter((d): d is { y: number; m: number; d: number } => !!d);
        if (!dates.length) return null;
        return dates.reduce((a, b) => (Date.UTC(b.y, b.m, b.d) > Date.UTC(a.y, a.m, a.d) ? b : a));
    }
    protected correctClockBack(): void {
        const cur = this.state.currentDate();
        if (!cur || !this.canCorrectClock()) return;
        const to = addDays(cur, -1);
        const start = this.state.startDate();
        if (start && Date.UTC(to.y, to.m, to.d) < Date.UTC(start.y, start.m, start.d)) return; // belt: the hard floor
        const res = this.lastResolutionDate();
        if (res && Date.UTC(to.y, to.m, to.d) < Date.UTC(res.y, res.m, res.d)) {
            if (!confirm(`That moves the clock to ${formatDate(to)}, BEFORE the last resolved mission (${formatDate(res)}).\n\nThat mission's record, its booked days and its after-action all sit after this date. Correcting past it is allowed and will be logged — but nothing about the mission is undone.\n\nContinue?`)) return;
        }
        this.state.setCurrentDate(to);
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), {
            date: to,
            text: `GM clock correction — ${formatDate(cur)} → ${formatDate(to)}. The date moved only: repair hours, monthly ticks and recovery already banked stay banked, so some records sit ahead of the clock.`,
            kind: 'admin' as const,
        }]);
        void this.store.persistCurrent();
    }

    /** The active mission spec, only when it belongs to the current contract (else stale → none). */
    protected readonly missionSpec = computed(() => {
        const spec = this.state.missionSpec();
        const ac = this.state.acceptedContract();
        // ORDER-10 P7 — the carrier spec is CURRENT only when it belongs to the ACTIVE branch (the same
        // source the header reads, odmSpecIsCurrent). A RESOLVED mission's spec (e.g. Pale Candle) that
        // lingers past its branch — as it can on resume, when a DIFFERENT branch (Last Bearing) is ACTIVE —
        // is never the GM's current brief. (The contractId guard alone can't tell ODM tracks apart: they
        // all carry 'odm-standing-orders'. HS is safe there because each contract mints a distinct id.)
        return spec && ac && spec.contractId === ac.id && odmSpecIsCurrent(spec, this.branches()) ? spec : null;
    });
    protected readonly hasMission = computed(() => !!this.missionSpec());
    /** Briefing prose — a VIEW rendered from the spec (DATA-003); NONE-mode narrator this slice. */
    protected readonly briefing = computed(() => {
        const s = this.missionSpec();
        return s ? NONE_NARRATOR.narrate(s, this.state.acceptedContract()?.employer.name ?? '—') : null;
    });
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

    protected readonly branches = computed(() => this.state.missionTree() ?? []);
    protected readonly activeBranch = computed(() => this.branches().find((b) => b.state === 'ACTIVE'));
    protected readonly availableBranches = computed(() => this.branches().filter((b) => b.state === 'AVAILABLE'));
    protected readonly lockedBranches = computed(() => this.branches().filter((b) => b.state === 'LOCKED'));
    protected readonly historyBranches = computed(() => this.branches().filter((b) => b.state === 'RESOLVED' || b.state === 'RETIRED'));
    /** One ACTIVE mission at a time — branch GENERATE is gated on no active mission. */
    protected readonly canGenerateBranch = computed(() => !this.activeBranch());
    protected readonly odmTreeData = signal<OdmTreeData | null>(null);
    protected readonly odmTreeAll = computed<OdmTreeData | null>(() => mergeGmMissions(this.odmTreeData(), this.state.odmGmMissions(), this.state.gmMissionDrafts()));
    private odmNode(id: string) { return this.odmTreeAll()?.nodes.find((n) => n.id === id); }
    protected readonly activeGmMission = computed(() => {
        const id = this.state.odmActiveNodeId();
        return id ? (this.state.odmGmMissions().find((m) => m.id === id) ?? null) : null;
    });
    /** The authored packet id behind a board card / the active mission (null = packet pending — PM still writing it). */
    protected odmPacketOf(branchId: string): string | null { return this.odmNode(branchId)?.packet ?? null; }
    protected odmIsAuthored(branchId: string): boolean { return !!this.odmNode(branchId); }
    protected nodeSystem(branchId: string): string { return this.odmNode(branchId)?.system ?? ''; }
    /** Gate text renders LIVE from tree.json — never from the branch (it would persist + fan to players). */
    protected nodeGateText(branchId: string): string { return this.odmNode(branchId)?.gate?.text ?? ''; }
    protected readonly activeNodePacket = computed(() => {
        const id = this.state.odmActiveNodeId();
        return id ? (this.odmTreeAll()?.nodes.find((n) => n.id === id)?.packet ?? null) : null;
    });
    protected readonly odmNow = computed<OdmDate | null>(() => this.state.currentDate() ?? this.state.startDate() ?? null);
    private readonly odmClockReconcile = effect(() => {
        const now = this.odmNow();
        const authored = this.odmTreeData();
        const data = this.odmTreeAll();
        if (!now || !data || !authored) return;
        const cur = this.state.missionTree() ?? [];
        if (!hasAuthoredNodes(cur, authored)) return; // pre-migration (the AUTHORED test) — odmEnsureTree owns that path
        const next = reconcileOdmTree(cur, data, this.state.odmOutcomes(), now); // §S-1: MERGED — a published mission is not residue
        if (JSON.stringify(next) !== JSON.stringify(cur)) { this.state.setMissionTree(next); void this.store.persistCurrent(); }
    });
    private async odmEnsureTree(): Promise<void> {
        const data = await this.create.treeJson();
        if (!data?.nodes?.length) return; // pack unreachable — keep whatever exists, NEVER crash (retry next mount)
        this.odmTreeData.set(data);
        const merged = mergeGmMissions(data, this.state.odmGmMissions(), this.state.gmMissionDrafts()) ?? data; // §S-1
        const cur = this.state.missionTree() ?? [];
        const now = this.odmNow() ?? undefined;
        const next = hasAuthoredNodes(cur, data)
            ? reconcileOdmTree(cur, merged, this.state.odmOutcomes(), now)
            : mintOdmBranches(merged, now);
        let changed = JSON.stringify(next) !== JSON.stringify(cur);
        // dropped: `next` has no ACTIVE branch this spec belongs to. The old guard (`!next.some(ACTIVE)`) only
        // caught a fully-idle tree; it MISSED the P7 shape — a resolved mission's spec lingering while a
        // DIFFERENT branch is ACTIVE. odmSpecIsCurrent is the shared rule; odmEnsureTree runs on every mount,
        // so this is the SAME clear applied on the live reconcile AND on resume/hydrate (one rule, two entries).
        if (this.state.missionSpec() && !odmSpecIsCurrent(this.state.missionSpec(), next)) { this.state.setMissionSpec(null); changed = true; }
        if (changed) { this.state.setMissionTree(next); void this.store.persistCurrent(); }
    }
    protected beginOperation(id: string): void {
        if (!this.canGenerateBranch()) return;
        const data = this.odmTreeAll();
        const node = data?.nodes.find((n) => n.id === id);
        if (!data || !node) { void this.tree.generateBranch(id); return; } // legacy-only fallback (a composed node IS in the merged set, so it never lands here)
        this.state.missionTree.update((t) => (t ?? []).map((b) => (b.branchId === id ? { ...b, state: 'ACTIVE' as const } : b)));
        this.state.odmActiveNodeId.set(id);
        // equally-legal roster); kept after resolve for reproducible history. Opaque — players see a uuid only.
        const seed = globalThis.crypto?.randomUUID?.() ?? `s-${hashSeedFallback(id + ':' + JSON.stringify(this.state.odmSeeds()))}`;
        this.state.odmSeeds.update((m) => ({ ...m, [id]: seed }));
        // (Force Preview / Lobby claims / battle reconcile / roster cell) sees the operation. Persist AFTER the
        // mint lands so one write carries branch+seed+spec together (Part E: re-begin re-rolls from the new seed).
        void this.mintOdmSpec(node, seed).then(() => void this.store.persistCurrent());
    }

    private async mintOdmSpec(node: NonNullable<ReturnType<OdmTreeData['nodes']['find']>>, seed: string): Promise<void> {
        let opforForce: ProtoInstance[] = [];
        let opforBv = 0;
        // rotates the mission seed on every begin (right for an authored ROLL, wrong for a GM's exact
        // roster — §S-9), so the composed force is stored on the published record and re-used, never
        // re-rolled. Instance ids were minted at publish in the odm-<seed8>-<i> shape.
        const composed = this.state.odmGmMissions().find((m) => m.id === node.id);
        if (composed) {
            opforForce = composed.opforForce ?? [];
            opforBv = composed.opforBv ?? 0;
        } else if (node.packet) {
            const fspec = await this.create.opforSpec(node.packet); // null in LAN (the ruled opfor* gate) / unauthored
            if (fspec) {
                try {
                    // the IDENTICAL roll the briefing computes: same seed, same rollOpfor, same stamp-first resolver
                    const rolled = rollOpfor(fspec, seed, (chassis, variant) => {
                        const key = `${chassis}|${variant}`.toLowerCase();
                        const u = this.data.getUnits().find((x) => `${x.chassis}|${x.model}`.toLowerCase() === key);
                        return u ? { name: u.name, mulId: u.id, tons: u.tons, bv: u.bv, type: u.type } : undefined;
                    });
                    const sh = seed.replace(/-/g, '').slice(0, 8);
                    opforForce = rolled.units.map((u, i) => ({
                        instanceId: `odm-${sh}-${i}`, // deterministic per seed; a re-begin's new seed = new ids (no stale-claim aliasing)
                        unitRef: u.unitRef, chassis: u.chassis, model: u.variant, mulId: u.mulId,
                        tons: u.tons, bv: u.bv,
                        unitType: (u.type === 'Tank' ? 'vehicle' : 'mech') as ProtoInstance['unitType'],
                        condition: 'Active',
                        provenance: { origin: 'gm-added' } as ProtoInstance['provenance'],
                        ...({ odmPilotName: u.pilotName, odmGunnery: u.gunnery, odmPiloting: u.piloting, odmRole: u.role, odmFixed: u.fixed } as object),
                    }));
                    opforBv = rolled.totalBv;
                } catch { /* an unstamped/unresolvable dev spec — empty force, never a crash */ }
            }
        }
        const spec: MissionSpec = {
            missionId: `odm-${node.id}-${seed.slice(0, 8)}`,
            contractId: this.state.acceptedContract()?.id ?? 'odm-standing-orders',
            type: 'GUERRILLA_WARFARE', // the standing order's generator family — never player-visible (typeName renders)
            typeName: node.title,
            posture: 'raid',
            // fallback returns these verbatim, so they reach the resolve dialog's three rows, the snapshotted
            // resolution.aar.objectives, the AAR objective table AND the player brief with no consumer change.
            // An authored mission keeps [] (its briefing packet is the mission document — DOCTRINE §7b).
            objectives: composed
                ? [composed.objectives.primary, composed.objectives.secondary, composed.objectives.bonus].filter((x) => !!x.trim())
                : [],
            opforForce, opforBv, playerBv: 0,
            terrain: {
                biome: node.system,
                // §S-7 — the authored sentence is a LIE for a composed operation (there is no packet).
                note: composed
                    ? 'GM-composed operation — the brief on this card is the mission document.'
                    : 'Authored operation — the briefing packet is the mission document.',
            },
            deployment: { player: '', opfor: '' },
            victoryConditions: [],
            clauses: { command: 'Independent', salvageExchange: false, salvagePct: 100, supportKind: 'none', supportPct: 0, transportPct: 0 },
            reward: { total: 0, monthly: 0 },
            window: { deployByDays: 2, engagementDays: Math.max(1, (node.opDays ?? 12) - 2), note: '' },
            seed: seedToNumber(seed),
        };
        this.state.setMissionSpec(spec);
    }
    protected beginFromTree(id: string): void { this.beginOperation(id); }
    protected briefingFromTree(id: string): void {
        const packet = this.odmPacketOf(id);
        if (!packet) return;
        this.create.briefingFocus.set(packet);
        this.select('briefing');
    }

    protected viewBriefing(): void {
        const packet = this.activeNodePacket();
        if (!packet) return;
        this.create.briefingFocus.set(packet);
        this.select('briefing');
    }
    // pickRandomTrack/generateBranchFromPreset) moved into the shared <bce-track-picker> component (chaos/track-picker.ts),
    // mounted both here (operations board, dashboard.html) and on the active-contract card. Plain "Generate »" stays above.

    //    focuses the MEKBAY tab with the engagement loaded (deployed BLUFOR + the active OpFor).
    protected readonly deployedCount = computed(() => deployedSet(this.state.startingForce(), this.state.quickMission()).length); // HF-020: quick one-shot counts the whole force
    protected prepareDeploy(): void {
        // uses the Missions hub; Quick Mission uses its own 'quickmission' hub. Set the sub AFTER select().
        // activeTab would land on 'missions' (no longer in HOTSPOTS_TABS) and de-highlight the whole HS tab bar.
        this.select('missions');
        this.missionsSub.set('force');
    }

    protected goToStep(d: { tab: string; sub?: string }): void {
        // Lobby, not a now-removed Missions sub. Other subs route as before.
        if (d.sub === 'claims') { this.select('lobby'); return; }
        this.select(d.tab);
        if (d.sub) this.selectMissionSub(d.sub as 'brief' | 'force' | 'aar');
    }

    private readonly fieldWalk = inject(OdmFieldWalkService);
    protected readonly walkPending = this.fieldWalk.pendingCount;
    protected readonly walkOpen = signal(false);
    // TABLE-2 T2-1 — open the walk for a SPECIFIC mission (from the AAR row); arg-less opens the first pending (the banner).
    protected openWalk(branchId?: string): void { this.fieldWalk.selectedWalkBranchId.set(branchId ?? null); this.walkOpen.set(true); }


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

        protected readonly classbar = computed(
        () => `${this.factionName()} · ${this.commandName()} · Operational Use Only`,
    );

    protected readonly dateText = computed(() => {
        const d = this.clock.currentDate();
        return d ? formatDate(d) : '—';
    });
    protected readonly eraText = computed(() => this.state.era()?.name ?? '—');
    /** S60 (2026-09-12) — the ODM header's WK was the same literal "1" S54 found on the campaign dashboard (the fork carried it). The
     *  campaign week off the ONE clock (campaignWeek = floor(daysBetween/7)+1), the same source the autosave's "Day N" derives from. */
    protected readonly weekText = computed(() => String(campaignWeek(this.state.startDate(), this.clock.currentDate())));

    // ── Overview stat cards ──
    protected readonly forceCount = computed(() => this.state.unitSize()?.count ?? 0);
    protected readonly pilotCount = computed(() => (this.state.pilots() ?? []).filter((p) => p.status !== 'KIA').length);
    protected readonly mechCount = computed(() => (this.state.startingForce() ?? []).filter((i) => i.unitType !== 'vehicle').length);
    protected readonly vehicleCount = computed(() => (this.state.startingForce() ?? []).filter((i) => i.unitType === 'vehicle').length);
    /** The ODM treasury is authored on the pack (state.treasury); the merc capital signal is null in the fork. */
    protected readonly treasuryAmount = computed(() => Math.round(this.state.treasury() ?? this.state.capital()?.amount ?? 0));
    // resources-derived transport card removed — the fork renders treasuryOdm + names the Iron Covenant.

    // ── Campaign log (templated from state) ──
    protected readonly log = computed(() => {
        const d = this.dateText();
        const c = this.state.capital();
        const lines = [
            `Campaign initiated. ${this.commandName()} deployed.`,
            'Standing orders in effect. Hold the Circle.',
            // 12 vehicles, and the warrior count is PEOPLE (the stables fold made it differ from the hulls).
            `Force mustered: ${this.mechCount()} ’Mechs, ${this.vehicleCount()} vehicles, ${this.pilotCount()} warriors.`,
            // capital signal is null in the fork, so this line rendered a bare em-dash where a number goes.
            `Treasury seeded: ${(c?.amount ?? this.treasuryAmount()).toLocaleString('en-US')} C-bills.`,
        ];
        const base = lines.map((text) => ({ t: d, text }));
        const entries = (this.state.campaignLog() ?? []).map((e) => ({ t: `${e.date.y}-${String(e.date.m + 1).padStart(2, '0')}-${String(e.date.d).padStart(2, '0')}`, text: e.text }));
        return [...base, ...entries];
    });


    //    costsAtRisk) REMOVED — a survival campaign models ATTRITION, not cash flow; the merc P&L (and its
    //    "take a contract / cut staff" advice) is false on occupied Terra. The txn log stays (Part C:
    //    C-bills remain, narrowed to bribes/black market/silence). ──
    /** Recent MONEY events only (signed amount + resulting balance), reverse-chron, capped at 15 (scroll for the rest). */
    protected readonly txnLog = computed(() => (this.state.campaignLog() ?? []).filter((e) => e.amount != null).slice().reverse().slice(0, 15));
    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected absVal(n: number): number { return Math.abs(n); }
    protected txnDate(d: { y: number; m: number; d: number }): string { return `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }

    //    below-floor WARNS and never gates BEGIN OPERATION (R1). Numbers from the authored pack ledger. ──
    //    Same data source as the roster + the walk (OdmFleetService + the live stocks) — zero duplicate state.
    private readonly fleetSvc = inject(OdmFleetService);
    protected readonly fleetVessels = computed(() => this.fleetSvc.vessels() ?? []);
    protected readonly liftBudget = this.fleetSvc.liftBudget;
    protected isJumpV(v: { class: string }): boolean { return /JumpShip/i.test(v.class); }

    protected readonly stocks = computed<OdmStocks>(() => this.state.odmStocks() ?? odmStartingStocks());
    protected readonly stockBins = computed(() => Object.entries(this.stocks().bins).map(([name, b]) => ({ name, ...b, breach: binBreach(b.tons, b.floorTons) })));
    protected readonly fuelPctV = computed(() => fuelPct(this.stocks()));
    protected readonly opsRemainingV = computed(() => opsRemaining(this.stocks()));
    protected readonly daysCrackingV = computed(() => daysCrackingPerOp(this.stocks()));
    protected readonly fuelStateV = computed(() => fuelState(this.stocks()));
    protected readonly anyBreach = computed(() => this.stockBins().some((b) => b.breach));
    protected fmtTons(n: number): string { return (Math.round(n * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
    /** Part B — Treasury, legible: 50,000 renders as 50,000 (the Classic M-rounding read `0M`). */
    protected readonly treasuryOdm = computed(() => {
        const t = this.state.treasury() ?? this.state.capital()?.amount;
        return t != null ? Math.round(t).toLocaleString('en-US') : '—';
    });
    /** Part B — EXPOSURE (replaces the inert Threat meter): a GM-SET assessment, honestly labelled. */
    protected readonly exposureV = computed(() => this.stocks().exposure);
    protected readonly exposureLevels = ODM_EXPOSURE_LEVELS;
    // the GM manual adjust (R2) — edits a draft copy; Save materializes + persists.
    protected readonly stocksAdjustOpen = signal(false);
    protected stocksDraft: { fuelTons: number; exposure: string; bins: { name: string; tons: number }[] } = { fuelTons: 0, exposure: 'LOW', bins: [] };
    protected openStocksAdjust(): void {
        const s = this.stocks();
        this.stocksDraft = { fuelTons: s.fuelTons, exposure: s.exposure, bins: Object.entries(s.bins).map(([name, b]) => ({ name, tons: b.tons })) };
        this.stocksAdjustOpen.set(true);
    }
    protected cancelStocksAdjust(): void { this.stocksAdjustOpen.set(false); }
    protected saveStocksAdjust(): void {
        const cur = this.stocks();
        const bins = { ...cur.bins };
        for (const d of this.stocksDraft.bins) {
            const t = Number(d.tons);
            if (bins[d.name] && Number.isFinite(t) && t >= 0) bins[d.name] = { ...bins[d.name], tons: t };
        }
        const fuel = Number(this.stocksDraft.fuelTons);
        this.state.odmStocks.set({
            ...cur,
            fuelTons: Number.isFinite(fuel) && fuel >= 0 ? Math.min(fuel, cur.fuelCapacityTons) : cur.fuelTons,
            bins,
            exposure: this.stocksDraft.exposure || cur.exposure,
        });
        this.stocksAdjustOpen.set(false);
        void this.store.persistCurrent();
    }

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
                    trade: (p.trade as OdmTrade | undefined) ?? null,
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
    protected readonly pilotGroups = computed(() => {
        const roster = this.pilotRoster();
        const groups: { key: string; label: string; people: typeof roster }[] = [];
        for (const t of TRADE_ORDER) {
            const people = roster.filter((p) => p.trade === t);
            if (people.length) groups.push({ key: t, label: TRADE_LABEL[t], people });
        }
        const unassigned = roster.filter((p) => !p.trade || !TRADE_ORDER.includes(p.trade));
        if (unassigned.length) groups.push({ key: 'unassigned', label: UNASSIGNED_LABEL, people: unassigned });
        return groups;
    });
    /** HF-016 posture, per group: the set holds the EXPANDED groups — empty set = ALL COLLAPSED at start. */
    protected readonly tradesOpen = signal<Set<string>>(new Set());
    protected tradeOpen(key: string): boolean { return this.tradesOpen().has(key); }
    protected toggleTrade(key: string): void {
        this.tradesOpen.update((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    }
    protected tradeChip(id: string): string {
        const t = (this.state.pilots() ?? []).find((p) => p.pilotId === id)?.trade as OdmTrade | undefined;
        return t && TRADE_ORDER.includes(t) ? TRADE_LABEL[t] : '';
    }
    private async ensureStables(): Promise<void> {
        const pilots = this.state.pilots() ?? [];
        const byIdent = new Map<string, typeof pilots>();
        for (const p of pilots) {
            if (!p.named) continue; // authored identities only — the ruled scope
            const k = identityOf(p.name, p.callsign);
            byIdent.set(k, [...(byIdent.get(k) ?? []), p]);
        }
        const twins = [...byIdent.values()].filter((g) => g.length === 2);
        if (!twins.length) return;
        const instById = new Map((this.state.startingForce() ?? []).map((i) => [i.instanceId, i]));
        // The primary marker lives in the pack roster (chassis+variant keyed) — fetch once, null-tolerant.
        const roster = await this.create.rosterJson();
        const secondaryKeys = new Set((roster?.units ?? []).filter((u) => u.pilotPrimary === false).map((u) => `${u.chassis}|${u.variant}`.toLowerCase()));
        let next = this.state.pilots() ?? [];
        let folded = 0;
        const noteMerges: [string, string][] = [];
        for (const pair of twins) {
            const seat = (p: (typeof pilots)[number]) => (p.assignedInstanceId ? instById.get(p.assignedInstanceId) : undefined);
            const isSecondary = (p: (typeof pilots)[number]) => { const i = seat(p); return !!i && secondaryKeys.has(`${i.chassis}|${i.model}`.toLowerCase()); };
            const isActive = (p: (typeof pilots)[number]) => seat(p)?.condition === 'Active';
            let primary = pair.find((p) => !isSecondary(p) && !!seat(p));
            let secondary = pair.find((p) => p !== primary);
            if (!primary || pair.every((p) => !isSecondary(p))) {
                // no marker resolution (roster unreachable / unmarked) → the condition rail
                const act = pair.filter(isActive);
                if (act.length === 1) { primary = act[0]; secondary = pair.find((p) => p !== primary); }
                else { this.state.logNotice(`Barracks reconciliation SKIPPED — two records for ${pair[0].name} and no marker or condition splits them; fix the pack marker.`, null, 'admin'); continue; }
            }
            if (!primary || !secondary) continue;
            const hulls = [primary.assignedInstanceId, secondary.assignedInstanceId].filter((x): x is string => !!x);
            const foldedRec = { ...foldPilots(primary, secondary), stableHulls: [...new Set([...(primary.stableHulls ?? []), ...hulls])] };
            next = next.filter((p) => p.pilotId !== secondary!.pilotId).map((p) => (p.pilotId === primary!.pilotId ? foldedRec : p));
            noteMerges.push([secondary.pilotId, primary.pilotId]);
            folded++;
            const secInst = seat(secondary);
            this.state.logNotice(`Barracks reconciliation — ${primary.name} consolidated to one record (rides ${seat(primary)?.chassis ?? 'their machine'}; the ${secInst?.chassis ?? 'second hull'} stands down as a spare machine of their stable).`, null, 'admin');
        }
        if (folded) {
            // strips rows before this async fold runs), leaving a store entry keyed by the folded-away id.
            // Merge it under the survivor so the fold stays LOSSLESS in BOTH homes, whichever ran first.
            const notes = { ...this.state.gmPilotNotes() };
            let notesChanged = false;
            for (const [from, to] of noteMerges) {
                if (notes[from]) {
                    notes[to] = notes[to] ? `${notes[to]}\n${notes[from]}` : notes[from];
                    delete notes[from];
                    notesChanged = true;
                }
            }
            if (notesChanged) this.state.setGmPilotNotes(notes);
            this.state.setPilots(next);
            void this.store.persistCurrent();
        }
    }
    private ensureTrades(): boolean {
        const pilots = this.state.pilots() ?? [];
        if (!pilots.length) return false;
        const byId = new Map((this.state.startingForce() ?? []).map((i) => [i.instanceId, i]));
        let changed = false;
        const next = pilots.map((p) => {
            if (p.trade || !p.assignedInstanceId) return p;
            const inst = byId.get(p.assignedInstanceId);
            if (!inst) return p;
            const trade = tradeForInstance(inst, this.data.getUnitByName(inst.unitRef)?.type);
            if (!trade) return p;
            changed = true;
            return { ...p, trade };
        });
        if (changed) this.state.setPilots(next);
        return changed;
    }
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
    protected gmNoteFor(pilotId: string): string { return this.state.gmPilotNotes()[pilotId] ?? ''; }
    protected saveGmNote(pilotId: string, text: string): void {
        const notes = { ...this.state.gmPilotNotes() };
        if (text) notes[pilotId] = text; else delete notes[pilotId];
        this.state.setGmPilotNotes(notes);
        void this.store.persistCurrent();
    }

    protected openPilot(id: string): void {
        this.detailPilot.set(id);
    }

    //    so leaving the control on the roster alone would have rebuilt the original complaint one screen over.
    //    Every derivation is the SHARED one in OdmReassignService: same trade rule, same annotations, same
    private readonly crew = inject(OdmReassignService);
    protected readonly postingOptions = computed(() => {
        const id = this.detailPilot();
        return id ? this.crew.postingOptions(id) : [];
    });
    protected changePosting(pilotId: string, instanceId: string): void {
        if (instanceId) {
            const warn = this.crew.displacementWarning(pilotId, instanceId);
            if (warn && !confirm(warn)) return;
            this.crew.reassign(instanceId, pilotId);
            return;
        }
        const from = (this.state.pilots() ?? []).find((p) => p.pilotId === pilotId)?.assignedInstanceId;
        if (!from) return;
        const warn = this.crew.standDownWarning(from);
        if (warn && !confirm(warn)) return;
        this.crew.reassign(from, '');
    }
    protected readonly tradeOptions = TRADE_CHOICES;
    protected changeTrade(pilotId: string, trade: string): void {
        const warn = this.crew.tradeChangeWarning(pilotId, trade);
        if (warn && !confirm(warn)) return;
        this.crew.setTrade(pilotId, trade);
    }
}
