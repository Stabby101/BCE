/*
 * FORKED FROM campaign/dashboard/flow/flow.ts @ 06b1947 — DIRECTIVE-ODM-4 (a DRIFT SURFACE).
 * Strips (Part A): generate()/canGenerate + every generate affordance (DOCTRINE §7b — ODM missions are NEVER
 * Forge-generated; Flow is read-only, Begin lives on the Missions board) · the D-119 HS rail variant · HS branches.
 * Adds (Part B): the AUTHORED tree's branching — render-only synthetic parent links + 4-tier edge labels derived
 * from tree.json gates (input from the dashboard; NEVER persisted — the runtime tree stays flat), true-4-tier
 * resolved badges from odmOutcomes, authored gate text in the veiled drawer, 'operation begun' rail wording.
 * ODM-5: the vertical axis is TIME — a semi-transparent NOW bar carries the campaign date and descends as
 * the clock advances; open windows above the bar (ordered by closes — most urgent nearest the bar), gate-locked
 * futures + time-keyed arrivals below it; EXPIRED nodes stamped "WINDOW CLOSED". Part D consolidation: this
 * component IS the operations board (mounted in the Missions tab; the Flow tab is gone) — BEGIN OPERATION and
 * View-briefing live on the node drawers as outputs the dashboard handles.
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal, output, input } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { MissionTreeService } from '../mission/mission-tree.service';
import { layoutTree } from '../dashboard/flow/flow-layout';
import type { MissionBranch } from '../mission/mission-tree';
import { deployedSet } from '../force/deployed';
import { closingSoon, isExpired, dateLE, type OdmDate, type OdmTreeData, type OdmTreeNode } from './odm-tree'; // ODM-4 + ODM-5
import { NODE_W, NODE_H, type FlowLayout } from '../dashboard/flow/flow-layout';
import { formatDate } from '../clock/campaign-clock';

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
// ODM-4 FORK: HS_RAIL const STRIPPED (the rail machinery is gone)

@Component({
    selector: 'bce-odm-flow',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-flow.html',
    styleUrl: '../dashboard/flow/flow.scss', // SHARED with the Classic flow (styles are not forked)
    styles: [`
        /* SPAWN-1 B5b — the board pans on a mouse drag (fork-owned; flow.scss untouched): a grab cursor at rest, grabbing while panning */
        .flow-pan { cursor: grab; } .flow-pan.panning { cursor: grabbing; user-select: none; }
        /* ODM-5 — the time-axis chrome (fork-owned; the shared flow.scss is untouched) */
        .now-bar { position: absolute; left: 0; right: 0; height: 34px; background: color-mix(in srgb, var(--warn) 14%, transparent);
                   border-top: 2px solid var(--warn); border-bottom: 1px dashed color-mix(in srgb, var(--warn) 45%, transparent);
                   display: flex; align-items: center; padding: 0 12px; pointer-events: none; z-index: 2; }
        .nb-date { font-family: var(--label); font-size: 12px; letter-spacing: 2px; color: var(--warn); font-weight: 700;
                   text-shadow: 0 1px 2px rgba(0,0,0,.5); }
        .fn-window { display: block; font-size: 10px; letter-spacing: .05em; color: var(--ink2); margin-top: 2px; }
        .fn-window.warn { color: var(--warn); font-weight: 700; }
        .fnode.closing-soon { border-color: var(--warn); box-shadow: 0 0 0 1px var(--warn) inset; }
        .fn-expired { display: block; font-size: 9.5px; letter-spacing: .04em; color: var(--ink2); opacity: .85; margin-top: 2px; }
        .fn-arrives { display: block; font-size: 10px; letter-spacing: .08em; color: var(--ink2); font-style: italic; margin-top: 2px; }
        .fd-note.warn { color: var(--warn); }
        /* ODM-8 — the reveal: lit fan on top, everything unrelated dims; chip-backed labels never collide
           (only one node's fan renders at a time). */
        .edge.lit { stroke-width: 2.2; opacity: 1; }
        .echip { fill: var(--paper, #141a21); stroke: var(--line, #2a3340); stroke-width: 1; opacity: .96; }
        .elabel.lit { font-weight: 700; }
        .fnode.dim { opacity: .32; filter: saturate(.5); }
        .fnode.lit { box-shadow: 0 0 0 2px var(--ok, #7fe3a0) inset; z-index: 3; }
    `],
    host: { '(document:keydown.escape)': 'closeDrawer()' },
})
export class OdmFlowComponent {
    /** ACTIVE node → open the dashboard's existing D-025 package overlay (one action, two surfaces). */
    readonly openPackage = output<void>();
    /** DIRECTIVE-115 — advisory rail: a step click → navigate the dashboard to where that step is done. */
    readonly navigate = output<{ tab: string; sub?: string }>();
    /** ODM-5 Part D — the tree IS the board: BEGIN OPERATION on an AVAILABLE node drawer. */
    readonly begin = output<string>();
    /** ODM-5 Part D — View briefing on an ACTIVE/AVAILABLE node drawer (packet-bound nodes). */
    readonly briefing = output<string>();
    /** DIRECTIVE-119 — Hot Spots only: the final "Advance phase" step → the dashboard advances the clock + returns to CONTRACT. */
    readonly advancePhase = output<void>();
    // ODM-4 FORK: the D-119 'rail' variant STRIPPED (HS-only; odm mounts the full view)
    /** ODM-4 — the authored tree (tree.json), bound in by the dashboard (it already loads it). */
    readonly odmTree = input<OdmTreeData | null>(null);

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
    /** ODM-4 Part B — the RENDER-ONLY authored view: synthetic parent links + 4-tier edge labels derived from
     *  tree.json gates (`when[0].node` = the primary parent; every authored gate has exactly one parent node).
     *  Never persisted — the runtime tree stays flat; this exists only for layoutTree/edges. */
    private readonly odmView = computed<MissionBranch[]>(() => {
        const data = this.odmTree();
        const tree = this.selectedTree();
        if (!data) return tree; // pack unreachable — render flat, never crash
        const byId = new Map(data.nodes.map((n) => [n.id, n]));
        return tree.map((b) => {
            const n = byId.get(b.branchId);
            if (!n?.gate) return b;
            const parent = n.gate.when[0]?.node ?? null;
            return { ...b, parentBranchId: parent && tree.some((x) => x.branchId === parent) ? parent : null,
                     outcomeGate: this.edgeLabel(n) as MissionBranch['outcomeGate'] };
        });
    });
    // ── ODM-5 — the TIME AXIS ──
    protected readonly odmNow = computed<OdmDate | null>(() => this.state.currentDate() ?? this.state.startDate() ?? null);
    protected readonly nowText = computed(() => { const n = this.odmNow(); return n ? formatDate(n) : ''; });
    private nodeDef(id: string): OdmTreeNode | undefined { return this.odmTree()?.nodes.find((x) => x.id === id); }
    /** ODM-18 P3 — a GM-COMPOSED operation (the merged node set's explicit kind). The drawer's authored
     *  copy asserts a packet exists; for a composed op that is a lie, and BEGIN gated on packetOf() would
     *  leave it unplayable (composed nodes carry packet:null BY DESIGN). */
    protected isComposed(id: string): boolean { return this.nodeDef(id)?.kind === 'gm-mission'; }
    /** ODM-6 (James ruling — the axis FLIP): NOW is the CEILING, the future flows DOWN. Bands top→bottom:
     *  [expired history — the ONLY thing above NOW] · [the NOW bar, carrying the date] · [AVAILABLE, hanging
     *  just below, most urgent leftmost/highest] · [gate-locked futures by tree depth] · [time-keyed arrivals
     *  by open date]. As the clock advances the field rises toward the bar; an un-begun node past its close
     *  passes UP THROUGH the ceiling and greys out as history. Render-orientation only — no data/clock change.
     *  Edges re-derived from the repositioned nodes (same bezier as flow-layout). barY < 0 = no time data. */
    protected readonly layout = computed<FlowLayout & { barY: number }>(() => {
        const base = layoutTree(this.odmView());
        const data = this.odmTree();
        const now = this.odmNow();
        if (!data || !now) return { ...base, barY: -1 };
        const ROW_H = 152, PAD = 26, BAR_H = 34, COLS = 3, COL_W = NODE_W + 30;
        const outcomes = this.state.odmOutcomes();
        const expired: typeof base.nodes = [];
        const avail: typeof base.nodes = [];
        const futures: typeof base.nodes = [];
        for (const n of base.nodes) {
            const def = this.nodeDef(n.branch.branchId);
            if (def && isExpired(def, n.branch.state, outcomes, now)) { expired.push(n); continue; }
            const arrived = !def?.window?.opens || dateLE(def.window.opens, now);
            (n.branch.state === 'LOCKED' || !arrived ? futures : avail).push(n);
        }
        const dnum = (d?: OdmDate | null) => d ? d.y * 10000 + d.m * 100 + d.d : Number.MAX_SAFE_INTEGER;
        const closesOf = (n: (typeof base.nodes)[0]) => dnum(this.nodeDef(n.branch.branchId)?.window?.closes);
        const opensOf = (n: (typeof base.nodes)[0]) => dnum(this.nodeDef(n.branch.branchId)?.window?.opens);
        const grid = (list: typeof base.nodes, out: typeof base.nodes, y0: number): number => {
            list.forEach((n, i) => out.push({ ...n, px: PAD + (i % COLS) * COL_W, py: y0 + Math.floor(i / COLS) * ROW_H }));
            return y0 + Math.ceil(list.length / COLS) * ROW_H;
        };
        const nodes: typeof base.nodes = [];
        // 1 — EXPIRED HISTORY above the ceiling (most recently expired nearest the bar)
        expired.sort((a, b) => closesOf(a) - closesOf(b));
        const barY = grid(expired, nodes, PAD) + (expired.length ? 8 : 0);
        // 2 — AVAILABLE hangs just below NOW: most urgent (earliest close) leftmost/highest
        avail.sort((a, b) => closesOf(a) - closesOf(b) || a.px - b.px);
        let y = grid(avail, nodes, barY + BAR_H + 24);
        // 3 — futures flow DOWN by time-to-come: gate-locked by tree depth, then time-keyed by open date
        const gated = futures.filter((n) => !!this.nodeDef(n.branch.branchId)?.gate).sort((a, b) => a.py - b.py || a.px - b.px);
        const timed = futures.filter((n) => !this.nodeDef(n.branch.branchId)?.gate).sort((a, b) => opensOf(a) - opensOf(b));
        y = grid(gated, nodes, y + 14);
        grid(timed, nodes, y + (timed.length ? 14 : 0));
        const pos = new Map(nodes.map((n) => [n.branch.branchId, n]));
        const edges = this.odmView().flatMap((b) => {
            const par = b.parentBranchId ? pos.get(b.parentBranchId) : undefined;
            const c = pos.get(b.branchId);
            if (!par || !c) return [];
            const x1 = par.px + NODE_W / 2, y1 = par.py + NODE_H, x2 = c.px + NODE_W / 2, y2 = c.py, my = (y1 + y2) / 2;
            // ODM-8: the label anchors just ABOVE its child card (inside the inter-row gap) — collision-free by construction
            return [{ gate: b.outcomeGate as string, path: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, lx: x2, ly: y2 - 14, from: b.parentBranchId as string, to: b.branchId }];
        });
        const width = Math.max(COLS * COL_W + PAD * 2, ...nodes.map((n) => n.px + NODE_W + PAD));
        const height = Math.max(...nodes.map((n) => n.py)) + NODE_H + PAD;
        return { nodes, edges, width, height, barY };
    });
    // ── ODM-8 — calendar clean at rest, branches on tap: edges render ONLY as the focused/hovered node's fan.
    //    Tap = the ODM-4 drawer AND the fan (one interaction, unified); hover/keyboard-focus previews the fan (a11y). ──
    protected readonly hoverId = signal<string | null>(null);
    protected readonly revealId = computed(() => this.focusedId() ?? this.hoverId());
    /** The revealed node's outcome fan — the only edges ever drawn (labels ride them, collision-free). */
    protected readonly litEdges = computed(() => {
        const id = this.revealId();
        if (!id) return [] as ReturnType<typeof this.layout>['edges'];
        return this.layout().edges.filter((e) => (e as { from?: string }).from === id);
    });
    protected isLit(branchId: string): boolean {
        const id = this.revealId();
        if (!id) return false;
        return branchId === id || this.litEdges().some((e) => (e as { to?: string }).to === branchId);
    }
    protected isDim(branchId: string): boolean { return !!this.revealId() && !this.isLit(branchId); }
    protected chipW(label: string): number { return label.length * 6.5 + 14; }

    /** Window chrome for a node card/drawer. */
    protected windowInfo(branchId: string): { closes: string; opens: string; soon: boolean; expired: boolean; expiredLine: string; arrives: boolean } {
        const def = this.nodeDef(branchId);
        const now = this.odmNow();
        const b = this.selectedTree().find((x) => x.branchId === branchId);
        const fmt = (d: OdmDate | null | undefined) => d ? formatDate(d) : '';
        if (!def || !now || !b) return { closes: '', opens: '', soon: false, expired: false, expiredLine: '', arrives: false };
        return {
            closes: fmt(def.window?.closes),
            opens: fmt(def.window?.opens),
            soon: closingSoon(def, now, b.state),
            expired: isExpired(def, b.state, this.state.odmOutcomes(), now),
            expiredLine: def.window?.expiredLine ?? 'the window closed',
            arrives: b.state === 'LOCKED' && !def.gate && !!def.window?.opens && !dateLE(def.window.opens, now),
        };
    }
    /** One ACTIVE at a time — BEGIN only when nothing runs (mirrors the board rule). */
    protected readonly canBegin = computed(() => !this.liveTree().some((b) => b.state === 'ACTIVE'));
    protected packetOf(branchId: string): string | null { return this.nodeDef(branchId)?.packet ?? null; }
    protected doBegin(id: string): void { if (this.canBegin()) { this.begin.emit(id); this.closeDrawer(); } }
    protected doBriefing(id: string): void { this.briefing.emit(id); this.closeDrawer(); }
    /** The 4-tier ODM edge vocabulary (never the Forge's threshold wording). */
    private edgeLabel(n: OdmTreeNode): string {
        const pretty: Record<string, string> = { FULL_SUCCESS: 'FULL SUCCESS', SUCCESS: 'SUCCESS', MISSION_FAILURE: 'FAILURE', CRITICAL_FAILURE: 'CRIT FAILURE' };
        const parts = (n.gate?.when ?? []).map((w) => {
            const t = (w.tier ?? []).map((x) => pretty[x] ?? x).join('/');
            const c = (w.flags?.length || w.notFlags?.length) ? (t ? '+ conditions' : 'conditions') : '';
            return [t, c].filter(Boolean).join(' ') || 'conditions';
        });
        return [...new Set(parts)].join(' or ');
    }
    protected odmGateLabel(branchId: string): string {
        const n = this.odmTree()?.nodes.find((x) => x.id === branchId);
        return n?.gate ? this.edgeLabel(n) : '';
    }
    /** The AUTHORED gate text (veiled drawer) — read live from tree.json, never from the branch. */
    protected odmGateText(branchId: string): string {
        return this.odmTree()?.nodes.find((x) => x.id === branchId)?.gate?.text ?? '';
    }
    /** The TRUE recorded 4-tier for a resolved authored node (falls back to the mapped ledger tier). */
    protected odmTierOf(branchId: string): string | null {
        return this.state.odmOutcomes()[branchId]?.tier ?? null;
    }
    protected readonly isEmpty = computed(() => this.contracts().length === 0);
    // ODM-4 FORK Part A: canGenerate/generate STRIPPED — no generate affordance exists in ODM Flow (DOCTRINE §7b)

    protected select(id: string): void {
        this.selectedId.set(id);
        this.focusedId.set(null);
    }

    // ── Drawer: one focused node at a time ──
    protected readonly focusedId = signal<string | null>(null);
    protected readonly focused = computed(() => this.selectedTree().find((b) => b.branchId === this.focusedId()) ?? null);
    // ── SPAWN-1 B5b — DRAG-TO-PAN on the board's background (James, 2026-09-11: 16 nodes and growing every week). The `.flow-pan` host
    //    already scrolls (overflow:auto · touch-action pan-x pan-y — wheel + thumb); a mouse drag now moves it too. Press on the canvas
    //    background (a press on a node is a click, never a pan), drag → the host's own scrollLeft/scrollTop follow; release ends it.
    //    Mouse pointers only — a touch pointer keeps the native scroll it already has. No re-layout, no transform: the scroll IS the pan.
    protected readonly panning = signal(false);
    private pan: { x: number; y: number; sl: number; st: number; id: number } | null = null;
    protected panStart(e: PointerEvent): void {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest('.fnode, button, a, select, input')) return; // a node press is a click
        const host = e.currentTarget as HTMLElement;
        this.pan = { x: e.clientX, y: e.clientY, sl: host.scrollLeft, st: host.scrollTop, id: e.pointerId };
        host.setPointerCapture?.(e.pointerId);
        this.panning.set(true);
    }
    protected panMove(e: PointerEvent): void {
        if (!this.pan || e.pointerId !== this.pan.id) return;
        const host = e.currentTarget as HTMLElement;
        host.scrollLeft = this.pan.sl - (e.clientX - this.pan.x);
        host.scrollTop = this.pan.st - (e.clientY - this.pan.y);
        e.preventDefault();
    }
    protected panEnd(e: PointerEvent): void {
        if (!this.pan || e.pointerId !== this.pan.id) return;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        this.pan = null; this.panning.set(false);
    }
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

    /** ODM-4 — the AVAILABLE drawer's only action: jump to the Missions board (BEGIN OPERATION lives there). */
    protected goBoard(): void {
        this.navigate.emit({ tab: 'missions', sub: 'brief' });
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
            { key: 'brief', name: 'Brief', status: 'done', detail: `operation begun · ${cur.name}` }, // ODM-4: authored packets are BEGUN, never generated
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

    // ODM-4 FORK: the D-119 HS PROCESS RAIL machinery (hsRail/hsRailNext/railStep) STRIPPED — never mounted here
}
