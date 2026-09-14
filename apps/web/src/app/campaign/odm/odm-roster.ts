/*
 * FORKED FROM campaign/dashboard/roster/roster.ts @ 6cc5dae - DIRECTIVE-ODM-1 Phase 1 (a DRIFT SURFACE: fixes to the original
 * may need mirroring here). Strips: the Acquire/Market overlay + its CTA (the IRON RULE has no unit market). Fleet & Transport KEPT (the fleet is the lifeline).
 */
/*
 * BCE retool — Unit Roster, production-data cell (DIRECTIVE-010, supersedes D-009's
 * hand-feel cell). Each cell: MekBay <unit-icon> sprite far-left + designation + a
 * compact lowered condition dropdown (left column), and a live Classic record-sheet
 * thumbnail (right pane) rendered off a real ForceUnit with a sample damage state.
 * Click the thumbnail to explode it to a read-only full sheet. Sprites + sheets are
 * REAL (sprites copied locally; catalog + sheet SVGs stream from db.mekbay.com).
 * Condition state is local; the Fleet section reflects the resource tier. MekBay
 * components are reused unedited.
 */
import { Component, ChangeDetectionStrategy, computed, signal, inject, effect, untracked, isDevMode, type Signal, ApplicationRef, EnvironmentInjector } from '@angular/core';
import { BceUnitSpriteComponent } from '../sprite/unit-sprite';
import { NewCampaignState } from '../new-campaign-state';
import { CONDITIONS, type Condition } from '../dashboard/roster/sample-force';
import { RosterForceService, type RosterEntry } from '../dashboard/roster/roster-force.service';
import { SheetRevService } from '../dashboard/roster/sheet-rev.service';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from '../barracks/pilot.service';
import type { Pilot } from '../barracks/pilot-generator';
import type { ProtoInstance } from '../force/force-generator';
import { buildNextLance, pruneLance, STRUCTURE_TUNABLES } from '../force/force-structure';
import { categoryCounts, forceReadiness } from '../force/deployed';
import { hasMechDamage } from '../repair/repair-bays'; // HOTFIX-024 — gate 'In repair' on the SAME predicate the bays queue filters on
import { InViewDirective } from '../dashboard/roster/in-view.directive';
import { SheetViewComponent } from '../dashboard/roster/sheet-view';
import { SheetModalComponent } from '../dashboard/roster/sheet-modal';
import { printSheets } from '../dashboard/roster/sheet-print';
// ODM-1 FORK: AcquisitionComponent (the C-bill market) STRIPPED - acquisition is salvage/raid/barter (waves)
import { PilotDetailComponent } from '../barracks/pilot-detail';
import { PILOT_ABILITIES } from '../barracks/pilot-abilities';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service'; // ODM-15
// (ODM-18 P1: the ODM-15 trade-stamp import moved into OdmReassignService.reassign — assign+stamp+persist, one fn)
import { TRADE_CHOICES, TRADE_NOUN, TRADE_ORDER, type OdmTrade } from './odm-trades';
import { OdmReassignService, crewName, machineLabel } from './odm-reassign.service'; // ODM-18 P1
import { DecimalPipe } from '@angular/common';
import { OdmFleetService, doorsUsed, type OdmVessel, type OdmFleetBay } from './odm-fleet.service'; // ODM-17 P2-e — the REAL fleet (the tier fiction died)
import { fuelPct, fuelState, odmStartingStocks } from './odm-stocks'; // ODM-17 P2-e — the Iron Covenant's tank IS the ODM-11 fuel card

