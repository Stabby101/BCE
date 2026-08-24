/*
 * BCE Inventory III (DIRECTIVE-064, refined by DIRECTIVE-065) — the impure parts-shop service.
 *
 * Owns the shop seam on the Inventory tab. IN-SYSTEM (D-065): the era-legal D-055 catalog → the build-time
 * 'Mech-relevant filter (parts-relevant.json) → the availability-TN rotation → CAPPED to a believable local
 * stock (30–50, common-weighted, scaled to the market rating). OUT-OF-SYSTEM (D-065): not a browse — a
 * SEARCH → a sourcing ROLL (may fail) → on success a paid ORDER that delivers in a few months on the clock.
 * Determinism: the in-system roll + the out-of-system roll are pure per (seed, period); orders persist
 * (DATA-002). GM surface; treasury/ledger via the existing path.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CatalogClientService } from '../catalog/catalog-client.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { daysBetween, formatDate, type CampaignDate } from '../clock/campaign-clock';
import { MARKET_TUNABLES } from '../force/market';
import {
    SHOP_TUNABLES, buildInSystemStock, searchOutOfSystem, outOfSystemRoll, outOfSystemPrice, priceOfPart,
    marketRating, shopCategoryOf, type ShopCategory, type ShopEntry, type ShopOrder,
} from './inventory-shop';
import type { CatalogItem, InventoryCategory, InventoryLine } from './starting-inventory';

const toInvCategory = (catalogCategory: string): InventoryCategory =>
    catalogCategory === 'ammo' ? 'ammunition' : catalogCategory === 'armor' ? 'armor' : 'component';
const lineKey = (l: InventoryLine): string => `${l.catalogId ?? 'null'}|${l.category}|${l.label}`;
const addMonths = (d: CampaignDate, n: number): CampaignDate => { const dt = new Date(d.y, d.m + n, d.d); return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() }; };
const onOrAfter = (a: CampaignDate, b: CampaignDate): boolean => a.y !== b.y ? a.y > b.y : a.m !== b.m ? a.m > b.m : a.d >= b.d;

export interface ShopCategoryView { key: ShopCategory; title: string; entries: ShopEntry[] }

@Injectable({ providedIn: 'root' })
export class InventoryShopService {
    private readonly state = inject(NewCampaignState);
    private readonly catalog = inject(CatalogClientService);
    private readonly store = inject(CampaignSaveStore);

    private readonly rows = signal<CatalogItem[]>([]);
    private readonly relevantIds = signal<Set<string> | null>(null);
    readonly loaded = signal(false);
    readonly reachable = this.catalog.reachable;
    private lastLoadedYear: number | null = null;

    constructor() {
        effect(() => { const y = this.year(); void this.load(y); }); // era-legal catalog once per campaign YEAR
        void this.loadRelevant(); // the build-time 'Mech-relevant id set (same-origin asset)
        effect(() => { this.state.currentDate(); this.deliverDueOrders(); }); // land in-transit orders on the clock
    }
    private async load(year: number): Promise<void> {
        if (this.lastLoadedYear === year && this.rows().length) return;
        this.lastLoadedYear = year;
        const rows = await this.catalog.list({ era: year });
        this.rows.set(rows);
        this.loaded.set(true);
    }
    private async loadRelevant(): Promise<void> {
        try {
            const res = await fetch('/mekbay/parts-relevant.json');
            if (res.ok) { const ids = (await res.json()) as string[]; this.relevantIds.set(new Set(ids.map(String))); }
        } catch { /* absent → isRelevantPart treats all as relevant (no over-filter) */ }
    }
    /** Manual (re)load — the tab kicks this when first opened so the shop never sits empty. */
    reload(): void {
        this.lastLoadedYear = null;
        void this.load(this.year());
        if (!this.relevantIds()) void this.loadRelevant();
    }

    readonly year = computed(() => this.state.currentDate()?.y ?? this.state.startDate()?.y ?? 3025);
    readonly seed = computed(() => `${this.state.commandName() ?? this.state.unit() ?? 'command'}|${this.state.startDate()?.y ?? 0}|${(this.state.startingForce() ?? []).length}`);
    readonly periodKey = computed(() => {
        const start = this.state.startDate();
        const cur = this.state.currentDate() ?? start;
        if (!start || !cur) return 'c0';
        return `c${Math.floor(Math.floor(daysBetween(start, cur) / 7) / SHOP_TUNABLES.restockWeeks)}`;
    });
    readonly restockWeeks = SHOP_TUNABLES.restockWeeks;
    readonly playerClan = computed(() => /^clan\b/i.test(this.state.faction() ?? ''));
    /** Market rating (0..1) from the resource tier — stock size + rare chance (T-010 per-system hook later). */
    readonly rating = computed(() => marketRating(this.state.resources()));
    readonly surchargePct = Math.round(SHOP_TUNABLES.outOfSystemSurcharge * 100);
    readonly deliveryMonths = SHOP_TUNABLES.outOfSystemDeliveryMonths;

    private readonly catalogById = computed(() => {
        const m = new Map<string, CatalogItem>();
        for (const r of this.rows()) m.set(r.id, r);
        return m;
    });

    /** In-system stock for the current cycle — relevant, capped, common-weighted (deterministic per seed+period). */
    readonly inSystem = computed<ShopEntry[]>(() => buildInSystemStock(this.rows(), this.year(), this.seed(), this.periodKey(), { playerClan: this.playerClan(), relevantIds: this.relevantIds(), rating: this.rating() }));
    /** In-system grouped into collapsible categories (D-065). */
    readonly inSystemByCategory = computed<ShopCategoryView[]>(() => {
        const groups: Record<ShopCategory, ShopEntry[]> = { weapon: [], ammo: [], armor: [], structure: [], component: [] };
        for (const e of this.inSystem()) groups[shopCategoryOf(e.item)].push(e);
        const titles: Record<ShopCategory, string> = { weapon: 'Weapons', ammo: 'Ammunition', armor: 'Armor', structure: 'Structure', component: 'Components' };
        return (Object.keys(groups) as ShopCategory[]).filter((k) => groups[k].length).map((k) => ({ key: k, title: titles[k], entries: groups[k] }));
    });

    readonly orders = computed<ShopOrder[]>(() => this.state.shopOrders() ?? []);
    readonly pendingOrders = computed<ShopOrder[]>(() => this.orders().filter((o) => !o.delivered));

    // ── IN-SYSTEM BUY — immediate (debit treasury + add a line) ──
    buyPart(entry: ShopEntry): boolean {
        const price = entry.price;
        const treasury = this.state.treasury() ?? 0;
        if (price > treasury) return false;
        this.state.setTreasury(treasury - price);
        this.state.logMoney(`Parts shop — ${entry.item.name}`, -price, null, 'purchase'); // D-074
        this.mergeInventoryLine(entry.item.id, entry.item.name, toInvCategory(entry.item.category), 1, 'Purchased — shop (in-system)');
        void this.store.persistCurrent();
        return true;
    }
    canAfford(price: number): boolean {
        return (this.state.treasury() ?? 0) >= price;
    }

    // ── OUT-OF-SYSTEM REQUEST — search → roll → (on success) a paid order delivering on the clock ──
    /** Era-legal relevant items matching the search, as request candidates (TN + the +surcharge price). */
    oosSearch(query: string): ShopEntry[] {
        return searchOutOfSystem(this.rows(), this.year(), query, { playerClan: this.playerClan(), relevantIds: this.relevantIds() });
    }
    outOfSystemPrice(item: CatalogItem): number {
        return outOfSystemPrice(item);
    }
    /** Roll to source an item out-of-system this cycle (deterministic per seed+period). On success + affordable,
     *  place a paid order delivering in `deliveryMonths` months. Returns the outcome for the UI to message. */
    requestOrder(item: CatalogItem): { sourced: boolean; roll: number; tn: number; affordable: boolean; ordered: boolean } {
        const { sourced, roll, tn } = outOfSystemRoll(item, this.year(), this.seed(), this.periodKey(), this.playerClan());
        if (!sourced) return { sourced: false, roll, tn, affordable: true, ordered: false };
        const price = outOfSystemPrice(item);
        const treasury = this.state.treasury() ?? 0;
        if (price > treasury) return { sourced: true, roll, tn, affordable: false, ordered: false };
        this.state.setTreasury(treasury - price);
        this.state.logMoney(`Out-of-system order — ${item.name}`, -price, null, 'purchase'); // D-074
        const category = toInvCategory(item.category);
        const now = this.state.currentDate() ?? this.state.startDate() ?? { y: 3025, m: 0, d: 1 };
        const order: ShopOrder = {
            id: `ord-${Math.floor(Math.random() * 1e9)}`, catalogId: item.id, name: item.name, category,
            unit: category === 'component' ? 'count' : 'tons', qty: 1, price, orderedOn: formatDate(now),
            deliver: addMonths(now, this.deliveryMonths), delivered: false,
        };
        this.state.setShopOrders([...(this.state.shopOrders() ?? []), order]);
        void this.store.persistCurrent();
        return { sourced: true, roll, tn, affordable: true, ordered: true };
    }
    /** Land any in-transit order whose delivery date has arrived → add to inventory, mark delivered, persist. */
    private deliverDueOrders(): void {
        const orders = untracked(() => this.state.shopOrders());
        if (!orders?.length) return;
        const now = this.state.currentDate() ?? this.state.startDate();
        if (!now) return;
        let changed = false;
        const next = orders.map((o) => {
            if (o.delivered || !onOrAfter(now, o.deliver)) return o;
            this.mergeInventoryLine(o.catalogId, o.name, o.category, o.qty, `Out-of-system delivery (ordered ${o.orderedOn})`);
            changed = true;
            return { ...o, delivered: true };
        });
        if (changed) { this.state.setShopOrders(next); void this.store.persistCurrent(); }
    }

    // ── SELL — credit the resale fraction (50%) + decrement on-hand ──
    sellLine(line: InventoryLine): boolean {
        const inv = this.state.inventory();
        if (!inv || line.onHand <= 0) return false;
        const resale = Math.round(this.priceForLine(line) * MARKET_TUNABLES.resaleRatio);
        this.state.setTreasury((this.state.treasury() ?? 0) + resale);
        this.state.logMoney(`Sold — ${line.label}`, resale, null, 'sale'); // D-074
        const key = lineKey(line);
        this.state.setInventory({ ...inv, lines: inv.lines.map((l) => (lineKey(l) === key ? { ...l, onHand: Math.max(0, l.onHand - 1) } : l)) });
        void this.store.persistCurrent();
        return true;
    }
    /** D-066 GM on-hand override — set an owned line's on-hand (clamp ≥0, integer) + persist. The status (vs floor)
     *  and the category rollup recompute reactively (the inventory signal mutates). The line is kept at 0, never
     *  silently dropped mid-edit. */
    setLineOnHand(line: InventoryLine, qty: number): void {
        const inv = this.state.inventory();
        if (!inv) return;
        const next = Math.max(0, Math.round(qty));
        if (next === line.onHand) return;
        const key = lineKey(line);
        this.state.setInventory({ ...inv, lines: inv.lines.map((l) => (lineKey(l) === key ? { ...l, onHand: next } : l)) });
        void this.store.persistCurrent();
    }

    priceForLine(line: InventoryLine): number {
        if (line.catalogId) { const item = this.catalogById().get(line.catalogId); if (item) return priceOfPart(item); }
        const cat = line.category === 'ammunition' ? 'ammo' : line.category === 'armor' ? 'armor' : 'misc';
        return SHOP_TUNABLES.fallbackCostByCategory[cat] ?? 1000;
    }
    resaleValue(line: InventoryLine): number {
        return Math.round(this.priceForLine(line) * MARKET_TUNABLES.resaleRatio);
    }

    private mergeInventoryLine(catalogId: string, label: string, category: InventoryCategory, qty: number, note: string): void {
        const inv = this.state.inventory();
        const unit: 'tons' | 'count' = category === 'component' ? 'count' : 'tons';
        const lines = inv ? [...inv.lines] : [];
        const idx = lines.findIndex((l) => l.catalogId === catalogId);
        if (idx >= 0) lines[idx] = { ...lines[idx], onHand: lines[idx].onHand + qty };
        else lines.push({ catalogId, category, label, onHand: qty, unit, floor: 0, notes: note });
        const date = this.state.currentDate() ?? this.state.startDate();
        const generatedAt = inv?.generatedAt ?? (date ? formatDate(date) : 'Begin');
        const tier = inv?.tier ?? (this.state.resources() ?? 'normal');
        this.state.setInventory({ lines, generatedAt, tier });
    }
}
