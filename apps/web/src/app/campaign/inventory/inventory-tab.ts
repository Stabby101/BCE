/*
 * BCE Inventory II (DIRECTIVE-056, T-037 slice 2) — the GM Inventory tab.
 *
 * Reads the snapshot `inventory` (rolled once at Begin / back-filled on load by InventoryService) and
 * renders it by category — collapsible sections, per-row on-hand / floor / status chip / notes. Status
 * is recomputed at render via the pure statusOf (no stored status to drift). Joins /api/catalog for
 * provenance on catalog-sourced rows (components/armor). GM surface only (a dashboard child — absent
 * from the player bundle). Collapsed state is UI-only (localStorage), never campaign state.
 *
 * SEAMS (build NOTHING this slice): a per-row Δ-since-last-cycle slot (D-059) and a buy/sell control
 * mount (D-057) are marked in the template as comments — no dead buttons.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { computeLedger } from '../economy-ledger';
import { CatalogClientService } from '../catalog/catalog-client.service';
import { statusOf, type InventoryCategory, type InventoryLine, type InventoryStatus } from './starting-inventory';
import { InventoryShopService, type ShopCategoryView } from './inventory-shop.service';
import { type ShopEntry } from './inventory-shop';

interface CategoryView {
    key: InventoryCategory;
    title: string;
    rollup: string;
    lines: InventoryLine[];
}

const COLLAPSE_KEY = 'bce.inv.collapsed';
const SEV: Record<InventoryStatus, string> = { GOOD: 'sev-G', LOW: 'sev-Y', CRITICAL: 'sev-R', OUT: 'sev-B' };

@Component({
    selector: 'bce-inventory-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ph">Inventory <span class="sub">stock the campaign owns — matched to the force, scaled to the outfit</span></div>

        @if (!inv()) {
            <p class="note">No inventory rolled yet — it generates at Begin (and back-fills an older save on first open).</p>
        } @else {
            <div class="inv-meta">Rolled {{ inv()!.generatedAt }} · tier <b>{{ inv()!.tier }}</b> · {{ inv()!.lines.length }} lines @if (!reachable()) {<span class="off">· catalog offline (citations hidden)</span>}</div>

            <!-- LEDGER (D-058) — the monthly economy projection; the in-the-black reflects PERSONNEL PAYROLL (T-037) -->
            <div class="ledger" data-testid="treasury-ledger">
                <div class="led-head">Monthly ledger <span class="sub">projected recurring economy</span></div>
                <div class="led-row"><span class="led-l">Treasury</span><span class="led-v">{{ money(ledger().treasury) }} C-bills</span></div>
                @if (ledger().income) {
                    <div class="led-row"><span class="led-l">Contract income</span><span class="led-v pos">+{{ money(ledger().income) }}/mo</span></div>
                }
                <div class="led-row" data-kind="payroll"><span class="led-l">Personnel payroll</span><span class="led-v neg">−{{ money(ledger().payroll) }}/mo</span></div>
                <div class="led-row" data-kind="maintenance"><span class="led-l">Unit maintenance</span><span class="led-v neg">−{{ money(ledger().maintenance) }}/mo</span></div>
                <div class="led-row net" [class.black]="ledger().net >= 0" [class.red]="ledger().net < 0">
                    <span class="led-l">Net / month</span>
                    <span class="led-v">{{ ledger().net >= 0 ? 'IN THE BLACK +' : 'IN THE RED −' }}{{ money(absVal(ledger().net)) }}/mo@if (ledger().runway != null) { · ~{{ ledger().runway }} mo runway }</span>
                </div>
            </div>

            <!-- DIRECTIVE-064/065 SHOP. IN-SYSTEM = the relevant, capped, common-weighted local stock (collapsible
                 by category, scrollable). OUT-OF-SYSTEM = a search → sourcing roll → a paid order that delivers on
                 the clock at +surcharge. GM surface (the Inventory tab is GM-only). -->
            <section class="shop">
                <div class="shop-head">
                    <span class="shop-title">Parts Shop Market ({{ source() === 'out-of-system' ? 'Out-of-System' : 'In-System' }})</span>
                    <div class="shop-src" role="group" aria-label="Source">
                        <button type="button" class="srcb" [class.on]="source() === 'in-system'" (click)="setSource('in-system')">In-system</button>
                        <button type="button" class="srcb" [class.on]="source() === 'out-of-system'" (click)="setSource('out-of-system')">Out-of-system</button>
                    </div>
                </div>

                @if (source() === 'in-system') {
                    <div class="shop-sub">
                        Local stock — <b>{{ inSystemCount() }}</b> items, rotates every {{ restockWeeks }} weeks (cycle {{ periodKey() }}); staples always in.
                        @if (!reachable()) { <span class="off">· catalog offline</span> }
                    </div>
                    <input type="search" class="shop-search" [value]="shopSearch()" (input)="setShopSearch($any($event.target).value)" placeholder="Filter local stock…" aria-label="Filter the in-system stock">
                    @if (!inSystemCats().length) {
                        <p class="note thin">@if (!shopLoaded()) { Loading the catalog… } @else { No parts match. }</p>
                    } @else {
                        <div class="shop-scroll">
                            @for (cat of inSystemCats(); track cat.key) {
                                <section class="shop-cat">
                                    <button type="button" class="cat-head" (click)="toggleShop(cat.key)" [attr.aria-expanded]="isShopOpen(cat.key)">
                                        <span class="caret" [class.open]="isShopOpen(cat.key)">▸</span>
                                        <span class="cat-title">{{ cat.title }}</span>
                                        <span class="cat-roll">{{ cat.entries.length }}</span>
                                    </button>
                                    @if (isShopOpen(cat.key)) {
                                        <table class="inv-tbl shop-tbl">
                                            <tbody>
                                                @for (e of cat.entries; track e.item.id) {
                                                    <tr>
                                                        <td class="l">{{ e.item.name }} @if (e.staple) { <span class="stp" title="staple — always stocked">staple</span> }</td>
                                                        <td class="av" title="availability code">{{ e.code }}</td>
                                                        <td class="n dim">×{{ e.qty }}</td>
                                                        <td class="n">{{ money(e.price) }}</td>
                                                        <td class="n"><button type="button" class="shopbtn buy" [disabled]="!canAfford(e)" (click)="buy(e)" [attr.aria-label]="'Buy ' + e.item.name">Buy</button></td>
                                                    </tr>
                                                }
                                            </tbody>
                                        </table>
                                    }
                                </section>
                            }
                        </div>
                    }
                } @else {
                    <div class="shop-sub">Special order — search a specific part, roll to source it (may fail), then it ships in ~{{ deliveryMonths }} months at +{{ surchargePct }}% transport.</div>
                    <input type="search" class="shop-search" [value]="oosQuery()" (input)="setOosQuery($any($event.target).value)" placeholder="Search a part to request (e.g. Gauss, ER PPC)…" aria-label="Search out-of-system">
                    @if (requestMsg()) { <p class="req-msg">{{ requestMsg() }}</p> }
                    @if (oosResults().length) {
                        <div class="shop-scroll">
                            <table class="inv-tbl shop-tbl">
                                <tbody>
                                    @for (e of oosResults(); track e.item.id) {
                                        <tr>
                                            <td class="l">{{ e.item.name }}</td>
                                            <td class="av" title="availability code">{{ e.code }}</td>
                                            <td class="n">{{ money(e.price) }}</td>
                                            <td class="n"><button type="button" class="shopbtn req" [disabled]="!canAfford(e)" (click)="request(e)" [attr.aria-label]="'Request ' + e.item.name">Request</button></td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        </div>
                    } @else if (oosQuery().length >= 2) {
                        <p class="note thin">No era-legal part matches.</p>
                    }
                    @if (pendingOrders().length) {
                        <div class="orders">
                            <div class="orders-head">In transit ({{ pendingOrders().length }})</div>
                            @for (o of pendingOrders(); track o.id) {
                                <div class="order-row"><span class="o-name">{{ o.name }}</span><span class="o-meta">{{ o.qty }} {{ o.unit }} · {{ money(o.price) }} · delivers {{ orderWhen(o) }}</span></div>
                            }
                        </div>
                    }
                }
            </section>

            @for (cat of categories(); track cat.key) {
                <section class="inv-cat">
                    <button type="button" class="cat-head" (click)="toggle(cat.key)" [attr.aria-expanded]="!isCollapsed(cat.key)">
                        <span class="caret" [class.open]="!isCollapsed(cat.key)">▸</span>
                        <span class="cat-title">{{ cat.title }}</span>
                        <span class="cat-roll">{{ cat.rollup }}</span>
                    </button>
                    @if (!isCollapsed(cat.key)) {
                        @if (cat.lines.length === 0) {
                            <p class="note thin">None.</p>
                        } @else {
                            <table class="inv-tbl">
                                <thead><tr><th class="l">Item</th><th class="n">On hand</th><th class="n">Floor</th><th>Status</th><th class="notes">Notes</th><th></th></tr></thead>
                                <tbody>
                                    @for (line of cat.lines; track line.label) {
                                        <tr>
                                            <td class="l">{{ line.label }}</td>
                                            <!-- D-066: ON HAND is GM-adjustable — stepper + inline number → setLineOnHand (clamp ≥0, persist; status/rollup recompute live). -->
                                            <td class="n onhand">
                                                <span class="oh-ed">
                                                    <button type="button" class="adj" (click)="adjustOnHand(line, -1)" [disabled]="line.onHand <= 0" aria-label="decrease on hand">−</button>
                                                    <input type="number" inputmode="numeric" min="0" class="oh-in" [value]="line.onHand" (change)="setOnHand(line, $any($event.target).value)" [attr.aria-label]="line.label + ' on hand'">
                                                    <button type="button" class="adj" (click)="adjustOnHand(line, 1)" aria-label="increase on hand">+</button>
                                                </span>
                                                <span class="u">{{ line.unit }}</span>
                                            </td>
                                            <td class="n dim">{{ line.floor }}</td>
                                            <!-- D-059 seam: a Δ-since-last-cycle indicator mounts here (no consumption yet → no diff). -->
                                            <td><span class="chip" [class]="sevClass(line)">{{ statusOf(line) }}</span></td>
                                            <td class="notes">
                                                {{ line.notes }}
                                                @if (provenance(line.catalogId); as p) { <span class="prov" [attr.title]="p">· {{ p }}</span> }
                                            </td>
                                            <!-- DIRECTIVE-064: per-line SELL at the resale fraction (50%). -->
                                            <td class="n act"><button type="button" class="shopbtn sell" [disabled]="line.onHand <= 0" (click)="sell(line)" [title]="'Sell 1 at 50% resale (+' + money(resale(line)) + ' C-bills)'">Sell</button></td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    }
                </section>
            }
        }
    `,
    styles: [`
        /* D-066: stack as a flex column so the shop can be ordered LAST (owned stock leads); children stretch full-width. */
        :host { display: flex; flex-direction: column; }
        .ph { font-family: var(--label); font-weight: 600; letter-spacing: 2.5px; font-size: 13px; text-transform: uppercase; border-bottom: 1.5px solid var(--ink); padding-bottom: 6px; margin: 0 0 12px; }
        .ph .sub { font-family: var(--type); font-weight: 400; letter-spacing: normal; text-transform: none; font-size: 12px; color: var(--ink2); margin-left: 8px; }
        .note { font-family: var(--type); font-size: 13px; color: var(--ink2); }
        .note.thin { margin: 4px 0 0 22px; }
        .inv-meta { font-family: var(--mono); font-size: 11px; color: var(--ink2); margin-bottom: 12px; }
        .inv-meta .off { color: var(--stamp); }
        .inv-cat { border: 1.4px solid var(--ink); margin-bottom: 10px; background: var(--paper); }
        .cat-head { width: 100%; display: flex; align-items: center; gap: 10px; background: var(--panel); border: none; border-bottom: 1.4px solid var(--ink); padding: 9px 12px; cursor: pointer; text-align: left; }
        .cat-head:hover { background: var(--paper2); }
        .caret { display: inline-block; transition: transform .12s; color: var(--ink2); font-size: 12px; }
        .caret.open { transform: rotate(90deg); }
        .cat-title { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 12px; color: var(--ink); }
        .cat-roll { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink2); }
        .inv-tbl { width: 100%; border-collapse: collapse; font-family: var(--type); font-size: 13px; }
        .inv-tbl th { font-family: var(--label); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; font-size: 10px; color: var(--ink2); text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--ink2); }
        .inv-tbl th.n, .inv-tbl td.n { text-align: right; }
        .inv-tbl td { padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--ink2) 30%, transparent); vertical-align: top; }
        .inv-tbl tr:last-child td { border-bottom: none; }
        .inv-tbl td.l { font-weight: 600; color: var(--ink); }
        .inv-tbl .u { color: var(--ink2); font-size: 11px; }
        .inv-tbl td.dim { color: var(--ink2); }
        .inv-tbl td.notes { font-size: 11px; color: var(--ink2); max-width: 380px; }
        .prov { color: color-mix(in srgb, var(--ink2) 80%, transparent); font-style: italic; }
        .chip { font-family: var(--label); font-weight: 700; letter-spacing: 1px; font-size: 10px; padding: 2px 7px; border-radius: 3px; color: #fff; }
        .chip.sev-G { background: var(--ok, #3a7d44); }
        .chip.sev-Y { background: var(--warn, #c79a23); color: #1c1402; }
        .chip.sev-R { background: #c2622a; }
        .chip.sev-B { background: #5a1d1d; }
        .ledger { border: 1.4px solid var(--ink); background: var(--panel); padding: 8px 12px; margin-bottom: 14px; }
        .led-head { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 11px; color: var(--ink2); margin-bottom: 6px; }
        .led-head .sub { font-family: var(--type); font-weight: 400; letter-spacing: normal; text-transform: none; font-size: 11px; margin-left: 6px; }
        .led-row { display: flex; justify-content: space-between; align-items: baseline; font-family: var(--type); font-size: 13px; padding: 3px 0; }
        .led-l { color: var(--ink2); }
        .led-v { font-family: var(--mono); color: var(--ink); }
        .led-v.pos { color: var(--ok, #3a7d44); }
        .led-v.neg { color: #c2622a; }
        .led-row.net { border-top: 1px solid var(--ink2); margin-top: 4px; padding-top: 6px; font-weight: 600; }
        .led-row.net.black .led-v { color: var(--ok, #3a7d44); font-family: var(--label); letter-spacing: .5px; }
        .led-row.net.red .led-v { color: #c2622a; font-family: var(--label); letter-spacing: .5px; }
        /* DIRECTIVE-064 — the parts SHOP */
        .shop { order: 1; border: 1.4px solid var(--ink); background: var(--paper); margin-bottom: 14px; padding: 10px 12px; } /* D-066: shop renders LAST */
        .shop-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
        .shop-title { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 12px; color: var(--ink); }
        .shop-src { display: flex; gap: 5px; }
        .srcb { font-family: var(--mono); font-size: 10.5px; letter-spacing: .4px; padding: 6px 10px; border: 1.3px solid var(--ink2); background: var(--paper2); color: var(--ink2); cursor: pointer; min-height: 32px; }
        .srcb.on { border-color: var(--stamp); background: var(--stamp); color: var(--paper); }
        .srcb .sur { font-size: 9px; opacity: .85; }
        .shop-sub { font-family: var(--mono); font-size: 10.5px; color: var(--ink2); margin-bottom: 7px; }
        .shop-sub .off { color: var(--stamp); }
        .shop-search { width: 100%; box-sizing: border-box; font-family: var(--mono); font-size: 12px; padding: 7px 9px; border: 1.3px solid var(--ink); background: var(--paper2); color: var(--ink); min-height: 36px; margin-bottom: 8px; }
        .shop-tbl td.av { font-family: var(--mono); font-size: 11px; color: var(--ink2); text-align: center; }
        .stp { font-family: var(--mono); font-size: 8.5px; letter-spacing: .5px; text-transform: uppercase; color: var(--ok, #3a7d44); border: 1px solid var(--ok, #3a7d44); border-radius: 3px; padding: 0 4px; margin-left: 5px; vertical-align: 1px; }
        td.act { width: 1%; white-space: nowrap; }
        .shopbtn { font-family: var(--label); font-weight: 600; letter-spacing: .8px; font-size: 10px; text-transform: uppercase; border: 1.4px solid var(--ink); background: var(--paper); color: var(--ink); padding: 5px 10px; cursor: pointer; min-height: 30px; }
        .shopbtn.buy { border-color: var(--ok, #3a7d44); color: var(--ok, #3a7d44); }
        .shopbtn.buy:hover:not(:disabled) { background: var(--ok, #3a7d44); color: var(--paper); }
        .shopbtn.sell { border-color: var(--stamp); color: var(--stamp); }
        .shopbtn.sell:hover:not(:disabled) { background: var(--stamp); color: var(--paper); }
        .shopbtn.req { border-color: var(--stamp); color: var(--stamp); }
        .shopbtn.req:hover:not(:disabled) { background: var(--stamp); color: var(--paper); }
        .shopbtn:disabled { opacity: .4; cursor: not-allowed; }
        /* DIRECTIVE-065 — collapsible + bounded-scroll shop, the out-of-system request + in-transit orders */
        .shop-scroll { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; border: 1px solid var(--line); }
        .shop-cat { border-bottom: 1px solid var(--line); }
        .shop-cat:last-child { border-bottom: none; }
        .shop-cat .cat-head { border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 1; }
        .shop-sub b { color: var(--ink); }
        .req-msg { font-family: var(--mono); font-size: 11.5px; color: var(--ink); background: var(--paper2); border-left: 3px solid var(--stamp); padding: 7px 10px; margin: 0 0 8px; }
        .orders { margin-top: 10px; border: 1.3px solid var(--ink2); background: var(--paper2); padding: 8px 10px; }
        .orders-head { font-family: var(--label); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; font-size: 10px; color: var(--stamp); margin-bottom: 5px; }
        .order-row { display: flex; justify-content: space-between; gap: 10px; font-family: var(--mono); font-size: 11.5px; padding: 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--ink2) 22%, transparent); }
        .order-row:last-child { border-bottom: none; }
        .order-row .o-name { color: var(--ink); font-weight: 600; }
        .order-row .o-meta { color: var(--ink2); text-align: right; }
        /* D-066 — GM-adjustable ON HAND (stepper + inline number) */
        td.onhand { white-space: nowrap; }
        .oh-ed { display: inline-flex; align-items: center; gap: 2px; }
        .oh-ed .adj { font-family: var(--mono); font-size: 13px; line-height: 1; width: 22px; height: 26px; border: 1.2px solid var(--ink2); background: var(--paper2); color: var(--ink); cursor: pointer; padding: 0; }
        .oh-ed .adj:hover:not(:disabled) { border-color: var(--stamp); color: var(--stamp); }
        .oh-ed .adj:disabled { opacity: .4; cursor: not-allowed; }
        .oh-in { width: 46px; height: 26px; box-sizing: border-box; text-align: right; font-family: var(--mono); font-size: 12px; border: 1.2px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 0 4px; -moz-appearance: textfield; }
        .oh-in::-webkit-outer-spin-button, .oh-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    `],
})
export class InventoryTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly catalog = inject(CatalogClientService);
    private readonly shop = inject(InventoryShopService);

    protected readonly inv = this.state.inventory;
    protected readonly reachable = this.catalog.reachable;
    protected readonly statusOf = statusOf;

    // ── DIRECTIVE-064/065 SHOP — in-system local stock (capped/collapsible) + out-of-system request + per-line sell ──
    protected readonly source = signal<'in-system' | 'out-of-system'>('in-system');
    protected readonly shopSearch = signal('');   // in-system filter
    protected readonly oosQuery = signal('');      // out-of-system search
    protected readonly requestMsg = signal('');    // last out-of-system request outcome
    protected readonly shopLoaded = this.shop.loaded;
    protected readonly periodKey = this.shop.periodKey;
    protected readonly restockWeeks = this.shop.restockWeeks;
    protected readonly deliveryMonths = this.shop.deliveryMonths;
    protected readonly surchargePct = this.shop.surchargePct;
    protected readonly pendingOrders = this.shop.pendingOrders;

    /** In-system grouped into collapsible categories, filtered by the in-system search. */
    protected readonly inSystemCats = computed<ShopCategoryView[]>(() => {
        const q = this.shopSearch().toLowerCase().trim();
        const cats = this.shop.inSystemByCategory();
        if (!q) return cats;
        return cats.map((c) => ({ ...c, entries: c.entries.filter((e) => e.item.name.toLowerCase().includes(q)) })).filter((c) => c.entries.length);
    });
    protected readonly inSystemCount = computed(() => this.shop.inSystem().length);
    /** Out-of-system search results (request candidates). */
    protected readonly oosResults = computed<ShopEntry[]>(() => this.shop.oosSearch(this.oosQuery()));

    protected setSource(s: 'in-system' | 'out-of-system'): void { this.source.set(s); this.requestMsg.set(''); }
    protected setShopSearch(v: string): void { this.shopSearch.set(v); }
    protected setOosQuery(v: string): void { this.oosQuery.set(v); this.requestMsg.set(''); }
    protected buy(e: ShopEntry): void { this.shop.buyPart(e); }
    protected canAfford(e: ShopEntry): boolean { return this.shop.canAfford(e.price); }
    protected isShopOpen(key: string): boolean { return !this.isCollapsed('shop:' + key); }
    protected toggleShop(key: string): void { this.toggle('shop:' + key); }
    /** Request an out-of-system item → roll → message (ordered / not sourced / can't afford). */
    protected request(e: ShopEntry): void {
        const r = this.shop.requestOrder(e.item);
        if (r.ordered) this.requestMsg.set(`Ordered ${e.item.name} — ${this.money(this.shop.outOfSystemPrice(e.item))} C-bills, delivering in ~${this.deliveryMonths} months.`);
        else if (!r.sourced) this.requestMsg.set(`${e.item.name}: not sourced this cycle (rolled ${r.roll} vs TN ${r.tn}) — try again after the next restock.`);
        else this.requestMsg.set(`${e.item.name}: sourced — but you can't afford the ${this.money(this.shop.outOfSystemPrice(e.item))} C-bills.`);
    }
    protected orderWhen(o: { deliver: { y: number; m: number; d: number } }): string { return `${o.deliver.y}-${String(o.deliver.m + 1).padStart(2, '0')}-${String(o.deliver.d).padStart(2, '0')}`; }
    protected sell(line: InventoryLine): void { this.shop.sellLine(line); }
    protected resale(line: InventoryLine): number { return this.shop.resaleValue(line); }
    // D-066: GM on-hand override — set/step an owned line's on-hand (clamp ≥0, persist; status + rollup recompute live).
    protected setOnHand(line: InventoryLine, raw: string): void { const n = Number(raw); if (Number.isFinite(n)) this.shop.setLineOnHand(line, n); }
    protected adjustOnHand(line: InventoryLine, delta: number): void { this.shop.setLineOnHand(line, line.onHand + delta); }

    private readonly provMap = signal<Record<string, string>>({});
    private readonly collapsed = signal<Set<string>>(this.loadCollapsed());

    protected readonly categories = computed<CategoryView[]>(() => {
        const lines = this.inv()?.lines ?? [];
        const pick = (c: InventoryCategory) => lines.filter((l) => l.category === c);
        const tons = (ls: InventoryLine[]) => ls.reduce((s, l) => s + (l.unit === 'tons' ? l.onHand : 0), 0);
        const count = (ls: InventoryLine[]) => ls.reduce((s, l) => s + (l.unit === 'count' ? l.onHand : 0), 0);
        const ammo = pick('ammunition');
        const armor = pick('armor');
        const comp = pick('component');
        return [
            { key: 'ammunition' as const, title: 'Ammunition', rollup: `${tons(ammo)} tons · ${ammo.length} lines`, lines: ammo },
            { key: 'armor' as const, title: 'Armor', rollup: `${tons(armor)} tons · ${armor.length} lines`, lines: armor },
            { key: 'component' as const, title: 'Unit Inventory', rollup: `${count(comp)} items · ${comp.length} lines`, lines: comp }, // D-066: the unit's held parts
        ];
    });

    // D-058: the monthly economy projection — treasury vs recurring income/burn. D-074: the computation moved
    // to the shared computeLedger() util so the Overview economy summary reads the IDENTICAL numbers (single
    // source, no drift). DATA-003: pure derivation, not stored.
    protected readonly ledger = computed(() => computeLedger(this.state));
    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected absVal(n: number): number { return Math.abs(n); }

    constructor() {
        // Catalog provenance join (display-only; the catalog is read-only host data, not campaign state).
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y;
        void this.catalog.list({ era: year ?? undefined }).then((rows) => {
            const m: Record<string, string> = {};
            for (const r of rows) if (r.provenance) m[r.id] = r.provenance;
            this.provMap.set(m);
        });
        this.shop.reload(); // ensure the shop's era-legal catalog loads when the tab opens (never an empty shop)
    }

    protected sevClass(line: InventoryLine): string {
        return SEV[statusOf(line)];
    }
    protected provenance(catalogId: string | null): string | null {
        return catalogId ? this.provMap()[catalogId] ?? null : null;
    }
    protected isCollapsed(key: string): boolean {
        return this.collapsed().has(key);
    }
    protected toggle(key: string): void {
        const next = new Set(this.collapsed());
        next.has(key) ? next.delete(key) : next.add(key);
        this.collapsed.set(next);
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* non-fatal */ }
    }
    private loadCollapsed(): Set<string> {
        try { const raw = localStorage.getItem(COLLAPSE_KEY); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* */ }
        return new Set();
    }
}
