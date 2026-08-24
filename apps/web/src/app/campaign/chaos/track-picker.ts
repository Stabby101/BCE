/*
 * BCE — DIRECTIVE-IMPORT-5 (Part A) — the shared TRACK PICKER. Extracted from the dashboard operations board's inline
 * D-132 picker so the SAME control can also sit on the active-contract card ("▶ Play a track", next to "Advance a
 * month") — the book's two moves side by side. Given an AVAILABLE branch id, it offers every track source (This hot
 * spot / My tracks / Universal §18 / 🎲 Random) and drives the existing MissionTreeService.generateBranch({presetSeed})
 * override path. Works for a custom hot spot with ZERO embedded tracks (the §18 + Random paths need no authored track).
 * Pure presentation over already-shared helpers — no new state, no schema change.
 */
import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { MissionTreeService } from '../mission/mission-tree.service';
import { HotSpotsCatalogService, hotspotSeedId } from './hotspots-catalog';
import { synthSeedFromPreset } from './chaos-track-preset';
import { synthSeedFromTemplate, UNIVERSAL_TRACK_LIBRARY, type TrackTemplateKey } from './track-setup';

@Component({
    selector: 'bce-track-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="tp-pick">
            <!-- IMPORT-5 — no fixed DOM id: this shared component can mount twice on the Contracts tab (active-card +
                 operations board) for the same branch; a static id would collide. The select carries its aria-label. -->
            <span class="tp-lbl">Pick a track to play:</span>
            <select #tsel class="tp-sel" data-testid="cc-track-select" aria-label="Track to play">@for (g of trackGroups(); track g.group) { <optgroup [label]="g.group">@for (c of g.items; track c.value) { <option [value]="c.value">{{ c.name }}</option> }</optgroup> }</select>
            <button type="button" class="tp-btn go" [disabled]="!canGenerate()" (click)="playChosen(tsel.value)" data-testid="cc-generate-chosen">Play this track &#9656;</button>
            <button type="button" class="tp-btn" [disabled]="!canGenerate()" (click)="playRandom()" data-testid="cc-random-track" title="Pick a random track (the hot spot's own tracks first, else the library)">&#127922; Random</button>
        </div>
    `,
    styles: [`
        .tp-pick { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; }
        .tp-lbl { font-family:var(--label); font-weight:600; letter-spacing:.06em; font-size:11px; text-transform:uppercase; color:var(--ink2); }
        .tp-sel { font:inherit; padding:6px 8px; border:1.3px solid var(--ink); background:var(--paper); color:var(--ink); min-height:34px; max-width:220px; }
        .tp-btn { font-family:var(--label); font-weight:600; letter-spacing:1px; font-size:11px; text-transform:uppercase; border:1.5px solid var(--ink); background:var(--paper); color:var(--ink); padding:7px 12px; cursor:pointer; min-height:34px; }
        .tp-btn.go { border-color:var(--stamp); color:var(--stamp); } .tp-btn.go:hover:not(:disabled) { background:var(--stamp); color:var(--paper); }
        .tp-btn:disabled { opacity:.4; cursor:not-allowed; }
    `],
})
export class TrackPickerComponent {
    private readonly state = inject(NewCampaignState);
    private readonly catalog = inject(HotSpotsCatalogService);
    private readonly tree = inject(MissionTreeService);
    /** The AVAILABLE branch this picker generates into. */
    readonly branchId = input<string | undefined>(undefined);

    /** The current hotspot contract's authored tracks ("This hot spot"); empty for a negotiated/0-track contract. */
    private readonly hotspotTracks = computed(() => {
        const id = this.state.activeChaosContract()?.hotspotId;
        return id ? (this.catalog.hotSpotById(id)?.tracks ?? []) : [];
    });
    /** The choice list grouped into <optgroup>s: This hot spot · My tracks · Universal library (§18). Always non-empty
     *  (§18 is always appended), so a 0-track hot spot still has the §18 + Random paths. */
    protected readonly trackGroups = computed(() => {
        const choices = [
            ...this.hotspotTracks().map((t) => ({ value: 'track:' + t.id, name: t.name, group: 'This hot spot' })),
            ...this.state.chaosTrackPresets().map((p) => ({ value: 'preset:' + p.id, name: p.name, group: 'My tracks' })),
            ...UNIVERSAL_TRACK_LIBRARY.map((u) => ({ value: 'template:' + u.key, name: u.name, group: 'Universal library (§18)' })),
        ];
        const groups: { group: string; items: { value: string; name: string }[] }[] = [];
        for (const c of choices) {
            let g = groups.find((x) => x.group === c.group);
            if (!g) { g = { group: c.group, items: [] }; groups.push(g); }
            g.items.push({ value: c.value, name: c.name });
        }
        return groups;
    });
    /** One operation runs at a time — generation is gated on a target branch + no ACTIVE mission (generateBranch re-guards). */
    protected readonly canGenerate = computed(() => !!this.branchId() && !this.tree.activeBranch());

    /** Generate the branch from a chosen track: a saved preset, a §18 template, or an authored hotspot track. */
    protected playChosen(value: string): void {
        const bid = this.branchId();
        if (!bid || !value) return;
        const [kind, id] = value.split(/:(.+)/); // 'track:<id>' | 'preset:<id>' | 'template:<key>' (split on the FIRST colon)
        if (kind === 'preset') { const p = this.state.chaosTrackPresets().find((x) => x.id === id); if (p) void this.tree.generateBranch(bid, { presetSeed: synthSeedFromPreset(p) }); return; }
        if (kind === 'template') { void this.tree.generateBranch(bid, { presetSeed: synthSeedFromTemplate(id as TrackTemplateKey) }); return; }
        const hsId = this.state.activeChaosContract()?.hotspotId;
        if (!hsId) return;
        const seed = this.catalog.seedForSeedId(hotspotSeedId(hsId, id)); // authored track → MissionSeed (with its forks)
        if (seed) void this.tree.generateBranch(bid, { presetSeed: seed });
    }
    /** Pick a random track, preferring the hot spot's OWN authored tracks, else the whole pool (presets + §18). */
    protected playRandom(): void {
        const flat = this.trackGroups().flatMap((g) => g.items);
        if (!flat.length) return;
        const authored = flat.filter((c) => c.value.startsWith('track:'));
        const pool = authored.length ? authored : flat;
        this.playChosen(pool[Math.floor(Math.random() * pool.length)].value);
    }
}
