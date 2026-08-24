/*
 * BCE — BATTLE-VIEW force service (DIRECTIVE-030). Builds the MEKBAY-tab battle view: the DEPLOYED
 * BLUFOR (via the D-027 deployedSet() accessor — its designed consumer) + the active mission's OpFor
 * (the stored MissionSpec.opforForce), each as its own CBTForce of MekBay ForceUnits. Sheets load
 * lazily per viewport (T-020 scale guard). Persisted battle damage is re-applied on load; every live
 * armor/internal/crit/ammo edit MIRRORS back to the owning instance and debounce-persists. MekBay
 * components reused unedited (the D-010 pipeline; the round-trip is BCE-side wrappers + an effect).
 */
import { DestroyRef, Injectable, Injector, effect, inject, signal } from '@angular/core';
import { DataService } from '../../services/data.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { CBTForce } from '../../models/cbt-force.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { Unit } from '../../models/units.model';
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
    private readonly unitInitializer = inject(UnitInitializerService);
    private readonly injector = inject(Injector);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilotService = inject(PilotService);
    private readonly rt = inject(ClaimRealtimeService); // D-048 phase B — the battle-state fan
    private readonly destroyRef = inject(DestroyRef);

    private readonly forces: Record<Side, CBTForce | null> = { blufor: null, opfor: null };
    private readonly instById = new Map<string, ProtoInstance>(); // `${side}:${id}` -> the owning instance
    private readonly instIndex = new Map<string, string>();       // instanceId -> `${side}:${id}` (fan routing)
    private readonly cache = new Map<string, BattleEntry>();      // `${side}:${id}` -> loaded entry (fu cached)
    private readonly mirrored = new Set<string>();               // sheets whose mirror effect is registered
    private readonly lastSeen = new Map<string, string>();       // `${side}:${id}` -> json of last emitted/applied state (echo guard)
    // Authority is split by BUNDLE: the GM app persists battle edits to the campaign snapshot (D-030);
    // the PLAYER app fans its edits but never writes the snapshot (configurePlayer()).
    private authoritative = true;
    private built = false;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    readonly bluforEntries = signal<BattleEntry[]>([]);
    readonly opforEntries = signal<BattleEntry[]>([]);
    readonly hasMission = signal(false);
    readonly ready = signal(false);
    readonly dataError = signal<string | null>(null);
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
        // D-048 phase B — inbound battle deltas apply to the matching loaded sheet (the live fan).
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
        if (cached && (cached.status === 'ok' || cached.status === 'loading')) return cached;
        const unit = this.resolveUnit(inst);
        const entry: BattleEntry = { side, instanceId: id, name: inst.chassis, model: inst.model, tons: inst.tons, status: unit ? 'pending' : 'missing', unit };
        this.cache.set(key, entry);
        return entry;
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
            const fu = force.addUnit(e.unit);
            await fu.load();
            applyDamage(fu, this.instById.get(key)?.damage); // restore persisted battle damage
            const live = this.rt.battleStates()[instanceId]; // a newer LIVE state (mid-battle load / late join) supersedes the persisted
            if (live) applyLiveState(fu, live.state as CBTSerializedState);
            if (side === 'blufor') this.applyCrew(instanceId, fu); // campaign pilot on the BLUFOR sheet
            else if (this.state.campaignSystem() === 'hotspots') this.applyOpForSkill(fu); // D-124 — GM difficulty raises OpFor skill (HS-only)
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
            fu.phaseTrigger(); // D-049: re-fire after MekBay's COMMIT/END-PHASE (endPhase bumps this) so the CONSOLIDATED state fans
            if (!primed) { primed = true; return; }
            const inst = this.instById.get(key);
            if (!inst) return;
            const live = liveState(fu);              // full state (heat intact) — the fan payload + dedup key
            const liveJson = JSON.stringify(live);
            inst.damage = extractDamage(fu);          // the persisted envelope (heat NEUTRALIZED — D-030 live-only)
            if (liveJson !== this.lastSeen.get(key)) { // a GENUINE local edit (not an echo of an applied remote)
                this.lastSeen.set(key, liveJson);
                this.rt.publishBattle(instanceId, live); // -> host persists + fans the delta to the room
            }
            if (this.authoritative) this.schedulePersist(); // GM writes the campaign snapshot (D-030); player never does
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

    /** D-124 — Hot Spots: the OpFor has no campaign pilot, so its sheet crew defaults to MekBay's baseline. The GM
     *  difficulty slider raises the OpFor skill TIER (≤1.0 Regular · 1.1–1.3 Veteran · >1.3 Elite). Render-time only;
     *  Traditional (and pre-D-124 HS) never reach this branch (gated at the call site). */
    private applyOpForSkill(fu: CBTForceUnit): void {
        const crew = fu.getCrewMember(0);
        if (!crew) return;
        const d = this.state.gmDifficulty() ?? 1;
        const [gunnery, piloting] = d > 1.3 ? [2, 3] : d >= 1.1 ? [3, 4] : [4, 5]; // Elite / Veteran / Regular
        crew.setSkill('gunnery', gunnery);
        crew.setSkill('piloting', piloting);
    }

    private resolveUnit(inst: ProtoInstance): Unit | undefined {
        const byName = this.dataService.getUnitByName(inst.unitRef);
        if (byName) return byName;
        const units = this.dataService.getUnits();
        if (!units?.length) return undefined;
        return units.find((u) => u.chassis === inst.chassis && u.model === inst.model) ?? units.find((u) => u.chassis === inst.chassis);
    }

    /** DEPLOY-006: the battle/MekBay view resolves units from the per-era SLICE (the same one the wizard +
     *  roster use) — never the 24MB full catalog. Index → campaign era → era slice; fall back to the full
     *  catalog ONLY on a genuine slice failure. The market GM-override still lazy-loads the full catalog. */
    private async ensureData(): Promise<void> {
        if (this.dataService.isDataReady()) return;
        try {
            if (await this.dataService.ensureSliceIndex()) {
                const eraId = resolveMekbayEraId(this.state.era(), this.dataService.getEras());
                if (eraId != null && (await this.dataService.ensureSlice(eraId))) return; // slice resident → ready
            }
        } catch { /* fall through to the full catalog */ }
        if (!this.dataService.isDownloading()) this.dataService.initialize().catch(() => { /* surfaced via timeout */ });
        await this.whenDataReady();
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
