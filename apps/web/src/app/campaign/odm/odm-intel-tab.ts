/*
 * FORKED FROM campaign/intel/intel-tab.ts @ 0840d6b — DIRECTIVE-ODM-12 Part B (a DRIFT SURFACE).
 * INTEL over the AUTHORED CONTACT REGISTRY, not the forge. Classic's contacts machinery derives from
 * npcAssignments (the forge's per-mission NPC casting) and an "introduce from the registry" pool over
 * voice-cast NPCs — structurally unreachable under this pack (no forge casting runs), which is the bug.
 * Here: contacts.json (server-served, in-memory only — never persisted, never bundled) supplies
 *   · DAY-ONE entries, rendered from campaign creation — authored order, so the registry's first entry
 *     leads and renders KIA: the company's dead founder, because the name is the obligation;
 *   · FIRST-ENCOUNTER entries, absent entirely until their channel is used (GM-filed — see the note on
 *     the file affordance) — a contact you have not made is not intel you possess;
 *   · the CELL LADDER as world-slots: CONFIRMED/SIGNALED show their note, UNCONTACTED shows the world
 *     name and NOTHING else. An empty line in a ledger is a promise.
 * Enemy personalities are NOT in this registry and do not seed it — they file from their PACKETS on
 * first encounter in a later pass (OdmContact.source is reserved for it; nothing sets it yet).
 * The NOTEBOOK is kept verbatim (campaign records, no forge dependency) minus the forge-fed copy.
 * NB: comments AND strings here reach the served GM bundle — never name pack content (the odm2 leak-net).
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState, type CampaignStartDate, type IntelNote, type IntelState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { formatDate } from '../clock/campaign-clock';
import { CONTACT_STATUSES } from '../intel/contact-status'; // ODM-12b C2 — the pure module, not the Classic component
import { OdmContactsService, type OdmCell, type OdmContact } from './odm-contacts.service';
import type { MissionBranch } from '../mission/mission-tree';

interface ContactVm {
    id: string;
    name: string;
    rank: string;
    role: string;
    faction: string;
    relationship: string;
    reliability: string | null;
    location: string;
    contactMethod: string;
    dossier: string;
    status: string;          // GM override, else registry truth
    kia: boolean;
    filed: boolean;          // a first-encounter entry the GM has filed
    contact: OdmContact;
}
interface FeedItem {
    dateKey: number;
    dateText: string;
    // ODM-12b C1 — the fork's own vocabulary: no contract / purchase / sale kinds exist under this pack
    // (there is no employer, no market, and nothing is bought). Kinds seen here: mission | walk | repair
    // | admin | note | log — whatever the campaign log itself recorded, plus GM notes.
    kind: string;
    text: string;
    noteId?: string;   // present = a GM note (editable/deletable)
    npcName?: string;  // a note linked to a contact
}

const dateKey = (d?: CampaignStartDate): number => (d ? d.y * 10000 + (d.m + 1) * 100 + d.d : 0);

@Component({
    selector: 'bce-odm-intel-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-intel-tab.html',
    styleUrls: ['../intel/intel-tab.scss' /* SHARED */, './odm-intel-tab.scss'],
    host: { '(document:keydown.escape)': 'closeOverlays()' },
})
export class OdmIntelTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly registry = inject(OdmContactsService);

    protected readonly statuses = CONTACT_STATUSES;
    protected readonly mode = signal<'contacts' | 'notebook'>('contacts');

    /** Bumped when the registry lands (the lazy-pack pattern); `loaded` separates "not read yet" from
     *  "nothing on file" so the empty state never claims an absence it has not established. */
    private readonly ready = signal(0);
    protected readonly loaded = computed(() => { this.ready(); return this.registry.contacts() !== null; });
    constructor() {
        void this.registry.ensureLoaded().then(() => this.ready.update((v) => v + 1));
    }

    private intelState(): IntelState {
        return this.state.intel() ?? { statuses: {}, introduced: [], notes: [] };
    }
    private today(): CampaignStartDate {
        return this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
    }
    private filedIds(): string[] {
        return this.state.intel()?.odmFiled ?? [];
    }

    // ── every RESOLVED branch, live + archived (the notebook feed) ──
    private readonly allResolved = computed<{ branch: MissionBranch }[]>(() => {
        const out = new Map<string, MissionBranch>();
        for (const e of this.state.treeArchive() ?? []) for (const b of e.tree) if (b.state === 'RESOLVED' && b.resolution) out.set(b.branchId, b);
        for (const b of this.state.missionTree() ?? []) if (b.state === 'RESOLVED' && b.resolution) if (!out.has(b.branchId)) out.set(b.branchId, b);
        return [...out.values()].map((branch) => ({ branch }));
    });

    // ── CONTACTS — day-one always; first-encounter only once filed ──
    /** Registry status → the GM select's vocabulary. CLAMPED to CONTACT_STATUSES: a future registry value
     *  outside the list would render a select whose shown option disagrees with the model (the earned
     *  NG-SELECT class of bug) — an unknown status falls back to 'active' and the card keeps the registry
     *  truth in its own line. KIA maps to 'dead'; the card + dossier both still read KIA. */
    private vm(c: OdmContact, filed: boolean): ContactVm {
        const gm = this.state.intel()?.statuses[c.id];
        const mapped = c.status === 'KIA' ? 'dead' : c.status.toLowerCase();
        const known = (s: string): boolean => (CONTACT_STATUSES as readonly string[]).includes(s);
        const status = gm && known(gm) ? gm : known(mapped) ? mapped : 'active';
        return {
            id: c.id, name: c.name, rank: c.rank, role: c.role, faction: c.faction,
            relationship: c.relationship, reliability: c.reliability, location: c.location,
            contactMethod: c.contactMethod, dossier: c.dossier,
            status, kia: c.status === 'KIA', filed, contact: c,
        };
    }
    /** Registry order IS authored order (the dead founder leads). Day-one first, then filed entries. */
    protected readonly contacts = computed<ContactVm[]>(() => {
        this.ready();
        const all = this.registry.contacts() ?? [];
        const filed = new Set(this.filedIds());
        return [
            ...all.filter((c) => c.visibility === 'day-one').map((c) => this.vm(c, false)),
            ...all.filter((c) => c.visibility === 'first-encounter' && filed.has(c.id)).map((c) => this.vm(c, true)),
        ];
    });
    /** Unfiled first-encounter entries — the GM's "the channel has been used" list. They are NOT rendered
     *  as contacts until filed; this is the affordance, not a preview (no dossier text is shown). */
    protected readonly unfiled = computed<OdmContact[]>(() => {
        this.ready();
        const filed = new Set(this.filedIds());
        return (this.registry.contacts() ?? []).filter((c) => c.visibility === 'first-encounter' && !filed.has(c.id));
    });

    protected readonly cells = computed<OdmCell[]>(() => {
        this.ready();
        return this.registry.cells() ?? [];
    });

    /** GM status flip — persists immediately (registry status stays read-only pack truth). */
    protected setStatus(id: string, status: string): void {
        const cur = this.intelState();
        this.state.setIntel({ ...cur, statuses: { ...cur.statuses, [id]: status } });
        void this.store.persistCurrent();
    }

    // ── FILE a first-encounter contact (their channel was used / their operation began) ──
    protected readonly fileOpen = signal(false);
    protected file(id: string): void {
        const cur = this.intelState();
        if ((cur.odmFiled ?? []).includes(id)) return;
        this.state.setIntel({ ...cur, odmFiled: [...(cur.odmFiled ?? []), id] });
        this.fileOpen.set(false);
        void this.store.persistCurrent();
    }

    // ── explode (the full dossier) ──
    protected readonly exploded = signal<ContactVm | null>(null);
    protected explode(c: ContactVm): void {
        this.exploded.set(c);
    }
    protected closeOverlays(): void {
        this.exploded.set(null);
        this.fileOpen.set(false);
        this.deleteTarget.set(null);
    }

    // ── NOTEBOOK (kept verbatim; the note link list reads the registry) ──
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
        // ODM-12b C1 — the Classic "Closed out: {employer · mission}" CONTRACT entry is DROPPED from the
        // fork. Its label is built from contract.employer.name — employer vocabulary ODM-13 P3 purged —
        // and it is dead for a fresh pack campaign but live for any legacy save. The operations
        // themselves already file above as MISSION entries; nothing is lost but the employer's name.
        for (const n of this.state.intel()?.notes ?? []) {
            items.push({ dateKey: dateKey(n.date), dateText: formatDate(n.date), kind: 'note', text: n.text, noteId: n.noteId, npcName: n.npcId ? this.registry.byId(n.npcId)?.name : undefined });
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
