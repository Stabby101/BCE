/*
 * BCE retool — Unit Roster force/render service (DIRECTIVE-010; campaign-real force D-018).
 * Builds a SELF-CONTAINED CBTForce from the campaign's GENERATED starting force (D-018
 * proto-instances on NewCampaignState), resolving each ref to a REAL catalog Unit
 * (DataService -> db.mekbay.com). Sprites resolve EAGERLY (status 'pending'); the Classic
 * record sheet (MekBay's ForceUnit pipeline) loads LAZILY per cell on viewport intersection
 * (T-020 scale guard) so regiment-scale stays responsive. MekBay components reused unedited.
 *
 * D-018 supersedes the D-010 hardcoded sample force. Pre-D-018 saves (no startingForce) and
 * any not-yet-generated generatable campaign generate-on-first-load here, then persist (flagged).
 */
import { Injectable, Injector, effect, inject, signal, untracked } from '@angular/core';
import { DataService } from '../../../services/data.service';
import { UnitInitializerService } from '../../../services/unit-initializer.service';
import { CBTForce } from '../../../models/cbt-force.model';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../../models/crew-member.model';
import type { UnitSummary as Unit } from '../../../models/unit-summary.model';
import { NewCampaignState } from '../../new-campaign-state';
import { ForceGeneratorService } from '../../force/force-generator.service';
import { CampaignSaveStore } from '../../campaign-save-store';
import { PilotService } from '../../barracks/pilot.service';
import type { ProtoInstance } from '../../force/force-generator';
import { resolveInstanceUnit } from './resolve-instance-unit'; // PLATFORM-1 Part C — pure + id-guarded
import { applyDamage, applyLiveState, resetDamage } from '../../battle/battle-damage';
import type { CBTSerializedState } from '../../../models/force-serialization';
import { ClaimRealtimeService } from '../../claims/claim-realtime.service';
import { SheetRevService } from './sheet-rev.service';
import { resolveMekbayEraId } from '../../faction/faction-select';

export interface RosterEntry {
    status: 'pending' | 'loading' | 'ok' | 'missing' | 'error';
    fu?: CBTForceUnit;
    unit?: Unit;
    error?: string;
}

@Injectable()
export class RosterForceService {
    private readonly dataService = inject(DataService);
    private readonly unitInitializer = inject(UnitInitializerService);
    private readonly injector = inject(Injector);
    private readonly state = inject(NewCampaignState);
    private readonly forceGen = inject(ForceGeneratorService);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
    private readonly rt = inject(ClaimRealtimeService);   // D-084 — the live in-battle fan (incoming socket deltas + the GM's own published edits)
    private readonly sheetRev = inject(SheetRevService);  // D-084 — per-card dirty bits

    private force: CBTForce | null = null;
    private built = false;
    private instances: ProtoInstance[] = [];
    /** D-084 — last live-battle timestamp seen per instance, so a re-applied delta flips ONLY the cards that changed. */
    private readonly lastBattleAt: Record<string, number> = {};
    /** D-084 — last applied crew signature per instance, so a pilot edit flips ONLY the card whose crew actually changed. */
    private readonly lastCrewSig = new Map<string, string>();
    /** HOTFIX-024 — last applied DAMAGE signature per instance. The cached fu holds the armor pips; the
     *  proto-instance.damage is the source of truth. When they diverge (a repair completion clears the envelope
     *  while the roster stays mounted), re-sync ONLY that card's fu + flip its bit (the deploy sheet was already
     *  fine — it re-derives from the condition gate; the Roster's per-instance fu cache is what goes stale). */
    private readonly lastDamageSig = new Map<string, string>();

    /** instanceId → entry (status + the loaded ForceUnit). */
    readonly entries = signal<Record<string, RosterEntry>>({});
    readonly ready = signal(false);
    readonly dataError = signal<string | null>(null);

