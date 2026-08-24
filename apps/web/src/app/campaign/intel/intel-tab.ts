/*
 * BCE — INTEL tab (DIRECTIVE-034, T-031 slice 1). What the campaign KNOWS, earned through play.
 * CONTACTS: every NPC met through missions (DERIVED from the persistent npcAssignments — no new
 * bookkeeping) + GM-introduced ones from the unmet registry pool (era/faction-filtered, never
 * dead-ends); dossier cards with missions-appeared (derived from the D-034 resolution snapshots +
 * the live spec) and a GM-mutable STATUS persisting via persistCurrent. NOTES: the campaign
 * notebook — auto-entries surfaced from the campaignLog + resolutions + closed contracts (typed,
 * dated), interleaved chronologically with GM free-text notes (the new intel snapshot field).
 * STATUS IS DATA ONLY this slice — the status-aware generation seam is marked at setStatus().
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState, type CampaignStartDate, type IntelNote, type IntelState } from '../new-campaign-state';
import { ForgePackService } from '../mission/forge-pack.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { eraTag, factionTags } from '../mission/forge-select';
import { formatDate } from '../clock/campaign-clock';
import type { ForgeNpc } from '../mission/forge-types';
import type { MissionBranch } from '../mission/mission-tree';

export const CONTACT_STATUSES = ['active', 'burned', 'dead', 'captured', 'promoted'] as const;

interface ContactVm {
    npcId: string;
    name: string;
    callsign: string;
    archetype: string;
    factions: string;
    status: string;
    missions: string[];
    gmIntroduced: boolean;
    npc: ForgeNpc;
}
interface FeedItem {
    dateKey: number;
    dateText: string;
    kind: string;      // contract | mission | purchase | sale | walk | repair | admin | note | log
    text: string;
    noteId?: string;   // present = a GM note (editable/deletable)
    npcName?: string;  // a note linked to a contact
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const dateKey = (d?: CampaignStartDate): number => (d ? d.y * 10000 + (d.m + 1) * 100 + d.d : 0);

@Component({
    selector: 'bce-intel-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './intel-tab.html',
    styleUrl: './intel-tab.scss',
    host: { '(document:keydown.escape)': 'closeOverlays()' },
})
export class IntelTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly pack = inject(ForgePackService);
    private readonly store = inject(CampaignSaveStore);

    protected readonly statuses = CONTACT_STATUSES;
    protected readonly mode = signal<'contacts' | 'notebook'>('contacts');

    /** Bumped when the lazy pack lands (the mission-package pattern). */
    private readonly ready = signal(this.pack.isLoaded() ? 1 : 0);
    constructor() {
        if (!this.pack.isLoaded()) void this.pack.ensureLoaded().then(() => this.ready.update((v) => v + 1));
    }

    private intelState(): IntelState {
        return this.state.intel() ?? { statuses: {}, introduced: [], notes: [] };
    }
    private today(): CampaignStartDate {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
    }

    // ── every RESOLVED branch, live + archived (the notebook + missions-appeared feed) ──
    private readonly allResolved = computed<{ branch: MissionBranch; }[]>(() => {
        const out = new Map<string, MissionBranch>();
        for (const e of this.state.treeArchive() ?? []) for (const b of e.tree) if (b.state === 'RESOLVED' && b.resolution) out.set(b.branchId, b);
        for (const b of this.state.missionTree() ?? []) if (b.state === 'RESOLVED' && b.resolution) if (!out.has(b.branchId)) out.set(b.branchId, b);
        return [...out.values()].map((branch) => ({ branch }));
    });

    /** Missions each NPC appeared in — derived from the D-034 resolution snapshots (flag → the
     *  campaign-stable npcAssignments) + the live spec's flags. No separate bookkeeping. */
    private readonly missionsByNpc = computed<Record<string, string[]>>(() => {
        const assigns = this.state.npcAssignments();
        const out: Record<string, string[]> = {};
        const add = (flag: string, label: string): void => {
            const id = assigns[flag];
            if (!id) return;
            (out[id] ??= []);
            if (!out[id].includes(label)) out[id].push(label);
        };
        for (const { branch } of this.allResolved()) for (const f of branch.resolution?.aar?.npcFlags ?? []) add(f, branch.name);
        const spec = this.state.missionSpec();
        const active = (this.state.missionTree() ?? []).find((b) => b.state === 'ACTIVE');
        if (spec?.forge) for (const f of spec.forge.npcFlags) add(f, `${active?.name ?? spec.typeName} (active)`);
        return out;
    });

    // ── CONTACTS ──
    protected readonly contacts = computed<ContactVm[]>(() => {
        this.ready();
        const intel = this.state.intel();
        const met = new Map<string, boolean>(); // npcId → gmIntroduced
        for (const id of Object.values(this.state.npcAssignments())) met.set(id, false);
        for (const id of intel?.introduced ?? []) if (!met.has(id)) met.set(id, true);
        const missions = this.missionsByNpc();
        return [...met.entries()]
            .map(([npcId, gmIntroduced]) => {
                const npc = this.pack.npcById(npcId);
                if (!npc) return null;
                return {
                    npcId,
                    name: npc.name,
                    callsign: npc.callsign ?? '',
                    archetype: npc.archetype.replace(/-/g, ' '),
                    factions: npc.factionAffinity.join(' · '),
                    status: intel?.statuses[npcId] ?? npc.status ?? 'active',
                    missions: missions[npcId] ?? [],
                    gmIntroduced,
                    npc,
                } as ContactVm;
            })
            .filter((c): c is ContactVm => !!c)
            .sort((a, b) => b.missions.length - a.missions.length || a.name.localeCompare(b.name));
    });

    /** GM status flip — persists immediately. SEAM (T-031 slice 3): status is DATA ONLY this slice;
     *  generation does not read it yet (status-aware casting / recurring-villain logic lands there). */
    protected setStatus(npcId: string, status: string): void {
        const cur = this.intelState();
        this.state.setIntel({ ...cur, statuses: { ...cur.statuses, [npcId]: status } });
        void this.store.persistCurrent();
    }

    // ── INTRODUCE (the unmet registry pool, era/faction-filtered, never dead-ends) ──
    protected readonly introduceOpen = signal(false);
    protected readonly introducePool = computed<ForgeNpc[]>(() => {
        this.ready();
        if (!this.introduceOpen()) return [];
        const met = new Set(this.contacts().map((c) => c.npcId));
        const era = eraTag(this.state.currentDate()?.y ?? this.state.startDate()?.y ?? 3025);
        const ac = this.state.acceptedContract();
        const tags = [
            ...factionTags(this.state.faction(), ac?.employer.name, ac?.target),
            ...(this.state.force() === 'MERC' ? ['merc'] : []),
        ].map(norm);
        const unmet = this.pack.npcs().filter((n) => !met.has(n.npcId));
        const eraFit = unmet.filter((n) => n.eraFit.some((e) => norm(e) === 'any' || norm(e) === norm(era)));
        const facFit = eraFit.filter((n) => n.factionAffinity.some((f) => tags.includes(norm(f))));
        return (facFit.length ? facFit : eraFit.length ? eraFit : unmet).slice().sort((a, b) => a.name.localeCompare(b.name));
    });
    protected introduce(npcId: string): void {
        const cur = this.intelState();
        if (cur.introduced.includes(npcId)) return;
        this.state.setIntel({ ...cur, introduced: [...cur.introduced, npcId] });
        this.introduceOpen.set(false);
        void this.store.persistCurrent();
    }

    // ── explode (the full dossier) ──
    protected readonly exploded = signal<ContactVm | null>(null);
    protected explode(c: ContactVm): void {
        this.exploded.set(c);
    }
    protected closeOverlays(): void {
        this.exploded.set(null);
        this.introduceOpen.set(false);
        this.deleteTarget.set(null);
    }

    // ── NOTEBOOK ──
    protected readonly feed = computed<FeedItem[]>(() => {
        const items: FeedItem[] = [];
        for (const e of this.state.campaignLog() ?? []) {
            items.push({ dateKey: dateKey(e.date), dateText: formatDate(e.date), kind: e.kind ?? 'log', text: e.text });
        }
        for (const { branch } of this.allResolved()) {
            const r = branch.resolution!;
            items.push({
                dateKey: dateKey(r.resolvedDate), dateText: r.resolvedDate ? formatDate(r.resolvedDate) : '—',
                kind: 'mission', text: `Operation ${branch.name} resolved — ${r.outcomeTier}${r.override ? ' (GM override)' : ''}`,
            });
        }
        for (const e of this.state.treeArchive() ?? []) {
            items.push({ dateKey: dateKey(e.completedDate), dateText: e.completedDate ? formatDate(e.completedDate) : '—', kind: 'contract', text: `Closed out: ${e.label}` });
        }
        const ac = this.state.acceptedContract();
        if (ac?.acceptedDate) {
            items.push({
                dateKey: dateKey(ac.acceptedDate), dateText: formatDate(ac.acceptedDate), kind: 'contract',
                text: `${this.state.force() === 'MERC' ? 'Contract accepted' : 'Orders acknowledged'}: ${ac.missionName} — ${ac.employer.name}`,
            });
        }
        for (const n of this.state.intel()?.notes ?? []) {
            items.push({ dateKey: dateKey(n.date), dateText: formatDate(n.date), kind: 'note', text: n.text, noteId: n.noteId, npcName: this.pack.npcById(n.npcId)?.name });
        }
        return items.sort((a, b) => b.dateKey - a.dateKey);
    });

    protected readonly noteText = signal('');
    protected readonly noteNpc = signal('');
    protected addNote(): void {
        const text = this.noteText().trim();
        if (!text) return;
        const cur = this.intelState();
        const note: IntelNote = { noteId: `note-${Math.floor(Math.random() * 1e9)}`, date: this.today(), text, ...(this.noteNpc() ? { npcId: this.noteNpc() } : {}) };
        this.state.setIntel({ ...cur, notes: [...cur.notes, note] });
        this.noteText.set('');
        this.noteNpc.set('');
        void this.store.persistCurrent();
    }

    protected readonly editingId = signal<string | null>(null);
    protected readonly editText = signal('');
    protected startEdit(it: FeedItem): void {
        if (!it.noteId) return;
        this.editingId.set(it.noteId);
        this.editText.set(it.text);
    }
    protected cancelEdit(): void {
        this.editingId.set(null);
    }
    protected saveEdit(): void {
        const id = this.editingId();
        const text = this.editText().trim();
        if (!id || !text) return;
        const cur = this.intelState();
        this.state.setIntel({ ...cur, notes: cur.notes.map((n) => (n.noteId === id ? { ...n, text } : n)) });
        this.editingId.set(null);
        void this.store.persistCurrent();
    }

    protected readonly deleteTarget = signal<string | null>(null);
    protected askDelete(noteId: string): void {
        this.deleteTarget.set(noteId);
    }
    protected confirmDelete(): void {
        const id = this.deleteTarget();
        if (!id) return;
        const cur = this.intelState();
        this.state.setIntel({ ...cur, notes: cur.notes.filter((n) => n.noteId !== id) });
        this.deleteTarget.set(null);
        void this.store.persistCurrent();
    }
}
