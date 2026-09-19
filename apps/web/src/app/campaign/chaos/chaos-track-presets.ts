import { Component, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { CHAOS_TRACK_FAMILIES, presetObjectives, type PresetTrack, type PresetObjective } from './chaos-track-preset';
import type { MissionTypeId } from '../contract/contract-terms';
import type { ObjectiveKind } from './hotspots-catalog';
import { type DraftTrack, emptyTrack, emptyObjective } from './hotspot-text-parser';
import { TrackEditorComponent, type TrackUpdater } from './track-editor';

interface Draft {
    name: string; family: MissionTypeId; location: string;
    composition: string; behavior: string;
    armsMix: '' | 'MECH_ONLY' | 'COMBINED_ARMS'; terrainBiome: string; operationDays: string; notes: string;
    track: DraftTrack;
}
const blank = (): Draft => ({ name: '', family: 'OBJECTIVE_RAID', location: '', composition: '', behavior: '', armsMix: '', terrainBiome: '', operationDays: '', notes: '', track: emptyTrack() });

@Component({
    selector: 'bce-chaos-track-presets',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TrackEditorComponent],
    template: `
        <div class="tp-head">
            <div><span class="l">Custom Tracks — build a track to play</span> <span class="tp-c">{{ presets().length }}</span></div>
            <div class="tp-actions">
                <button type="button" class="tp-btn go" (click)="toggleForm()">{{ formOpen() ? '× Close builder' : '+ Build a track' }}</button>
                <button type="button" class="tp-btn" (click)="startImport()">Import JSON</button>
                @if (presets().length) { <button type="button" class="tp-btn" (click)="exportAll()">Export all</button> }
            </div>
        </div>
        <p class="tp-ip">Build one track (a single scenario/battle) from your own rulebook, then choose it at Generate below, in place of the rolled track. This is one battle — not a contract. BCE ships no track content.</p>
        @if (presets().length) { <p class="tp-ip tp-ptr">Saved — pick it under “Pick a track to play” (My tracks) when you Generate an operation.</p> }

        @if (presets().length) {
            <div class="tp-list">
                @for (p of presets(); track p.id) {
                    <div class="tp-row">
                        <span class="tp-n">{{ p.name }}</span>
                        <span class="tp-fam">{{ familyLabel(p.family) }}</span>
                        <span class="tp-t">{{ p.title }}</span>
                        <span class="tp-rb">
                            <button type="button" class="tp-mini" (click)="editPreset(p)">Edit</button>
                            <button type="button" class="tp-mini" (click)="duplicate(p)">Duplicate</button>
                            <button type="button" class="tp-mini" (click)="exportOne(p)">Export</button>
                            <button type="button" class="tp-mini danger" (click)="remove(p.id)">Delete</button>
                        </span>
                    </div>
                }
            </div>
        } @else { <p class="tp-empty">No saved tracks. Build one from your rulebook, then Generate it from the operations board.</p> }

        @if (ioMode(); as mode) {
            <div class="tp-io">
                <div class="tp-io-h">{{ mode === 'export' ? 'Export — copy this JSON' : 'Import — paste track JSON' }}</div>
                <textarea class="tp-ta" [readonly]="mode === 'export'" [value]="ioText()" (input)="ioText.set($any($event.target).value)" rows="6" spellcheck="false"></textarea>
                @if (importError()) { <div class="tp-err">{{ importError() }}</div> }
                <div class="tp-io-a">
                    @if (mode === 'export') { <button type="button" class="tp-btn" (click)="copyIo()">{{ copied() ? 'Copied ✓' : 'Copy' }}</button> }
                    @if (mode === 'import') { <button type="button" class="tp-btn go" (click)="doImport()">Load</button> }
                    <button type="button" class="tp-btn ghost" (click)="ioMode.set(null)">Close</button>
                </div>
            </div>
        }

        @if (formOpen()) {
            <div class="tp-form">
                <div class="tp-form-h">{{ editingId() ? 'Edit track' : 'Build a track' }}</div>
                <div class="tp-grid">
                    <label class="tf"><span>Name <small>(saved-list label)</small></span><input type="text" [value]="d().name" (input)="set('name', $any($event.target).value)" maxlength="60" /></label>
                    <label class="tf"><span>Type</span>
                        <select (change)="set('family', $any($event.target).value)">
                            @for (f of families; track f.id) { <option [value]="f.id" [selected]="f.id === d().family">{{ f.label }}</option> }
                        </select>
                    </label>
                    <label class="tf"><span>Location <small>(optional)</small></span><input type="text" [value]="d().location" (input)="set('location', $any($event.target).value)" maxlength="60" /></label>
                    <label class="tf"><span>Terrain biome <small>(optional)</small></span><input type="text" [value]="d().terrainBiome" (input)="set('terrainBiome', $any($event.target).value)" maxlength="40" /></label>
                    <div class="tf wide tp-track">
                        <span>Track</span>
                        <bce-track-editor [track]="d().track" [showName]="true" [nameLabel]="'Operation title'" [showTemplate]="false" [showOpfor]="false" [removable]="false" (trackChange)="setTrack($event)" />
                    </div>
                    <label class="tf wide"><span>OpFor composition</span><input type="text" [value]="d().composition" (input)="set('composition', $any($event.target).value)" placeholder="e.g. a reinforced armor company" /></label>
                    <label class="tf wide"><span>OpFor behavior</span><input type="text" [value]="d().behavior" (input)="set('behavior', $any($event.target).value)" placeholder="e.g. dug-in defenders, counterattacking on loss" /></label>
                    <label class="tf"><span>Arms mix</span>
                        <select (change)="set('armsMix', $any($event.target).value)">
                            <option value="" [selected]="d().armsMix === ''">Campaign default</option>
                            <option value="MECH_ONLY" [selected]="d().armsMix === 'MECH_ONLY'">’Mechs only</option>
                            <option value="COMBINED_ARMS" [selected]="d().armsMix === 'COMBINED_ARMS'">Combined arms</option>
                        </select>
                    </label>
                    <label class="tf"><span>Operation days <small>(optional)</small></span><input type="number" min="0" [value]="d().operationDays" (input)="set('operationDays', $any($event.target).value)" /></label>
                    <label class="tf wide"><span>GM notes <small>(optional, never rendered)</small></span><input type="text" [value]="d().notes" (input)="set('notes', $any($event.target).value)" /></label>
                </div>
                <div class="tp-form-a">
                    <button type="button" class="tp-btn go" [disabled]="!canSave()" (click)="save()">{{ editingId() ? 'Save changes' : 'Save track' }}</button>
                    <button type="button" class="tp-btn ghost" (click)="cancelForm()">Cancel</button>
                    @if (!canSave()) { <span class="tp-hint">name · operation title · situation · an objective required</span> }
                </div>
            </div>
        }
    `,
    styles: [`
        :host { display:block; border:1.6px solid var(--ink); background:var(--paper2, var(--paper)); padding:14px 16px; margin-bottom:18px; }
        .tp-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
        .tp-head .l { font-family:var(--label); font-weight:600; letter-spacing:2px; font-size:13px; text-transform:uppercase; }
        .tp-c { font-family:var(--mono); font-size:11px; color:var(--stamp); border:1px solid var(--stamp); padding:1px 7px; margin-left:6px; }
        .tp-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .tp-ip { font-family:var(--type); font-size:12px; font-style:italic; color:var(--ink2); border-left:3px solid var(--stamp); padding:5px 10px; margin:10px 0 12px; }
        .tp-ptr { font-style:normal; color:var(--ink); border-left-color:var(--ok, #3a7d44); }
        .tp-btn { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:11px; text-transform:uppercase; border:1.5px solid var(--ink); background:var(--paper); color:var(--ink); padding:7px 12px; cursor:pointer; min-height:34px; }
        .tp-btn.go { border-color:var(--stamp); color:var(--stamp); } .tp-btn.go:hover:not(:disabled) { background:var(--stamp); color:var(--paper); }
        .tp-btn.ghost { background:transparent; } .tp-btn:disabled { opacity:.4; cursor:not-allowed; }
        .tp-list { display:flex; flex-direction:column; gap:5px; margin-bottom:10px; }
        .tp-row { display:grid; grid-template-columns:1.2fr auto 1.4fr auto; gap:12px; align-items:center; border:1.2px solid var(--ink2); padding:7px 11px; background:var(--paper); }
        .tp-n { font-family:var(--type); font-weight:600; font-size:14px; overflow-wrap:anywhere; }
        .tp-fam { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:10px; text-transform:uppercase; color:var(--ink2); border:1px solid var(--ink2); padding:1px 6px; }
        .tp-t { font-family:var(--type); font-size:12.5px; color:var(--ink2); overflow-wrap:anywhere; }
        .tp-rb { display:flex; gap:5px; }
        .tp-mini { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:10px; text-transform:uppercase; border:1.2px solid var(--ink2); background:transparent; color:var(--ink2); padding:4px 8px; cursor:pointer; min-height:30px; }
        .tp-mini:hover { border-color:var(--stamp); color:var(--stamp); } .tp-mini.danger:hover { border-color:var(--warn, #c2622a); color:var(--warn, #c2622a); }
        .tp-empty { font-family:var(--type); font-size:13px; color:var(--ink2); margin:4px 0 8px; }
        .tp-io { border:1.4px dashed var(--ink2); padding:10px 12px; margin:10px 0; }
        .tp-io-h { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:11px; text-transform:uppercase; color:var(--ink2); margin-bottom:6px; }
        .tp-ta, .tf textarea { width:100%; font-family:var(--mono); font-size:12px; border:1.3px solid var(--ink2); background:var(--paper); color:var(--ink); padding:7px; resize:vertical; box-sizing:border-box; }
        .tp-io-a { display:flex; gap:8px; margin-top:8px; }
        .tp-err { font-family:var(--type); font-size:12px; color:var(--warn, #c2622a); margin-top:6px; }
        .tp-form { border:1.4px solid var(--stamp); padding:12px 14px; margin-top:12px; background:var(--paper); }
        .tp-form-h { font-family:var(--stencil, var(--label)); font-weight:600; letter-spacing:1.5px; font-size:15px; text-transform:uppercase; margin-bottom:10px; }
        .tp-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; }
        .tf { display:flex; flex-direction:column; gap:3px; } .tf.wide { grid-column:1 / -1; }
        .tf span { font-family:var(--label); font-weight:600; letter-spacing:.5px; font-size:10.5px; text-transform:uppercase; color:var(--ink2); }
        .tf span small { font-weight:400; text-transform:none; letter-spacing:0; }
        .tf input, .tf select { font-family:var(--type); font-size:13px; padding:7px 8px; border:1.3px solid var(--ink); background:var(--paper); color:var(--ink); min-height:36px; }
        .tp-form-a { display:flex; align-items:center; gap:10px; margin-top:12px; }
        .tp-hint { font-family:var(--type); font-size:12px; color:var(--ink2); }
        @media (max-width:640px) { .tp-grid { grid-template-columns:1fr; } .tf.wide { grid-column:1; } .tp-row { grid-template-columns:1fr auto; } .tp-fam,.tp-t { grid-column:1; } }
    `],
})
export class ChaosTrackPresetsComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);

    protected readonly presets = this.state.chaosTrackPresets;
    protected readonly families = CHAOS_TRACK_FAMILIES;
    protected readonly d = signal<Draft>(blank());
    protected readonly formOpen = signal<boolean>(false);
    protected readonly editingId = signal<string | null>(null);
    protected readonly ioMode = signal<'export' | 'import' | null>(null);
    protected readonly ioText = signal<string>('');
    protected readonly importError = signal<string | null>(null);
    protected readonly copied = signal<boolean>(false);

    protected familyLabel(id: string): string { return this.families.find((f) => f.id === id)?.label ?? id; }
    protected set<K extends keyof Draft>(k: K, v: string): void { this.d.update((x) => ({ ...x, [k]: v as Draft[K] })); }
    protected setTrack(upd: TrackUpdater): void { this.d.update((x) => ({ ...x, track: upd(x.track) })); } // an updater over the CURRENT track (never a stale child snapshot)
    /** name · operation title (track.name) · situation · ≥1 non-blank objective (mirrors the hotspot builder's track rule). */
    protected readonly canSave = computed(() => { const x = this.d(); return !!x.name.trim() && !!x.track.name.trim() && !!x.track.situation.trim() && x.track.objectives.some((o) => o.text.trim()); });

    private uid(): string { return globalThis.crypto?.randomUUID?.() ?? 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
    private now(): number { try { return Date.now(); } catch { return 0; } }

    protected newPreset(): void { this.d.set(blank()); this.editingId.set(null); this.ioMode.set(null); this.formOpen.set(true); }
    /** Close the builder and DISCARD the in-progress draft (blank it + drop any edit target) so an accidental open
     *  — or a change of mind — leaves no partial state. Used by both the form's Cancel and the header toggle. */
    protected cancelForm(): void { this.d.set(blank()); this.editingId.set(null); this.formOpen.set(false); }
    /** The header button toggles the builder: open a fresh form when closed, cancel (discard) when open. */
    protected toggleForm(): void { if (this.formOpen()) this.cancelForm(); else this.newPreset(); }
    protected editPreset(p: PresetTrack): void {
        const objs: PresetObjective[] = presetObjectives(p);
        this.d.set({
            name: p.name, family: p.family, location: p.location ?? '',
            composition: p.opforSketch.composition, behavior: p.opforSketch.behavior,
            armsMix: p.armsMix ?? '', terrainBiome: p.terrainBiome ?? '', operationDays: p.operationDays != null ? String(p.operationDays) : '', notes: p.notes ?? '',
            track: {
                ...emptyTrack(), name: p.title, situation: p.situation,
                objectives: objs.length ? objs : [emptyObjective()], // DECISION: the editor always shows ≥1 row (its remove guard assumes it)
                deployment: p.deployment ?? '', specialRules: p.specialRules ?? '', trackEnd: p.trackEnd ?? '', salvagePolicy: p.salvagePolicy ?? '',
                playerRole: p.playerRole ?? '', templateId: p.templateId ?? emptyTrack().templateId,
            },
        });
        this.editingId.set(p.id); this.ioMode.set(null); this.formOpen.set(true);
    }

    private fromDraft(id: string, createdAt: number): PresetTrack {
        const x = this.d();
        const days = parseInt(x.operationDays, 10);
        const t = x.track;
        const trackObjectives: PresetObjective[] = t.objectives.filter((o) => o.text.trim()).map((o) => ({ text: o.text.trim(), vp: Number(o.vp) || 0, kind: o.kind, side: o.side }));
        // the legacy trio: first objective of each KIND; the primary slot falls back to the first objective when no primary-kind
        // row exists (mirrors synthSeedFromPreset) — old readers (AAR / filledObjectives) never see a blank primary.
        const firstOfKind = (k: ObjectiveKind): string => trackObjectives.find((o) => o.kind === k)?.text || (k === 'primary' ? trackObjectives[0]?.text : '') || '';
        return {
            id, name: x.name.trim(), family: x.family, title: t.name.trim(),
            location: x.location.trim() || undefined,
            situation: t.situation.trim(),
            objectives: { primary: firstOfKind('primary'), secondary: firstOfKind('secondary'), bonus: firstOfKind('bonus') },
            trackObjectives,
            opforSketch: { composition: x.composition.trim(), behavior: x.behavior.trim() },
            armsMix: x.armsMix || undefined,
            terrainBiome: x.terrainBiome.trim() || undefined,
            operationDays: Number.isFinite(days) && days > 0 ? days : undefined,
            notes: x.notes.trim() || undefined,
            // the optional track-sheet fields (blank → absent, like location/notes)
            deployment: t.deployment.trim() || undefined,
            specialRules: t.specialRules.trim() || undefined,
            trackEnd: t.trackEnd.trim() || undefined,
            salvagePolicy: t.salvagePolicy.trim() || undefined,
            playerRole: t.playerRole || undefined,
            // templateId is NOT written by the form: the Template select is hidden in this mount (the preset's `family` drives
            // the seed's template), so persisting the DraftTrack default ('Objective') would only mislead. (JSON import keeps it.)
            createdAt,
        };
    }

    protected save(): void {
        if (!this.canSave()) return;
        const id = this.editingId();
        if (id) { const prev = this.presets().find((p) => p.id === id); this.state.updateChaosTrackPreset(this.fromDraft(id, prev?.createdAt ?? this.now())); }
        else this.state.addChaosTrackPreset(this.fromDraft(this.uid(), this.now()));
        void this.store.persistCurrent();
        this.formOpen.set(false);
    }
    protected duplicate(p: PresetTrack): void {
        this.state.addChaosTrackPreset({ ...p, id: this.uid(), name: `${p.name} (copy)`, createdAt: this.now() });
        void this.store.persistCurrent();
    }
    protected remove(id: string): void { this.state.removeChaosTrackPreset(id); void this.store.persistCurrent(); if (this.editingId() === id) this.cancelForm(); }

    // ── Export / Import (portable JSON — no global store) ──
    private show(text: string): void { this.ioText.set(text); this.copied.set(false); this.importError.set(null); this.ioMode.set('export'); }
    protected exportOne(p: PresetTrack): void { this.show(JSON.stringify([p], null, 2)); }
    protected exportAll(): void { this.show(JSON.stringify(this.presets(), null, 2)); }
    protected startImport(): void { this.ioText.set(''); this.importError.set(null); this.ioMode.set('import'); }
    protected copyIo(): void { try { void navigator.clipboard?.writeText(this.ioText()); this.copied.set(true); } catch { /* */ } }
    protected doImport(): void {
        this.importError.set(null);
        let parsed: unknown;
        try { parsed = JSON.parse(this.ioText()); } catch { this.importError.set('Not valid JSON.'); return; }
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const valid: PresetTrack[] = [];
        for (const raw of arr) {
            const o = raw as Partial<PresetTrack>;
            if (!o || typeof o.name !== 'string' || typeof o.title !== 'string' || typeof o.situation !== 'string' || !o.objectives || !o.opforSketch) continue;
            // hand-edited/corrupt import can't inject a string operationDays (→ NaN in the dossier), an out-of-range
            // vehicleShare, or an invalid family/armsMix into the generator.
            const family = this.families.find((f) => f.id === o.family)?.id;
            if (!family) continue; // skip an entry whose mission family isn't a known MissionTypeId
            const days = typeof o.operationDays === 'number' && Number.isFinite(o.operationDays) && o.operationDays > 0 ? Math.floor(o.operationDays) : undefined;
            const vShare = typeof o.vehicleShare === 'number' && Number.isFinite(o.vehicleShare) ? Math.max(0, Math.min(1, o.vehicleShare)) : undefined;
            const arms = o.armsMix === 'MECH_ONLY' || o.armsMix === 'COMBINED_ARMS' ? o.armsMix : undefined;
            // per-field coercion (a legacy JSON without them still imports; presetObjectives hydrates it on read).
            // Rows need a non-blank text; vp coerced to a number; an unknown kind/side falls back to primary/both.
            const isKind = (k: unknown): k is ObjectiveKind => k === 'primary' || k === 'secondary' || k === 'bonus';
            const isSide = (s: unknown): s is 'both' | 'attacker' | 'defender' => s === 'both' || s === 'attacker' || s === 'defender';
            const rows: Partial<PresetObjective>[] = Array.isArray(o.trackObjectives) ? (o.trackObjectives as unknown[]).map((r) => (r && typeof r === 'object' ? (r as Partial<PresetObjective>) : {})) : [];
            const trackObjectives: PresetObjective[] = rows
                .filter((r) => typeof r.text === 'string' && r.text.trim())
                .map((r) => ({ text: r.text as string, vp: Number(r.vp) || 0, kind: isKind(r.kind) ? r.kind : 'primary', side: isSide(r.side) ? r.side : 'both' }));
            const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
            valid.push({
                id: this.uid(), name: o.name, family, title: o.title,
                location: typeof o.location === 'string' ? o.location : undefined,
                situation: o.situation,
                objectives: { primary: o.objectives.primary ?? '', secondary: o.objectives.secondary ?? '', bonus: o.objectives.bonus ?? '' },
                ...(trackObjectives.length ? { trackObjectives } : {}),
                opforSketch: { composition: o.opforSketch.composition ?? '', behavior: o.opforSketch.behavior ?? '' },
                armsMix: arms, vehicleShare: vShare,
                terrainBiome: typeof o.terrainBiome === 'string' ? o.terrainBiome : undefined,
                operationDays: days,
                notes: typeof o.notes === 'string' ? o.notes : undefined,
                deployment: str(o.deployment), specialRules: str(o.specialRules), trackEnd: str(o.trackEnd), salvagePolicy: str(o.salvagePolicy),
                playerRole: o.playerRole === 'attacker' || o.playerRole === 'defender' ? o.playerRole : undefined,
                templateId: str(o.templateId),
                createdAt: this.now(),
            });
        }
        if (!valid.length) { this.importError.set('No valid track presets found in that JSON.'); return; }
        this.state.setChaosTrackPresets([...this.presets(), ...valid]);
        void this.store.persistCurrent();
        this.ioMode.set(null);
    }
}