    constructor() {
        // HOTFIX-013: hydrate NEWLY-ADDED instances reactively. A market buy appends a ProtoInstance to
        // startingForce → the cell renders, but its `entries` row didn't exist (the initial resolve runs once in
        // build()) → null unit → MOVE/ARMS "—", placeholder icon, sheet stuck. This effect resolves any instance
        // missing an entry the moment the force changes, so a bought cell fills without a refresh. build() owns
        // the initial resolve (we wait on ready()); this only ever touches genuinely-new ids → idempotent.
        effect(() => {
            const force = this.state.startingForce() ?? [];
            if (!this.ready()) return; // catalog not loaded yet — build() will do the first resolve
            this.resolveNewInstances(force);
            this.resyncChangedInstances(force); // HOTFIX-024: a loaded cell whose damage envelope changed (e.g. repair cleared it) repaints
        });

        // D-084 — LIVE in-battle damage on the GM roster, per-card. The realtime fan (incoming player deltas
        // AND the GM's own published battle edits both land in rt.battleStates()) is the trigger — NO polling.
        // On every diff we re-apply that ONE unit's live state to its roster ForceUnit and flip ONLY its dirty
        // bit; the cell pulls its current DMG line + thumbnail once. Sibling cards (unchanged `at`) never move.
        effect(() => {
            const states = this.rt.battleStates();
            untracked(() => {
                for (const id of Object.keys(states)) {
                    const at = states[id]?.at ?? 0;
                    if (this.lastBattleAt[id] === at) continue; // unchanged → don't touch this card
                    this.lastBattleAt[id] = at;
                    const fu = this.entries()[id]?.fu;
                    const st = states[id]?.state as CBTSerializedState | undefined;
                    if (fu && st && Object.keys(st).length) applyLiveState(fu, st); // mutate THIS card's fu in place
                    this.sheetRev.bump(id); // coalesced re-read of just this card
                }
            });
        });

        // D-084 test seam (OPT-IN: only when localStorage['bce.test.d084'] is set — never present in normal use).
        // Pushes a no-op live-battle delta for one instance so a headless render can prove the socket→per-card
        // path (the GM-roster effect above fires → flips ONLY that card). Identical to a real inbound socket delta.
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.d084')) {
            (window as unknown as Record<string, unknown>)['__d084sim'] = (id: string): void =>
                this.rt.battleStates.update((m) => ({ ...m, [id]: { state: m[id]?.state ?? {}, at: (m[id]?.at ?? 0) + 1 } }));
        }

