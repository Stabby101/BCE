/*
 * BCE — the FLOW tab (DIRECTIVE-028). Renders the D-026 mission tree natively on the dossier theme
 * tokens: depth-columned node cards connected by gate-labeled SVG edges, with a side drawer per node
 * state. GENERATE on an AVAILABLE node calls the SAME MissionTreeService action as the Missions tab
 * (one action, two surfaces); OPEN FULL PACKAGE on the ACTIVE node is emitted to the dashboard's
 * existing package overlay. The veil rule holds by construction — LOCKED nodes have no spec, so their
 * drawer shows only the fork's trigger/consequence teaser. A contract selector recalls archived trees
 * (read-only). MERC/contract-scoped. Height-safe (the canvas pans inside a bounded viewport).
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal, output, input } from '@angular/core';
import { NewCampaignState } from '../../new-campaign-state';
import { MissionTreeService } from '../../mission/mission-tree.service';
import { layoutTree } from './flow-layout';
import type { MissionBranch } from '../../mission/mission-tree';
import { deployedSet } from '../../force/deployed';

/** DIRECTIVE-073 — one lifecycle stage of the current mission, read-only over the real state/gates. */
interface GateNode { key: string; name: string; status: 'done' | 'pending' | 'blocked'; detail: string; }

/** DIRECTIVE-115 — the advisory rail: each lifecycle step → the tab (+ optional Missions-hub sub) where the player
 *  performs it, per campaign system. Post-D-114 Hot Spots layout: the mission hub lives in the Contracts tab
 *  (chaos-contracts, subs brief/force/claims/aar), repair + heal in Repair & Refit (chaos-repair); Traditional keeps
 *  missions / repair / barracks. Advisory navigation only — never forces the step. */
type FlowDest = { tab: string; sub?: 'brief' | 'force' | 'claims' | 'aar' };
const STEP_DEST: Record<string, { traditional: FlowDest; hotspots: FlowDest }> = {
    brief:     { traditional: { tab: 'missions', sub: 'brief' }, hotspots: { tab: 'chaos-contracts', sub: 'brief' } },
    deploy:    { traditional: { tab: 'missions', sub: 'force' }, hotspots: { tab: 'chaos-contracts', sub: 'force' } },
    claims:    { traditional: { tab: 'lobby' },                  hotspots: { tab: 'lobby' } },
    aar:       { traditional: { tab: 'missions', sub: 'aar' },   hotspots: { tab: 'chaos-contracts', sub: 'aar' } },
    repair:    { traditional: { tab: 'repair' },                 hotspots: { tab: 'chaos-repair' } },
    infirmary: { traditional: { tab: 'barracks' },              hotspots: { tab: 'chaos-repair' } },
    outcome:   { traditional: { tab: 'repair' },                 hotspots: { tab: 'chaos-repair' } },
};

/** DIRECTIVE-119 P2 — the Hot Spots lifecycle as a top-of-sheet Process Rail: ordered steps + where each is done.
 *  `advance` is the P1 clock-advance action (not a navigate). Reuses the same navigate/advancePhase outputs. */
const HS_RAIL: readonly { key: string; label: string; dest: FlowDest | 'advance' }[] = [
    { key: 'force',    label: 'Your force',         dest: { tab: 'roster' } },
    { key: 'contract', label: 'Contract',           dest: { tab: 'chaos-contracts', sub: 'brief' } },
    // DECISION (D-119 P2) — DEPLOY lands on the Contracts BRIEF sub, where the D-118 inline deploy roster lives (the
    // primary deploy UX), not the legacy /force battle-view; the brief hub adapts (board when idle → deploy roster
    // once a track is active), so CONTRACT and DEPLOY share it state-adaptively.
    { key: 'deploy',   label: 'Deploy',             dest: { tab: 'chaos-contracts', sub: 'brief' } },
    { key: 'lobby',    label: 'Lobby',              dest: { tab: 'lobby' } },
    { key: 'resolve',  label: 'Resolve',            dest: { tab: 'lobby' } },
    { key: 'aar',      label: 'AAR',                dest: { tab: 'aar' } },
    { key: 'repair',   label: 'Repair & Infirmary', dest: { tab: 'chaos-repair' } },
    { key: 'advance',  label: 'Advance phase',      dest: 'advance' },
];

@Component({
    selector: 'bce-campaign-flow',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './flow.html',
    styleUrl: './flow.scss',
    host: { '(document:keydown.escape)': 'closeDrawer()' },
})
export class FlowComponent {
    /** ACTIVE node → open the dashboard's existing D-025 package overlay (one action, two surfaces). */
    readonly openPackage = output<void>();
    /** DIRECTIVE-115 — advisory rail: a step click → navigate the dashboard to where that step is done. */
    readonly navigate = output<{ tab: string; sub?: string }>();
    /** DIRECTIVE-119 — Hot Spots only: the final "Advance phase" step → the dashboard advances the clock + returns to CONTRACT. */
    readonly advancePhase = output<void>();
    /** DIRECTIVE-119 P2 — 'rail' renders the compact top-of-sheet Process Rail (Hot Spots, above the tab bar);
     *  'full' (default) is the Flow tab's tree + gate window (Traditional). */
    readonly variant = input<'full' | 'rail'>('full');