@Component({
    selector: 'bce-odm-roster',
    standalone: true,
    imports: [BceUnitSpriteComponent, InViewDirective, SheetViewComponent, SheetModalComponent, PilotDetailComponent, DecimalPipe],
    providers: [RosterForceService],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-roster.html',
    styleUrl: '../dashboard/roster/roster.scss', // SHARED (styles are not forked)
    // ODM-17 P2-e — fleet-detail additions, FORK-LOCAL (the shared roster.scss stays untouched for these)
    styles: [`
        .vspec { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--mono); font-size: 10px; color: var(--ink-dim, var(--ink)); margin: 4px 0 2px; }
        .vnote { font-family: var(--mono); font-size: 9.5px; font-style: italic; color: var(--ink-dim, var(--ink)); opacity: .85; margin-top: 4px; line-height: 1.45; }
        .ftag.vgrounded { border-color: var(--stamp); color: var(--stamp); }
        /* ── ODM-25 — the crew ACTION ROW. FORK-LOCAL on purpose: these controls exist only in the ODM
           template, so the SHARED roster.scss stays untouched and Classic cannot be moved by them.

           THE BUG THIS SHAPE FIXES: the stand-down button first shipped INSIDE .pmain, which is
           \`flex: 1 1 auto; min-width: 0\` — so it shrank below its content instead of wrapping, its
           children spilled ~50px to the right of the 225px left column, and .thumb (position: relative,
           therefore painted in the positioned layer ABOVE in-flow content) covered the overflow. The
           button existed at a real size and nothing on earth could click it: elementFromPoint returned
           DIV.sheet-host. A sibling with \`flex: 0 0 auto\` would NOT have fixed it — .pmain would still
           have shrunk and overflowed. \`flex-basis: 100%\` inside the wrapping .pilot ALWAYS takes its own
           line, so there is no overflow to be covered.

           z-index is the belt to that braces: should anything in this block ever overflow again, it paints
           ABOVE the sheet column instead of under it — the class of bug, not just this instance. ── */
        .pilot { position: relative; z-index: 1; }
        /* ROW 2: chips left, the two icon controls hard right. flex-basis:100% makes it a row by
           construction, and margin-left:auto on .picons pins the icons to the column's right edge. */
        .prow2 { flex: 0 0 100%; display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 1px; }
        .prow2 .pflav { min-width: 0; overflow: hidden; }
        .picons { flex: 0 0 auto; margin-left: auto; display: flex; align-items: center; gap: 6px; }
        /* THE ICONS. Fixed 28px squares, so the row's right edge is fixed too: whatever the name or the
           chips do, these two cannot push past the column. That is the point — the geometry is no longer
           something to keep checking, it is something that cannot happen. */
        .picon { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
            font-family: var(--mono); font-size: 14px; line-height: 1; background: var(--paper); color: var(--ink2);
            border: 1.4px solid var(--ink2); cursor: pointer; }
        .picon:hover:not(:disabled), .picon:focus-visible { border-color: var(--stamp); color: var(--stamp); outline: none; }
        /* the star carries its own state — ☆ hollow / ★ filled, matching the ★ CMD badge on this same card */
        .picon.prim.on { background: var(--ok, #3a7d44); border-color: var(--ok, #3a7d44); color: var(--paper); }
        .picon:disabled { opacity: .45; cursor: not-allowed; } /* disabled WITH A REASON (title), never hidden */
        /* ODM-25b — the name WRAPS to two lines rather than truncating. .pname's shared rule is
           nowrap+ellipsis; this fork-local override uses the house line-clamp already on .arms and .dmg. */
        .pilot .pname { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden; line-height: 1.2; }
        .liftline { font-family: var(--mono); font-size: 10.5px; border: 1.4px solid var(--line, currentColor); padding: 6px 9px; margin-top: 8px; }
        .liftline b { color: var(--ok, #3a7d44); } .liftline b.short { color: var(--stamp); }
        .liftline.vops { border-style: dashed; font-style: italic; opacity: .9; }
        .vdisc { flex-basis: 100%; font-style: italic; color: var(--warn, var(--ink)); }
    `],
})
export class OdmRosterComponent {
    private readonly state = inject(NewCampaignState);
    private readonly appRef = inject(ApplicationRef); // D-083 — AS print needs the app injector for dynamic cards
    private readonly envInjector = inject(EnvironmentInjector);
    private readonly forceService = inject(RosterForceService);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
    private readonly crew = inject(OdmReassignService); // ODM-18 P1 — the extracted reassign core
    private readonly data = inject(DataService); // ODM-15 — the reassign re-derive reads the catalog type
    protected readonly sheetRev = inject(SheetRevService); // D-084 — per-card dirty bits (template reads rev(id))

    protected readonly conditions = CONDITIONS;
    protected readonly ready = this.forceService.ready;
    protected readonly dataError = this.forceService.dataError;
    // D-069 (B): a Quick Mission is a one-shot with no roster management — every unit is simply DEPLOYED, so
    // the per-cell condition + lance dropdowns are dropped (the pilot control + sheet stay). Campaign keeps them.
    protected readonly quickMission = this.state.quickMission;

    // Condition lives ON the proto-instance (single source of truth, persisted). syncedId = the cue.
    protected readonly syncedId = signal<string | null>(null);
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    // D-084 — the DMG line, PER CARD: one memoized computed per instanceId that depends ONLY on that card's
    // dirty bit (sheetRev.rev(id)). A flip re-derives just that card's damage line once; sibling cards return
    // their cached value (no recompute). The fu is read UNTRACKED so a flip — not a roster-wide change — is the
    // sole trigger. (Replaces the coarse global `crewRev` thumbnail nudge, which re-cloned the whole roster.)
    private readonly dmgCache = new Map<string, Signal<string | null>>();
    protected dmgLine(id: string): string | null {
        let sig = this.dmgCache.get(id);
        if (!sig) {
            sig = computed(() => {
                this.sheetRev.rev(id); // the ONLY dependency — this card's dirty bit
                if (isDevMode()) console.debug('[D-084] dmg-recompute', id); // proof seam: one line per flipped card
                return this.damageLine(untracked(() => this.forceService.entries()[id]?.fu ?? null));
            });
            this.dmgCache.set(id, sig);
        }
        return sig();
    }

    // ── D-027 lance management + active-mission cell ──
    protected readonly reserveKey = '__reserve__';
    /** D-029 — the unit-acquisition (market) overlay, opened from the roster header / empty state. */
    protected readonly marketOpen = signal(false); // ODM-1 FORK: retained as an always-false signal (no market overlay mounts)
    /** Tap-the-'MECHS-count filter: when on, the roster collapses to deployed cells only. */
    protected readonly deployFilter = signal(false);

    // Explode modal.
    protected readonly explodedFu = signal<CBTForceUnit | null>(null);
    protected readonly explodedTitle = signal<string>('');
    protected readonly explodedAbilities = signal<string[]>([]); // D-070 (E): the exploded sheet's SPA overlay