        // HOTFIX-024 test seam (OPT-IN: localStorage['bce.test.hf024'] — never present in normal use). Battle damage
        // is out of the headless harness's scope, so this injects/reads a small armor envelope on an instance to drive
        // the repair round-trip: inject → the resyncChangedInstances effect APPLIES it (the DMG line appears) → a REAL
        // repair completion (assign + clock advance → settle) CLEARS it (the DMG line goes). Same state shape as a
        // persisted battle envelope (D-030).
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage.getItem('bce.test.hf024')) {
            (window as unknown as Record<string, unknown>)['__hf024'] = {
                units: (): unknown => (this.state.startingForce() ?? []).map((i) => ({ id: i.instanceId, label: `${i.chassis} ${i.model}`.trim(), vehicle: i.unitType === 'vehicle', damaged: !!i.damage, loaded: this.entries()[i.instanceId]?.status === 'ok', condition: i.condition })),
                damage: (id: string): void => this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => i.instanceId === id
                    ? { ...i, damage: { locations: { CT: { armor: 6 } }, crits: [], heat: { current: 0, previous: 0 }, modified: false, destroyed: false, shutdown: false, crew: [] } as CBTSerializedState } : i)),
            };
        }
    }

    /** Resolve + insert entries for any force instance without one yet (dual-path), then trigger its lazy sheet.
     *  Reads `entries` UNTRACKED so the effect depends only on startingForce/ready (no self-retrigger loop). */
    private resolveNewInstances(force: ProtoInstance[]): void {
        this.instances = force; // keep current (ensureSheet's damage lookup reads this list)
        const have = untracked(() => this.entries());
        const fresh: string[] = [];
        for (const inst of force) {
            if (have[inst.instanceId]) continue; // already resolved → idempotent, no churn on existing cells
            const unit = this.resolveUnit(inst);
            this.patch(inst.instanceId, unit ? { status: 'pending', unit } : { status: 'missing' });
            if (unit) fresh.push(inst.instanceId);
        }
        // The InViewDirective fires ONCE — a cell whose first intersection happened before its entry resolved
        // won't re-trigger — so kick the lazy sheet here. Deferred (setTimeout) to run OUTSIDE the effect's
        // reactive scope (ensureSheet reads entries()) and after the cell paints the resolved unit (icon/MOVE/ARMS).
        if (fresh.length) setTimeout(() => { for (const id of fresh) void this.ensureSheet(id); }, 0);
    }

    /** HOTFIX-024 — a card's persisted-damage signature; a diff drives the per-card resync below. */
    private damageSig(d?: CBTSerializedState | null): string {
        return d ? JSON.stringify(d) : '';
    }

    /** HOTFIX-024 — for already-LOADED cells whose proto-instance damage envelope CHANGED (notably a repair
     *  completion clearing it to undefined while the Roster tab stays mounted), reset the cached fu to the
     *  CURRENT envelope and flip the card's dirty bit so its DMG line + thumbnail repaint to the repaired state.
     *  Mirrors the D-084 live-battle effect, but driven off inst.damage (not the socket fan). Reads `entries`
     *  UNTRACKED so the host effect depends only on startingForce (no self-retrigger). Pristine/unloaded cells
     *  (status !== 'ok') are skipped — they pick the cleared envelope up on their own ensureSheet. */
    private resyncChangedInstances(force: ProtoInstance[]): void {
        const have = untracked(() => this.entries());
        const changed: string[] = [];
        for (const inst of force) {
            const e = have[inst.instanceId];
            if (!e || e.status !== 'ok' || !e.fu) continue; // only resolved+loaded cells hold a cached fu
            const sig = this.damageSig(inst.damage);
            if (this.lastDamageSig.get(inst.instanceId) === sig) continue; // envelope unchanged → leave this card
            this.lastDamageSig.set(inst.instanceId, sig);
            resetDamage(e.fu);              // wipe the cached fu to pristine (applyDamage can't CLEAR a unit)
            applyDamage(e.fu, inst.damage); // re-apply the current envelope (undefined after repair → stays pristine)
            changed.push(inst.instanceId);
        }
        for (const id of changed) this.sheetRev.bump(id); // coalesced per-card re-read (DMG line + thumbnail)
    }

    async build(): Promise<void> {
        if (this.built) return;
        this.built = true;
        try {
            await this.ensureData();
        } catch {
            this.dataError.set('Unit catalog failed to load (db.mekbay.com).');
            this.ready.set(true);
            return;
        }

        // Resolve the campaign force. Pre-D-018 saves / not-yet-generated generatable campaigns
        // generate-on-first-load here, then persist (the flagged legacy path).
        let force = this.state.startingForce();
        if (force === null && this.forceGen.isGeneratable()) {
            try {
                await this.forceGen.generateForCampaign();
                await this.store.quickSave();
            } catch { /* leave it empty; non-fatal */ }
            force = this.state.startingForce();
        }
        // Structure-on-load (D-019): a loaded force without lance links (pre-D-019 save) gets
        // organized into lances/Stars + re-persisted IN PLACE (no new autosave).
        if (force && force.length && this.forceGen.ensureStructure()) {
            try { await this.store.persistCurrent(); } catch { /* non-fatal */ }
            force = this.state.startingForce();
        }
        // Pilots-on-load (D-020): a loaded force with no pilots (pre-D-020 save) gets the 1:1 +
        // spare roster minted once + re-persisted IN PLACE (no new autosave). Pilots ride their
        // own signal, so `force` is unchanged.
        if (force && force.length && this.pilotService.ensurePilots()) {
            try { await this.store.persistCurrent(); } catch { /* non-fatal */ }
        }
        this.instances = force ?? [];

        this.force = new CBTForce('BCE Campaign Force', this.dataService, this.unitInitializer, this.injector);

        // Resolve Units eagerly (sprites are cheap); DEFER sheet streaming to ensureSheet().
        for (const inst of this.instances) {
            const unit = this.resolveUnit(inst);
            this.patch(inst.instanceId, unit ? { status: 'pending', unit } : { status: 'missing' });
        }
        this.ready.set(true);
    }

    /** Lazily load one cell's Classic record sheet (called on viewport intersection). */
    async ensureSheet(instanceId: string): Promise<void> {
        const e = this.entries()[instanceId];
        if (!e || e.status !== 'pending' || !e.unit || !this.force) return;
        this.patch(instanceId, { status: 'loading' });
        try {
            const fu = this.force.addUnit(e.unit);
            await fu.load();
            const inst0 = this.instances.find((i) => i.instanceId === instanceId);
            applyDamage(fu, inst0?.damage); // D-030: real persisted battle damage → DMG line + thumbnail
            this.lastDamageSig.set(instanceId, this.damageSig(inst0?.damage)); // HOTFIX-024: prime the damage-resync guard
            this.applyCrew(instanceId, fu); // DRIVE the Classic-sheet pilot box from the campaign pilot
            this.lastCrewSig.set(instanceId, this.crewSig(instanceId)); // D-084: prime the crew-change guard
            await this.tick(); // let the unit-svg effect paint before the cell clones the svg
            this.patch(instanceId, { status: 'ok', fu });
            this.sheetRev.bump(instanceId); // D-084: first paint of this card → pull its DMG line + thumbnail once
        } catch (er: unknown) {
            this.patch(instanceId, { status: 'error', error: this.msg(er) });
        }
    }

    /** Drive a loaded ForceUnit's crew[0] (the MekBay Classic-sheet pilot box) from the assigned
     *  campaign pilot — name + Gunnery/Piloting. Mutating crew re-runs the unit-svg effect, so the
     *  sheet repaints live; D-018 damage state on the same unit is untouched. Blank when pilotless. */
    private applyCrew(instanceId: string, fu: CBTForceUnit): void {
        const crew = fu.getCrewMember(0);
        if (!crew) return;
        const pilot = this.pilotService.pilotFor(instanceId);
        if (pilot) {
            crew.setName(pilot.callsign ? `${pilot.name} "${pilot.callsign}"` : pilot.name);
            crew.setSkill('gunnery', pilot.gunnery);
            crew.setSkill('piloting', pilot.piloting);
        } else {
            crew.setName(''); // pilotless 'Mech — clear any prior crew's identity
            crew.setSkill('gunnery', DEFAULT_GUNNERY_SKILL);
            crew.setSkill('piloting', DEFAULT_PILOTING_SKILL);
        }
    }

    /** D-084 — a card's crew identity signature (name + skills); a diff here flips just that card's bit. */
    private crewSig(instanceId: string): string {
        const p = this.pilotService.pilotFor(instanceId);
        return p ? `${p.name}|${p.callsign ?? ''}|${p.gunnery}|${p.piloting}` : '';
    }

    /** Re-drive every already-loaded cell's pilot box (after a reassignment). Pending/unloaded cells pick the
     *  new pilot up on their own ensureSheet. D-084: returns the instanceIds whose crew ACTUALLY changed, so the
     *  caller flips only those cards' dirty bits (a single pilot edit re-clones one thumbnail, not the roster). */
    reapplyAllCrew(): string[] {
        const map = this.entries();
        const changed: string[] = [];
        for (const id of Object.keys(map)) {
            const e = map[id];
            if (e.status !== 'ok' || !e.fu) continue;
            this.applyCrew(id, e.fu);
            const sig = this.crewSig(id);
            if (this.lastCrewSig.get(id) !== sig) { this.lastCrewSig.set(id, sig); changed.push(id); }
        }
        return changed;
    }

    private resolveUnit(inst: ProtoInstance): Unit | undefined {
        // HOTFIX-013 dual-path (name → MUL id → chassis/model → chassis), extracted PURE + id-guarded
        // (PLATFORM-1 Part C: a persisted -1 reads as absent — see resolve-instance-unit.ts + its spec).
        return resolveInstanceUnit(inst, this.dataService.getUnitByName(inst.unitRef), this.dataService.getUnits());
    }

    /** Ensure unit data is loaded (the /campaign route doesn't mount MekBay's App). DEPLOY-006: resolve the
     *  roster from the per-era SLICE — the SAME tiny slice the wizard uses (ensureSlice(<campaign era>)) — so a
     *  dashboard refresh NEVER pulls the 24MB catalog from db.mekbay.com. Fall back to the full catalog ONLY on
     *  a genuine slice failure (dev without slices, or a fetch error). The market GM-override still lazy-loads
     *  the full catalog (unchanged). */
    private async ensureData(): Promise<void> {
        if (this.dataService.isDataReady()) return;
        try {
            if (await this.dataService.ensureSliceIndex()) {
                const eraId = resolveMekbayEraId(this.state.era(), this.dataService.getEras());
                if (eraId != null && (await this.dataService.ensureSlice(eraId))) return; // slice resident → ready
            }
        } catch { /* fall through to the full catalog */ }
        if (!this.dataService.isDownloading()) {
            this.dataService.initialize().catch(() => { /* surfaced via whenDataReady timeout */ });
        }
        await this.whenDataReady();
    }

    private whenDataReady(): Promise<void> {
        if (this.dataService.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { ref.destroy(); reject(new Error('data timeout')); }, 30000);
            const ref = effect(() => {
                if (this.dataService.isDataReady()) {
                    clearTimeout(timer);
                    ref.destroy();
                    resolve();
                }
            }, { injector: this.injector });
        });
    }

    private patch(id: string, e: Partial<RosterEntry>): void {
        this.entries.update((m) => ({ ...m, [id]: { ...(m[id] ?? { status: 'pending' }), ...e } as RosterEntry }));
    }

    private tick(): Promise<void> {
        return new Promise((r) => setTimeout(r, 40));
    }

    private msg(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }
}
