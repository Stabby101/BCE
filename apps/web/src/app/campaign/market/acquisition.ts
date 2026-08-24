/*
 * BCE — UNIT ACQUISITION overlay (DIRECTIVE-029). A full-screen dossier overlay (the D-025 pattern:
 * Esc/click-out, height-safe internal scroll) opened from the roster header. Two tabs: BUY (the
 * eligibility-filtered + gated catalog, search + weight-class filter, a GM override that widens to all
 * combat 'Mechs and surfaces the gate failures per row, a per-row GM ADD) and SELL/STRIKE (the force's
 * units at resale, with a deployed guard + confirm). All actions route through AcquisitionService.
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal, output } from '@angular/core';
import { AcquisitionService, type BuyRow, type OwnedRow } from './acquisition.service';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
// DIRECTIVE-063 (C): reuse MekBay's unit-browser filter MODEL (field keys + labels) so our market popover names
// the same dimensions as the unit browser — applied with light market-native predicates here, not MekBay's worker
// / advanced-search UI. RANGE_FILTERS gives tons/bv/year; DROPDOWN_FILTERS gives techBase/weightClass; SORT_OPTIONS
// the sort labels.
import { RANGE_FILTERS, DROPDOWN_FILTERS, SORT_OPTIONS } from '../../services/unit-search-filters.model';

type SortKey = 'name' | 'tons' | 'bv' | 'year';
type TechFilter = 'All' | 'IS' | 'Clan';
type Bound = 'tonsMin' | 'tonsMax' | 'yearMin' | 'yearMax' | 'bvMin' | 'bvMax';

@Component({
    selector: 'bce-acquisition',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BceUnitSpriteComponent],
    templateUrl: './acquisition.html',
    styleUrl: './acquisition.scss',
    host: { '(document:keydown.escape)': 'onEsc()' },
})
export class AcquisitionComponent {
    readonly close = output<void>();
    protected readonly acq = inject(AcquisitionService);

    // HOTFIX-005: catalog readiness for the BUY tab's loading / failed+retry states.
    protected readonly catalogReady = this.acq.catalogReady;
    protected readonly catalogLoading = this.acq.catalogLoading;
    protected readonly catalogError = this.acq.catalogError; // HOTFIX-012
    protected retryCatalog(): void { this.acq.retryCatalog(); }

    constructor() {
        // If the market opens before the catalog is ready (a slow/failed app-init load), kick a load so rows
        // arrive once it lands — never a permanent empty BUY tab.
        if (!this.acq.catalogReady()) this.acq.retryCatalog();
    }

    protected readonly tab = signal<'buy' | 'sell'>('buy');
    protected readonly search = signal('');
    protected readonly gmOverride = signal(false);
    protected readonly weightClasses = ['Light', 'Medium', 'Heavy', 'Assault'];
    private readonly CAP = 120; // cap rendered rows (the GM-broad list is ~3000) — search/filter narrows

    // (A) Sort — default Name A-Z; the keys/labels mirror MekBay's SORT_OPTIONS (Name/Tons/BV/Year).
    protected readonly sortKey = signal<SortKey>('name');
    protected readonly sortDir = signal<'asc' | 'desc'>('asc');
    protected readonly sortFields: { key: SortKey; label: string }[] = [
        { key: 'name', label: this.mekLabel(SORT_OPTIONS, 'name', 'Name') },
        { key: 'tons', label: 'Tonnage' }, // MekBay calls it 'Tons'; James asked for 'Tonnage'
        { key: 'bv', label: this.mekLabel(SORT_OPTIONS, 'bv', 'BV') },
        { key: 'year', label: this.mekLabel(SORT_OPTIONS, 'year', 'Year') },
    ];

    // (B) Filter popover — dimensions reused from MekBay's filter model, presented in our market-native popover.
    protected readonly filterOpen = signal(false);
    protected readonly weightClass = signal<string>(''); // (folds in the old always-on chips)
    protected readonly techBase = signal<TechFilter>('All');
    protected readonly tonsMin = signal<number | null>(null);
    protected readonly tonsMax = signal<number | null>(null);
    protected readonly yearMin = signal<number | null>(null);
    protected readonly yearMax = signal<number | null>(null);
    protected readonly bvMin = signal<number | null>(null);
    protected readonly bvMax = signal<number | null>(null);
    protected readonly techBases: { key: TechFilter; label: string }[] = [
        { key: 'All', label: 'All' }, { key: 'IS', label: 'IS' }, { key: 'Clan', label: 'Clan' },
    ];
    // Range-field labels lifted straight from MekBay's RANGE_FILTERS so the popover names match the unit browser.
    protected readonly tonsLabel = this.mekLabel(RANGE_FILTERS, 'tons', 'Tons');
    protected readonly yearLabel = this.mekLabel(RANGE_FILTERS, 'year', 'Year');
    protected readonly bvLabel = this.mekLabel(RANGE_FILTERS, 'bv', 'BV');
    // techBase field is sourced from MekBay's DROPDOWN_FILTERS (its sortOptions are 'Inner Sphere'/'Clan'/'Mixed').
    private readonly techBaseField = DROPDOWN_FILTERS.find((f) => f.key === 'techBase');

    private mekLabel(set: readonly { key: string; label: string }[], key: string, fallback: string): string {
        return set.find((f) => f.key === key)?.label ?? fallback;
    }

    /** Catalog min/max per range field (over the full GM-broad set) — used as input placeholders/hints. */
    protected readonly bounds = computed(() => {
        const rows = this.acq.marketRows();
        let tlo = Infinity, thi = -Infinity, ylo = Infinity, yhi = -Infinity, blo = Infinity, bhi = -Infinity;
        for (const r of rows) {
            if (r.tons < tlo) tlo = r.tons; if (r.tons > thi) thi = r.tons;
            if (r.year > 0) { if (r.year < ylo) ylo = r.year; if (r.year > yhi) yhi = r.year; }
            if (r.bv < blo) blo = r.bv; if (r.bv > bhi) bhi = r.bv;
        }
        return rows.length
            ? { tons: [tlo, thi], year: [Number.isFinite(ylo) ? ylo : 0, Number.isFinite(yhi) ? yhi : 0], bv: [blo, bhi] }
            : { tons: [20, 100], year: [2400, 3200], bv: [0, 3000] };
    });

    /** How many filter dimensions are active (badge + clear-all enable). */
    protected readonly activeFilters = computed(() => {
        let n = 0;
        if (this.weightClass()) n++;
        if (this.techBase() !== 'All') n++;
        if (this.tonsMin() != null || this.tonsMax() != null) n++;
        if (this.yearMin() != null || this.yearMax() != null) n++;
        if (this.bvMin() != null || this.bvMax() != null) n++;
        return n;
    });

    /** BUY rows after the GM + filter-popover dimensions + text search, then the chosen sort. */
    protected readonly filtered = computed<BuyRow[]>(() => {
        const gm = this.gmOverride();
        const q = this.search().toLowerCase().trim();
        const wc = this.weightClass();
        const tb = this.techBase();
        const tlo = this.tonsMin(), thi = this.tonsMax(), ylo = this.yearMin(), yhi = this.yearMax(), blo = this.bvMin(), bhi = this.bvMax();
        let rows = this.acq.marketRows();
        if (!gm) rows = rows.filter((r) => r.passes); // GM off: only gate-clean units
        if (wc) rows = rows.filter((r) => r.weightClass === wc);
        if (tb === 'IS') rows = rows.filter((r) => r.techBase === 'Inner Sphere' || r.techBase === 'Mixed');
        else if (tb === 'Clan') rows = rows.filter((r) => r.techBase === 'Clan' || r.techBase === 'Mixed'); // Mixed counts for both (MekBay convention)
        if (tlo != null) rows = rows.filter((r) => r.tons >= tlo);
        if (thi != null) rows = rows.filter((r) => r.tons <= thi);
        if (ylo != null) rows = rows.filter((r) => r.year >= ylo);
        if (yhi != null) rows = rows.filter((r) => r.year <= yhi);
        if (blo != null) rows = rows.filter((r) => r.bv >= blo);
        if (bhi != null) rows = rows.filter((r) => r.bv <= bhi);
        if (q) rows = rows.filter((r) => (r.unit.chassis + ' ' + r.unit.model).toLowerCase().includes(q));
        const k = this.sortKey(), s = this.sortDir() === 'asc' ? 1 : -1;
        const tie = (a: BuyRow, b: BuyRow) => a.unit.chassis.localeCompare(b.unit.chassis) || a.unit.model.localeCompare(b.unit.model);
        return [...rows].sort((a, b) => {
            if (k === 'name') return s * tie(a, b);
            const av = k === 'tons' ? a.tons : k === 'bv' ? a.bv : a.year;
            const bv = k === 'tons' ? b.tons : k === 'bv' ? b.bv : b.year;
            return s * (av - bv) || tie(a, b);
        });
    });
    protected readonly shown = computed(() => this.filtered().slice(0, this.CAP));
    protected readonly overflowCount = computed(() => Math.max(0, this.filtered().length - this.CAP));
    protected readonly owned = computed<OwnedRow[]>(() => this.acq.ownedRows());

    protected readonly confirm = signal<{ kind: 'sell' | 'delete'; instanceId: string; name: string; amount: number } | null>(null);

    protected setTab(t: 'buy' | 'sell'): void {
        this.tab.set(t);
        this.confirm.set(null);
    }
    protected setSearch(v: string): void {
        this.search.set(v);
    }
    protected setWc(wc: string): void {
        this.weightClass.set(this.weightClass() === wc ? '' : wc);
    }
    protected toggleGm(): void {
        this.gmOverride.update((v) => !v);
    }

    // (A) Sort — pick a field (defaults asc); click the active field again to flip asc/desc.
    protected setSort(key: SortKey): void {
        if (this.sortKey() === key) this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { this.sortKey.set(key); this.sortDir.set('asc'); }
    }
    // (B) Filter popover open/close + value setters.
    protected toggleFilter(): void {
        this.filterOpen.update((v) => !v);
    }
    protected setTech(t: TechFilter): void {
        this.techBase.set(t);
    }
    protected setBound(field: Bound, raw: string): void {
        const t = (raw ?? '').trim();
        const n = t === '' ? null : Number(t);
        if (n != null && Number.isNaN(n)) return; // ignore non-numeric input, keep prior value
        this[field].set(n);
    }
    /** Reset every filter dimension (not the text search — that composes independently). */
    protected clearAll(): void {
        this.weightClass.set('');
        this.techBase.set('All');
        this.tonsMin.set(null); this.tonsMax.set(null);
        this.yearMin.set(null); this.yearMax.set(null);
        this.bvMin.set(null); this.bvMax.set(null);
    }

    protected buy(r: BuyRow): void {
        this.acq.buy(r.unit);
    }
    protected gmAdd(r: BuyRow): void {
        this.acq.gmAdd(r.unit);
    }
    /** Buyable = affordable AND (gate-clean OR GM override on). */
    protected buyable(r: BuyRow): boolean {
        return this.acq.canBuy(r.price) && (r.passes || this.gmOverride());
    }

    protected askSell(o: OwnedRow): void {
        if (!o.deployed) this.confirm.set({ kind: 'sell', instanceId: o.instance.instanceId, name: `${o.name} ${o.variant}`, amount: o.resale });
    }
    protected askDelete(o: OwnedRow): void {
        if (!o.deployed) this.confirm.set({ kind: 'delete', instanceId: o.instance.instanceId, name: `${o.name} ${o.variant}`, amount: 0 });
    }
    protected doConfirm(): void {
        const c = this.confirm();
        if (!c) return;
        if (c.kind === 'sell') this.acq.sell(c.instanceId);
        else this.acq.del(c.instanceId);
        this.confirm.set(null);
    }
    protected cancelConfirm(): void {
        this.confirm.set(null);
    }

    protected onEsc(): void {
        if (this.confirm()) this.confirm.set(null);
        else if (this.filterOpen()) this.filterOpen.set(false); // Esc closes the filter popover before the overlay
        else this.close.emit();
    }
    protected onClose(): void {
        this.close.emit();
    }
    protected fmt(n: number): string {
        return n.toLocaleString('en-US');
    }
}
