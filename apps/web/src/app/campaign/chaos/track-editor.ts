/*
 * BCE — DIRECTIVE-IMPORT-6 Part C — ONE shared track editor. The hotspot builder's embedded per-track editor
 * (IMPORT-1 form: name · template · role · OpFor · situation · deployment · objectives with VP + kind + side ·
 * special rules · track end · salvage policy — the SUPERSET model, `DraftTrack`) extracted so the D-116 preset
 * builder mounts the SAME control instead of its own three plain-text objectives.
 *
 * DUMB input/output component: it edits ONE `DraftTrack` and emits the whole patched track on every change —
 * the PARENT owns the state (the hotspot builder's tab-provided HotspotIoState draft; the preset builder's local
 * draft signal). No injected services, no auth logic (each mount keeps its own gate: the hotspot builder's IMPORT-1
 * guest gate wraps its mount; the preset builder is ungated as before). Forks/nextTrack stay GENERATED (the linear
 * chain is auto-wired by draftToHotSpot; branching stays a JSON-import concern) — no fork UI here by design.
 *
 * STYLES are self-contained on purpose: `.cc-btn` is a scoped-global that only reaches children of
 * <bce-chaos-contracts> (styles.scss), and the preset builder mounts on the DASHBOARD — so the buttons/inputs/
 * objective rows replicate the hotspot-io + `.cc-btn.small` declarations here (encapsulated) to look identical in
 * the hotspot builder and correctly styled on the dashboard, WITHOUT adding another scoped-global.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { type DraftTrack, type DraftObjective, emptyObjective } from './hotspot-text-parser';

/** The track TEMPLATE labels offered by the editor (12 labels — display/steer only; a hot spot's play still runs the
 *  §18 track-setup archetype mapping). Moved here from hotspot-io (IMPORT-6 Part C) so both mounts share one list. */
export const TRACK_EDITOR_TEMPLATES = ['Objective', 'Assault', 'Defend', 'Strike', 'Recon', 'Duel', 'Extraction', 'Escort', 'Chase', 'Hold', 'Breakthrough', 'Retreat'] as const;

