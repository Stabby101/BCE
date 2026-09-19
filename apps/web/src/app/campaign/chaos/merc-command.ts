import { Component, ChangeDetectionStrategy, computed, signal, effect, untracked, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { WarchestService } from './warchest.service';
import { CHAOS_START_PROFILES, CUSTOM_PROFILE_ID, type StartProfile } from './chaos-start-profiles';
import { CHAOS_CAMPAIGNS } from '../setup/chaos-campaigns';
import { resolveMekbayEraId } from '../faction/faction-select'; // PURE era-id mapping helper (NOT the faction component)
import { MulAllowlistService, COMMAND_AFFILIATIONS, DEFAULT_AFFILIATION, commandMulKey } from './mul-allowlist.service';
import { eraLegalIdSet, isEraLegal, emptyWhy } from './era-legal';
import { generatePilots } from '../barracks/pilot-generator';
import { ensureForgeData, type ForgeRegion } from './forge/hs-forge-data'; // HSFORGE-1 P2 — the theater picker's region table
import type { ProtoInstance } from '../force/force-generator';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';

const RATINGS = ['Green', 'Regular', 'Veteran', 'Elite'];
const VISIBLE_CAP = 120;

type SortField = 'name' | 'bv' | 'tons' | 'year' | 'type';
const SORT_FIELDS: { key: SortField; label: string }[] = [
    { key: 'name', label: 'Name' }, { key: 'bv', label: 'BV' }, { key: 'tons', label: 'Tonnage' }, { key: 'year', label: 'Year' }, { key: 'type', label: 'Type' },
];

// together (weight AND bv AND era). An empty group is unconstrained. Weight is by tonnage; BV + era by band.
interface FilterBand { key: string; label: string; test: (u: Unit) => boolean; }
const WEIGHT_BANDS: FilterBand[] = [
    { key: 'light', label: 'Light', test: (u) => u.tons <= 35 },
    { key: 'medium', label: 'Medium', test: (u) => u.tons >= 36 && u.tons <= 55 },
    { key: 'heavy', label: 'Heavy', test: (u) => u.tons >= 56 && u.tons <= 75 },
    { key: 'assault', label: 'Assault', test: (u) => u.tons >= 76 },
];
const BV_BANDS: FilterBand[] = [
    { key: 'bv1', label: '≤ 1000', test: (u) => u.bv <= 1000 },
    { key: 'bv2', label: '1000–1600', test: (u) => u.bv > 1000 && u.bv <= 1600 },
    { key: 'bv3', label: '1600–2200', test: (u) => u.bv > 1600 && u.bv <= 2200 },
    { key: 'bv4', label: '2200 +', test: (u) => u.bv > 2200 },
];
const ERA_BANDS: FilterBand[] = [
    { key: 'sl', label: 'Star League', test: (u) => u.year != null && u.year <= 2780 },
    { key: 'sw', label: 'Succession Wars', test: (u) => u.year != null && u.year >= 2781 && u.year <= 3049 },
    { key: 'ci', label: 'Clan Invasion', test: (u) => u.year != null && u.year >= 3050 && u.year <= 3061 },
    { key: 'cw', label: 'Civil War', test: (u) => u.year != null && u.year >= 3062 && u.year <= 3067 },
    { key: 'jh', label: 'Jihad', test: (u) => u.year != null && u.year >= 3068 && u.year <= 3080 },
    { key: 'da', label: 'Dark Age', test: (u) => u.year != null && u.year >= 3081 && u.year <= 3130 },
    { key: 'il', label: 'ilClan', test: (u) => u.year != null && u.year >= 3131 },
];
/** Toggle a key in an immutable Set (chip on/off). */
const toggleKey = (s: Set<string>, k: string): Set<string> => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
/** A unit passes a group iff the group is empty (unconstrained) or it matches ANY selected band's test. */
const passesGroup = (u: Unit, sel: Set<string>, bands: FilterBand[]): boolean => sel.size === 0 || bands.some((band) => sel.has(band.key) && band.test(u));

@Component({
    selector: 'bce-merc-command',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './merc-command.html',
    styleUrl: './merc-command.scss',
})
export class MercCommandComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);
    private readonly mulAllow = inject(MulAllowlistService);
    private readonly warchest = inject(WarchestService);

    protected readonly profiles = CHAOS_START_PROFILES;
    protected readonly ratings = RATINGS;
    protected readonly isCustom = CUSTOM_PROFILE_ID;

    protected readonly commandName = signal<string>('');
    /** ORDER-15 (a) — the command's AFFILIATION (the canon MUL keys, Mercenary by default): the off-list tag keys on it here and
     *  in the Market; the hiring predicate on the offer board. Persisted at Begin. */
    protected readonly affiliation = signal<string>(DEFAULT_AFFILIATION);
    protected readonly affiliations = COMMAND_AFFILIATIONS;
    protected readonly profileId = signal<string>('merc');
    protected readonly rating = signal<string>('Regular');
    protected readonly search = signal<string>('');
    protected readonly sortFields = SORT_FIELDS;
    protected readonly sortPrimary = signal<SortField>('name');
    protected readonly sortSecondary = signal<SortField | 'none'>('none');
    protected readonly sortDir = signal<'asc' | 'desc'>('asc');
    protected readonly weightBands = WEIGHT_BANDS;
    protected readonly bvBands = BV_BANDS;
    protected readonly weightFilter = signal<Set<string>>(new Set());
    protected readonly bvFilter = signal<Set<string>>(new Set());
    protected readonly eraFilter = signal<Set<string>>(new Set());
    protected readonly chosen = signal<Unit[]>([]);
    protected readonly catalogError = signal<boolean>(false);
    // Custom fields (default from Merc).
    protected readonly customForceBV = signal<number>(3000);
    protected readonly customWarchestSP = signal<number>(3000);
    protected readonly customScale = signal<number>(1);
    protected readonly customUnitCap = signal<number>(2);
    protected readonly customPilots = signal<number>(2);

    // ── HSFORGE-1 P2 — the THEATER picker (ruling D4/D11): the command's region of operations, specific or
    //    🎲 Random (resolved AT PICK to a concrete id — the stored value is never 'random'), default null =
    //    era-wide (today's behavior byte-identical). Drives the offer-board chamber filter + the Forge's
    //    top-up region. This component is HS-only (the constructor guard), so no extra mode gate. ──
    protected readonly theater = this.state.hsRegion;
    protected readonly theaterRegions = signal<ForgeRegion[]>([]);
    protected setTheater(el: HTMLSelectElement): void {
        const v = el.value;
        if (v === 'random') {
            const rs = this.theaterRegions();
            const picked = rs.length ? rs[Math.floor(Math.random() * rs.length)].id : null;
            this.state.setHsRegion(picked);
            // NG-SELECT gotcha class (P2 review): when the draw equals the CURRENT value the signal
            // no-ops (no CD pass) and the select keeps displaying '🎲' — write the element imperatively.
            el.value = picked ?? '';
        } else {
            this.state.setHsRegion(v || null);
        }
    }

    constructor() {
        void ensureForgeData().then((c) => this.theaterRegions.set(c.regions.regions)).catch(() => { /* picker degrades to era-wide only */ });
        // Order guard (no route guards; POST-INIT check like the Traditional steps): a Merc Command step needs an
        // era + a Hot Spots campaign — else back to the Setup card.
        if (!this.state.era() || this.state.campaignSystem() !== 'hotspots') {
            void this.router.navigate(['/campaign/new/setup']);
            return;
        }
        // SHRINKS, prune units that no longer fit the unit cap / BV budget, so Begin can never ship an over-budget
        // force with a mismatched Warchest. (A growing profile keeps the force untouched.)
        effect(() => {
            const p = this.profile();
            untracked(() => {
                const cur = this.chosen();
                const kept: Unit[] = []; let bv = 0;
                for (const u of cur) { if (kept.length < p.unitCap && bv + u.bv <= p.forceBV) { kept.push(u); bv += u.bv; } }
                if (kept.length !== cur.length) this.chosen.set(kept);
            });
        });
        void this.mulAllow.ensure();
        void this.ensureSlice(); // merc-command replaces faction (which loaded the slice), so load it here
    }

    private async ensureSlice(): Promise<void> {
        if (this.data.isFullLoaded()) return;
        try {
            if (await this.data.ensureSliceIndex()) {
                const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
                if (eraId != null && (await this.data.ensureSlice(eraId))) return; // slice resident → ready
            }
            if (!this.data.isFullLoaded() && !this.data.isDownloading()) await this.data.ensureFullCatalog(); // fallback
        } catch { /* fall through to the error check below */ }
        if (this.data.getUnits().length === 0) this.catalogError.set(true);
    }
    protected retryCatalog(): void { this.catalogError.set(false); void this.ensureSlice(); }

    /** The active profile — Custom folds in the live custom fields. */
    protected readonly profile = computed<StartProfile>(() => {
        const p = this.profiles.find((x) => x.id === this.profileId()) ?? this.profiles[0];
        if (p.id !== CUSTOM_PROFILE_ID) return p;
        return { ...p, forceBV: this.customForceBV(), warchestSP: this.customWarchestSP(), scale: this.customScale(), unitCap: this.customUnitCap(), pilots: this.customPilots() };
    });

    protected readonly catalogReady = computed(() => { this.data.isDataReady(); return this.data.getUnits().length > 0; });
    private readonly basePool = computed<Unit[]>(() => {
        this.data.isDataReady();
        const eraCeil = this.state.era()?.to ?? Infinity;
        // IS the era's slice. (The intro-year ceiling is 9999 in ilClan — it was never the gate.)
        const eraSet = eraLegalIdSet(this.data.getEras(), resolveMekbayEraId(this.state.era(), this.data.getEras()));
        return this.data.getUnits().filter((u) => this.combatEligible(u) && u.bv > 0 && (u.year == null || u.year <= eraCeil) && isEraLegal(eraSet, u.id));
    });
    protected readonly mulKey = computed(() => commandMulKey(this.affiliation()));
    protected readonly mulActive = computed(() => this.mulAllow.idsFor(this.mulKey()) != null);
    /** LANDING (3) — the list FAILS CLOSED, visibly: 'loading' → "Faction list loading…" and nothing is tagged; 'failed' → said,
     *  with Retry; 'ready' → the advisory (or the no-list line); 'inert' → nothing (outside HS+ilClan). Never silent. */
    protected readonly mulState = computed(() => this.mulAllow.gateState());
    protected retryMul(): void { void this.mulAllow.retry(); }
    /** ORDER-15 (a) — an affiliation with NO MUL list in this era (Lyran, FWL) tags nothing — said plainly, never silently. */
    protected readonly noListFor = computed(() => this.mulState() === 'ready' && this.mulAllow.idsFor(this.mulKey()) == null ? this.mulKey() : null);
    protected isOffList(u: Unit): boolean { const allow = this.mulAllow.idsFor(this.mulKey()); return !!allow && !allow.has(u.id); }
    protected readonly offCount = computed(() => { const allow = this.mulAllow.idsFor(this.mulKey()); return allow ? this.catalog().reduce((n, u) => n + (allow.has(u.id) ? 0 : 1), 0) : 0; });
    protected readonly eraBands = computed(() => ERA_BANDS.filter((band) => this.basePool().some((u) => band.test(u))));
    // campaign-era slice), so the ERA band sub-filter is redundant: it's hidden in the template + ignored here.
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly activeFilters = computed(() => this.weightFilter().size + this.bvFilter().size + (this.isHotspots() ? 0 : this.eraFilter().size));
    private readonly searched = computed<Unit[]>(() => { const q = this.search().trim().toLowerCase(); return q ? this.basePool().filter((u) => `${u.chassis} ${u.model}`.toLowerCase().includes(q)) : this.basePool(); });
    /** The visible catalog: base pool → text search → the three filter groups (AND) → the two-key sort. */
    protected readonly catalog = computed<Unit[]>(() => {
        const pk = this.sortPrimary(), sk = this.sortSecondary(), dir = this.sortDir();
        const wf = this.weightFilter(), bf = this.bvFilter(), ef = this.eraFilter();
        const hs = this.isHotspots();
        return this.searched()
            .filter((u) => passesGroup(u, wf, WEIGHT_BANDS) && passesGroup(u, bf, BV_BANDS) && (hs || passesGroup(u, ef, ERA_BANDS)))
            .sort((a, b) =>
                this.cmpBy(a, b, pk, dir) // primary honors direction
                || (sk !== 'none' ? this.cmpBy(a, b, sk, 'asc') : 0) // secondary always ascending; 'none' → skip
                || `${a.chassis} ${a.model}`.localeCompare(`${b.chassis} ${b.model}`)); // stable final tie-break
    });
    protected readonly catalogVisible = computed(() => this.catalog().slice(0, VISIBLE_CAP));
    protected readonly catalogEmptyWhy = computed(() => emptyWhy({ eraLegal: this.basePool().length, searched: this.searched().length, filtered: this.catalog().length }, this.search().trim(), this.isHotspots() ? 'the Weight / BV filters' : 'the Weight / BV / Era filters', this.state.era()?.name ?? null));
    protected readonly chosenBV = computed(() => this.chosen().reduce((s, u) => s + (u.bv || 0), 0));
    // A plain campaign still requires ≥1 unit (byte-untouched). The table path is gated on gmSession, which the GM door sets.
    protected readonly gmSess = computed(() => this.state.gmSession());
    protected readonly canBegin = computed(() => this.chosen().length > 0 || this.state.gmSession());
    protected readonly hostingTable = computed(() => this.state.gmSession() && this.chosen().length === 0);
    protected readonly gmDifficulty = this.state.gmDifficulty;
    protected setDifficulty(v: number): void { this.state.setGmDifficulty(v); }
    protected difficultyLabel(v: number): string { return v <= 0.9 ? 'Green' : v <= 1.0 ? 'Standard' : v <= 1.3 ? 'Veteran' : 'Elite'; }

    protected money(n: number): string { return Math.round(n).toLocaleString('en-US'); }
    protected setProfile(id: string): void { this.profileId.set(id); }
    protected canAdd(u: Unit): boolean {
        const p = this.profile();
        return this.chosen().length < p.unitCap && this.chosenBV() + u.bv <= p.forceBV;
    }
    protected addUnit(u: Unit): void { if (this.canAdd(u)) this.chosen.update((c) => [...c, u]); }
    protected removeUnit(i: number): void { this.chosen.update((c) => c.filter((_, idx) => idx !== i)); }
    protected num(v: string): number { return Math.max(0, Math.floor(Number(v) || 0)); }

    //    (non-industrial) OR a combat Vehicle: a Tank/VTOL carrying a 'Combat Vehicle' subtype, minus support/
    //    Naval are NOT battle-supported yet (T-032) → excluded by type. ──
    private isCombatMech(u: Unit): boolean {
        return u.type === 'Mek' && !/industrial/i.test(u.subtype ?? '');
    }
    private isCombatVehicle(u: Unit): boolean {
        // combat VTOLs too — they carry the same 'Combat Vehicle' subtype, so only the type gate broadens.
        if (u.type !== 'Tank' && u.type !== 'VTOL') return false;
        const sub = u.subtype ?? '';
        if (!/combat vehicle/i.test(sub) || /support|industrial/i.test(sub)) return false;
        const name = `${u.chassis ?? ''} ${u.model ?? ''}`;
        return !/recovery|engineering|salvage|support|cargo|mobile (hq|long ?tom|field|hpg|structure)|maintenance|refuel|fuel|ambulance|\bmash\b|fire ?(engine|truck)|construction|bridge ?layer|coolant|crane/i.test(name);
    }
    protected combatEligible(u: Unit): boolean {
        return this.isCombatMech(u) || this.isCombatVehicle(u);
    }
    protected unitTypeLabel(u: Unit): string {
        switch (u.type) {
            case 'Mek': return 'MECH';
            case 'Tank': case 'VTOL': return 'VEHICLE';
            case 'ProtoMek': return 'PROTOMECH';
            case 'Aero': return 'AERO';
            default: return String(u.type).toUpperCase();
        }
    }
    private cmpBy(a: Unit, b: Unit, k: SortField, dir: 'asc' | 'desc'): number {
        if (k === 'bv' || k === 'tons' || k === 'year') {
            const av = k === 'bv' ? a.bv : k === 'tons' ? a.tons : a.year;
            const bv = k === 'bv' ? b.bv : k === 'tons' ? b.tons : b.year;
            const an = av == null || Number.isNaN(av), bn = bv == null || Number.isNaN(bv);
            if (an && bn) return 0;
            if (an) return 1; // nulls last regardless of direction
            if (bn) return -1;
            const r = (av as number) - (bv as number);
            return dir === 'asc' ? r : -r;
        }
        const as = k === 'type' ? this.unitTypeLabel(a) : `${a.chassis} ${a.model}`;
        const bs = k === 'type' ? this.unitTypeLabel(b) : `${b.chassis} ${b.model}`;
        const r = as.localeCompare(bs);
        return dir === 'asc' ? r : -r;
    }
    protected setSortPrimary(v: string): void { this.sortPrimary.set(v as SortField); }
    protected setSortSecondary(v: string): void { this.sortSecondary.set(v as SortField | 'none'); }
    protected toggleSortDir(): void { this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc')); }
    protected toggleWeight(k: string): void { this.weightFilter.update((s) => toggleKey(s, k)); }
    protected toggleBv(k: string): void { this.bvFilter.update((s) => toggleKey(s, k)); }
    protected toggleEra(k: string): void { this.eraFilter.update((s) => toggleKey(s, k)); }
    protected clearFilters(): void { this.weightFilter.set(new Set()); this.bvFilter.set(new Set()); this.eraFilter.set(new Set()); }

    /** Back → Setup (era-locked skipped Era) or Era (generic came through it). */
    protected back(): void {
        const c = CHAOS_CAMPAIGNS.find((x) => x.id === this.state.hotSpotCampaign());
        void this.router.navigate([c?.eraLocked ? '/campaign/new/setup' : '/campaign/new/era']);
    }

    private uid(): string { return globalThis.crypto?.randomUUID?.() ?? 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

    /**
     * Hot Spots Begin — seeds a VALID campaign with Hot-Spots values WITHOUT the Traditional generators. Mints the
     * chosen force directly, generates the Named Pilots, seeds the Warchest from the profile, sets the
     * dashboard-required signals, and leaves C-bill/Traditional state (treasury/capital/resources/market) null.
     */
    protected begin(): void {
        if (this.state.campaignSystem() !== 'hotspots' || !this.canBegin()) return;
        const s = this.state;
        const p = this.profile();
        const era = s.era();
        const name = this.commandName().trim() || 'Mercenary Command';
        const startDate = s.startDate() ?? { y: era?.from ?? 3025, m: 0, d: 1 };
        // (warchestSP left null — never seeded), no accepted contract; only the dashboard-entry labels + the table's clock.
        // The GM hosts and referees; he brings his own company (if he wants) through the player handshake, like anyone.
        if (this.hostingTable()) {
            s.setForce('MERC');
            s.setFaction(this.commandName().trim() || 'GM Table');
            s.setUnit('__custom__');
            s.setUnitSize({ id: 'custom', name: 'GM Table', count: 0 });
            s.setCommandName(this.commandName().trim() || 'GM Table');
            s.setRating(this.rating());
            s.setLogisticsProfile('merc-market');
            s.setResources('normal'); // the dashboard-entry guard's benign C-bill label (unused in SP mode)
            s.setStartDate(startDate);
            s.setStartingForce([]); // NO company of the GM's own
            s.setPilots([]);
            s.setContractScale(1); // a default; the session contract carries the hot spot's authored Scale at Present
            s.setCurrentDate(startDate);
            s.setCurrentLocation(null);
            // deliberately NO warchest.seed — warchestSP stays null (the companylessTable signal the 5 branches read)
            void this.store.beginSave();
            void this.router.navigate(['/campaign']);
            return;
        }

        const force: ProtoInstance[] = this.chosen().map((u) => ({
            instanceId: this.uid(), unitRef: u.name, chassis: u.chassis, model: u.model, mulId: u.id, tons: u.tons, bv: u.bv,
            unitType: u.type === 'Tank' || u.type === 'VTOL' ? 'vehicle' : 'mech',
            condition: 'Active', damage: undefined,
            // Traditional force-gen uses). Kept clean-room (we mint directly; no forceGen call).
            provenance: { origin: 'generated', acquiredDate: startDate },
        }));
        // Named Pilots = the profile's count (book-faithful — Merc starts with 2, Veteran 4); marked named so the
        // pilots — the rest are crew); other units are crewed by non-named hires later.
        const NAMED_CAP = 4;
        const pilots = generatePilots(force, this.rating()).slice(0, p.pilots).map((pl, i) => ({ ...pl, named: i < NAMED_CAP }));

        s.setForce('MERC');
        s.setFaction(this.commandName().trim() || s.hotSpotCampaign() || 'Mercenary Command');
        s.setCommandFaction(this.affiliation()); // ORDER-15 (a) — the declared affiliation, persisted (the tag + the hiring predicate key on it)
        s.setUnit('__custom__');
        s.setUnitSize({ id: 'custom', name: 'Mercenary Command', count: force.length });
        s.setCommandName(name);
        s.setRating(this.rating());
        s.setLogisticsProfile('merc-market');
        // benign C-bill-economy label unused in SP mode (treasury stays null → no C-bill money). Not a Traditional edit.
        s.setResources('normal');
        s.setStartDate(startDate);
        s.setStartingForce(force);
        s.setPilots(pilots);
        this.warchest.seed({ warchestSP: p.warchestSP, reputation: p.reputation, scale: p.scale });
        s.setContractScale(p.scale);
        s.setCurrentDate(startDate);
        s.setCurrentLocation(null); // capital resolution deferred — the GM sets it on the Star Map (§13)
        void this.store.beginSave();
        void this.router.navigate(['/campaign']);
    }
}
