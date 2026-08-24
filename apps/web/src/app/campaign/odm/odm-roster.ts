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
import { shipForSize } from '../size-capital/resources';
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
import type { Unit } from '../../models/units.model';

interface Vessel {
    name: string;
    cls: string;
    kind: 'drop' | 'jump' | 'contract' | 'none';
    pct?: number;
}

@Component({
    selector: 'bce-odm-roster',
    standalone: true,
    imports: [BceUnitSpriteComponent, InViewDirective, SheetViewComponent, SheetModalComponent, PilotDetailComponent],
    providers: [RosterForceService],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-roster.html',
    styleUrl: '../dashboard/roster/roster.scss', // SHARED (styles are not forked)
})
export class OdmRosterComponent {
    private readonly state = inject(NewCampaignState);
    private readonly appRef = inject(ApplicationRef); // D-083 — AS print needs the app injector for dynamic cards
    private readonly envInjector = inject(EnvironmentInjector);
    private readonly forceService = inject(RosterForceService);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
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
    /** IMPORT-7 Part B — Fleet & Transport (DropShips/fuel/jump-passage) is a Traditional resource-tier mechanic; hidden under
     *  Hot Spots (no fuel model in the DR book — transport is the negotiated SP term + the brief's transit line). */
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
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
            commander: !!inst.isCommander,
            // HOTFIX-024 — has any MECH damage? Gates the 'In repair' condition option (an undamaged unit can't be
            // repaired → it would strand in neither the bays nor the deployable pool). Same predicate as the queue.
            hasDamage: hasMechDamage(inst.damage),
            vehicle: inst.unitType === 'vehicle', // D-046 — combined-arms type flag (motor-pool grouping + chip)
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

    /** Display name with the optional callsign, e.g. `Mara Voss "Ghost"` — used for the sheet crew + the ▾ list. */
    private pilotName(p: Pilot): string {
        return p.callsign ? `${p.name} "${p.callsign}"` : p.name;
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
     *  never crew again — KIA pilots are filtered out (the service hard-guards the same line). */
    protected readonly pilotOptions = computed(() =>
        [...(this.state.pilots() ?? [])]
            .filter((p) => p.status !== 'KIA')
            .sort((a, b) => a.gunnery - b.gunnery || a.piloting - b.piloting || a.name.localeCompare(b.name))
            .map((p) => ({ id: p.pilotId, label: `${this.pilotName(p)} · ${p.gunnery}/${p.piloting}${p.assignedInstanceId ? '' : ' — spare'}` })),
    );
    /** D-036: the pilot detail explode (the roster pilot block's name opens it). */
    protected readonly detailPilot = signal<string | null>(null);
    /** Pilots exist for this campaign (drives whether the pull-down renders). */
    protected readonly hasPilots = computed(() => (this.state.pilots()?.length ?? 0) > 0);

    /** Reassign a 'Mech's pilot ('' = unassign the current crew) → re-drive sheets + persist in place. */
    protected reassignPilot(instanceId: string, pilotId: string): void {
        if (pilotId) {
            this.pilotService.assign(pilotId, instanceId);
        } else {
            const current = (this.state.pilots() ?? []).find((p) => p.assignedInstanceId === instanceId);
            if (current) this.pilotService.assign(current.pilotId, null);
        }
        // D-084: re-drive the live SVGs off the new crew, then flip ONLY the affected card's dirty bit (the
        // returned changed-id; the bump coalesces + awaits the svg paint). No whole-roster re-clone.
        for (const cid of this.forceService.reapplyAllCrew()) this.sheetRev.bump(cid);
        this.schedulePersist();             // in-place persist (no new autosave), debounced
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

    // ── Fleet (reflects the resource tier chosen in the wizard) ──
    protected readonly fleet = computed<Vessel[]>(() => {
        const res = this.state.resources();
        const ship = shipForSize(this.state.unitSize()?.id);
        const drops: Vessel[] = [
            { name: 'Wolf’s Fang', cls: `${ship}-class DropShip`, kind: 'drop', pct: 78 },
            { name: 'Talon’s Reach', cls: `${ship}-class DropShip`, kind: 'drop', pct: 46 },
        ];
        if (res === 'established') return [...drops, { name: 'Wolf’s Tongue', cls: 'Invader-class JumpShip', kind: 'jump', pct: 64 }];
        if (res === 'normal') return [...drops, { name: 'Jump passage', cls: 'Contracted lift — no owned JumpShip', kind: 'contract' }];
        return [{ name: 'Transport', cls: 'Lean tier — lift bought / leased / contracted per drop', kind: 'none' }];
    });
    protected readonly fleetCount = computed(() => {
        const f = this.fleet();
        const drops = f.filter((v) => v.kind === 'drop').length;
        const jump = f.some((v) => v.kind === 'jump');
        if (drops === 0) return 'no organic transport';
        return `${drops} DropShip${drops === 1 ? '' : 's'} · ${jump ? 'owned JumpShip (K-F)' : 'jump passage contracted'}`;
    });
    protected fuelClass(pct: number): string {
        return pct > 60 ? 'g' : pct > 40 ? 'a' : 'r';
    }
}