    private readonly state = inject(NewCampaignState);
    private readonly tree = inject(MissionTreeService);
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots'); // D-115 — picks the destination column

    // ── Contract selector: the live (active) contract + archived completed contracts (read-only) ──
    private readonly selectedId = signal<string>('current');
    protected readonly archive = computed(() => this.state.treeArchive() ?? []);
    private readonly liveTree = computed(() => this.state.missionTree() ?? []);
    protected readonly hasLive = computed(() => !!this.state.acceptedContract() && this.liveTree().length > 0);
    protected readonly contracts = computed(() => {
        const opts: { id: string; label: string }[] = [];
        if (this.hasLive()) {
            const ac = this.state.acceptedContract();
            opts.push({ id: 'current', label: `Current · ${ac?.employer.name ?? ''} ${ac?.missionName ?? ''}`.trim() });
        }
        for (const e of [...this.archive()].reverse()) opts.push({ id: e.contractId, label: e.label });
        return opts;
    });
    /** Resolve the selection to a valid option (defaults to the first — live if present, else newest archive). */
    protected readonly effectiveId = computed(() => {
        const opts = this.contracts();
        if (!opts.length) return null;
        const sel = this.selectedId();
        return opts.some((o) => o.id === sel) ? sel : opts[0].id;
    });
    protected readonly isLive = computed(() => this.effectiveId() === 'current');
    protected readonly selectedTree = computed<MissionBranch[]>(() => {
        if (this.isLive()) return this.liveTree();
        return this.archive().find((x) => x.contractId === this.effectiveId())?.tree ?? [];
    });
    protected readonly layout = computed(() => layoutTree(this.selectedTree()));
    protected readonly isEmpty = computed(() => this.contracts().length === 0);
    /** One ACTIVE at a time — GENERATE only on the live tree when no branch is active. */
    protected readonly canGenerate = computed(() => this.isLive() && !this.liveTree().some((b) => b.state === 'ACTIVE'));

    protected select(id: string): void {
        this.selectedId.set(id);
        this.focusedId.set(null);
    }

    // ── Drawer: one focused node at a time ──
    protected readonly focusedId = signal<string | null>(null);
    protected readonly focused = computed(() => this.selectedTree().find((b) => b.branchId === this.focusedId()) ?? null);
    protected focus(b: MissionBranch): void {
        this.focusedId.set(b.branchId);
    }
    protected closeDrawer(): void {
        this.focusedId.set(null);
    }

    /** The live spec's objectives, for the ACTIVE node drawer (archived trees never carry an ACTIVE node). */
    protected readonly activeObjectives = computed(() => this.state.missionSpec()?.objectives ?? []);
    /** HOTFIX-021 — a real forge seed is bound → the full package exists; generic (seedless) → the brief is the whole operation (matches the Contract/Brief gate). */
    protected readonly hasPackage = computed(() => !!this.state.missionSpec()?.forge?.seedId);

    protected generate(b: MissionBranch): void {
        if (!this.canGenerate() || b.state !== 'AVAILABLE' || !this.isLive()) return;
        void this.tree.generateBranch(b.branchId);
        this.closeDrawer();
    }
    protected openPkg(): void {
        this.openPackage.emit();
        this.closeDrawer();
    }

