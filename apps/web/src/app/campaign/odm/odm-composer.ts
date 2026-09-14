/*
 * DIRECTIVE-ODM-18 Phase 3 — the GM MISSION COMPOSER (ODM fork only; mounted in the Missions tab).
 *
 * The GM authors a mission the way the roleplay produced it: a title, the player-facing brief prose, the
 * objective trio, the resolve-flag checklist, the operation's real time cost, and a hand-picked OpFor.
 * PUBLISH derives the player-safe record (odm-gm-mission.publishRecord — a field WHITELIST, so GM notes
 * cannot ride along) into the top-level snapshot, and the merged node set (§S-1) makes it a real tree node.
 *
 * THE NO-FORGE RULING HOLDS: nothing here rolls a force. The picker fields units the GM chooses from the
 * era-legal catalog (DOCTRINE §7c ≤2767 by default), with an explicit off-list toggle that is a deliberate
 * GM act, never a default. §S-6: the D-130 builder is NOT imported — engine-odm→engine-hs is a forbidden
 * fence edge; this is the fork's own small picker (pool + counts, no BV cap — the ruled scope).
 *
 * Drafts live under gmOnly (stripped for players); a draft NEVER writes a campaign-log line — that would
 * leak an unpublished mission's existence and title through a surface the fan does not strip.
 */