    constructor() {
        void this.forceService.build();
        void this.fleetSvc.ensureLoaded(); // ODM-17 P2-e — the fleet section reads pack truth
        // D-070: a pilot edit (skills/name from the detail overlay, or a grant) must move the LIVE record sheet,
        // not just the cell — re-push crew onto the ForceUnits whenever the pilot roster changes, then re-clone
        // the thumbnails (the proven 40ms paint tick). untracked so the effect depends ONLY on pilots(), not on
        // whatever reapplyAllCrew reads (no feedback loop; reapplyAllCrew never writes state.pilots()).
        effect(() => {
            this.state.pilots(); // the trigger: any pilot mutation (skills, name, perks, assignment)
            untracked(() => {
                // D-084: re-drive crew, then flip ONLY the cards whose crew actually changed (per-card,
                // not the whole roster). reapplyAllCrew returns the changed instanceIds; each bump coalesces.
                for (const id of this.forceService.reapplyAllCrew()) this.sheetRev.bump(id);
            });
        });
    }

    /** The generated campaign force (D-018 proto-instances). */
    protected readonly force = computed(() => this.state.startingForce() ?? []);
    // (ODM-17 P2-e: the IMPORT-7 isHotspots gate on the fleet section died with the tier fiction — the fork
    //  is ODM-only and the section now renders pack truth unconditionally.)
    /** Build-your-own (or no force) → clean empty-roster state once data is ready. */
    protected readonly isEmpty = computed(() => this.ready() && this.force().length === 0);

    /** Formation context (D-021) — "<formation> · <faction>" header tag, or null. */
    protected readonly formationContext = computed(() => {
        const f = this.state.formation();
        if (!f) return null;
        const fac = this.state.faction();
        return fac ? `${f} · ${fac}` : f;
    });

    protected readonly structure = computed(() => this.state.forceStructure());

    /** Roster grouped into lance/Star sections (per the structure) + a RESERVE section (D-019). */
    protected readonly sections = computed(() => {
        const force = this.force();
        const structure = this.structure();
        const entries = this.forceService.entries();
        const lances = structure?.lances ?? [];
        const basis = structure?.basis ?? 4;

        const pilotByInstance = new Map<string, Pilot>();
        for (const p of this.state.pilots() ?? []) {
            if (p.assignedInstanceId) pilotByInstance.set(p.assignedInstanceId, p);
        }

        // D-046 — 'Mechs flow into lance/Star sections; combat vehicles surface in the MOTOR POOL (the
        // ODM hangar concept). A 'Mech lance is sized by its 'Mechs; vehicles are organic support below.
        const isVeh = (i: ProtoInstance): boolean => i.unitType === 'vehicle';
        const byLance = new Map<string, ProtoInstance[]>();
        for (const inst of force) {
            if (isVeh(inst) || !inst.lanceId) continue;
            const a = byLance.get(inst.lanceId) ?? [];
            a.push(inst);
            byLance.set(inst.lanceId, a);
        }
        let prev: string[] = [];
        const out = lances.map((l) => {
            let common = 0;
            while (common < l.groups.length && common < prev.length && l.groups[common] === prev[common]) common++;
            const newGroups = l.groups.slice(common); // parent headers to emit before this lance
            prev = l.groups;
            const units = (byLance.get(l.id) ?? []).map((i) => this.cellVm(i, entries, pilotByInstance));
            const depCount = units.filter((u) => u.cond === 'Deployed').length;
            return { id: l.id, name: l.name, newGroups, count: units.length, understrength: units.length > 0 && units.length < basis, overstrength: units.length > basis, depCount, units, reserve: false, motorPool: false };
        });
        const assigned = new Set(lances.flatMap((l) => (byLance.get(l.id) ?? []).map((i) => i.instanceId)));
        const reserve = force.filter((i) => !isVeh(i) && !assigned.has(i.instanceId)).map((i) => this.cellVm(i, entries, pilotByInstance));
        if (reserve.length) out.push({ id: 'reserve', name: 'Reserve', newGroups: [] as string[], count: reserve.length, understrength: false, overstrength: false, depCount: reserve.filter((u) => u.cond === 'Deployed').length, units: reserve, reserve: true, motorPool: false });
        const motor = force.filter(isVeh).map((i) => this.cellVm(i, entries, pilotByInstance));
        if (motor.length) out.push({ id: 'motorpool', name: 'Motor Pool', newGroups: [] as string[], count: motor.length, understrength: false, overstrength: false, depCount: motor.filter((u) => u.cond === 'Deployed').length, units: motor, reserve: false, motorPool: true });
        return out;
    });

