import { DestroyRef, Injectable, Injector, effect, inject, signal, untracked } from '@angular/core';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service'; // ORDER-6 P6 — the era-less-boot fallback console line
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { CBTForce } from '../../models/cbt-force.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import type { CBTSerializedState } from '../../models/force-serialization';
import { NewCampaignState } from '../new-campaign-state';
import { resolveMekbayEraId } from '../faction/faction-select';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from '../barracks/pilot.service';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';
import { deployedSet } from '../force/deployed';
import type { ProtoInstance } from '../force/force-generator';
import { extractDamage, applyDamage, applyLiveState, liveState } from './battle-damage';
import { resolveInstanceUnit } from '../dashboard/roster/resolve-instance-unit';

export type Side = 'blufor' | 'opfor';

export interface BattleEntry {
    side: Side;
    instanceId: string;
    name: string;
    model: string;
    tons: number;
    status: 'pending' | 'loading' | 'ok' | 'missing' | 'error';
    fu?: CBTForceUnit;
    unit?: Unit;
    error?: string;
}

@Injectable()
export class BattleForceService {
    private readonly dataService = inject(DataService);
    private readonly logger = inject(LoggerService); // ORDER-6 P6
    private readonly unitInitializer = inject(UnitInitializerService);
    private readonly injector = inject(Injector);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
    private readonly rt = inject(ClaimRealtimeService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly forces: Record<Side, CBTForce | null> = { blufor: null, opfor: null };
    private readonly instById = new Map<string, ProtoInstance>(); // `${side}:${id}` -> the owning instance
    private readonly instIndex = new Map<string, string>();       // instanceId -> `${side}:${id}` (fan routing)
    private readonly cache = new Map<string, BattleEntry>();      // `${side}:${id}` -> loaded entry (fu cached)
    private readonly mirrored = new Set<string>();               // sheets whose mirror effect is registered
    private readonly lastSeen = new Map<string, string>();       // `${side}:${id}` -> json of last emitted/applied state (echo guard)
    // the PLAYER app fans its edits but never writes the snapshot (configurePlayer()).
    private authoritative = true;
    private built = false;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    readonly bluforEntries = signal<BattleEntry[]>([]);
    readonly opforEntries = signal<BattleEntry[]>([]);
    readonly hasMission = signal(false);
    readonly ready = signal(false);
    readonly dataError = signal<string | null>(null);
    readonly readOnly = signal(false);
    /** bumped when a sheet finishes loading, so the derivation re-emits the now-loaded entry. */
    private readonly rev = signal(0);

    /** PLAYER bundle only: fan battle edits but NEVER persist the campaign snapshot — authority stays
     *  with the GM app (DATA-001). Call before build(). The GM leaves the default (authoritative). */
    configurePlayer(): void {
        this.authoritative = false;
    }

    async build(): Promise<void> {
        if (this.built) return;
        this.built = true;
        this.destroyRef.onDestroy(this.rt.onBattle((instanceId, state) => this.applyRemote(instanceId, state)));
        // The battle view (GM) / player sheet must JOIN the campaign room themselves to receive the fan —
        // the GM may never open the Claims/Lobby tab (which is what otherwise calls ensure). Idempotent.
        effect(() => {
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) this.rt.ensure(id, key);
        }, { injector: this.injector });
        try {
            await this.ensureData();
        } catch {
            this.dataError.set('Unit catalog failed to load (db.mekbay.com).');
            this.ready.set(true);
            return;
        }
        this.forces.blufor = new CBTForce('BCE BLUFOR', this.dataService, this.unitInitializer, this.injector);
        this.forces.opfor = new CBTForce('BCE OPFOR', this.dataService, this.unitInitializer, this.injector);

        // Reactive derivation: re-emit the entry lists when the deployed set / mission / a sheet-load changes.
        effect(() => {
            this.rev();
            const blufor = deployedSet(this.state.startingForce(), this.state.quickMission()); // HF-020: a quick one-shot fields the WHOLE force (no stray-Reserve strand)
            const spec = this.state.missionSpec();
            const opfor = spec?.opforForce ?? [];
            this.hasMission.set(!!spec);
            this.bluforEntries.set(blufor.map((i) => this.entryFor('blufor', i, 0)));
            this.opforEntries.set(opfor.map((i, idx) => this.entryFor('opfor', i, idx)));
        }, { injector: this.injector });
        this.ready.set(true);
    }

