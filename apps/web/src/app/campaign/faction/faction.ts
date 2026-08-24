/*
 * BCE retool — New Campaign, step 3: faction & starting unit. DIRECTIVE-014.
 * The FACTION list (LEFT) is now MekBay's ERA-GATED factions (faction.eras[era]
 * non-empty), scoped by the step-2 archetype -> group, grouped for play (majors
 * bucketed by affinity, long tail collapsible), each card decorated with a cited
 * blurb + colors from faction-flavor.ts when matched. The starting-unit column
 * (RIGHT) is unchanged: placeholder formations (bridged from faction-data.ts) or
 * make-your-own. Data streams via the same DataService the roster kicks; on
 * catalog failure we fall back to the placeholder faction list so the wizard
 * still proceeds. Writes faction + unit to the wizard state, advances to step 4.
 */
import { Component, ChangeDetectionStrategy, computed, signal, inject, effect, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { FACTION_DATA, ARCH_NAMES, CUSTOM_UNIT, type FactionGroup } from './faction-data';
import { resolveMekbayEraId, buildFactionPick, formationsFor, flavorMisses, type FactionPick, type FormationPick } from './faction-select';
import { MERC_COMMANDS, type MercCommand } from './merc-commands';
import type { FormationRecord } from './formation-oob';
import { ContractMarketService } from '../contract/contract-market.service';

const EMPTY_PICK: FactionPick = { sections: [], count: 0, relaxed: false, note: null };

export type MercRating = 'Green' | 'Regular' | 'Veteran' | 'Elite';
const MERC_RATINGS: MercRating[] = ['Green', 'Regular', 'Veteran', 'Elite'];

@Component({
    selector: 'bce-faction',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './faction.html',
    styleUrl: './faction.scss',
})
export class FactionComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly injector = inject(Injector);
    private readonly market = inject(ContractMarketService);

    protected readonly CUSTOM = CUSTOM_UNIT;
    protected readonly era = this.state.era;
    protected readonly ready = this.data.isDataReady;
    protected readonly dataError = signal(false);

    protected readonly archetypeName = computed(() => {
        const c = this.state.force();
        return c ? ARCH_NAMES[c] ?? c : '';
    });
    protected readonly eraLine = computed(() => {
        const e = this.era();
        return e ? `${e.name} · ${e.from}–${e.to >= 9999 ? 'present' : e.to}` : '';
    });
    protected readonly eraShort = computed(() => this.era()?.name ?? '—');

    /** Wizard era -> MekBay era id (only once data is ready). HOTFIX-011: re-drives on a catalog/slice swap. */
    protected readonly eraId = computed(() => {
        this.data.catalogVersion();
        return this.ready() ? resolveMekbayEraId(this.era(), this.data.getEras()) : null;
    });

    /** The grouped, era-gated, archetype-scoped pick. HOTFIX-011: catalogVersion() makes it recompute when
     *  the resident slice swaps (getFactions() is a plain read; isDataReady stays true across a slice swap). */
    protected readonly pick = computed<FactionPick>(() => {
        this.data.catalogVersion();
        if (!this.ready()) return EMPTY_PICK;
        const code = this.state.force();
        return code ? buildFactionPick(this.data.getFactions(), code, this.eraId()) : EMPTY_PICK;
    });
    protected readonly availCount = computed(() => this.pick().count);

    /** Offline fallback: the legacy placeholder faction groups. */
    protected readonly fallbackGroups = computed<FactionGroup[]>(() => {
        const c = this.state.force();
        return c ? FACTION_DATA[c] ?? [] : [];
    });
    /** HOTFIX-011: show the placeholder list when the catalog FAILED (dataError) OR loaded-but-yielded-zero
     *  factions (empty-success) — never an empty column. (buildFactionPick already era-relaxes when it can;
     *  this covers a total catalog failure where getFactions() is empty.) */
    protected readonly showFallback = computed(() => this.dataError() || (this.ready() && this.pick().count === 0));

    protected readonly selectedFaction = signal<string | null>(null);
    protected readonly selectedUnit = signal<string | null>(null);
    protected readonly expanded = signal<Record<string, boolean>>({}); // per-section overflow toggles

    // ── Merc command identity (D-016, MERC path) ──
    protected readonly isMerc = computed(() => this.state.force() === 'MERC');
    protected readonly mercCommands = MERC_COMMANDS;
    protected readonly ratings = MERC_RATINGS;
    protected readonly mercMode = signal<'canon' | 'own'>('canon');
    protected readonly selectedMerc = signal<MercCommand | null>(null);
    protected readonly commandName = signal<string>('');
    protected readonly rating = signal<MercRating>('Regular');

    constructor() {
        const code = this.state.force();
        if (!code) {
            // No archetype => step 2 not done; send back up the wizard.
            void this.router.navigate(['/campaign/new/date-force']);
            return;
        }
        if (code === 'MERC') {
            // The MERC path is a command-identity setup, not the era-gated picker.
            this.initMerc();
            return;
        }
        if (this.state.unit() === CUSTOM_UNIT) this.selectedUnit.set(CUSTOM_UNIT);

        void this.kickData();

        // Once data is ready: default-select the first major faction (or restore a
        // prior choice), and run the one-shot flavor resolve-probe.
        let probed = false;
        effect(() => {
            if (!this.ready()) return;
            const p = this.pick();
            if (this.selectedFaction() === null) {
                const all = p.sections.flatMap((s) => [...s.visible, ...s.overflow]);
                const prev = this.state.faction();
                const def = (prev ? all.find((v) => v.faction.name === prev) : null) ?? p.sections[0]?.visible[0] ?? null;
                if (def) {
                    this.selectedFaction.set(def.faction.name);
                    // Restore a prior formation (or MAKE YOUR OWN) when returning to step 3.
                    const prevFormation = this.state.formation();
                    if (prevFormation) {
                        const match = formationsFor(def.faction.name, this.startYear()).find((f) => f.name === prevFormation);
                        if (match) { this.selectedFormation.set(match); this.selectedUnit.set(match.name); }
                    } else if (this.state.unit() === CUSTOM_UNIT) {
                        this.selectedUnit.set(CUSTOM_UNIT);
                    }
                } else if (this.showFallback()) {
                    // HOTFIX-011: empty-success / catalog-failure → default-select the first placeholder faction
                    // so the column is never empty and Proceed can enable.
                    const fb = this.fallbackGroups();
                    const name = (prev ? fb.find((f) => f.name === prev)?.name : undefined) ?? fb[0]?.name ?? null;
                    if (name) this.selectedFaction.set(name);
                }
            }
            if (!probed) {
                probed = true;
                const misses = flavorMisses(this.data.getFactions(), code, this.eraId());
                const total = p.count;
                if (misses.length) {
                    console.warn(`[D-014 flavor] ${total - misses.length}/${total} matched in ${this.eraShort()}; ${misses.length} fallback (no flavor): ${misses.join(', ')}`);
                } else {
                    console.info(`[D-014 flavor] ${total}/${total} factions matched a flavor record in ${this.eraShort()}`);
                }
            }
        }, { injector: this.injector });
    }

    /** Kick the catalog load (step 3 runs before MekBay's App mounts). DEPLOY-005: load the SMALL per-era
     *  SLICE first (tens–hundreds of KB, fast parse, no UI freeze) — fall back to the full 24MB catalog
     *  only on a genuine slice failure (dev without slices, or a fetch error). dataError is set ONLY on a
     *  true load failure (not a race while the slice is still arriving). */
    private async kickData(): Promise<void> {
        if (this.data.isFullLoaded()) return; // the full catalog covers every era
        this.dataError.set(false);
        try {
            if (await this.data.ensureSliceIndex()) {
                const eraId = resolveMekbayEraId(this.era(), this.data.getEras());
                // HOTFIX-011: load (or SWITCH to) THIS era's slice — do NOT early-return on isDataReady, which
                // may reflect a DIFFERENT era's resident slice (the stale-slice empty-column bug). ensureSlice
                // now reloads when the resident era differs.
                if (eraId != null && (await this.data.ensureSlice(eraId))) return;
            }
        } catch { /* fall through to the full catalog */ }
        if (this.data.isFullLoaded()) return;
        if (!this.data.isDownloading()) this.data.initialize().catch(() => this.dataError.set(true));
        this.whenDataReady().catch(() => this.dataError.set(true));
    }

    private whenDataReady(): Promise<void> {
        if (this.data.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { ref.destroy(); reject(new Error('data timeout')); }, 30000);
            const ref = effect(() => {
                if (this.data.isDataReady()) {
                    clearTimeout(timer);
                    ref.destroy();
                    resolve();
                }
            }, { injector: this.injector });
        });
    }

    /** Campaign start year (step-2) — gates the OOB formation list. */
    protected readonly startYear = computed(() => this.state.startDate()?.y ?? this.state.era()?.from ?? 3025);

    /** Canon OOB formations for the selected faction — up to 5, era-preferred, never strands (D-021/D-061). */
    protected readonly formations = computed<FormationPick[]>(() => {
        const fac = this.selectedFaction();
        return fac ? formationsFor(fac, this.startYear()) : [];
    });

    // ── DIRECTIVE-061: the per-command right-side visual (crest + redrawn paint swatch) + fallbacks ──
    /** The selected faction's catalog view (for the faction-crest + heraldry-colour fallbacks). */
    private readonly selectedFactionView = computed(() => {
        const name = this.selectedFaction();
        if (!name) return null;
        const all = this.pick().sections.flatMap((s) => [...s.visible, ...s.overflow]);
        return all.find((v) => v.faction.name === name) ?? null;
    });
    /** The committed faction crest (catalog img) — the fallback when a command has no mirrored crest. */
    protected selectedFactionImg(): string { return this.selectedFactionView()?.faction.img ?? ''; }
    private heraldryColors(): string[] { return this.selectedFactionView()?.flavor?.colors ?? []; }
    private paintColors(f: FormationPick): string[] {
        if (f.paint) return [f.paint.primary, f.paint.secondary, f.paint.accent].filter((c): c is string => !!c);
        const h = this.heraldryColors();
        return h.length ? h : ['#6b7682'];
    }
    /** Our REDRAWN swatch (color bands from the paint hex, else the faction heraldry) — never their art. */
    protected swatchBg(f: FormationPick): string {
        const c = this.paintColors(f);
        if (c.length === 1) return c[0];
        if (c.length === 2) return `linear-gradient(135deg, ${c[0]} 0 52%, ${c[1]} 52% 100%)`;
        return `linear-gradient(135deg, ${c[0]} 0 40%, ${c[1]} 40% 70%, ${c[2]} 70% 100%)`;
    }
    protected paintTip(f: FormationPick): string {
        if (f.paint) return [f.paint.note, f.paint.source].filter(Boolean).join(' · ');
        const name = this.selectedFaction();
        return name ? `${name} heraldry` : '';
    }
    /** Crest fallback: formation crest → faction crest → (hide; the swatch still shows). */
    protected onCrestError(ev: Event): void {
        const img = ev.target as HTMLImageElement;
        const fb = img.getAttribute('data-faction-crest');
        if (fb && img.dataset['swapped'] !== '1' && fb && !img.src.endsWith(fb)) { img.dataset['swapped'] = '1'; img.src = fb; }
        else { img.style.visibility = 'hidden'; }
    }
    /** The formation whose detail panel is shown (null = none / MAKE YOUR OWN). */
    protected readonly selectedFormation = signal<FormationRecord | null>(null);

    protected selectFaction(name: string): void {
        if (this.selectedFaction() === name) return;
        this.selectedFaction.set(name);
        this.selectedUnit.set(null); // new faction => clear the unit + formation choice
        this.selectedFormation.set(null);
    }
    protected selectFormation(f: FormationRecord): void {
        this.selectedFormation.set(f);
        this.selectedUnit.set(f.name); // unit = formation name: satisfies the size-capital guard + names the save
    }
    protected selectCustom(): void {
        this.selectedUnit.set(CUSTOM_UNIT);
        this.selectedFormation.set(null); // MAKE YOUR OWN — un-seeded, no formation framing
    }
    /** Hide a logo that 404s rather than showing a broken-image glyph. */
    protected onLogoError(ev: Event): void {
        (ev.target as HTMLImageElement).style.visibility = 'hidden';
    }

    protected isExpanded(group: string): boolean {
        return !!this.expanded()[group];
    }
    protected toggleSection(group: string): void {
        this.expanded.update((m) => ({ ...m, [group]: !m[group] }));
    }

    // ── Merc command setup (D-016) ──
    private initMerc(): void {
        this.market.warm(); // background-load the catalog so the Begin-time market gen is fast (D-017)
        const prevName = this.state.commandName();
        const prevRating = this.state.rating();
        if (prevName) {
            this.commandName.set(prevName);
            const canon = MERC_COMMANDS.find((c) => c.name === prevName || c.aliases.includes(prevName));
            if (canon) {
                this.mercMode.set('canon');
                this.selectedMerc.set(canon);
            } else {
                this.mercMode.set('own');
            }
        } else {
            this.selectMerc(MERC_COMMANDS[0]); // default: model on the first canon command
        }
        if (prevRating && (MERC_RATINGS as string[]).includes(prevRating)) this.rating.set(prevRating as MercRating);
    }
    protected selectMerc(c: MercCommand): void {
        this.mercMode.set('canon');
        this.selectedMerc.set(c);
        this.commandName.set(c.name); // pre-fill the editable command name
    }
    protected useCanonMode(): void {
        if (this.mercMode() === 'canon') return;
        this.selectMerc(this.selectedMerc() ?? MERC_COMMANDS[0]);
    }
    protected buildOwn(): void {
        if (this.mercMode() === 'own') return; // don't wipe a typed name on re-click
        this.mercMode.set('own');
        this.selectedMerc.set(null);
        this.commandName.set('');
    }
    protected onNameInput(ev: Event): void {
        this.commandName.set((ev.target as HTMLInputElement).value);
    }
    protected setRating(r: MercRating): void {
        this.rating.set(r);
    }

    protected readonly canProceed = computed(() => {
        if (this.isMerc()) return this.commandName().trim().length > 0;
        return !!this.selectedFaction() && !!this.selectedUnit();
    });

    protected back(): void {
        void this.router.navigate(['/campaign/new/date-force']);
    }

    protected proceed(): void {
        if (this.isMerc()) {
            const name = this.commandName().trim();
            if (!name) return;
            // faction = the modeled-on canon command, or an independent command for build-own.
            const fac = this.mercMode() === 'canon' && this.selectedMerc() ? this.selectedMerc()!.name : 'Independent Command';
            this.state.setFaction(fac);
            this.state.setUnit(name); // unit = command name: satisfies the size-capital guard + names the save
            this.state.setCommandName(name);
            this.state.setRating(this.rating());
            this.state.setLogisticsProfile('merc-market');
            void this.router.navigate(['/campaign/new/size-capital']);
            return;
        }
        const fac = this.selectedFaction();
        const unit = this.selectedUnit();
        if (!fac || !unit) return;
        this.state.setFaction(fac);
        this.state.setUnit(unit);
        // D-021: a chosen formation seeds generation + frames the campaign; its logistics value
        // rides the existing logisticsProfile display seam. MAKE YOUR OWN clears both (un-seeded).
        const f = this.selectedFormation();
        if (f && unit !== CUSTOM_UNIT) {
            this.state.setFormation(f.name);
            this.state.setLogisticsProfile(f.logistics);
        } else {
            this.state.setFormation(null);
            this.state.setLogisticsProfile(null);
        }
        void this.router.navigate(['/campaign/new/size-capital']);
    }
}