    private cellVm(inst: ProtoInstance, entries: Record<string, RosterEntry>, pilotByInstance: Map<string, Pilot>) {
        const entry = entries[inst.instanceId] ?? { status: 'pending' as const };
        const unit = entry.unit ?? null;
        const pilot = pilotByInstance.get(inst.instanceId) ?? null;
        const arms = this.armsLine(unit); // HOTFIX-002 vitals (from the eager catalog Unit)
        return {
            id: inst.instanceId,
            name: unit?.chassis ?? inst.chassis,
            variant: unit?.model ?? inst.model,
            tons: unit?.tons ?? inst.tons,
            // Forward hook (no state today): a future unit-naming feature surfaces here; renders only when present.
            customName: (inst as { customName?: string }).customName ?? '',
            unit,
            fu: entry.fu ?? null,
            status: entry.status,
            cond: inst.condition as Condition,
            lanceId: inst.lanceId ?? this.reserveKey,
            // ODM-25b — the lance's full NAME, for the title on a <select> that can only ellipsis it.
            lanceName: (this.structure()?.lances ?? []).find((l) => l.id === inst.lanceId)?.name ?? 'Reserve',
            commander: !!inst.isCommander,
            // HOTFIX-024 — has any MECH damage? Gates the 'In repair' condition option (an undamaged unit can't be
            // repaired → it would strand in neither the bays nor the deployable pool). Same predicate as the queue.
            hasDamage: hasMechDamage(inst.damage),
            vehicle: inst.unitType === 'vehicle', // D-046 — combined-arms type flag (motor-pool grouping + chip)
            // ODM-25 — the machine's TRADE, so this card's crew list can be pruned to the right profession
            // (ruling 3: cross-trade is a different job, not a penalty band). Null = a hull we cannot
            // classify, which opens the list rather than closing it — see OdmReassignService.tradeAllows.
            trade: this.crew.tradeOfInstance(inst),
            // ODM-25 (ruling 4) — is THIS chassis the crew's primary hull? Chassis-keyed, so it survives a
            // reassignment onto another machine of the same type and does not die with the instance.
            primary: !!pilot?.primaryHull && pilot.primaryHull === (unit?.chassis ?? inst.chassis),
            // ── VITALS readout (HOTFIX-002): MOVE / BV / ARMS from the catalog; DMG from the live fu ──
            // D-046: vehicles show cruise/flank (no jump); 'Mechs show walk/run/jump.
            move: unit ? (inst.unitType === 'vehicle' ? `${unit.walk} / ${unit.run}` : `${unit.walk} / ${unit.run} / ${unit.jump}`) : '—',
            // D-070: skill-adjusted BV — base unit BV × the canon G/P multiplier (BVCalculatorUtil, the same
            // BV2.0 table the record sheet uses). Unmanned/default → base BV (a 4/5 pilot multiplier is 1.0).
            bv: unit
                ? (pilot ? BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, pilot.gunnery, pilot.piloting) : unit.bv).toLocaleString('en-US')
                : inst.bv ? inst.bv.toLocaleString('en-US') : '—',
            arms,
            armsLong: arms.length > 34, // the SCALE step — step the font down one notch for long loadouts
            // D-084: the DMG line is no longer derived eagerly here (that re-derived the WHOLE roster on any
            // damage change). It is pulled per-card via dmgLine(u.id) — a flip of this card's bit re-reads it alone.
            // ── PILOT BLOCK (display ≠ control): name / callsign chip / G·P chip; the ▾ reuses pilotOptions ──
            pilotId: pilot?.pilotId ?? '',
            pilotDisplayName: pilot?.name ?? '',
            callsign: pilot?.callsign ?? '',
            pilotGp: pilot ? `G${pilot.gunnery} · P${pilot.piloting}` : '',
            kin: pilot?.note ? 'kin' : '', // extension-ready: WIA / ★ favorite chips land beside this (T-030)
            perkCount: pilot?.perks?.length ?? 0, // D-036: the ability chip (★N)
            // D-070 (E): the pilot's SPA display names → the record-sheet overlay ("Abilities: Sniper · …").
            // D-084: returned with a STABLE reference (memoized on the pilot+perks signature) so a roster re-derive
            // (e.g. a condition change) does NOT change the [abilities] input on every sheet → only the card whose
            // bit actually flipped re-clones. A fresh `.map()` here re-cloned the whole roster on any list change.
            pilotAbilities: this.pilotAbilitiesFor(inst.instanceId, pilot),
            // ★ CAPTURED chip (D-034 ride-along) — provenance 'captured' (D-031 prizes), the chip row built for it.
            captured: inst.provenance?.origin === 'captured',
        };
    }

    // D-084 — stable per-card SPA-name arrays: same reference unless the pilot or their perks change, so a roster
    // re-derive doesn't churn the sheet-view [abilities] input (which would re-clone every thumbnail).
    private readonly abilCache = new Map<string, { sig: string; arr: string[] }>();
    private pilotAbilitiesFor(id: string, pilot: Pilot | null | undefined): string[] {
        const sig = `${pilot?.pilotId ?? ''}|${(pilot?.perks ?? []).join(',')}`;
        const c = this.abilCache.get(id);
        if (c && c.sig === sig) return c.arr;
        const arr = (pilot?.perks ?? []).map((pid) => PILOT_ABILITIES.find((a) => a.id === pid)?.name).filter((n): n is string => !!n);
        this.abilCache.set(id, { sig, arr });
        return arr;
    }

    /** Display name with the optional callsign, e.g. `Mara Voss "Ghost"` — used for the sheet crew + the ▾ list.
     *  ODM-25: the one spelling now lives beside the crew mutations (crewName), so the pull-down, the overlay
     *  and every warning address the same person the same way. */
    private pilotName(p: Pilot): string {
        return crewName(p);
    }

    // ── Cell vitals (HOTFIX-002) — pure derivation from EXISTING data; no new state, no persistence ──
    private readonly mekLocs = ['HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL'];
    private readonly rearLocs = new Set(['CT', 'RT', 'LT']);

    /** ARMS line — weapon comps (E/M/B/A) GROUPED by name ("12×ER M.Laser", never twelve entries). */
    private armsLine(unit: Unit | null): string {
        if (!unit?.comp?.length) return '—';
        const byName = new Map<string, number>();
        for (const c of unit.comp) {
            if (c.t !== 'E' && c.t !== 'M' && c.t !== 'B' && c.t !== 'A') continue; // weapons only (X=ammo, C/S/O skip)
            byName.set(c.n, (byName.get(c.n) ?? 0) + (c.q || 1));
        }
        if (!byName.size) return '—';
        return [...byName.entries()].map(([n, q]) => (q > 1 ? `${q}×` : '') + this.abbrevWeapon(n)).join(' · ');
    }
    private abbrevWeapon(n: string): string {
        return n
            .replace(/\bMedium\b/g, 'M.').replace(/\bLarge\b/g, 'L.').replace(/\bSmall\b/g, 'S.')
            .replace(/\bMachine Gun\b/g, 'MG').replace(/\bAnti-Missile System\b/g, 'AMS')
            .replace(/([MLS])\.\s+/g, '$1.');
    }

    /** Crimson DMG line — pure derivation from the live ForceUnit armor state. Null when pristine (no box).
     *  Armor % + stripped front locations; ammo/low-ammo tracking arrives with the engine (T-017). */
    private damageLine(fu: CBTForceUnit | null): string | null {
        if (!fu) return null;
        let maxA = 0;
        let curA = 0;
        const stripped: string[] = [];
        for (const loc of this.mekLocs) {
            for (const rear of this.rearLocs.has(loc) ? [false, true] : [false]) {
                const pts = fu.getArmorPoints(loc, rear);
                if (!pts) continue;
                const hits = Math.min(fu.getArmorHits(loc, rear), pts);
                maxA += pts;
                curA += pts - hits;
                if (!rear && hits >= pts) stripped.push(loc);
            }
        }
        if (maxA === 0 || curA >= maxA) return null; // no armor data, or undamaged
        const parts = [`armor ${Math.round((curA / maxA) * 100)}%`];
        if (stripped.length) parts.push(`${stripped.join('/')} stripped`);
        return parts.join(' · ');
    }

    /** Pull-down options — every LIVING pilot, best-skills first, spares flagged. D-036: the dead
     *  never crew again — KIA pilots are filtered out (the service hard-guards the same line).
     *
     *  ODM-25 — the list is now PER MACHINE, not one list for the whole roster:
     *   · **pruned by TRADE** (ruling 3) — a 'Mech offers MechWarriors, a tank offers vehicle crews. Cross-
     *     trade is a different profession and is BLOCKED, because the old behaviour did not merely permit it,
     *     it LAUNDERED it (the A5 re-stamp converted the pilot in the act of mis-posting them).
     *   · **annotated** — every option states WHAT the person is and WHERE they are, so a company is not
     *     assigned blind.
     *   · **the untraded bench is on every list**, flagged as the career decision it is (item 2). This is the
     *     C-ter composition: identity-means-never-overwrite would brick these pilots against a trade filter
     *     if the stamp-if-absent path had not survived. It did; they are postable, and the list says why.
     *
     *  Built once PER TRADE rather than once per card, so each `<select>` gets a STABLE array reference. */
    private readonly crewLists = computed<Record<string, { id: string; label: string }[]>>(() => {
        const living = [...(this.state.pilots() ?? [])]
            .filter((p) => p.status !== 'KIA')
            .sort((a, b) => a.gunnery - b.gunnery || a.piloting - b.piloting || a.name.localeCompare(b.name));
        const out: Record<string, { id: string; label: string }[]> = {};
        for (const key of ['', ...TRADE_ORDER]) {
            const machineTrade = (key || null) as OdmTrade | null;
            out[key] = living
                // ONE guard, in the service (ODM-18 ruling 5) — the pull-down and the pilot overlay's
                // posting list must never drift into two different ideas of who may crew what.
                .filter((p) => this.crew.tradeAllows(p.trade, machineTrade))
                .map((p) => ({ id: p.pilotId, label: this.crewOptionLabel(p, machineTrade) }));
        }
        return out;
    });
    /** ODM-25b — THE SEATED CREW IS ALWAYS IN THEIR OWN MACHINE'S LIST, trade or no trade. Correcting a
     *  trade can leave someone in an off-trade hull (permitted and visible — ruling 3 blocks the ACT of
     *  posting cross-trade, it does not dissolve a seat already held). Pruning them out of their own card
     *  would make the control read "— no pilot —" over a crewed machine: a display contradicting the state,
     *  which is the silent-wrong-value class with a dropdown for a face. Cached against the base array's
     *  own identity, so the normal path keeps its stable reference and the exception keeps one too. */
    private readonly offTradeOpts = new Map<string, { base: unknown; arr: { id: string; label: string }[] }>();
    protected pilotOptions(trade: OdmTrade | null | undefined, pilotId?: string): { id: string; label: string }[] {
        const base = this.crewLists()[trade ?? ''] ?? [];
        if (!pilotId || base.some((o) => o.id === pilotId)) return base;
        const key = `${trade ?? ''}|${pilotId}`;
        const hit = this.offTradeOpts.get(key);
        if (hit && hit.base === base) return hit.arr;
        const p = (this.state.pilots() ?? []).find((x) => x.pilotId === pilotId);
        const arr = p
            ? [{ id: p.pilotId, label: `${this.crewOptionLabel(p, trade ?? null)} — OFF-TRADE, already seated here` }, ...base]
            : base;
        this.offTradeOpts.set(key, { base, arr });
        return arr;
    }
    /** `Mara Voss "Ghost" · 3/4 · MechWarrior · Phoenix Hawk PXH-1` — or, for the bench, the career line. */
    private crewOptionLabel(p: Pilot, machineTrade: OdmTrade | null): string {
        const t = p.trade as OdmTrade | undefined;
        // An off-vocabulary stored value is SHOWN as it stands, never re-labelled or re-bucketed by guess.
        const known = t ? (TRADE_NOUN[t] ?? t) : null;
        const trade = known
            ?? (machineTrade ? `untraded — will be stamped ${TRADE_NOUN[machineTrade]} on posting` : 'untraded');
        const where = p.assignedInstanceId ? this.machineOf(p.assignedInstanceId) : 'unassigned';
        return `${this.pilotName(p)} · ${p.gunnery}/${p.piloting} · ${trade} · ${where}`;
    }
    /** D-036: the pilot detail explode (the roster pilot block's name opens it). */
    protected readonly detailPilot = signal<string | null>(null);
    // ── ODM-18 P1 (ruling 1) — GM-private pilot notes (gmOnly.pilotNotes; the fan strips them) ──
    protected gmNoteFor(pilotId: string): string { return this.state.gmPilotNotes()[pilotId] ?? ''; }
    protected saveGmNote(pilotId: string, text: string): void {
        const notes = { ...this.state.gmPilotNotes() };
        if (text) notes[pilotId] = text; else delete notes[pilotId];
        this.state.setGmPilotNotes(notes);
        void this.store.persistCurrent();
    }

    /** Pilots exist for this campaign (drives whether the pull-down renders). */
    protected readonly hasPilots = computed(() => (this.state.pilots()?.length ?? 0) > 0);

    /** Reassign a machine's crew ('' = unassign the current crew) → re-drive sheets + persist in place.
     *  ODM-18 P1 (ruling 5) — the assign + ODM-15 trade-stamp + persist core is EXTRACTED to OdmReassignService
     *  (the one fn this UI and the intent adapter both call); the component keeps only the render re-drive. */
    /** The machine a pilot is currently in, by name — the annotation the pull-down was missing. */
    private machineOf(instanceId: string | null | undefined): string {
        if (!instanceId) return '';
        const i = (this.state.startingForce() ?? []).find((x) => x.instanceId === instanceId);
        return i ? machineLabel(i) : (instanceId ?? '');
    }
    /** ODM-25 — UNASSIGN, as a control you can SEE. The capability already existed (the "— no pilot —" row
     *  inside an opacity:0 select laid over a chevron), which made it indistinguishable from absent. Third
     *  invisible control of the session; the fix is always to surface, never to rebuild. */
    protected standDown(instanceId: string): void {
        const warn = this.crew.standDownWarning(instanceId);
        if (!warn) return; // no crew — nothing to stand down (the guard is HERE, not only on the @if)
        if (!confirm(warn)) return;
        this.applyCrew(instanceId, '');
    }
    protected reassignPilot(instanceId: string, pilotId: string, el?: HTMLSelectElement): void {
        /* ODM-25 — WARN ON DISPLACEMENT. Choosing an already-posted pilot MOVES them, and the seat they left
           silently empties. A machine quietly losing its crew is exactly the class of silent decision this
           whole session has been about, so it is stated before it happens rather than discovered at deploy.
           (No trade warning: as of ODM-25 there is no re-stamp to warn about, and cross-trade never reaches
           this list — the options are pruned to the machine's own profession.) */
        const warn = pilotId ? this.crew.displacementWarning(pilotId, instanceId) : null;
        if (warn && !confirm(warn)) {
            // NG-SELECT (the twice-earned gotcha): a refused change must not leave the picked option
            // standing as if applied — put the control back on the truth.
            if (el) el.value = (this.state.pilots() ?? []).find((x) => x.assignedInstanceId === instanceId)?.pilotId ?? '';
            return;
        }
        this.applyCrew(instanceId, pilotId);
    }
    /** The one write + re-render both crew controls share. */
    private applyCrew(instanceId: string, pilotId: string): void {
        this.crew.reassign(instanceId, pilotId);
        // D-084: re-drive the live SVGs off the new crew, then flip ONLY the affected card's dirty bit (the
        // returned changed-id; the bump coalesces + awaits the svg paint). No whole-roster re-clone.
        for (const cid of this.forceService.reapplyAllCrew()) this.sheetRev.bump(cid);
    }

    /** ODM-25 (ruling 4) — mark/unmark THIS chassis as the crew's primary hull. One per pilot: setting
     *  replaces. The real refusal lives in the service (a pilot with no posting has no primary), so a click
     *  forced past the `disabled` attribute does nothing — a guard that lives only in the markup is not a
     *  guard. No mechanic reads the field yet; this is the record, ODM-16 is the number. */
    protected togglePrimary(u: { pilotId: string; name: string; primary: boolean }): void {
        if (!u.pilotId) return;
        this.crew.setPrimaryHull(u.pilotId, u.primary ? null : u.name);
    }

    /** ODM-25 — the PILOT OVERLAY's posting list (the shared `bce-pilot-detail` renders it only when a
     *  caller supplies it AND the campaign is ODM). Same trade rule, same annotation discipline as the
     *  roster pull-down; derived in the service so the two lists cannot disagree. */
    protected readonly postingOptions = computed(() => {
        const id = this.detailPilot();
        return id ? this.crew.postingOptions(id) : [];
    });
    /** Apply a posting chosen on the pilot overlay ('' = stand down). Same warnings, same one write. */
    protected changePosting(pilotId: string, instanceId: string): void {
        if (instanceId) {
            const warn = this.crew.displacementWarning(pilotId, instanceId);
            if (warn && !confirm(warn)) return;
            this.applyCrew(instanceId, pilotId);
            return;
        }
        const from = (this.state.pilots() ?? []).find((p) => p.pilotId === pilotId)?.assignedInstanceId;
        if (!from) return;
        const warn = this.crew.standDownWarning(from);
        if (warn && !confirm(warn)) return;
        this.applyCrew(from, '');
    }
    /** ODM-25b — correct a trade from the overlay. The choices are ODM's vocabulary, supplied to the shared
     *  component; the warning and the write are the service's, so this and the Barracks cannot drift. */
    protected readonly tradeOptions = TRADE_CHOICES;
    protected changeTrade(pilotId: string, trade: string): void {
        const warn = this.crew.tradeChangeWarning(pilotId, trade);
        if (warn && !confirm(warn)) return;
        this.crew.setTrade(pilotId, trade);
    }

    /** Lazy: stream a cell's record sheet only when it scrolls into view (T-020). */
    protected loadSheet(id: string): void {
        void this.forceService.ensureSheet(id);
    }

    protected setCondition(id: string, cond: string): void {
        const force = this.state.startingForce() ?? [];
        // HOTFIX-024 — defense in depth behind the disabled <option>: never set an UNDAMAGED unit 'In repair'
        // (it would vanish from the bays AND the mission pool). Damaged units are unaffected (every option stays).
        if (cond === 'In repair' && !hasMechDamage(force.find((i) => i.instanceId === id)?.damage)) return;
        // Update the proto-instance (single source of truth) + persist IN PLACE (debounced; D-019).
        this.state.setStartingForce(force.map((i) => (i.instanceId === id ? { ...i, condition: cond } : i)));
        this.sheetRev.bump(id); // D-084: condition rides the same per-card bit → only this cell re-reads
        this.syncedId.set(id);
        this.schedulePersist();
        setTimeout(() => {
            if (this.syncedId() === id) this.syncedId.set(null);
        }, 1400);
    }
    private schedulePersist(): void {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.store.persistCurrent();
        }, 500);
    }

    // ── Lance management (MOVE TO ▸ / + ADD / + NEW LANCE) — lanceId mutations, persisted in place ──
    /** Every lance (incl. empty + NEW LANCE ones) as MOVE-TO targets. */
    protected readonly lanceOptions = computed(() => (this.structure()?.lances ?? []).map((l) => ({ id: l.id, name: l.name })));
    /** Unassigned units (the RESERVE pool) for the lance-header + ADD selector. */
    protected readonly reserveUnits = computed(() => this.force().filter((i) => !i.lanceId).map((i) => ({ id: i.instanceId, name: i.chassis })));

    /** Move a unit to a lance (or RESERVE) → re-group live + prune the emptied source + persist in place. */
    protected moveTo(instanceId: string, target: string): void {
        const force = this.state.startingForce() ?? [];
        const inst = force.find((i) => i.instanceId === instanceId);
        if (!inst) return;
        const source = inst.lanceId;
        const dest = target === this.reserveKey ? undefined : target;
        if (source === dest) return;
        const next = force.map((i) => (i.instanceId === instanceId ? { ...i, lanceId: dest } : i));
        // enforceBasis (default false) would hard-cap; default = overstrength warns, never blocks (PROD-001).
        if (STRUCTURE_TUNABLES.enforceBasis && dest) {
            const basis = this.structure()?.basis ?? 4;
            if (next.filter((i) => i.lanceId === dest).length > basis) return;
        }
        this.state.setStartingForce(next);
        const struct = this.state.forceStructure();
        if (struct && source) this.state.setForceStructure(pruneLance(struct, next, source));
        this.schedulePersist();
    }
    /** + ADD on a lance header — pull a chosen RESERVE unit in. */
    protected addToLance(lanceId: string, instanceId: string): void {
        if (instanceId) this.moveTo(instanceId, lanceId);
    }
    /** + NEW LANCE — append an empty lance (next-in-sequence name); it persists until filled then emptied. */
    protected newLance(): void {
        const struct = this.state.forceStructure();
        if (!struct) return;
        const clan = this.state.force() === 'CLAN';
        this.state.setForceStructure({ ...struct, lances: [...struct.lances, buildNextLance(struct, clan)] });
        this.schedulePersist();
    }

    // ── ACTIVE MISSION cell (a DATA-003 view of the stored MissionSpec + clock; both variants) ──
    protected readonly counts = computed(() => categoryCounts(this.force()));
    protected readonly readiness = computed(() => forceReadiness(this.force()));

    private daysBetween(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
        return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
    }

    /** The active operation, derived from the stored MissionSpec (+ the D-026 branch name + clock). Null = idle. */
    protected readonly activeMission = computed(() => {
        const spec = this.state.missionSpec();
        if (!spec) return null;
        const seeded = !!spec.forge && !spec.forge.generic;
        const branch = (this.state.missionTree() ?? []).find((b) => b.state === 'ACTIVE');
        const op = seeded ? `OPERATION ${branch?.name ?? spec.typeName}`.toUpperCase() : spec.typeName.toUpperCase();
        const world = seeded ? `${spec.forge!.slots.WORLD} — ${spec.forge!.slots.DISTRICT} district` : spec.terrain.biome;
        const ratio = spec.playerBv > 0 ? spec.opforBv / spec.playerBv : 1;
        const threat = ratio >= 1 ? 'HIGH' : ratio >= 0.66 ? 'MEDIUM' : 'LOW';
        const window = spec.window.deployByDays + spec.window.engagementDays;
        const anchor = this.state.acceptedContract()?.acceptedDate ?? null;
        const now = this.state.currentDate();
        const day = anchor && now ? Math.min(window, Math.max(1, this.daysBetween(anchor, now) + 1)) : 1;
        return { op, type: spec.typeName, world, threat, day, window };
    });

    /** Idle-variant context line — the live contract (or faction) + a pointer to the Missions tab. */
    protected readonly idleContext = computed(() => {
        const ac = this.state.acceptedContract();
        if (ac) return `${ac.missionName} · ${ac.target} · BEGIN an operation on the Missions tab`; // ODM-9: no generate exists in ODM
        const who = this.state.faction() ?? this.state.commandName();
        return who ? `${who} · review the contract market on the Missions tab` : 'No contract — the Missions tab opens the market';
    });

    /** Tap a count box → filter the roster to deployed units (only 'Mechs are deployable this slice). */
    protected toggleDeployFilter(key: string): void {
        if (key !== 'mechs') return;
        this.deployFilter.update((v) => !v);
    }

    protected explode(vm: { fu: CBTForceUnit | null; name: string; variant: string; pilotAbilities?: string[] }): void {
        if (!vm.fu) return;
        this.explodedTitle.set(`${vm.name} ${vm.variant}`.trim());
        this.explodedAbilities.set(vm.pilotAbilities ?? []); // D-070 (E): carry the SPA overlay into the modal
        this.explodedFu.set(vm.fu);
    }
    protected closeModal(): void {
        this.explodedFu.set(null);
    }

    // D-071 (B): print every record sheet in a lance/Star (or Reserve/Motor Pool), one sheet per page. Ensure
    // each unit's sheet is loaded first (the D-006 lazy ensureSheet — off-screen cells haven't streamed yet),
    // then compose each with its D-070 pilot box + SPAs and print the batch. Read-only; no state change.
    protected readonly printingLance = signal<string | null>(null);
    protected async printLance(sec: { id: string; units: { id: string; pilotAbilities: string[] }[] }): Promise<void> {
        if (this.printingLance()) return;
        this.printingLance.set(sec.id);
        try {
            const ids = sec.units.map((u) => u.id);
            await Promise.all(ids.map((id) => this.forceService.ensureSheet(id).catch(() => undefined)));
            // ensureSheet no-ops on a non-pending entry, so a cell that was mid-stream needs a wait — poll
            // until every group entry has settled (ok / error / missing) before composing.
            for (let i = 0; i < 80; i++) {
                const m = this.forceService.entries();
                if (ids.every((id) => { const e = m[id]; return !e || e.status === 'ok' || e.status === 'error' || e.status === 'missing'; })) break;
                await new Promise((r) => setTimeout(r, 100));
            }
            const m = this.forceService.entries();
            const items = sec.units
                .map((u) => ({ fu: m[u.id]?.fu ?? null, abilities: u.pilotAbilities }))
                .filter((it) => !!it.fu && !!it.fu.svg());
            printSheets(items, { gameSystem: this.state.gameSystem(), appRef: this.appRef, environmentInjector: this.envInjector }); // D-083: AS routes to the card print; CBT byte-identical
        } finally {
            this.printingLance.set(null);
        }
    }

    // ── ODM-17 P2-e — THE FLEET, real: packs/odm/fleet.json (one-way from the PM canonical-lift master)
    //    rendered LIVE (the status overlay wins). The tier-fiction vessels, `shipForSize`, and the static
    //    pct literals died here — the resource-tier branches never run under ODM. The Iron Covenant's
    //    fuel bar reads the ODM-11 fuel card (ONE tank, never double-tracked — the stock's 215 t capacity
    //    IS her bunker, master-confirmed); the Leopards' tanks are capacity DATA, not tracked separately
    //    in v1. Doors render as data AND truth: a 0-door hold loads nothing afield.
    private readonly fleetSvc = inject(OdmFleetService);
    protected readonly fleetVessels = computed<OdmVessel[]>(() => this.fleetSvc.vessels() ?? []);
    protected readonly fleetOps = this.fleetSvc.opsData;
    protected readonly fleetCount = computed(() => {
        const v = this.fleetVessels();
        if (!v.length) return 'fleet manifest loading…';
        const ops = v.filter((x) => x.status === 'OPERATIONAL' && x.type === 'DropShip').length;
        const jump = v.find((x) => x.type === 'JumpShip');
        return `${ops} operational DropShip${ops === 1 ? '' : 's'} · ${jump ? 'owned JumpShip (K-F)' : 'no JumpShip'}`;
    });
    /** The company tank, live (fuelPct/fuelState = the ODM-11 color law). */
    protected readonly icFuel = computed(() => { const s = this.state.odmStocks() ?? odmStartingStocks(); return { pct: fuelPct(s), state: fuelState(s) }; });
    protected readonly liftBudget = this.fleetSvc.liftBudget;
    protected isJumpShip(v: OdmVessel): boolean { return v.type === 'JumpShip'; }
    /** A bay line in the master's own notation: "type × count (doors)" / cargo as "N t (doors)". */
    protected bayLine(b: OdmFleetBay): string {
        if (b.type === 'cargo') return `cargo ${b.tons} t (${b.doors} door${b.doors === 1 ? '' : 's'})${b.doors === 0 ? ' — loads NOTHING afield' : ''}`;
        return `${b.type === 'mech' ? '’Mech' : 'fighter'} × ${b.count} (${b.doors})`;
    }
    protected doorsLine(v: OdmVessel): string {
        if (!v.doorsMax) return '';
        const used = doorsUsed(v);
        return `doors ${used}/${v.doorsMax}${used >= v.doorsMax ? ' — AT the construction cap' : ''}`;
    }
}