    protected dateText(d?: { y: number; m: number; d: number }): string {
        return d ? `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '—';
    }
    /** IMPORT-6 FOLLOWUPS — the player's authored objectives + marks as resolved (resolution.aar.objectiveMarks, 'our' rows). */
    protected ourMarks(b: MissionBranch): { text: string; vp: number; met: boolean }[] {
        return (b.resolution?.aar?.objectiveMarks ?? []).filter((o) => o.side !== 'opp');
    }

    // ── D-039 — gate edges read as THRESHOLDS; AVAILABLE siblings that survived a resolve are "still open" ──
    private readonly hasProgress = computed(() => this.selectedTree().some((b) => b.state === 'ACTIVE' || b.state === 'RESOLVED'));
    /** A still-playable, un-taken option: AVAILABLE while the campaign has already moved past a mission. */
    protected stillOpen(b: MissionBranch): boolean {
        return b.state === 'AVAILABLE' && this.hasProgress();
    }
    /** Gate → threshold reading (the fork opens AT this bar, not only at an exact key). */
    protected thresholdLabel(gate: string): string {
        return { ANY: 'always', FAILURE: 'on failure', COMPROMISED: 'if compromised', PARTIAL: '≥ partial', SUCCESS: '≥ success', FULL_SUCCESS: 'full success only' }[gate] ?? gate;
    }

    /** D-129 — a friendly label for the authored DR track template (Hot Spots only; e.g. 'Breakthrough' → "Breakthrough").
     *  Title-cases + normalizes separators; empty for a missing type (Traditional nodes carry none → nothing renders). */
    protected trackTypeLabel(id?: string): string {
        return id ? id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
    }

    // ── DIRECTIVE-073 — the CURRENT mission's STATE MACHINE + GATES (dev/diagnostic). A READ-ONLY reflection
    //    of the real lifecycle state — it adds no state engine and touches no gate. Lives below the campaign
    //    flow above. Sources: the live mission tree (branch state ACTIVE/RESOLVED + resolution snapshot),
    //    deployedSet (D-027), the resolution's engaged/fieldWalk (D-034/D-037), pilots (infirmary), bays. ──
    /** The mission whose lifecycle the gate window tracks: the ACTIVE branch, else a RESOLVED branch still
     *  awaiting the field-walk (resolved but not yet walked → AAR done, outcome pending). Null = idle. */
    private readonly missionBranch = computed<MissionBranch | null>(() => {
        const tree = this.state.missionTree() ?? [];
        const active = tree.find((b) => b.state === 'ACTIVE');
        if (active) return active;
        // D-119 — a phase-advanced HS branch is finalized (leaves the rail → idle/CONTRACT). Traditional never sets
        // `advanced`, so `!undefined` keeps this byte-identical to the fieldWalk-only condition there.
        const pendingWalk = tree.filter((b) => b.state === 'RESOLVED' && b.resolution && !b.resolution.fieldWalk && !b.resolution.advanced);
        return pendingWalk.length ? pendingWalk[pendingWalk.length - 1] : null;
    });

    /** The lifecycle stages with real done/pending/blocked status; null when no active mission. Updates live
     *  (every source is a signal) as the mission advances: deploy set → claims/play → AAR resolve → walk. */
    protected readonly missionStage = computed<{ label: string; nodes: GateNode[] } | null>(() => {
        const cur = this.missionBranch();
        if (!cur) return null;
        const resolved = cur.state === 'RESOLVED';
        const walked = !!cur.resolution?.fieldWalk;
        // D-119 — Hot Spots settles the post-battle AT RESOLVE (SP economy — combat pay + Salvage% + damage, D-110b/c/d);
        // there is NO field walk, so a resolved HS mission is FINALIZED (never stuck "pending walk"). Traditional keeps
        // the walk semantics exactly: `settled`/the outcome node fall through to the untouched `walked` branches below.
        const hs = this.isHotspots();
        const advanced = !!cur.resolution?.advanced; // D-119 — HS phase-advanced marker
        const settled = hs ? resolved : walked;       // repair/infirmary "done" gate (Traditional: === walked, unchanged)
        const deployed = deployedSet(this.state.startingForce()).length;
        const injured = (this.state.pilots() ?? []).filter((p) => p.status === 'Injured').length;
        const inBays = (this.state.bays() ?? []).length;
        const tier = cur.resolution?.outcomeTier;
        const engaged = cur.resolution?.engaged?.bluforIds?.length ?? 0;
        const nodes: GateNode[] = [
            { key: 'brief', name: 'Brief', status: 'done', detail: `operation generated · ${cur.name}` },
            { key: 'deploy', name: 'Deploy', status: resolved || deployed > 0 ? 'done' : 'pending',
              detail: resolved ? `${engaged} fielded` : deployed > 0 ? `${deployed} unit(s) deployed` : 'set ≥1 unit to Deployed (Force Preview)' },
            { key: 'claims', name: 'Claims · play', status: resolved ? 'done' : deployed > 0 ? 'pending' : 'blocked',
              detail: resolved ? 'engagement played & resolved' : deployed > 0 ? 'players claim & play the engagement' : 'blocked — deploy a force first' },
            { key: 'aar', name: 'AAR · resolve', status: resolved ? 'done' : deployed > 0 ? 'pending' : 'blocked',
              detail: resolved ? `resolved · ${tier}` : deployed > 0 ? 'resolve the mission (Missions → Resolve)' : 'blocked — play the engagement first' },
            { key: 'repair', name: 'Repair & Salvage', status: settled ? 'done' : resolved ? 'pending' : 'blocked',
              detail: hs ? (resolved ? 'settled — SP salvage & damage (Repair & Refit)' : 'blocked — awaits resolve')
                         : (walked ? `${inBays} unit(s) in bays` : resolved ? 'applied on walk-the-field' : 'blocked — awaits AAR') },
            { key: 'infirmary', name: 'Infirmary', status: settled ? 'done' : resolved ? 'pending' : 'blocked',
              detail: hs ? (resolved ? 'settled — pilot outcomes recorded (SP loop)' : 'blocked — awaits resolve')
                         : (walked ? `${injured} pilot(s) recovering` : resolved ? 'pilot outcomes applied on walk' : 'blocked — awaits AAR') },
            { key: 'outcome', name: hs ? 'Advance phase' : 'Outcome · walk-the-field',
              status: hs ? (advanced ? 'done' : resolved ? 'pending' : 'blocked') : (walked ? 'done' : resolved ? 'pending' : 'blocked'),
              detail: hs ? (advanced ? 'phase advanced · clock moved to the next contract' : resolved ? 'advance the clock → next contract' : 'blocked — awaits resolve')
                         : (walked ? `confirmed · ${tier}` : resolved ? 'walk the field to finalize spoils + outcome' : 'blocked — awaits AAR') },
        ];
        return { label: `${cur.name} · ${cur.state}${resolved && tier ? ' · ' + tier : ''}`, nodes };
    });

    // ── DIRECTIVE-115 — the advisory rail: "do this next" + click-to-jump. Navigation only; never blocks/forces. ──
    /** The primary next-actionable step: the first pending stage, else the first blocked one (else null). */
    protected readonly nextGate = computed<GateNode | null>(() => {
        const s = this.missionStage();
        if (!s) return null;
        return s.nodes.find((n) => n.status === 'pending') ?? s.nodes.find((n) => n.status === 'blocked') ?? null;
    });

    /** Click a step → jump to the tab/sub where it's performed (per system). Advisory; the drawer closes if open. */
    protected goStep(n: GateNode): void {
        // D-119 — Hot Spots: the final step is "Advance phase" (advance the clock + return to CONTRACT), not a plain
        // navigate. Traditional's outcome node keeps navigating (the HS gate is false there → unchanged).
        if (n.key === 'outcome' && this.isHotspots()) { this.advancePhase.emit(); this.closeDrawer(); return; }
        const d = STEP_DEST[n.key];
        if (!d) return;
        this.navigate.emit(this.isHotspots() ? d.hotspots : d.traditional);
        this.closeDrawer();
    }

    /** Idle "Get started" pointer → the tab where you accept a contract / generate a mission. */
    protected goStart(): void {
        this.navigate.emit(this.isHotspots() ? { tab: 'chaos-contracts', sub: 'brief' } : { tab: 'missions', sub: 'brief' });
        this.closeDrawer();
    }

    // ── DIRECTIVE-119 P2 — the Hot Spots top-of-sheet PROCESS RAIL (locked-until-earned). Same state sources as the
    //    advisory rail; the earned frontier is expressed as the existing done/pending/blocked status (blocked = locked
    //    = ahead of the frontier = non-navigating; done/pending = at/behind = clickable, back-free). ──
    protected readonly hsRail = computed<GateNode[]>(() => {
        const contract = !!this.state.activeChaosContract();
        const cur = this.missionBranch();
        const resolved = cur?.state === 'RESOLVED';
        const hasActive = cur?.state === 'ACTIVE';
        const deployed = deployedSet(this.state.startingForce()).length;
        const st = (key: string): GateNode['status'] => {
            switch (key) {
                case 'force': return 'done'; // the merc command always exists in Hot Spots
                case 'contract': return contract ? 'done' : 'pending';
                case 'deploy': return !contract ? 'blocked' : (resolved || (hasActive && deployed > 0)) ? 'done' : 'pending';
                case 'lobby': return resolved ? 'done' : (hasActive && deployed > 0) ? 'pending' : 'blocked';
                case 'resolve': return resolved ? 'done' : (hasActive && deployed > 0) ? 'pending' : 'blocked';
                case 'aar': return resolved ? 'done' : 'blocked';
                case 'repair': return resolved ? 'done' : 'blocked'; // HS settles repair/infirmary at resolve (SP economy)
                case 'advance': return resolved ? 'pending' : 'blocked';
                default: return 'blocked';
            }
        };
        return HS_RAIL.map((s) => ({ key: s.key, name: s.label, status: st(s.key), detail: '' }));
    });
    /** The first pending step — the "do this next" ▶ highlight. */
    protected readonly hsRailNext = computed<string | null>(() => this.hsRail().find((n) => n.status === 'pending')?.key ?? null);

    /** Click a rail step: locked (blocked = ahead of frontier) does nothing; else navigate, or fire ADVANCE PHASE. */
    protected railStep(step: GateNode): void {
        if (step.status === 'blocked') return; // locked-until-earned — ahead steps are non-navigating
        const dest = HS_RAIL.find((s) => s.key === step.key)?.dest;
        if (!dest) return;
        if (dest === 'advance') { this.advancePhase.emit(); return; }
        this.navigate.emit(dest);
    }
}