    /** Build (or reuse the cached) entry for an instance. Loaded fu's survive a re-derivation. */
    private entryFor(side: Side, inst: ProtoInstance, idx: number): BattleEntry {
        const id = inst.instanceId || `${side}-${idx}`;
        const key = `${side}:${id}`;
        this.instById.set(key, inst); // refresh the owning-instance ref each derivation
        this.instIndex.set(id, key);  // instanceId -> key, so an inbound battle delta finds its sheet
        const cached = this.cache.get(key);
        // ORDER-9 Commit 1 — a TERMINAL entry is never resurrected. 'ok'/'loading' were already cached; 'error'/'missing'
        // are cached the same way now. A re-derivation returns the cached terminal entry, so the sheet effect (which only
        // ensureSheet's a 'pending' entry) can never re-drive a failed load — the change-detection resurrection loop
        // (entryFor re-creates 'error'→'pending' → effect → ensureSheet → throw → 'error' → …, which prod's uncapped CD
        if (cached && cached.status !== 'pending') return cached;
        const unit = this.resolveUnit(inst);
        const entry: BattleEntry = { side, instanceId: id, name: inst.chassis, model: inst.model, tons: inst.tons, status: unit ? 'pending' : 'missing', unit };
        this.cache.set(key, entry);
        return entry;
    }

    /** ORDER-9 Commit 1 — the ONLY path back to 'pending' for a terminal (error/missing) entry: an explicit user retry.
     *  Drops the cached entry so the next derivation re-resolves it fresh, then re-emits the lists (the sheet effect
     *  re-ensureSheets it). One retry = one attempt; a second failure lands terminal again (no loop). */
    retrySheet(side: Side, instanceId: string): void {
        this.cache.delete(`${side}:${instanceId}`);
        this.rev.update((v) => v + 1);
    }

    /** Lazily load one sheet (called on viewport intersection): load -> restore damage -> crew -> mirror. */
    async ensureSheet(side: Side, instanceId: string): Promise<void> {
        const key = `${side}:${instanceId}`;
        const e = this.cache.get(key);
        const force = this.forces[side];
        if (!e || e.status !== 'pending' || !e.unit || !force) return;
        this.cache.set(key, { ...e, status: 'loading' });
        this.rev.update((v) => v + 1);
        try {
            // BCE FORK-EDIT (REBASE-1 P1 e): construct the unit UNTRACKED. player-sheet drives ensureSheet from
            // inside effect()s (player-sheet.ts:299/301), so addUnit runs synchronously within a reactive context;
            // the CBTForceUnit constructor creates a standalone manualCleanup effect (cbt-force-unit.model.ts:252),
            // and the pin's Angular 22 now THROWS NG0602 ("effect() cannot be called from within a reactive context")
            // where the fork's Angular 21 tolerated it — which broke every player-sheet load. The unit's effect is
            // meant to be independent (own injector + manualCleanup), never a child of the caller's context, so
            // untracked() is the correct escape. (RosterForceService already sidesteps this by deferring ensureSheet
            // via setTimeout / an IntersectionObserver — the GM roster never hits it.) load()'s own async work is
            // already untracked in the core (cbt-force-unit.model.ts:485); registerMirror's effect runs post-await.
            const unit = e.unit; // narrowed non-null by the guard above; hoisted so the closure keeps the narrowing
            const fu = untracked(() => force.addUnit(unit));
            await fu.load();
            applyDamage(fu, this.instById.get(key)?.damage); // restore persisted battle damage
            const live = this.rt.battleStates()[instanceId]; // a newer LIVE state (mid-battle load / late join) supersedes the persisted
            if (live) applyLiveState(fu, live.state as CBTSerializedState);
            if (side === 'blufor') this.applyCrew(instanceId, fu); // campaign pilot on the BLUFOR sheet
            else if (this.state.campaignSystem() === 'hotspots') this.applyOpForSkill(fu);
            this.lastSeen.set(key, JSON.stringify(liveState(fu))); // prime the echo guard AFTER all init -> no spurious fan on load
            this.registerMirror(side, instanceId, fu); // round-trip seam
            await this.tick();
            this.cache.set(key, { ...e, status: 'ok', fu });
        } catch (er: unknown) {
            this.cache.set(key, { ...e, status: 'error', error: this.msg(er) });
        }
        this.rev.update((v) => v + 1);
    }

    /** THE round-trip seam: any armor/internal/crit/ammo change on the live fu (heat excluded ->
     *  live-only) writes the damage back to the owning instance + schedules a debounced persistCurrent.
     *  The first (priming) run captures the just-applied load state without persisting. */
    private registerMirror(side: Side, instanceId: string, fu: CBTForceUnit): void {
        const key = `${side}:${instanceId}`;
        if (this.mirrored.has(key)) return;
        this.mirrored.add(key);
        let primed = false;
        effect(() => {
            fu.getLocations(); fu.getCritSlots(); fu.getInventory(); fu.getHeat(); // track (heat now rides the live fan)
            fu.phaseTrigger();
            fu.crewTrigger(); // TABLE-2 T2-3: re-fire on a crew/pilot-hit change so a pilot hit fans on its own (crew hits aren't a tracked getter)
            if (!primed) { primed = true; return; }
            const inst = this.instById.get(key);
            if (!inst) return;
            const live = liveState(fu);              // full state (heat intact) — the fan payload + dedup key
            const liveJson = JSON.stringify(live);
            inst.damage = extractDamage(fu);
            if (liveJson !== this.lastSeen.get(key)) { // a GENUINE local edit (not an echo of an applied remote)
                this.lastSeen.set(key, liveJson);
                if (!this.readOnly()) this.rt.publishBattle(instanceId, live);
            }
            if (this.authoritative) this.schedulePersist();
        }, { injector: this.injector });
    }

