import { Component, ChangeDetectionStrategy, computed, inject, output, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { ForgePackService } from '../mission/forge-pack.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { CUSTOM_UNIT } from '../faction/faction-data';
import { campaignRegister } from '../mission/forge-select';
import { selectUnlocks, type MissionBranch, type BranchResolution } from '../mission/mission-tree';
import { aarArchive, buildAarDocument, type AarArchiveItem, type AarContext, type AarDocument, type AarVoiceRef } from '../aar/aar-render';
import { formatDate } from '../clock/campaign-clock';
import { NarratorService } from '../narrator/narrator.service';
import type { RefineTarget } from '../narrator/narrator-types';
import { OdmContactsService, type OdmAarSlot } from './odm-contacts.service';

@Component({
    selector: 'bce-odm-aar-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: '../aar/aar-tab.html' /* SHARED */,
    styleUrl: '../aar/aar-tab.scss' /* SHARED */,
    host: { '(document:keydown.escape)': 'close()' },
})
export class OdmAarTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly pack = inject(ForgePackService); // npcById only — LEGACY resolutions CAN carry npcFlags (the pre-authored/fallback generateBranch path), so the pack still loads (panel catch)
    private readonly store = inject(CampaignSaveStore);
    private readonly crewSvc = inject(OdmContactsService);
    protected readonly narrator = inject(NarratorService);

    /** Bumped when the crew registry lands so the open document recomputes with the authored bylines. */
    private readonly ready = signal(0);
    /** Bumped after a refine pass stores results, so doc() re-reads the resolution's refined map. */
    private readonly refinedRev = signal(0);

    constructor() {
        // written to the campaign's staff-voice map); the contact registry is the only voice source.
        void this.crewSvc.ensureLoaded().then(() => this.ready.update((v) => v + 1));
        // The forge pack still loads (NO mint) — legacy/fallback-generated resolutions carry npcFlags, and
        // Section 2's "Source contributions" line + the refine allowed-name set need npcById (panel catch:
        // dropping this silently lost the line in a fresh session, with no recompute when the pack landed).
        void this.pack.ensureLoaded().then(() => this.ready.update((v) => v + 1));
    }

    private readonly liveContext = computed(() => {
        const ac = this.state.acceptedContract();
        return ac ? `${ac.employer.name} · ${ac.missionName}` : 'Current operations';
    });

    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');

    protected readonly items = computed<AarArchiveItem[]>(() => {
        this.ready();
        return aarArchive(this.state.missionTree() ?? [], this.liveContext(), this.state.treeArchive() ?? []);
    });

    protected readonly selected = signal<AarArchiveItem | null>(null);
    protected open(it: AarArchiveItem): void {
        this.selected.set(it);
    }

    // TABLE-2 T2-1/T2-4 — the AAR "WALK THE FIELD ▸" badge IS a per-mission control (ODM only). The dashboard
    // owns the walk modal, so the row emits its branchId and odm-dashboard.openWalk($event) opens the walk for it.
    protected readonly walkable = true;
    readonly walkMission = output<string>();
    protected requestWalk(it: AarArchiveItem): void { this.walkMission.emit(it.branchId); }
    protected close(): void {
        this.selected.set(null);
    }
    protected print(): void {
        window.print();
    }

    protected readonly docTier = computed(() => this.selected()?.tier ?? '');

    private voiceRef(slot: OdmAarSlot): AarVoiceRef | null {
        return this.crewSvc.voiceRef(slot);
    }

    /** The tree a branch actually lives in — its own archived tree, else the live spine. */
    private treeOf(branchId: string): MissionBranch[] {
        for (const e of this.state.treeArchive() ?? []) if (e.tree.some((b) => b.branchId === branchId)) return e.tree;
        return this.state.missionTree() ?? [];
    }

    /** Resolve the selected branch FRESH from state by id (live tree or archive) so a refine store
     *  reflects immediately — the archive item's branch object is a stale snapshot. */
    private branchById(branchId: string): MissionBranch | undefined {
        return this.treeOf(branchId).find((b) => b.branchId === branchId);
    }

    protected readonly doc = computed<AarDocument | null>(() => {
        this.ready();
        this.refinedRev();
        const it = this.selected();
        const br = it ? this.branchById(it.branch.branchId) ?? it.branch : null;
        if (!it || !br?.resolution) return null;
        return buildAarDocument(br, this.ctxFor(br, it.context));
    });

    /** Assemble the render context for a branch — the authored crew in every author slot. */
    private ctxFor(br: MissionBranch, contextLabel?: string): AarContext {
        const r = br.resolution!;
        const npcNamesByFlag = this.npcNames(br);
        const tree = this.treeOf(br.branchId);
        const kids = tree.filter((c) => c.parentBranchId === br.branchId);
        const opened = new Set(selectUnlocks(kids.map((c) => ({ branchId: c.branchId, outcomeGate: c.outcomeGate })), r.outcomeTier).unlock);
        const unlocked = kids.filter((c) => opened.has(c.branchId)).map((c) => c.name);
        const pilots = this.state.pilots() ?? [];
        const pilotOf = (id?: string) => (id ? pilots.find((p) => p.pilotId === id) : undefined);
        const unit = this.state.unit();
        const openJobs: Record<string, { hours: number; cost: number; bayName: string }> = {};
        for (const b of this.state.bays() ?? []) if (b.occupantId) openJobs[b.occupantId] = { hours: b.laborHours, cost: b.estimateCost, bayName: b.name };
        return {
            register: campaignRegister(this.state.force(), this.state.faction()),
            commandName: this.state.commandName() ?? (unit && unit !== CUSTOM_UNIT ? unit : 'Custom command'),
            unitSizeName: this.state.unitSize()?.name ?? 'Company',
            contextLabel: contextLabel ?? this.liveContext(),
            voices: { command: this.voiceRef('command'), intelligence: this.voiceRef('intelligence'), engineering: this.voiceRef('engineering'), personnel: this.voiceRef('personnel') },
            armorerClosing: this.bayNote(br),
            pilotInfoOf: (id) => {
                const p = pilotOf(id);
                return p ? { name: p.callsign ? `${p.name} "${p.callsign}"` : p.name, status: p.status, recoveryDays: p.recoveryDays ?? null, kiaDateText: p.kiaDate ? formatDate(p.kiaDate) : null } : null;
            },
            bayHistory: this.state.bayHistory() ?? [],
            openJobs,
            salvageClause: this.clauseFor(br.branchId),
            npcNamesByFlag,
            unlocked,
            isHotspots: this.isHotspots(),
            survival: true,
            refined: r.aar?.refined,
        };
    }

    private bayNote(br: MissionBranch): string | null {
        const tpl = this.crewSvc.bySlot('engineering')?.aar?.bayNote;
        const walk = br.resolution?.fieldWalk;
        if (!tpl || !walk) return null;
        const walked = new Set(walk.rows.map((w) => w.instanceId));
        const settled = (this.state.bayHistory() ?? []).filter((h) => walked.has(h.instanceId) && h.outcome === 'completed');
        // Sum re-rounded to 2 dp (the repair-bays convention) — a raw IEEE sum can print "0.30000000000000004 h",
        // exactly the inexact figure her rules forbid (panel catch).
        const hours = Math.round(settled.reduce((s, h) => s + h.laborHours, 0) * 100) / 100;
        const parts = settled.flatMap((h) => h.partsUsed ?? []);
        const short = settled.flatMap((h) => h.rearmShort ?? []);
        const fill = (t: string, vals: Record<string, string>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => vals[k] ?? '');
        if (!settled.length) return fill(tpl.noWork, { machines: String(walk.rows.length) });
        const shortfall = short.length ? fill(tpl.shortfallStated, { short: short.join('; ') }) : tpl.noShortfall;
        return fill(tpl.withWork, {
            machines: String(walk.rows.length),
            jobs: String(settled.length),
            hours: String(hours),
            parts: parts.length ? parts.join(', ') : 'none this span',
            shortfall,
        });
    }

    protected readonly canRefine = computed(() => this.narrator.mode() === 'local' && this.narrator.aarsOn() && !!this.doc());
    protected readonly refining = this.narrator.busy;
    protected readonly results = this.narrator.lastRun;

    /** Build refine targets from the TEMPLATE sections (refined stripped) so we polish the template,
     *  not already-refined prose. Command + intelligence — pure prose; tables/precept stay locked. */
    private targetsFor(br: MissionBranch): RefineTarget[] {
        const a = br.resolution?.aar;
        const tmpl = this.templateSections(br);
        const tier = br.resolution?.outcomeTier ?? '';
        const out: RefineTarget[] = [];
        if (tmpl['command']?.trim()) out.push({ id: 'command', label: 'Command summary', roleFamily: 'command', text: tmpl['command'], names: [tier, a?.employer ?? '', a?.target ?? ''].filter(Boolean) });
        if (tmpl['intelligence']?.trim()) out.push({ id: 'intelligence', label: 'Intelligence assessment', roleFamily: 'intelligence', text: tmpl['intelligence'], names: [a?.target ?? '', a?.world ?? '', ...Object.values(this.npcNames(br))].filter(Boolean) });
        return out;
    }
    private npcNames(br: MissionBranch): Record<string, string> {
        const out: Record<string, string> = {};
        for (const f of br.resolution?.aar?.npcFlags ?? []) { const n = this.pack.npcById(this.state.npcAssignments()[f]); if (n) out[f] = n.name; }
        return out;
    }
    /** Template section prose (refined=off) keyed by id — the refine baseline + the machine-diff source. */
    private templateSections(br: MissionBranch): Record<string, string> {
        const saved = br.resolution!.aar?.refined;
        // build with refined stripped
        const stripped: MissionBranch = { ...br, resolution: { ...br.resolution!, aar: br.resolution!.aar ? { ...br.resolution!.aar, refined: undefined } : undefined } as BranchResolution };
        const d = buildAarDocument(stripped, this.ctxFor(stripped));
        const out: Record<string, string> = {};
        for (const s of d.sections) out[s.id] = s.paragraphs.join('\n\n');
        void saved;
        return out;
    }

    async refine(): Promise<void> {
        const it = this.selected();
        const br = it ? this.branchById(it.branch.branchId) : undefined;
        if (!br?.resolution) return;
        const targets = this.targetsFor(br);
        if (!targets.length) return;
        const register = campaignRegister(this.state.force(), this.state.faction());
        const results = await this.narrator.refine(targets, register, (rf) => this.voiceCard(rf));
        const accepted: Record<string, { text: string; verified: boolean }> = { ...(br.resolution.aar?.refined ?? {}) };
        for (const r of results) if (r.status === 'accepted' && r.text) accepted[r.id] = { text: r.text, verified: true };
        if (Object.keys(accepted).length) this.storeRefined(br.branchId, accepted);
    }

    private voiceCard(roleFamily: string | null): { name: string; speechRules: string[] } | null {
        if (roleFamily !== 'command' && roleFamily !== 'intelligence' && roleFamily !== 'engineering' && roleFamily !== 'personnel') return null;
        const m = this.crewSvc.bySlot(roleFamily);
        // Registry names already carry their rank ("Major-Select Elspeth Varro") — ONE source, no re-assembly.
        return m?.aar ? { name: m.name, speechRules: m.aar.standingRules } : null;
    }

    /** Write the refined map onto the branch's resolution.aar wherever it lives (live tree or archive). */
    private storeRefined(branchId: string, refined: Record<string, { text: string; verified: boolean }>): void {
        const patch = (b: MissionBranch): MissionBranch =>
            b.branchId === branchId && b.resolution
                ? { ...b, resolution: { ...b.resolution, aar: { ...(b.resolution.aar ?? {}), refined } } }
                : b;
        if ((this.state.missionTree() ?? []).some((b) => b.branchId === branchId)) {
            this.state.setMissionTree((this.state.missionTree() ?? []).map(patch));
        } else {
            this.state.setTreeArchive((this.state.treeArchive() ?? []).map((e) => ({ ...e, tree: e.tree.map(patch) })));
        }
        this.refinedRev.update((v) => v + 1);
        void this.store.persistCurrent();
    }

    /** The salvage clause this mission ran under: the archived contract when the branch is archived,
     *  else the live one. Null = not on record — under ODM there is no contract, so this is always null
     *  and the survival annex never renders clause math (kept verbatim for fork faithfulness). */
    private clauseFor(branchId: string): { pct: number; exchange: boolean } | null {
        const entry = (this.state.treeArchive() ?? []).find((e) => e.tree.some((b) => b.branchId === branchId));
        const offer = entry
            ? (this.state.completedContracts() ?? []).find((c) => c.id === entry.contractId)
            : this.state.acceptedContract();
        return offer?.salvage ? { pct: offer.salvage.pct, exchange: !!offer.salvage.exchange } : null;
    }
}