@Component({
    selector: 'bce-track-editor',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="hi-track">
            <!-- DECISION: the head row (index caption + Remove) is a LIST concern — hidden for a mount that edits exactly
                 one track (removable=false: the preset builder supplies its own form heading). -->
            @if (removable()) {
                <div class="hi-thead">
                    <b>{{ index() === 0 ? 'First track' : 'Track ' + (index() + 1) }}</b>
                    <button type="button" class="te-btn" (click)="remove.emit()" data-testid="te-remove">Remove</button>
                </div>
            }
            <div class="hi-grid">
                @if (showName()) {
                    <label>{{ nameLabel() }}<input class="hi-in" [value]="track().name" (input)="updTrackStr('name', $event)" data-testid="te-name"></label>
                }
                @if (showTemplate()) {
                    <label>Template
                        <select class="hi-in" (change)="updTrackStr('templateId', $event)">
                            @for (tp of templates; track tp) { <option [value]="tp" [selected]="tp === track().templateId">{{ tp }}</option> }
                        </select>
                    </label>
                }
                <label>Your role
                    <select class="hi-in" (change)="updTrackStr('playerRole', $event)">
                        <option value="" [selected]="track().playerRole === ''">(infer)</option>
                        <option value="attacker" [selected]="track().playerRole === 'attacker'">Attacker</option>
                        <option value="defender" [selected]="track().playerRole === 'defender'">Defender</option>
                    </select>
                </label>
                @if (showOpfor()) {
                    <label>OpFor faction<input class="hi-in" [value]="track().opforFaction" (input)="updTrackStr('opforFaction', $event)"></label>
                    <label>OpFor mix
                        <select class="hi-in" (change)="updTrackStr('armsMix', $event)">
                            <option value="MECH_ONLY" [selected]="track().armsMix === 'MECH_ONLY'">'Mechs only</option>
                            <option value="COMBINED_ARMS" [selected]="track().armsMix === 'COMBINED_ARMS'">Combined arms</option>
                        </select>
                    </label>
                }
            </div>
            <label class="hi-wide">Situation<textarea class="hi-ta" rows="2" [value]="track().situation" (input)="updTrackStr('situation', $event)" data-testid="te-situation"></textarea></label>
            <label class="hi-wide">Deployment<input class="hi-in" [value]="track().deployment" (input)="updTrackStr('deployment', $event)"></label>
            <div class="hi-objhd">Objectives (with VP) <button type="button" class="te-btn" (click)="addObj()" data-testid="te-add-obj">＋</button></div>
            @for (o of track().objectives; track $index; let oi = $index) {
                <div class="hi-obj">
                    <input class="hi-in obj" [value]="o.text" (input)="updObjStr(oi, 'text', $event)" placeholder="Objective" data-testid="te-obj-text">
                    <input class="hi-in vp" type="number" min="0" [value]="o.vp" (input)="updObjNum(oi, 'vp', $event)" title="Victory points (0 or more)">
                    <select class="hi-in kind" (change)="updObjStr(oi, 'kind', $event)">
                        <option value="primary" [selected]="o.kind === 'primary'">primary</option>
                        <option value="secondary" [selected]="o.kind === 'secondary'">secondary</option>
                        <option value="bonus" [selected]="o.kind === 'bonus'">bonus</option>
                    </select>
                    <select class="hi-in side" (change)="updObjStr(oi, 'side', $event)">
                        <option value="both" [selected]="o.side === 'both'">both</option>
                        <option value="attacker" [selected]="o.side === 'attacker'">attacker</option>
                        <option value="defender" [selected]="o.side === 'defender'">defender</option>
                    </select>
                    @if (track().objectives.length > 1) { <button type="button" class="te-btn" (click)="removeObj(oi)">×</button> }
                </div>
            }
            <label class="hi-wide">Special rules<input class="hi-in" [value]="track().specialRules" (input)="updTrackStr('specialRules', $event)"></label>
            <div class="hi-grid">
                <label>Track end<input class="hi-in" [value]="track().trackEnd" (input)="updTrackStr('trackEnd', $event)"></label>
                <label>Salvage policy<input class="hi-in" [value]="track().salvagePolicy" (input)="updTrackStr('salvagePolicy', $event)"></label>
            </div>
        </div>
    `,
    styles: [`
        /* Replicated VERBATIM from hotspot-io (the track block + the form's label/grid/input chrome it relied on) so the
           hotspot builder looks the same after the extraction; encapsulated here so the dashboard mount is styled too. */
        :host { display:block; }
        .hi-track { border:1.2px solid var(--ink); padding:8px; margin:8px 0; }
        .hi-thead { display:flex; justify-content:space-between; align-items:center; font-family:var(--type); font-size:12px; margin-bottom:6px; }
        .hi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
        .hi-track label { display:flex; flex-direction:column; font-family:var(--type); font-size:11px; color:var(--ink2); gap:3px; } /* same specificity as hotspot-io's ".hi-form label" → still beats .hi-wide's display:block */
        .hi-wide { display:block; margin-top:8px; }
        .hi-in, .hi-ta { font-family:var(--mono); font-size:12px; padding:6px; border:1.2px solid var(--ink); background:var(--paper); color:var(--ink); box-sizing:border-box; width:100%; }
        .hi-objhd { font-family:var(--type); font-size:11px; color:var(--ink2); margin:8px 0 4px; display:flex; gap:8px; align-items:center; }
        .hi-obj { display:flex; gap:5px; margin:3px 0; align-items:center; }
        .hi-in.obj { flex:1; } .hi-in.vp { width:64px; } .hi-in.kind, .hi-in.side { width:auto; }
        /* = styles.scss "bce-chaos-contracts .cc-btn" + ".cc-btn.small", merged (that scoped-global does not reach the dashboard mount). */
        .te-btn { font-family:var(--label); font-weight:600; letter-spacing:1.5px; font-size:11px; text-transform:uppercase; border:1.6px solid var(--ink); background:var(--paper2, var(--paper)); color:var(--ink); padding:7px 12px; cursor:pointer; min-height:34px; }
    `],
})
export class TrackEditorComponent {
    /** The track this editor renders + patches. The parent owns it; every edit comes back as an UPDATER the parent applies
     *  to ITS current copy (`trackChange`). */
    readonly track = input.required<DraftTrack>();
    /** Position in the parent's list — drives the "First track / Track n" caption (only shown when `removable`). */
    readonly index = input<number>(0);
    /** Show the Name field (a mount with its own name field can hide it). */
    readonly showName = input<boolean>(true);
    /** The Name field's label — the preset builder relabels it "Operation title" (its `track.name` IS the op title,
     *  and the preset has its own saved-list Name field beside it). */
    readonly nameLabel = input<string>('Name');
    /** Show the Template select (the preset builder uses its own `family` instead → false). */
    readonly showTemplate = input<boolean>(true);
    /** Show the hotspot-only OpFor faction + arms-mix inputs (the preset builder has its own OpFor sketch/arms fields → false). */
    readonly showOpfor = input<boolean>(true);
    /** Show the head row (index caption + Remove) — false for a mount that edits exactly one track. */
    readonly removable = input<boolean>(true);
    /** An UPDATER `(current) => next` the parent applies to its own copy of the track. Emitting an updater (not a
     *  pre-merged object) means two edits landing before the parent re-renders this OnPush child (rapid typing across
     *  fields, a script setting several inputs in one tick) can't clobber each other — each merges into the parent's
     *  CURRENT state, never into this child's possibly-stale input snapshot. */
    readonly trackChange = output<TrackUpdater>();
    /** The Remove button (parent drops the track from its list). */
    readonly remove = output<void>();

    protected readonly templates = TRACK_EDITOR_TEMPLATES;

    // ── the handlers, moved VERBATIM in behavior from hotspot-io: each is an immutable patch, now emitted to the parent ──
    private patch(p: Partial<DraftTrack>): void { this.trackChange.emit((t) => ({ ...t, ...p })); }
    protected updTrackStr(key: keyof DraftTrack, e: Event): void { this.patch({ [key]: (e.target as HTMLInputElement | HTMLSelectElement).value } as Partial<DraftTrack>); }

    private updObj(oi: number, p: Partial<DraftObjective>): void {
        this.trackChange.emit((t) => ({ ...t, objectives: t.objectives.map((o, j) => (j === oi ? { ...o, ...p } : o)) }));
    }
    protected updObjStr(oi: number, key: keyof DraftObjective, e: Event): void { this.updObj(oi, { [key]: (e.target as HTMLInputElement | HTMLSelectElement).value } as Partial<DraftObjective>); }
    protected updObjNum(oi: number, key: keyof DraftObjective, e: Event): void { this.updObj(oi, { [key]: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } as Partial<DraftObjective>); } // VP never negative (the VP-share tier)
    protected addObj(): void { this.trackChange.emit((t) => ({ ...t, objectives: [...t.objectives, emptyObjective()] })); }
    protected removeObj(oi: number): void {
        this.trackChange.emit((t) => (t.objectives.length > 1 ? { ...t, objectives: t.objectives.filter((_, j) => j !== oi) } : t)); // ≥1 objective row always stays
    }
}

/** IMPORT-6 Part C — the shape of a track edit: a pure updater over the parent's CURRENT track. */
export type TrackUpdater = (current: DraftTrack) => DraftTrack;
