import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { ForgePackService } from '../mission/forge-pack.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { CUSTOM_UNIT } from '../faction/faction-data';
import { campaignRegister, factionTags, mintVoice } from '../mission/forge-select';
import { selectUnlocks, type MissionBranch, type BranchResolution } from '../mission/mission-tree';
import { aarArchive, buildAarDocument, stableIndex, type AarArchiveItem, type AarContext, type AarDocument, type AarVoiceRef } from './aar-render';
import { formatDate } from '../clock/campaign-clock';
import { NarratorService } from '../narrator/narrator.service';
import type { RefineTarget } from '../narrator/narrator-types';

const STAFF_FAMILIES = ['command', 'intelligence', 'engineering'] as const;

@Component({
    selector: 'bce-aar-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './aar-tab.html',
    styleUrl: './aar-tab.scss',
    host: { '(document:keydown.escape)': 'close()' },
})
export class AarTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly pack = inject(ForgePackService);
    private readonly store = inject(CampaignSaveStore);
    protected readonly narrator = inject(NarratorService);

    /** Bumped when the lazy pack lands so the archive/doc recompute (the mission-package pattern). */
    private readonly ready = signal(this.pack.isLoaded() ? 1 : 0);
    /** Bumped after a refine pass stores results, so doc() re-reads the resolution's refined map. */
    private readonly refinedRev = signal(0);

    constructor() {
        void this.ensureStaff();
    }

    private readonly liveContext = computed(() => {
        const ac = this.state.acceptedContract();
        return ac ? `${ac.employer.name} · ${ac.missionName}` : 'Current operations';
    });

    // SETTLED, never the Traditional "WALK PENDING". Traditional is unchanged.
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');

    protected readonly items = computed<AarArchiveItem[]>(() => {
        this.ready();
        return aarArchive(this.state.missionTree() ?? [], this.liveContext(), this.state.treeArchive() ?? []);
    });

    protected readonly selected = signal<AarArchiveItem | null>(null);
    protected open(it: AarArchiveItem): void {
        this.selected.set(it);
    }
    protected close(): void {
        this.selected.set(null);
    }

    // TABLE-2 T2-1 — the per-mission WALK control is ODM-only (shared template). Classic keeps its single-walk
    // model: the badge stays a passive label (walkable=false hides the button), so requestWalk is never invoked.
    protected readonly walkable = false;
    protected requestWalk(it: AarArchiveItem): void { void it; /* Classic: no per-mission walk route (out of TABLE-2 scope); walkable=false hides the button */ }
    protected print(): void {
        window.print();
    }

    protected readonly docTier = computed(() => this.selected()?.tier ?? '');

    private voiceRef(roleFamily: string): AarVoiceRef | null {
        const v = this.pack.voiceById(this.state.staffVoices()[roleFamily]);
        return v ? { name: v.name, roleFamily: v.roleFamily, header: v.sidebarHeader, rules: v.speechRules.join(' · ') } : null;
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

    /** Assemble the render context for a branch (voices, pilots, bay history, NPC names, refined). */
    private ctxFor(br: MissionBranch, contextLabel?: string): AarContext {
        const r = br.resolution!;
        const npcNamesByFlag = this.npcNames(br);
        const tree = this.treeOf(br.branchId);
        const kids = tree.filter((c) => c.parentBranchId === br.branchId);
        const opened = new Set(selectUnlocks(kids.map((c) => ({ branchId: c.branchId, outcomeGate: c.outcomeGate })), r.outcomeTier).unlock);
        const unlocked = kids.filter((c) => opened.has(c.branchId)).map((c) => c.name);
        const pilots = this.state.pilots() ?? [];
        const pilotOf = (id?: string) => (id ? pilots.find((p) => p.pilotId === id) : undefined);
        const engineering = this.pack.voiceById(this.state.staffVoices()['engineering']);
        const unit = this.state.unit();
        const openJobs: Record<string, { hours: number; cost: number; bayName: string }> = {};
        for (const b of this.state.bays() ?? []) if (b.occupantId) openJobs[b.occupantId] = { hours: b.laborHours, cost: b.estimateCost, bayName: b.name };
        return {
            register: campaignRegister(this.state.force(), this.state.faction()),
            commandName: this.state.commandName() ?? (unit && unit !== CUSTOM_UNIT ? unit : 'Custom command'),
            unitSizeName: this.state.unitSize()?.name ?? 'Company',
            contextLabel: contextLabel ?? this.liveContext(),
            voices: { command: this.voiceRef('command'), intelligence: this.voiceRef('intelligence'), engineering: this.voiceRef('engineering') },
            armorerClosing: engineering?.sampleLines?.length ? engineering.sampleLines[stableIndex(br.branchId, engineering.sampleLines.length)] : null,
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
            survival: !!this.state.packId(),
            refined: r.aar?.refined,
        };
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
        if (!roleFamily) return null;
        const v = this.pack.voiceById(this.state.staffVoices()[roleFamily]);
        return v ? { name: v.name, speechRules: v.speechRules } : null;
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
     *  else the live one. Null = not on record (e.g. a closed House order) — rendered honestly. */
    private clauseFor(branchId: string): { pct: number; exchange: boolean } | null {
        const entry = (this.state.treeArchive() ?? []).find((e) => e.tree.some((b) => b.branchId === branchId));
        const offer = entry
            ? (this.state.completedContracts() ?? []).find((c) => c.id === entry.contractId)
            : this.state.acceptedContract();
        return offer?.salvage ? { pct: offer.salvage.pct, exchange: !!offer.salvage.exchange } : null;
    }

    private async ensureStaff(): Promise<void> {
        await this.pack.ensureLoaded();
        this.ready.update((v) => v + 1);
        const tags = [...factionTags(this.state.faction()), ...(this.state.force() === 'MERC' ? ['merc'] : [])];
        const next = { ...this.state.staffVoices() };
        let changed = false;
        for (const rf of STAFF_FAMILIES) {
            if (next[rf]) continue;
            const id = mintVoice(this.pack.voices(), rf, tags);
            if (id) { next[rf] = id; changed = true; }
        }
        if (changed) {
            this.state.setStaffVoices(next);
            void this.store.persistCurrent();
        }
    }
}
