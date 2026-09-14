/*
 * FORKED FROM campaign/inventory/inventory-tab.ts @ 02c88a1 — DIRECTIVE-ODM-13 Phase 3 (a DRIFT SURFACE).
 * THE QUARTERMASTER'S LEDGER — the survival inventory. What Classic renders as a store-and-ledger surface
 * (the monthly projection, the parts trade, per-line disposal-for-cash) is GONE here (Ruling 3c): the company holds STOCK, and
 * stock only ever arrives from the field. What stays: the owned lines by category (armor + components — ammo
 * is ALWAYS magazine bins, Ruling 1/2), the catalog provenance join, and the GM on-hand adjust (fork-owned —
 * Classic's stepper routes through its trade service; this one writes campaign state directly). Added: a
 * read-only STOCKS summary (the ODM-11 gauges live on Overview) and the DONOR STOCK list (COLD hulks — the
 * strip control itself lives at the Repair Bays, ONE place only).
 * NB: comments AND strings here reach the served GM bundle — never name pack content (the odm2 leak-net).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NewCampaignState, type CampaignStartDate } from '../new-campaign-state';
import { CatalogClientService } from '../catalog/catalog-client.service';
import { statusOf, type CatalogItem, type InventoryCategory, type InventoryLine, type InventoryStatus } from '../inventory/starting-inventory';
import { CampaignSaveStore } from '../campaign-save-store';
import { OdmRepairBaysService } from './odm-repair-bays.service';
import { fuelPct, fuelState, opsRemaining, binBreach, round1 } from './odm-stocks';
import { effGrades, ODM_BENCH } from './odm-materiel'; // ODM-17 P3 — grades and the lifecycle
import { OdmSupportService, type OdmSupportRow } from './odm-support.service'; // ODM-17 P4-d — the support register

interface CategoryView {
    key: InventoryCategory;
    title: string;
    rollup: string;
    lines: InventoryLine[];
}

const COLLAPSE_KEY = 'bce.odm.qm.collapsed'; // fork-owned UI state — never shared with the Classic tab
const SEV: Record<InventoryStatus, string> = { GOOD: 'sev-G', LOW: 'sev-Y', CRITICAL: 'sev-R', OUT: 'sev-B' };
// Same shape as the Classic trade service's private key (module-private there) — lockstep copy, noted.
import { depotDrawer, type DepotDrawerGroup } from './odm-depot-drawer'; // QM-1 — tier 2, the zero-stock drawer

const lineKey = (l: InventoryLine): string => `${l.catalogId ?? 'null'}|${l.category}|${l.label}`;

@Component({
    selector: 'bce-odm-inventory-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ph">Quartermaster <span class="sub">the ledger of what the company owns — nothing arrives that the field did not give up</span></div>

        @if (!inv()) {
            <p class="note">No stores on the books yet — the quartermaster's count is taken at Begin (and back-fills an older save on first open).</p>
        } @else {
            <div class="inv-meta">Rolled {{ inv()!.generatedAt }} · tier <b>{{ inv()!.tier }}</b> · {{ inv()!.lines.length }} lines @if (!reachable()) {<span class="off">· catalog offline (citations hidden)</span>}</div>

            <!-- ODM-13 P3 — the read-only STOCKS summary; the full gauges (and the GM adjust) live on Overview. -->
            @if (stocks(); as s) {
                <div class="stocks" data-testid="odm-qm-stocks">
                    <div class="led-head">Stocks <span class="sub">fuel + magazine — full gauges on the Overview tab</span></div>
                    <div class="led-row"><span class="led-l">Fuel</span><span class="led-v" [class.warn]="fState(s) === 'amber'" [class.crit]="fState(s) === 'red'">{{ r1(s.fuelTons) }} t ({{ fPct(s) }}%) · ≈{{ opsLeft(s) }} operations in the tanks</span></div>
                    <div class="led-row"><span class="led-l">Magazine</span><span class="led-v" [class.crit]="breached().length > 0">{{ r1(magazineTons()) }} t across {{ binCount() }} bins@if (breached().length) { · BREACH: {{ breached().join(', ') }} }</span></div>
                    <!-- ODM-17 P3-d — ASSESS-FIRST lots sit OUTSIDE the usable pool until benched (doctrine Part V). -->
                    @if (quarantined().length) {
                        <div class="led-row"><span class="led-l">Quarantine</span><span class="led-v warn" data-testid="odm-qm-quarantine">
                            @for (q of quarantined(); track q.name) { <span class="qlot">{{ q.tons }} t {{ q.name }} — unusable by rearm <button type="button" class="bch" (click)="clearQuarantine(q.name)">Bench-clear ({{ qHours(q.tons) }} h)</button></span> }
                        </span></div>
                    }
                </div>
            }

            <!-- ══ QM-1 TIER 2 — THE DRAWER. Everything the era allows that this company does NOT hold, at
                 zero. ODM's premise is that nothing here is replaceable, and a depot listing only holdings
                 hides the SHAPE of the shortage — which is the campaign. A zero line is a fact; an absent
                 line is ignorance. Collapsed by default: a drawer, not a wall. ══ -->
            @if (drawer().length) {
                <section class="inv-cat depot-drawer">
                    <button type="button" class="cat-head" (click)="toggleDrawer()" [attr.aria-expanded]="drawerOpen()" data-testid="odm-depot-drawer">
                        <span class="caret" [class.open]="drawerOpen()">▸</span>
                        <span class="cat-title">Not held — the rest of the era</span>
                        <span class="cat-roll">{{ drawerCount() }} era-legal items at zero · {{ drawer().length }} categories</span>
                    </button>
                    @if (drawerOpen()) {
                        <p class="note thin dd-why" data-testid="odm-depot-why">Every component the era allows that you have none of. Zero-stock lines are
                            <b>read-only</b> until the repair loop can consume them — nothing here can be stocked yet, and a
                            depot promising materiel the bays cannot spend would be worse than one that says nothing.
                            Ammunition is not listed: it is tracked as magazine bins above.</p>
                        <!-- THREE STATES, none of them silence. Dropping the complete and empty-era cases
                             would make silence mean two different things, which is the absent-vs-zero bug
                             this feature exists to fix, reappearing inside the fix. Worded as COMPLETENESS
                             — this is the full era catalogue, and "your armor coverage is complete" is a
                             real fact in a campaign about scarcity, not filler. -->
                        @for (g of drawer(); track g.key) {
                            <div class="dd-group" [attr.data-testid]="'odm-depot-group-' + g.key" [attr.data-state]="g.state">
                                @switch (g.state) {
                                    @case ('complete') {
                                        <div class="dd-head dd-done">{{ g.title }} <span class="dd-note">— all {{ g.eraLegal }} era-legal type{{ g.eraLegal === 1 ? '' : 's' }} held</span></div>
                                    }
                                    @case ('none-in-era') {
                                        <div class="dd-head dd-none">{{ g.title }} <span class="dd-note">— none exist in this era</span></div>
                                    }
                                    @default {
                                        <div class="dd-head">{{ g.title }} <span class="dd-n">{{ g.items.length }} of {{ g.eraLegal }} not held</span></div>
                                        <ul class="dd-list">
                                            @for (it of g.items; track it.id) { <li class="dd-item"><span class="dd-name">{{ it.name }}</span><span class="dd-zero">0</span></li> }
                                        </ul>
                                    }
                                }
                            </div>
                        }
                    }
                </section>
            }

            @for (cat of categories(); track cat.key) {
                <section class="inv-cat">
                    <button type="button" class="cat-head" (click)="toggle(cat.key)" [attr.aria-expanded]="!isCollapsed(cat.key)">
                        <span class="caret" [class.open]="!isCollapsed(cat.key)">▸</span>
                        <span class="cat-title">{{ cat.title }}</span>
                        <span class="cat-roll">{{ cat.rollup }}</span>
                    </button>
                    @if (!isCollapsed(cat.key)) {
                        @if (cat.lines.length === 0) {
                            <p class="note thin">None. Stores come off the field — strip what you leave behind.</p>
                        } @else {
                            <table class="inv-tbl">
                                <thead><tr><th class="l">Item</th><th class="n">On hand</th>@if (cat.key === 'component') { <th class="l">Grades — the bench (doctrine: RAW installs NOTHING)</th> }<th class="n">Floor</th><th>Status</th><th class="notes">Notes</th></tr></thead>
                                <tbody>
                                    @for (line of cat.lines; track line.label) {
                                        <tr>
                                            <td class="l">{{ line.label }}</td>
                                            <!-- D-066 pattern, fork-owned: ON HAND adjust writes state directly (clamp ≥0, persist). -->
                                            <td class="n onhand">
                                                <span class="oh-ed">
                                                    <button type="button" class="adj" (click)="adjustOnHand(line, -1)" [disabled]="line.onHand <= 0" aria-label="decrease on hand">−</button>
                                                    <input type="number" inputmode="numeric" min="0" class="oh-in" [value]="line.onHand" (change)="setOnHand(line, $any($event.target).value)" [attr.aria-label]="line.label + ' on hand'">
                                                    <button type="button" class="adj" (click)="adjustOnHand(line, 1)" aria-label="increase on hand">+</button>
                                                </span>
                                                <span class="u">{{ line.unit }}</span>
                                            </td>
                                            <!-- ODM-17 P3-a/b — the A/B/C/RAW ledger + the bench actions (1–4 h/item, MAC-7). -->
                                            @if (cat.key === 'component') {
                                                <td class="grades" [attr.data-testid]="'odm-grades-' + line.label">
                                                    <span class="gch ga">A {{ g(line).a }}</span><span class="gch gb">B {{ g(line).b }}</span><span class="gch gc">C {{ g(line).c }}</span><span class="gch graw">RAW {{ g(line).raw }}</span>
                                                    @if (g(line).raw > 0 && assessFor() !== line.label) { <button type="button" class="bch" (click)="openAssess(line)">Bench-assess</button> }
                                                    @if (g(line).b > 0) { <button type="button" class="bch" (click)="inspectB(line)">Inspect B→A ({{ r1(g(line).b * BENCH.inspectPerItem) }} h)</button> }
                                                    @if (g(line).c > 0) { <button type="button" class="bch" (click)="repairC(line)">Repair C→A ({{ r1(g(line).c * BENCH.repairPerItem) }} h)</button> }
                                                    @if (assessFor() === line.label) {
                                                        <span class="asx" data-testid="odm-assess-form">grade →
                                                            A <input type="number" min="0" class="oh-in gx" [value]="axA()" (input)="axA.set($any($event.target).valueAsNumber || 0)">
                                                            B <input type="number" min="0" class="oh-in gx" [value]="axB()" (input)="axB.set($any($event.target).valueAsNumber || 0)">
                                                            C <input type="number" min="0" class="oh-in gx" [value]="axC()" (input)="axC.set($any($event.target).valueAsNumber || 0)">
                                                            <button type="button" class="bch go" [disabled]="!assessValid(line)" (click)="confirmAssess(line)">To the bench ({{ assessHours() }} h)</button>
                                                            <button type="button" class="bch" (click)="assessFor.set(null)">×</button>
                                                        </span>
                                                    }
                                                </td>
                                            }
                                            <td class="n dim">{{ line.floor }}</td>
                                            <td><span class="chip" [class]="sevClass(line)">{{ statusOf(line) }}</span></td>
                                            <td class="notes">
                                                {{ line.notes }}
                                                @if (provenance(line.catalogId); as p) { <span class="prov" [attr.title]="p">· {{ p }}</span> }
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    }
                </section>
            }

            <!-- ODM-13 P3 — DONOR STOCK (Ruling 4): cold hulks ARE stores-on-legs. Read-only here; the strip
                 control lives at the Repair Bays (one place only — it settles held jobs on the spot). -->
            <section class="inv-cat donors" data-testid="odm-qm-donors">
                <div class="cat-head static">
                    <span class="cat-title">Donor Stock — cold hulks</span>
                    <span class="cat-roll">{{ donors().length }}</span>
                </div>
                @if (donors().length === 0) {
                    <p class="note thin">No hulks in the yard. Recover what the field leaves standing.</p>
                } @else {
                    <table class="inv-tbl">
                        <thead><tr><th class="l">Hulk</th><th>Condition</th><th class="notes">Recoverable (approx.)</th></tr></thead>
                        <tbody>
                            @for (d of donors(); track d.inst.instanceId) {
                                <tr>
                                    <td class="l">{{ d.label }}</td>
                                    <td><span class="chip" [class]="'sev-' + d.sev">{{ sevWord(d.sev) }}</span></td>
                                    <td class="notes">{{ yieldText(d) }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                    <p class="note thin">Strip a donor at the <b>Repair Bays</b> — a strip can free a held job on the spot.</p>
                }
            </section>

            <!-- ODM-17 P3-b — THE BENCH (the doctrine's IN-SHOP): items out of the stores while the hours burn. -->
            <section class="inv-cat" data-testid="odm-qm-bench">
                <div class="cat-head static">
                    <span class="cat-title">The Bench — IN-SHOP</span>
                    <span class="cat-roll">{{ bench().length }} job{{ bench().length === 1 ? '' : 's' }} · {{ benchHoursLeft() }} h remaining</span>
                </div>
                @if (!bench().length) {
                    <p class="note thin">Nothing on the bench. RAW stock cannot be installed until it is bench-assessed (1–4 h per item, MAC-7 only).</p>
                } @else {
                    <table class="inv-tbl">
                        <thead><tr><th class="l">Item</th><th>Work</th><th class="n">Count</th><th class="n">Hours left</th></tr></thead>
                        <tbody>
                            @for (j of bench(); track j.id) {
                                <tr><td class="l">{{ j.label }}</td><td>{{ benchKind(j.kind) }}</td><td class="n">{{ j.count }}{{ j.kind === 'ammo' ? ' t' : '' }}</td><td class="n">{{ j.hoursRemaining }}</td></tr>
                            }
                        </tbody>
                    </table>
                    <p class="note thin">The bench takes the day's leftover MAC-7 hours — the bays burn first (strict priority arrives with the maintenance ladder).</p>
                }
            </section>

            <!-- ODM-17 P4-d — THE SUPPORT REGISTER (battlefield assets; the wrecker's coupling moves the
                 FIELD pool live). Floors breach in ODM-11 style; deploy/expend are the GM's steppers. -->
            <section class="inv-cat" data-testid="odm-qm-assets">
                <div class="cat-head static">
                    <span class="cat-title">Battlefield Assets — the support register</span>
                    <span class="cat-roll">{{ supportRows().length }} assets @if (wreckerLost()) { · <b class="lostb">ENG-01 LOST — field salvage degraded</b> }</span>
                </div>
                @if (!supportRows().length) {
                    <p class="note thin">Register loading (or not entitled) — assets render from the pack seed + the live overlay.</p>
                } @else {
                    <table class="inv-tbl">
                        <thead><tr><th class="l">Asset</th><th>Auth</th><th class="n">Avail</th><th class="n">Deployed</th><th class="n">Expended</th><th class="n">Floor</th><th class="notes">Dependency / notes</th></tr></thead>
                        <tbody>
                            @for (r of supportRows(); track r.id) {
                                <tr [attr.data-testid]="'odm-asset-' + r.id">
                                    <td class="l">{{ r.id }} · {{ r.name }} @if (r.lost) { <span class="chip sev-B">LOST</span> } @else if (r.status !== 'OPERATIONAL') { <span class="chip sev-Y">{{ r.status }}</span> }</td>
                                    <td class="dim">{{ r.authLevel }}</td>
                                    <td class="n" [class.breachtxt]="r.breach"><b>{{ r.live.available }}</b>/{{ r.total }} @if (r.breach) { <span class="stk-breach">BREACH</span> }</td>
                                    <td class="n">{{ r.live.deployed }}
                                        <button type="button" class="adj" (click)="assetDeploy(r)" [disabled]="r.live.available <= 0" aria-label="deploy one">▸</button>
                                        <button type="button" class="adj" (click)="assetReturn(r)" [disabled]="r.live.deployed <= 0" aria-label="return one">◂</button>
                                    </td>
                                    <td class="n">{{ r.live.expended }}
                                        <button type="button" class="adj" (click)="assetExpend(r)" [disabled]="r.live.available + r.live.deployed <= 0" aria-label="expend one">✕</button>
                                    </td>
                                    <td class="n dim">{{ r.floorMinimum }}</td>
                                    <td class="notes">@if (r.dependency) { <b>needs:</b> {{ r.dependency }} · } {{ r.notes }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                    <p class="note thin">Expending is permanent (CONSUMED). The wrecker (ENG-01) is the field pool's teeth: operational +20 h/day; lost, field salvage drops to 80 h/day and RED-triage recovery doubles. Aero sortie fuel dependencies render as data — the Hawthorn's tank is not tracked separately in v1.</p>
                }
            </section>

            <!-- ODM-17 P4-d — WHAT CANNOT BE SALVAGED (doctrine Part VI, as data — the walk's physics already
                 excludes gyro/engine/JJ; this is the doctrine's own reasoning on the record). -->
            @if (unsalvageable().length) {
                <section class="inv-cat" data-testid="odm-qm-unsalvageable">
                    <div class="cat-head static"><span class="cat-title">What Cannot Be Salvaged</span><span class="cat-roll">doctrine — not worth recovering under any standard condition</span></div>
                    <table class="inv-tbl"><tbody>
                        @for (u of unsalvageable(); track u.item) { <tr><td class="l">{{ u.item }}</td><td class="notes">{{ u.reason }}</td></tr> }
                    </tbody></table>
                </section>
            }

            <!-- ODM-17 P3-c — THE PARTS LEDGER (append-only = immutable; the record IS the authority). -->
            <section class="inv-cat" data-testid="odm-qm-ledger">
                <div class="cat-head static">
                    <span class="cat-title">Parts Ledger</span>
                    <span class="cat-roll">RAW → IN-SHOP → CACHED → INSTALLED / CONSUMED — immutable history</span>
                </div>
                @if (!partsLog().length) {
                    <p class="note thin">No lifecycle entries yet — strips land RAW, the bench grades them, installs write themselves here.</p>
                } @else {
                    <table class="inv-tbl">
                        <tbody>
                            @for (e of partsLog(); track $index) {
                                <tr><td class="dim l" style="white-space:nowrap">{{ ld(e.date) }}</td><td class="notes">{{ e.text }}</td></tr>
                            }
                        </tbody>
                    </table>
                }
            </section>
        }
    `,
    styles: [`
        /* QM-1 — the tier-2 drawer. Deliberately quieter than tier 1: held stock is the subject, the
           shortage is the context. Zeroes render dim so a stocked line never loses the eye to an empty one. */
        .depot-drawer .cat-title { opacity: .85; }
        .dd-why { margin: 6px 0 10px; opacity: .8; }
        .dd-group { margin: 0 0 10px; }
        .dd-head { font-family: var(--label, inherit); font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; opacity: .7; margin-bottom: 3px; }
        .dd-head .dd-n { opacity: .55; margin-left: 6px; }
        .dd-head .dd-note { opacity: .6; margin-left: 6px; font-style: italic; text-transform: none; letter-spacing: 0; }
        .dd-done .dd-note { color: var(--ok, #3a7d44); opacity: .8; } /* completeness is a POSITIVE fact here */
        .dd-none { opacity: .55; }
        .dd-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1px 14px; }
        .dd-item { display: flex; align-items: baseline; gap: 8px; font-family: var(--mono, monospace); font-size: 11.5px; opacity: .72; }
        .dd-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dd-zero { flex: 0 0 auto; opacity: .55; }

        :host { display: flex; flex-direction: column; }
        .ph { font-family: var(--label); font-weight: 600; letter-spacing: 2.5px; font-size: 13px; text-transform: uppercase; border-bottom: 1.5px solid var(--ink); padding-bottom: 6px; margin: 0 0 12px; }
        .ph .sub { font-family: var(--type); font-weight: 400; letter-spacing: normal; text-transform: none; font-size: 12px; color: var(--ink2); margin-left: 8px; }
        .note { font-family: var(--type); font-size: 13px; color: var(--ink2); }
        .note.thin { margin: 4px 0 0 22px; }
        .note b { color: var(--ink); }
        .inv-meta { font-family: var(--mono); font-size: 11px; color: var(--ink2); margin-bottom: 12px; }
        .inv-meta .off { color: var(--stamp); }
        .inv-cat { border: 1.4px solid var(--ink); margin-bottom: 10px; background: var(--paper); }
        .inv-cat.donors .note.thin { margin: 6px 12px 10px; }
        .cat-head { width: 100%; display: flex; align-items: center; gap: 10px; background: var(--panel); border: none; border-bottom: 1.4px solid var(--ink); padding: 9px 12px; cursor: pointer; text-align: left; }
        .cat-head:hover { background: var(--paper2); }
        .cat-head.static { cursor: default; }
        .cat-head.static:hover { background: var(--panel); }
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
        /* ODM-13 P3 — the read-only stocks strip (the ledger frame, repurposed for materiel) */
        .stocks { border: 1.4px solid var(--ink); background: var(--panel); padding: 8px 12px; margin-bottom: 14px; }
        .led-head { font-family: var(--label); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; font-size: 11px; color: var(--ink2); margin-bottom: 6px; }
        .led-head .sub { font-family: var(--type); font-weight: 400; letter-spacing: normal; text-transform: none; font-size: 11px; margin-left: 6px; }
        .led-row { display: flex; justify-content: space-between; align-items: baseline; font-family: var(--type); font-size: 13px; padding: 3px 0; }
        .led-l { color: var(--ink2); }
        .led-v { font-family: var(--mono); color: var(--ink); }
        .led-v.warn { color: var(--warn, #c79a23); }
        .led-v.crit { color: #c2622a; }
        /* D-066 — GM-adjustable ON HAND (stepper + inline number) */
        td.onhand { white-space: nowrap; }
        .oh-ed { display: inline-flex; align-items: center; gap: 2px; }
        .oh-ed .adj { font-family: var(--mono); font-size: 13px; line-height: 1; width: 22px; height: 26px; border: 1.2px solid var(--ink2); background: var(--paper2); color: var(--ink); cursor: pointer; padding: 0; }
        .oh-ed .adj:hover:not(:disabled) { border-color: var(--stamp); color: var(--stamp); }
        .oh-ed .adj:disabled { opacity: .4; cursor: not-allowed; }
        .oh-in { width: 46px; height: 26px; box-sizing: border-box; text-align: right; font-family: var(--mono); font-size: 12px; border: 1.2px solid var(--ink); background: var(--paper2); color: var(--ink); padding: 0 4px; -moz-appearance: textfield; }
        .oh-in::-webkit-outer-spin-button, .oh-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        /* ODM-17 P3 — grade chips + bench controls + quarantine */
        td.grades { font-family: var(--mono); font-size: 11px; white-space: normal; }
        .gch { display: inline-block; border: 1.2px solid var(--ink2); border-radius: 2px; padding: 1px 5px; margin-right: 4px; font-weight: 700; font-size: 10px; }
        .gch.ga { border-color: var(--ok, #3a7d44); color: var(--ok, #3a7d44); }
        .gch.gb { border-color: var(--warn, #c79a23); color: var(--warn, #c79a23); }
        .gch.gc { border-color: #c2622a; color: #c2622a; }
        .gch.graw { border-color: var(--ink2); color: var(--ink2); }
        .bch { font-family: var(--mono); font-size: 10px; border: 1.2px solid var(--ink2); background: var(--paper2); color: var(--ink); cursor: pointer; padding: 2px 6px; margin: 2px 4px 0 0; }
        .bch:hover:not(:disabled) { border-color: var(--stamp); color: var(--stamp); }
        .bch:disabled { opacity: .4; cursor: not-allowed; }
        .bch.go { border-color: var(--ok, #3a7d44); }
        .asx { display: inline-flex; align-items: center; gap: 4px; margin-top: 3px; }
        .oh-in.gx { width: 36px; }
        .qlot { display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; }
        /* ODM-17 P4-d — the support register */
        .lostb { color: #c2622a; }
        td.breachtxt b { color: #c2622a; }
    `],
})
export class OdmInventoryTabComponent {
    private readonly state = inject(NewCampaignState);
    private readonly catalog = inject(CatalogClientService);
    private readonly store = inject(CampaignSaveStore);
    private readonly bays = inject(OdmRepairBaysService); // donor list — the SAME derivation the bays use (one source)

    protected readonly inv = this.state.inventory;
    protected readonly reachable = this.catalog.reachable;
    protected readonly statusOf = statusOf;
    protected readonly stocks = this.state.odmStocks;
    protected readonly donors = this.bays.donors;

    // ── the stocks strip derivations (odm-stocks pure fns, aliased for the template) ──
    protected readonly fPct = fuelPct;
    protected readonly fState = fuelState;
    protected readonly opsLeft = opsRemaining;
    protected readonly r1 = round1;
    protected readonly magazineTons = computed(() => Object.values(this.stocks()?.bins ?? {}).reduce((s, b) => s + b.tons, 0));
    protected readonly binCount = computed(() => Object.keys(this.stocks()?.bins ?? {}).length);
    protected readonly breached = computed(() =>
        Object.entries(this.stocks()?.bins ?? {}).filter(([, b]) => binBreach(b.tons, b.floorTons)).map(([name]) => name));

    private readonly provMap = signal<Record<string, string>>({});
    private readonly collapsed = signal<Set<string>>(this.loadCollapsed());

    // ── ODM-17 P3 — grades, the bench, quarantine, the ledger ──
    protected readonly g = effGrades;
    protected readonly BENCH = ODM_BENCH;
    protected readonly bench = this.state.odmBench;
    protected readonly benchHoursLeft = computed(() => round1(this.bench().reduce((s, j) => s + j.hoursRemaining, 0)));
    protected readonly partsLog = computed(() => (this.state.campaignLog() ?? []).filter((e) => e.kind === 'parts').slice(-12).reverse());
    protected readonly quarantined = computed(() =>
        Object.entries(this.stocks()?.bins ?? {}).filter(([, b]) => (b.quarantinedTons ?? 0) > 0).map(([name, b]) => ({ name, tons: round1(b.quarantinedTons ?? 0) })));
    protected readonly assessFor = signal<string | null>(null);
    protected readonly axA = signal(0);
    protected readonly axB = signal(0);
    protected readonly axC = signal(0);
    protected openAssess(line: InventoryLine): void { const raw = effGrades(line).raw; this.assessFor.set(line.label); this.axA.set(raw); this.axB.set(0); this.axC.set(0); }
    protected assessTotal(): number { return (this.axA() || 0) + (this.axB() || 0) + (this.axC() || 0); }
    protected assessValid(line: InventoryLine): boolean { const n = this.assessTotal(); return n > 0 && n <= effGrades(line).raw && this.axA() >= 0 && this.axB() >= 0 && this.axC() >= 0; }
    protected assessHours(): number { return round1(this.assessTotal() * ODM_BENCH.assessPerItem); }
    protected confirmAssess(line: InventoryLine): void {
        if (!this.assessValid(line)) return;
        this.bays.benchAssess(line.label, { a: this.axA() || 0, b: this.axB() || 0, c: this.axC() || 0 });
        this.assessFor.set(null);
    }
    protected inspectB(line: InventoryLine): void { this.bays.benchInspect(line.label, effGrades(line).b); }
    protected repairC(line: InventoryLine): void { this.bays.benchRepair(line.label, effGrades(line).c); }
    protected clearQuarantine(bin: string): void { this.bays.benchAmmoClear(bin); }
    protected qHours(tons: number): number { return round1(tons * ODM_BENCH.ammoPerTon); }
    protected benchKind(k: string): string { return ({ assess: 'Assessment (RAW → graded)', inspect: 'Inspection (B → A)', repair: 'Parts-repair (C → A)', ammo: 'Quarantine clearance' } as Record<string, string>)[k] ?? k; }
    protected ld(d: CampaignStartDate): string { return `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }

    // ── ODM-17 P4-d — the support register (service-owned rows; the steppers persist the overlay) ──
    private readonly support = inject(OdmSupportService);
    protected readonly supportRows = this.support.rows;
    protected readonly unsalvageable = this.support.unsalvageable;
    protected readonly wreckerLost = this.support.redRecoveryDoubled;
    protected assetDeploy(r: OdmSupportRow): void { this.support.adjust(r.id, { available: r.live.available - 1, deployed: r.live.deployed + 1 }); void this.store.persistCurrent(); }
    protected assetReturn(r: OdmSupportRow): void { this.support.adjust(r.id, { available: r.live.available + 1, deployed: r.live.deployed - 1 }); void this.store.persistCurrent(); }
    protected assetExpend(r: OdmSupportRow): void {
        // expend from DEPLOYED first (the thing out working is what gets used up), else from stores
        const fromDeployed = r.live.deployed > 0;
        this.support.adjust(r.id, { deployed: fromDeployed ? r.live.deployed - 1 : r.live.deployed, available: fromDeployed ? r.live.available : r.live.available - 1, expended: r.live.expended + 1 });
        this.state.setCampaignLog([...(this.state.campaignLog() ?? []), { date: this.state.currentDate() ?? this.state.startDate() ?? { y: 2767, m: 0, d: 1 }, text: `Support register — ${r.id} ${r.name} EXPENDED (permanent; ${Math.max(0, (fromDeployed ? r.live.available : r.live.available - 1) + (fromDeployed ? r.live.deployed - 1 : r.live.deployed))} remain)`, kind: 'parts' }]);
        void this.store.persistCurrent();
    }

    /** Armor + components ONLY — ammunition is ALWAYS magazine bins (Ruling 1/2), never a ledger line. */
    protected readonly categories = computed<CategoryView[]>(() => {
        const lines = this.inv()?.lines ?? [];
        const pick = (c: InventoryCategory) => lines.filter((l) => l.category === c);
        const tons = (ls: InventoryLine[]) => ls.reduce((s, l) => s + (l.unit === 'tons' ? l.onHand : 0), 0);
        const count = (ls: InventoryLine[]) => ls.reduce((s, l) => s + (l.unit === 'count' ? l.onHand : 0), 0);
        const armor = pick('armor');
        const comp = pick('component');
        return [
            { key: 'armor' as const, title: 'Armor', rollup: `${tons(armor)} tons · ${armor.length} lines`, lines: armor },
            { key: 'component' as const, title: 'Component Stores', rollup: `${count(comp)} items · ${comp.length} lines`, lines: comp },
        ];
    });

    /* ── QM-1 TIER 2 — the zero-stock drawer. Sourced from /api/catalog, which is ALREADY era-filtered
       server-side and already carries the depot's own id space: all 24 authored lines resolve in it,
       `struct:*` included, so promotion fills the existing line instead of minting a duplicate. It also
       carries engine/gyro/cockpit/actuator — literally "every possible component and engine".

       NO EXTRA FETCH: the constructor already pulls these rows for the provenance join, so the drawer
       reuses them rather than adding a call. The only new request is the 'Mech-relevance id set, the same
       106 KB same-origin asset inventory-shop.service already loads, and it is NOT on the slice or
       full-catalog path — so this whole feature is resume-clean. ── */
    private readonly catalogRows = signal<CatalogItem[]>([]);
    private readonly relevantIds = signal<ReadonlySet<string> | null>(null);
    protected readonly drawerOpen = signal(false); // COLLAPSED by default — a drawer, not a wall
    protected toggleDrawer(): void { this.drawerOpen.update((v) => !v); }
    protected readonly drawer = computed<DepotDrawerGroup[]>(() =>
        depotDrawer(this.catalogRows(), this.inv()?.lines ?? [], this.relevantIds()));
    protected readonly drawerCount = computed(() => this.drawer().reduce((n, g) => n + g.items.length, 0));

    constructor() {
        void this.support.ensureLoaded(); // ODM-17 P4-d — the register renders here
        // Catalog provenance join (display-only; the catalog is read-only host data, not campaign state).
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y;
        void this.catalog.list({ era: year ?? undefined }).then((rows) => {
            const m: Record<string, string> = {};
            for (const r of rows) if (r.provenance) m[r.id] = r.provenance;
            this.provMap.set(m);
            this.catalogRows.set(rows ?? []); // QM-1 — the same rows, kept for the drawer
        });
        // QM-1 — the build-time 'Mech/vehicle-relevant id set. Absent → nothing is excluded (HOTFIX-014's
        // precedent): over-filtering a completeness feature into silence is worse than a little noise.
        void fetch('/mekbay/parts-relevant.json')
            .then((r) => (r.ok ? r.json() : null))
            .then((ids: string[] | null) => { if (Array.isArray(ids)) this.relevantIds.set(new Set(ids.map(String))); })
            .catch(() => { /* absent → unfiltered, deliberately */ });
    }

    // ── fork-owned GM on-hand adjust — writes state directly (Classic routes this through its trade service) ──
    protected setOnHand(line: InventoryLine, raw: string): void {
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        this.writeOnHand(line, n);
    }
    protected adjustOnHand(line: InventoryLine, delta: number): void { this.writeOnHand(line, line.onHand + delta); }
    private writeOnHand(line: InventoryLine, qty: number): void {
        const inv = this.state.inventory();
        if (!inv) return;
        const next = Math.max(0, Math.round(qty));
        if (next === line.onHand) return;
        const key = lineKey(line);
        // ODM-17 P3 — GM fiat keeps the grades honest on component lines: additions land as A (depot
        // stock is A); removals drain A → RAW → B → C (never below zero; grades always sum to onHand).
        const apply = (l: InventoryLine): InventoryLine => {
            if (l.category !== 'component') return { ...l, onHand: next };
            const g = { ...effGrades(l) };
            let delta = next - l.onHand;
            if (delta > 0) g.a += delta;
            else for (const k of ['a', 'raw', 'b', 'c'] as const) { const take = Math.min(g[k], -delta); g[k] -= take; delta += take; if (delta >= 0) break; }
            return { ...l, onHand: next, grades: g };
        };
        this.state.setInventory({ ...inv, lines: inv.lines.map((l) => (lineKey(l) === key ? apply(l) : l)) });
        void this.store.persistCurrent();
    }

    // ── donor stock display ──
    protected sevWord(sev: string): string {
        return ({ G: 'LIGHT', Y: 'MODERATE', R: 'HEAVY', B: 'WRECKED' } as Record<string, string>)[sev] ?? sev;
    }
    protected yieldText(d: { yield: { ammo: { tons: number }[]; parts: { count: number }[] } }): string {
        const ammo = d.yield.ammo.reduce((s, a) => s + a.tons, 0);
        const parts = d.yield.parts.reduce((s, p) => s + p.count, 0);
        if (!ammo && !parts) return 'nothing recoverable';
        return `${ammo ? `${round1(ammo)} t ammunition` : ''}${ammo && parts ? ' · ' : ''}${parts ? `${parts} component${parts === 1 ? '' : 's'}` : ''}`;
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
        if (next.has(key)) next.delete(key); else next.add(key);
        this.collapsed.set(next);
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* non-fatal */ }
    }
    private loadCollapsed(): Set<string> {
        try { const raw = localStorage.getItem(COLLAPSE_KEY); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* */ }
        return new Set();
    }
}