    /** Inbound battle delta (the live fan): apply to the VISIBLE sheet if loaded. The echo guard
     *  (lastSeen) makes the resulting mirror run treat it as already-seen → no re-broadcast; on the
     *  GM the mirror still writes inst.damage + persists (the snapshot records the player's edit). */
    private applyRemote(instanceId: string, state: unknown): void {
        const key = this.instIndex.get(instanceId);
        if (!key || state == null) return;
        this.lastSeen.set(key, JSON.stringify(state));
        const e = this.cache.get(key);
        if (e?.fu) applyLiveState(e.fu, state as CBTSerializedState); // not loaded yet -> ensureSheet applies on load
    }

    private schedulePersist(): void {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => { this.persistTimer = null; void this.store.persistCurrent(); }, 600);
    }

    private applyCrew(instanceId: string, fu: CBTForceUnit): void {
        const crew = fu.getCrewMember(0);
        if (!crew) return;
        const pilot = this.pilotService.pilotFor(instanceId);
        if (pilot) {
            crew.setName(pilot.callsign ? `${pilot.name} "${pilot.callsign}"` : pilot.name);
            crew.setSkill('gunnery', pilot.gunnery);
            crew.setSkill('piloting', pilot.piloting);
        }
    }

    private applyOpForSkill(fu: CBTForceUnit): void {
        const crew = fu.getCrewMember(0);
        if (!crew) return;
        const d = this.state.gmDifficulty() ?? 1;
        const [gunnery, piloting] = d > 1.3 ? [2, 3] : d >= 1.1 ? [3, 4] : [4, 5]; // Elite / Veteran / Regular
        crew.setSkill('gunnery', gunnery);
        crew.setSkill('piloting', piloting);
    }

    private resolveUnit(inst: ProtoInstance): Unit | undefined {
        // missing the positive-mulId leg (id:-1 sentinel guarded — 1,545 catalog units share -1), which
        // bites exactly the player-imported units whose unitRef drifted from the receiving catalog's names.
        return resolveInstanceUnit(inst, this.dataService.getUnitByName(inst.unitRef), this.dataService.getUnits());
    }

    /** DEPLOY-006: the battle/MekBay view resolves units from the per-era SLICE (the same one the wizard +
     *  roster use) — never the 24MB full catalog. Index → campaign era → era slice; fall back to the full
     *  catalog ONLY on a genuine slice failure. The market GM-override still lazy-loads the full catalog. */
    private async ensureData(): Promise<void> {
        if (this.dataService.isDataReady()) return;
        try {
            if (await this.dataService.ensureSliceIndex()) {
                // ORDER-6 P6 — a cold boot on the player SHEET route runs this BEFORE the campaign snapshot has
                // hydrated the era over the socket, so `state.era()` is momentarily null. Resolving era-less here
                // fell straight through to the 24 MB full catalog (units.json requested at ~90 ms) — every player
                // phone, every mode. The roster→sheet path is unaffected: the era is already resident there, so
                // whenEra() returns immediately. WAIT for the era before choosing a slice; only a genuinely
                // era-less boot (nothing bound) falls through to the full catalog, and says so.
                if (await this.whenEra()) {
                    const eraId = resolveMekbayEraId(this.state.era(), this.dataService.getEras());
                    if (eraId != null && (await this.dataService.ensureSlice(eraId))) return; // slice resident → ready
                } else {
                    this.logger.warn('[P6] no campaign era bound — the full catalog is the honest fallback for this boot.');
                }
            }
        } catch { /* fall through to the full catalog */ }
        if (!this.dataService.isDownloading()) this.dataService.initialize().catch(() => { /* surfaced via timeout */ });
        await this.whenDataReady();
    }

    /** ORDER-6 P6 — resolve once the campaign era is KNOWN (true) or knowably absent (false). The player sheet route
     *  can boot before the snapshot fan hydrates the era; the roster/GM paths already have it resident, so this
     *  returns immediately there. Bounded so a stalled snapshot degrades to the full-catalog fallback, never hangs. */
    private whenEra(): Promise<boolean> {
        if (this.state.era() != null) return Promise.resolve(true);
        if (!this.store.campaignId()) return Promise.resolve(false); // nothing bound → no era is ever coming
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => { ref.destroy(); resolve(this.state.era() != null); }, 20000);
            const ref = effect(() => {
                if (this.state.era() != null) { clearTimeout(timer); ref.destroy(); resolve(true); }
            }, { injector: this.injector });
        });
    }

    private whenDataReady(): Promise<void> {
        if (this.dataService.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { ref.destroy(); reject(new Error('data timeout')); }, 30000);
            const ref = effect(() => {
                if (this.dataService.isDataReady()) { clearTimeout(timer); ref.destroy(); resolve(); }
            }, { injector: this.injector });
        });
    }

    private tick(): Promise<void> { return new Promise((r) => setTimeout(r, 40)); }
    private msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
}