import { Component, ChangeDetectionStrategy, computed, inject, input, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import type { ProtoInstance } from '../force/force-generator';
import { ODM_LEGALITY_YEAR, medianOpDays, newGmDraft, publishBlockers, publishRecord, type OdmGmDraft } from './odm-gm-mission';
import type { OdmTreeData } from './odm-tree';

@Component({
    selector: 'bce-odm-composer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="cmp" data-testid="odm-composer">
            <div class="cmp-h">Compose an operation <span class="cmp-dim">— what the table's roleplay earned</span></div>
            @if (!draft()) {
                <button type="button" class="cmp-btn primary" (click)="startDraft()" data-testid="odm-cmp-new">+ New operation</button>
                @if (drafts().length) {
                    <div class="cmp-sub">Drafts</div>
                    @for (d of drafts(); track d.id) {
                        <div class="cmp-row">
                            <span class="cmp-t">{{ d.title || '(untitled)' }}</span>
                            <span class="cmp-dim">{{ d.published ? 'published' : 'draft' }}</span>
                            <button type="button" class="cmp-btn" (click)="edit(d)" data-testid="odm-cmp-edit">Edit</button>
                            @if (d.published) {
                                <!-- PANEL FIX — a published operation must be RETRACTABLE: discarding the draft
                                     alone would strand an un-editable, un-removable card on the players' board. -->
                                <button type="button" class="cmp-btn no" (click)="retract(d)" data-testid="odm-cmp-retract">Retract</button>
                            } @else {
                                <button type="button" class="cmp-btn no" (click)="discard(d)" data-testid="odm-cmp-discard">Discard</button>
                            }
                        </div>
                    }
                }
                @if (published().length) {
                    <div class="cmp-sub">Published — live on the board</div>
                    @for (m of published(); track m.id) {
                        <div class="cmp-row" data-testid="odm-cmp-published">
                            <span class="cmp-t">{{ m.title }}</span><span class="cmp-dim">{{ m.system }} · {{ m.opDays }} days · {{ m.opforForce.length }} OpFor</span>
                            <button type="button" class="cmp-btn no" (click)="retractById(m.id)" data-testid="odm-cmp-retract-pub">Retract</button>
                        </div>
                    }
                }
            } @else if (draft(); as d) {
                <div class="cmp-form">
                    <label class="cmp-f"><span>Title</span><input type="text" [value]="d.title" (input)="patch({ title: val($event) })" data-testid="odm-cmp-title" /></label>
                    <label class="cmp-f"><span>System</span><input type="text" [value]="d.system" (input)="patch({ system: val($event) })" data-testid="odm-cmp-system" /></label>
                    <label class="cmp-f"><span>Threat</span><input type="text" [value]="d.threat" (input)="patch({ threat: val($event) })" data-testid="odm-cmp-threat" /></label>
                    <label class="cmp-f wide"><span>Brief — the players read this verbatim</span><textarea rows="5" [value]="d.brief" (input)="patch({ brief: val($event) })" data-testid="odm-cmp-brief"></textarea></label>
                    <label class="cmp-f wide"><span>Primary objective</span><input type="text" [value]="d.objectives.primary" (input)="patchObj('primary', val($event))" data-testid="odm-cmp-obj1" /></label>
                    <label class="cmp-f wide"><span>Secondary objective</span><input type="text" [value]="d.objectives.secondary" (input)="patchObj('secondary', val($event))" data-testid="odm-cmp-obj2" /></label>
                    <label class="cmp-f wide"><span>Bonus objective</span><input type="text" [value]="d.objectives.bonus" (input)="patchObj('bonus', val($event))" data-testid="odm-cmp-obj3" /></label>
                    <label class="cmp-f"><span>Operation days — the real time cost</span><input type="number" min="1" [value]="d.opDays" (input)="patch({ opDays: +val($event) || 1 })" data-testid="odm-cmp-opdays" /></label>
                    <label class="cmp-f wide"><span>GM notes — GM-only: stored with the campaign, stripped from every player device</span><textarea rows="2" [value]="d.gmNotes" (input)="patch({ gmNotes: val($event) })" data-testid="odm-cmp-gmnotes"></textarea></label>
                </div>

                <div class="cmp-sub">Resolve flags — your checklist at resolve</div>
                @for (f of d.resolveFlags; track f.id) {
                    <div class="cmp-row"><span class="cmp-t">{{ f.label }}</span><button type="button" class="cmp-btn no" (click)="dropFlag(f.id)">remove</button></div>
                }
                <div class="cmp-row">
                    <input type="text" [value]="flagText()" (input)="flagText.set(val($event))" placeholder="e.g. the depot survived" data-testid="odm-cmp-flag" />
                    <button type="button" class="cmp-btn" (click)="addFlag()" data-testid="odm-cmp-flag-add">+ flag</button>
                </div>

                <div class="cmp-sub">Opposing force — hand-picked, {{ offList() ? 'off-list allowed' : 'era-legal only' }}</div>
                <div class="cmp-row">
                    <input type="text" [value]="q()" (input)="q.set(val($event))" placeholder="search the catalog…" data-testid="odm-cmp-search" />
                    <label class="cmp-chk"><input type="checkbox" [checked]="offList()" (change)="offList.set(!offList())" data-testid="odm-cmp-offlist" /> field any unit (off-list)</label>
                </div>
                @for (u of pool(); track u.key) {
                    <div class="cmp-row">
                        <span class="cmp-t">{{ u.name }}</span><span class="cmp-dim">{{ u.tons }}t · {{ u.bv }} BV · {{ u.year }}</span>
                        <button type="button" class="cmp-btn" (click)="addUnit(u)" data-testid="odm-cmp-add">+ add</button>
                    </div>
                }
                @if (d.opforForce.length) {
                    <div class="cmp-sub">Fielded — {{ d.opforForce.length }} units · {{ d.opforBv }} BV</div>
                    @for (i of d.opforForce; track i.instanceId) {
                        <div class="cmp-row" data-testid="odm-cmp-fielded">
                            <span class="cmp-t">{{ i.chassis }} {{ i.model }}</span>
                            <button type="button" class="cmp-btn no" (click)="removeUnit(i.instanceId)" data-testid="odm-cmp-remove">remove</button>
                        </div>
                    }
                }

                @if (note(); as nt) { <div class="cmp-note" data-testid="odm-cmp-note">{{ nt }}</div> }
            @if (blockers().length) { <div class="cmp-note" data-testid="odm-cmp-blockers">Publish needs {{ blockers().join(' · ') }}.</div> }
                <div class="cmp-acts">
                    <button type="button" class="cmp-btn" (click)="saveDraft()" data-testid="odm-cmp-save">Save draft</button>
                    <button type="button" class="cmp-btn primary" [disabled]="blockers().length > 0" (click)="publish()" data-testid="odm-cmp-publish">Publish ▸</button>
                    <button type="button" class="cmp-btn" (click)="close()" data-testid="odm-cmp-close">Close</button>
                </div>
            }
        </div>
    `,
    styles: [`
        .cmp { border: 1px solid #2a3340; border-radius: 6px; padding: 12px 14px; margin: 14px 0; }
        .cmp-h { font-weight: 700; letter-spacing: .04em; margin-bottom: 8px; }
        .cmp-sub { font-size: 11px; letter-spacing: .08em; opacity: .7; margin: 10px 0 4px; text-transform: uppercase; }
        .cmp-dim { font-size: 11px; opacity: .6; }
        .cmp-row { display: flex; gap: 10px; align-items: center; padding: 3px 0; border-top: 1px dashed #222b36; }
        .cmp-t { flex: 1; font-size: 12.5px; }
        .cmp-btn { font-size: 11px; padding: 2px 10px; cursor: pointer; }
        .cmp-btn.primary { font-weight: 700; }
        .cmp-btn.no { opacity: .8; }
        .cmp-form { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 6px; }
        .cmp-f { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
        .cmp-f.wide { flex-basis: 100%; }
        .cmp-f input, .cmp-f textarea { font: inherit; font-size: 12.5px; padding: 3px 6px; }
        .cmp-chk { font-size: 11px; display: flex; gap: 4px; align-items: center; }
        .cmp-note { font-size: 12px; color: #e0b070; margin-top: 8px; }
        .cmp-acts { display: flex; gap: 10px; margin-top: 10px; }
    `],
})
export class OdmComposerComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);

    /** The AUTHORED tree — read for the opDays default and the id-collision check only (the composer never
     *  touches authored nodes; §S-8: a composed id shadowing an authored one would break its gates silently). */
    readonly tree = input<OdmTreeData | null>(null);

    protected readonly draft = signal<OdmGmDraft | null>(null);
    protected readonly drafts = computed(() => this.state.gmMissionDrafts());
    protected readonly published = computed(() => this.state.odmGmMissions());
    protected readonly q = signal('');
    protected readonly offList = signal(false);
    protected readonly flagText = signal('');
    protected readonly note = signal<string | null>(null);

    protected val(e: Event): string { return (e.target as HTMLInputElement | HTMLTextAreaElement).value; }

    protected readonly blockers = computed(() => {
        const d = this.draft();
        if (!d) return [];
        const authored = new Set((this.tree()?.nodes ?? []).map((n) => n.id));
        const others = this.published().filter((m) => m.id !== d.id);
        return publishBlockers(d, authored, new Set(others.map((m) => m.id)), others.map((m) => m.title));
    });

    /** The era-legal pool (DOCTRINE §7c): catalog units at or before the legality year, unless the GM has
     *  deliberately opened the off-list toggle. Bounded to 40 rows — this is a picker, not a browser. */
    protected readonly pool = computed(() => {
        const needle = this.q().trim().toLowerCase();
        if (needle.length < 2) return [];
        const off = this.offList();
        const out: { key: string; name: string; chassis: string; model: string; mulId: number; tons: number; bv: number; year: number; type: string }[] = [];
        for (const u of this.data.getUnits()) {
            if (!off && (u.year ?? 9999) > ODM_LEGALITY_YEAR) continue;
            if (!u.name?.toLowerCase().includes(needle)) continue;
            out.push({ key: `${u.chassis}|${u.model}`, name: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv, year: u.year, type: u.type });
            if (out.length >= 40) break;
        }
        return out;
    });

    protected startDraft(): void {
        const rand = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`).replace(/-/g, '').slice(0, 10);
        this.draft.set(newGmDraft(rand, medianOpDays(this.tree()))); // §S-2's default, single-sourced in the pure module
    }
    protected edit(d: OdmGmDraft): void { this.draft.set({ ...d }); }
    protected close(): void { this.draft.set(null); }
    protected patch(p: Partial<OdmGmDraft>): void { this.draft.update((d) => (d ? { ...d, ...p } : d)); }
    protected patchObj(k: 'primary' | 'secondary' | 'bonus', v: string): void {
        this.draft.update((d) => (d ? { ...d, objectives: { ...d.objectives, [k]: v } } : d));
    }
    protected addFlag(): void {
        const label = this.flagText().trim();
        if (!label) return;
        const id = `f${Date.now().toString(36)}`;
        this.draft.update((d) => (d ? { ...d, resolveFlags: [...d.resolveFlags, { id, label }] } : d));
        this.flagText.set('');
    }
    protected dropFlag(id: string): void {
        this.draft.update((d) => (d ? { ...d, resolveFlags: d.resolveFlags.filter((f) => f.id !== id) } : d));
    }

    /** Mint in the SAME shape mintOdmSpec's rolled units use (deterministic ids, provenance 'gm-added',
     *  the additive odm* pilot fields) — the claims board and the resolve loss rows read that shape. */
    protected addUnit(u: { name: string; chassis: string; model: string; mulId: number; tons: number; bv: number; type: string }): void {
        this.draft.update((d) => {
            if (!d) return d;
            const i = d.nextIdx; // PANEL FIX — MONOTONIC, never the array length: a remove-then-add reused
                                 // an id, and one id on two hulls collides on the claims board, in
                                 // battle-reconcile's find(), and in the resolve loss rows.
            const inst = {
                instanceId: `odm-${d.id.slice(-8)}-${i}`,
                unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.mulId,
                tons: u.tons, bv: u.bv,
                unitType: (u.type === 'Tank' ? 'vehicle' : 'mech') as ProtoInstance['unitType'],
                condition: 'Active',
                provenance: { origin: 'gm-added' } as ProtoInstance['provenance'],
                ...({ odmPilotName: '', odmGunnery: 4, odmPiloting: 5, odmRole: 'line', odmFixed: false } as object),
            } as ProtoInstance;
            return { ...d, nextIdx: d.nextIdx + 1, opforForce: [...d.opforForce, inst], opforBv: d.opforBv + (u.bv || 0) };
        });
    }
    protected removeUnit(instanceId: string): void {
        this.draft.update((d) => {
            if (!d) return d;
            const gone = d.opforForce.find((i) => i.instanceId === instanceId);
            return { ...d, opforForce: d.opforForce.filter((i) => i.instanceId !== instanceId), opforBv: Math.max(0, d.opforBv - (gone?.bv ?? 0)) };
        });
    }

    /** Save the draft under gmOnly. NO campaign-log line: a log entry naming an unpublished mission would
     *  leak its existence and title to every joined player through a surface the fan does not strip. */
    protected saveDraft(): void {
        const d = this.draft();
        if (!d) return;
        const list = this.drafts();
        const i = list.findIndex((x) => x.id === d.id);
        this.state.setGmMissionDrafts(i >= 0 ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]);
        void this.store.persistCurrent();
    }
    protected discard(d: OdmGmDraft): void {
        this.state.setGmMissionDrafts(this.drafts().filter((x) => x.id !== d.id));
        void this.store.persistCurrent();
    }
    /** RETRACT — the published record AND its runtime branch come off the board together (the draft is kept
     *  so the GM can revise and re-publish). Refused once the operation has been begun or resolved: the
     *  campaign has a record of it by then, and silently deleting played history is not a retraction. */
    protected retract(d: OdmGmDraft): void { this.retractById(d.id); }
    protected retractById(id: string): void {
        if (this.state.odmActiveNodeId() === id || this.state.odmOutcomes()[id]) {
            this.note.set('That operation has already been played — it stays on the record.');
            return;
        }
        this.state.setOdmGmMissions(this.published().filter((m) => m.id !== id));
        this.state.setMissionTree((this.state.missionTree() ?? []).filter((b) => b.branchId !== id));
        this.state.setGmMissionDrafts(this.drafts().map((x) => (x.id === id ? { ...x, published: false } : x)));
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), {
            date: today, text: 'Operation withdrawn — the posting is off the board', kind: 'admin' as const,
        }]);
        this.note.set(null);
        void this.store.persistCurrent();
    }

    /** PUBLISH — derive the player-safe record, store it top-level (the merged node set turns it into a real
     *  tree node on the next reconcile), and write the audit line. Campaign state changed; the table may know. */
    protected publish(): void {
        const d = this.draft();
        if (!d || this.blockers().length) return;
        const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 };
        const rec = publishRecord(d, today);
        this.state.setOdmGmMissions([...this.published().filter((m) => m.id !== rec.id), rec]);
        const marked = { ...d, published: true };
        const list = this.drafts();
        const i = list.findIndex((x) => x.id === d.id);
        this.state.setGmMissionDrafts(i >= 0 ? list.map((x) => (x.id === d.id ? marked : x)) : [...list, marked]);
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), {
            date: today, text: `Operation posted — ${rec.title} (${rec.system || 'system unrecorded'}); the company has its orders`, kind: 'admin' as const,
        }]);
        this.draft.set(null);
        void this.store.persistCurrent();
    }
}
