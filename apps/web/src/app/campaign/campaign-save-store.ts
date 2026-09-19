import { contractSummaryOf } from './chaos/chaos-contract';
import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, type Observable, Subject, TimeoutError, catchError, debounceTime, firstValueFrom, switchMap, tap, timeout } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ClaimRealtimeService } from './claims/claim-realtime.service';
import { NewCampaignState } from './new-campaign-state';
import type { CampaignSnapshot } from './campaign-persistence.service';
import { daysBetween, type CampaignDate } from './clock/campaign-clock';

const SCHEMA_VERSION = 1;
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api'; // localhost-first; LAN via localStorage 'bce.engine.url'
const ENGINE_URL_KEY = 'bce.engine.url';
const MIGRATED_FLAG = 'bce.migrated.host'; // one-time IndexedDB→host import marker
const HOST_TIMEOUT_MS = 6000; // a hung connection backstop (a refused localhost fails far faster)
const PERSIST_DEBOUNCE_MS = 400; // collapse a write burst; small enough to bound the loss window

const DB_NAME = 'bce-campaigns';
const DB_VERSION = 1;
const SAVES = 'saves';
const META = 'meta';
const LAST_KEY = 'last';

export interface SaveRecord {
    id: string;
    name: string;
    savedAt: number;
    version: number;
    summary: string;
    snapshot: CampaignSnapshot;
    ephemeral?: boolean;
                         // a resumable save (the host excludes it from the Load list + refuses it as "last").
    // contract simply never declared them. Optional + read-only in practice: the client never writes them, and
    // the server ignores them on the way back in. Additive, so every existing reader is unaffected.
    createdAt?: number;
    updatedAt?: number;
    // rowToRecord for every record, the same as the stamps above; declared now so the co-GM read view can ask
    // "is this record mine?" NEVER written from the client (the server ignores it inbound and stamps its own).
    ownerId?: string | null;
    // keys on it (cover/odm-door.ts). Absent on every other row and on an un-pinned host; ignored on the way back in.
    odmRecord?: boolean;
}

// (campaign DAY + count of RESOLVED operations) from a snapshot, so it works for any stored SaveRecord
// (rec.snapshot) AND live state. NO new snapshot field, NO version bump (the directive's "derive from
// existing fields"). The cover Load browser + the dashboard note share this — never a bare datestamp.
/** Campaign day, the campaign opening on Day 1 (start === current → Day 1). 1 when dates are absent. */
export function campaignDay(start?: CampaignDate | null, current?: CampaignDate | null): number {
    return start && current ? daysBetween(start, current) + 1 : 1;
}
/** Count of RESOLVED operations across the live tree + the archive (mirrors mission-package's enumerate;
 *  RETIRED = unplayed, excluded). */
export function resolvedMissions(snap: Pick<CampaignSnapshot, 'missionTree' | 'treeArchive'>): number {
    const all = [...(snap.missionTree ?? []), ...(snap.treeArchive ?? []).flatMap((e) => e.tree)];
    return all.filter((b) => b.state === 'RESOLVED').length;
}
/** "Day 24 · 3 missions" — the specific, datestamp-free progress label. */
export function campaignProgress(snap: Pick<CampaignSnapshot, 'startDate' | 'currentDate' | 'missionTree' | 'treeArchive'>): string {
    const m = resolvedMissions(snap);
    return `Day ${campaignDay(snap.startDate, snap.currentDate)} · ${m} mission${m === 1 ? '' : 's'}`;
}

@Injectable({ providedIn: 'root' })
export class CampaignSaveStore {
    private readonly state = inject(NewCampaignState);
    private readonly http = inject(HttpClient);
    private readonly auth = inject(AuthService);
    private readonly rt = inject(ClaimRealtimeService);

    // engine-offline state (MERGE-002 / T-003) — the campaign surfaces read these.
    private readonly onlineSig = signal(true);
    private readonly reasonSig = signal<string | null>(null);
    readonly online = this.onlineSig.asReadonly();
    readonly offlineReason = this.reasonSig.asReadonly();

    private readonly idSig = signal<string | null>(null);
    readonly campaignId = this.idSig.asReadonly();

    // ask "am I the holder of this record, or a co-GM reading it?" Set in trackLoaded; null when nothing loaded.
    private readonly ownerIdSig = signal<string | null>(null);
    private readonly packIdSig = signal<string | null>(null);
    readonly readOnly = computed<boolean>(() => {
        if (!this.auth.authRequired()) return false;   // dev/LAN/single-tenant — one operator, never read-only
        if (this.packIdSig() !== 'odm') return false;  // scoped to THE ODM record (P0); every plain campaign writes
        const u = this.auth.user();
        if (u?.role === 'admin') return false;          // admin WRITEs (odmRecordAccess parity)
        const me = u?.id ?? null;
        // (the owner who handed away included) reads. (ownerIdSig is truthful on every path now — the create
        // paths track the SERVER's record — so this ordering is the rule itself, not a workaround.)
        // another device reads ("your other device holds the table"). A legacy account-level holder (device null) = any device.
        if (this.writeRefused()) return true;            // the host refused this device's write — reading until the next `writer` fan
        const holder = this.rt.writerHolder();
        if (holder != null) {
            if (holder !== me) return true;
            const dev = this.rt.writerHolderDevice();
            return dev != null && dev !== this.rt.myDeviceId;
        }
        // nobody holds it (or the server has not said yet) → the OWNER is optimistic: its first write / join TAKES the table
        // (ruling 1); the host's belt refuses a second device, and the `writer` fan turns that device to reading within a tick.
        const owner = this.ownerIdSig();
        if (!owner) return false;                       // legacy-unowned row — not a co-GM read
        return owner !== me;                            // a co-GM (not the owner) reads
    });
    private readonly writeRefused = signal(false);

    readonly isRecordOwner = computed<boolean>(() => {
        if (!this.auth.authRequired() || this.packIdSig() !== 'odm') return false;
        const owner = this.ownerIdSig();
        return !!owner && owner === (this.auth.user()?.id ?? null);
    });

    // the currently-loaded record, tracked in-memory so persistCurrent needs no host round-trip.
    private loadedId: string | null = null;
    private loadedName: string | null = null;
    private loadedEphemeral = false;

    // the debounced persist pipe (switchMap = abort the in-flight PUT when a newer one queues).
    private readonly persist$ = new Subject<void>();

    constructor() {
        effect(() => { this.rt.writerHolder(); this.rt.writerHolderDevice(); this.rt.writerKnown(); this.writeRefused.set(false); });
        this.persist$
            .pipe(
                debounceTime(PERSIST_DEBOUNCE_MS),
                switchMap(() => {
                    const id = this.loadedId;
                    if (!id) return EMPTY;
                    const snap = this.snapshot();
                    // to a listed/resumable save (the upsert would otherwise overwrite ephemeral back to 0).
                    const rec: SaveRecord = { id, name: this.loadedName ?? id, savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap, ephemeral: this.loadedEphemeral };
                    return this.http.put(`${this.base()}/campaigns/${encodeURIComponent(id)}`, rec).pipe(
                        timeout(HOST_TIMEOUT_MS),
                        tap(() => this.markReachable()),
                        catchError((e) => {
                            if (this.isUnreachable(e)) this.markOffline();
                            // until the next `writer` fan says otherwise (the fan normally arrives first; this closes the race).
                            if (e instanceof HttpErrorResponse && e.status === 404 && this.packIdSig() === 'odm') this.writeRefused.set(true);
                            return EMPTY; // never kill the pipe — the next mutation retries
                        }),
                    );
                }),
            )
            .subscribe();
    }

    // ── host plumbing ──
    private base(): string {
        return localStorage.getItem(ENGINE_URL_KEY) || DEFAULT_ENGINE_URL;
    }
    private isUnreachable(e: unknown): boolean {
        // status 0 = network/CORS/refused (the host is DOWN); a TimeoutError = hung. Both = offline.
        return (e instanceof HttpErrorResponse && e.status === 0) || e instanceof TimeoutError;
    }
    private markReachable(): void {
        if (!this.onlineSig()) {
            this.onlineSig.set(true);
            this.reasonSig.set(null);
        }
    }
    private markOffline(): void {
        if (this.onlineSig()) {
            this.onlineSig.set(false);
            this.reasonSig.set(`Engine host unreachable (${this.base().replace(/\/api$/, '')}).`);
        }
    }
    /** Run a host request; mark online/offline by reachability. Throws on any error (callers default). */
    private async call<T>(obs: Observable<T>): Promise<T> {
        try {
            const r = await firstValueFrom(obs.pipe(timeout(HOST_TIMEOUT_MS)));
            this.markReachable();
            return r;
        } catch (e) {
            if (this.isUnreachable(e)) this.markOffline();
            else this.markReachable(); // a 4xx/5xx means the host RESPONDED — it's online
            throw e;
        }
    }

    // ── init + one-time IndexedDB→host import ──
    async init(): Promise<void> {
        const hostSaves = await this.list(); // marks online/offline; [] when offline
        if (!this.onlineSig()) return; // engine offline at boot → degrade, don't block /app or hang boot
        await this.maybeImportLegacy(hostSaves);
    }

    private async maybeImportLegacy(hostSaves: SaveRecord[]): Promise<void> {
        try {
            if (localStorage.getItem(MIGRATED_FLAG)) return; // already done
            if (hostSaves.length > 0) {
                localStorage.setItem(MIGRATED_FLAG, '1'); // host already populated — nothing to import
                return;
            }
            const legacy = await this.legacyReadAll();
            if (legacy.saves.length === 0) {
                localStorage.setItem(MIGRATED_FLAG, '1'); // no legacy saves — mark done so we never re-probe
                return;
            }
            for (const rec of legacy.saves) {
                try { await this.put(rec); } catch { /* per-record best-effort */ }
            }
            if (legacy.lastId) {
                try { await this.setLast(legacy.lastId); } catch { /* */ }
            }
            localStorage.setItem(MIGRATED_FLAG, '1'); // idempotent: a second boot won't re-import
        } catch {
            /* import is best-effort; a failure must not block boot */
        }
    }

    // ── CRUD (host-backed; reads safe-default on failure) ──
    async list(): Promise<SaveRecord[]> {
        try {
            const all = await this.call(this.http.get<SaveRecord[]>(`${this.base()}/campaigns`));
            return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
        } catch {
            return [];
        }
    }
    async get(id: string): Promise<SaveRecord | null> {
        try {
            return await this.call(this.http.get<SaveRecord>(`${this.base()}/campaigns/${encodeURIComponent(id)}`));
        } catch {
            return null; // 404 (not found) or offline — both null to the caller
        }
    }
    private forceNewOnce = false;
    armForceNew(): void { this.forceNewOnce = true; }
    async put(rec: SaveRecord): Promise<SaveRecord | null> {
        const body = this.forceNewOnce ? { ...rec, forceNew: true } : rec;
        this.forceNewOnce = false;
        const saved = await this.call(this.http.put<SaveRecord | null>(`${this.base()}/campaigns/${encodeURIComponent(rec.id)}`, body));
        return saved && typeof saved === 'object' && saved.id === rec.id ? saved : null;
    }
    async remove(id: string): Promise<void> {
        await this.call(this.http.delete(`${this.base()}/campaigns/${encodeURIComponent(id)}`));
        // the host clears/repoints "last" itself on delete; mirror the loaded-id bookkeeping.
        if (this.loadedId === id) {
            this.loadedId = null;
            this.loadedName = null;
            this.idSig.set(null);
        }
    }
    async count(): Promise<number> {
        return (await this.list()).length;
    }

    // ── "last" pointer ──
    async getLastId(): Promise<string | null> {
        try {
            const r = await this.call(this.http.get<{ id: string | null }>(`${this.base()}/campaigns/last`));
            return r?.id ?? null;
        } catch {
            return null;
        }
    }
    async setLast(id: string | null): Promise<void> {
        await this.call(this.http.put(`${this.base()}/campaigns/last`, { id }));
    }
    async getLast(): Promise<SaveRecord | null> {
        const id = await this.getLastId();
        return id ? this.get(id) : null;
    }

    // ── snapshot + naming (PURE, host-agnostic — unchanged from the IndexedDB store) ──
    private snapshot(): CampaignSnapshot {
        const s = this.state;
        return {
            version: SCHEMA_VERSION,
            savedAt: Date.now(),
            era: s.era(),
            startDate: s.startDate(),
            force: s.force(),
            faction: s.faction(),
            unit: s.unit(),
            unitSize: s.unitSize(),
            capital: s.capital(),
            resources: s.resources(),
            commandName: s.commandName(),
            commandFaction: s.commandFaction(), // ORDER-15 (a)
            rating: s.rating(),
            logisticsProfile: s.logisticsProfile(),
            contractMarket: s.contractMarket(),
            ...(s.gmSession() ? {} : { acceptedContract: s.acceptedContract() }),
            houseOrder: s.houseOrder(),
            startingForce: s.startingForce(),
            forceStructure: s.forceStructure(),
            pilots: s.pilots(),
            formation: s.formation(),
            currentDate: s.currentDate(),
            treasury: s.treasury(),
            completedContracts: s.completedContracts(),
            missionSpec: s.missionSpec(),
            npcAssignments: s.npcAssignments(),
            staffVoices: s.staffVoices(),
            outcomeLedger: s.outcomeLedger(),
            escalationByThread: s.escalationByThread(),
            escalationCampaign: s.escalationCampaign(),
            missionTree: s.missionTree(),
            treeArchive: s.treeArchive(),
            campaignLog: s.campaignLog(),
            bays: s.bays(),
            bayHistory: s.bayHistory(),
            intel: s.intel(),
            techPool: s.techPool(),
            inventory: s.inventory(),
            shopOrders: s.shopOrders(),
            personnel: s.personnel(),
            payrollShortfalls: s.payrollShortfalls(),
            hiringMarket: s.hiringMarket(),
            currentLocation: s.currentLocation(),
            gameSystem: s.gameSystem(),
            campaignSystem: s.campaignSystem(),
            packId: s.packId(),
            odmOutcomes: s.odmOutcomes(), odmActiveNodeId: s.odmActiveNodeId(),
            odmSeeds: s.odmSeeds(),
            odmStocks: s.odmStocks(),
            odmFleetStatus: s.odmFleetStatus(),
            odmBench: s.odmBench(),
            odmMaintenance: s.odmMaintenance(),
            odmSupport: s.odmSupport(),
            hotSpotCampaign: s.hotSpotCampaign(),
            warchestSP: s.warchestSP(),
            reputation: s.reputation(),
            contractScale: s.contractScale(),
            warchestLedger: s.warchestLedger(),
            ...(s.gmSession() ? { contractSummary: contractSummaryOf(s.activeChaosContract()) } : { activeChaosContract: s.activeChaosContract() }),
            gmDifficulty: s.gmDifficulty(),
            chaosTrackPresets: s.chaosTrackPresets(),
            // (the server fan strips it for non-GM recipients; hydrate accepts both layouts). Plain HS keeps
            // today's top-level layout, keys in the same positions — byte-identical for every non-GM campaign.
            ...(s.gmSession() ? {} : { customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion() }),
            hiredMercs: s.hiredMercs(), contractHiredKeys: s.contractHiredKeys(),
            ...(s.gmSession()
                ? { gmOnly: { activeChaosContract: s.activeChaosContract(), acceptedContract: s.acceptedContract(), participantContracts: s.participantContracts(), voidedContracts: s.voidedContracts(), customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion(), hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}), ...(s.odmLedger().length ? { odmLedger: s.odmLedger() } : {}) } }
                : { hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...((Object.keys(s.gmPilotNotes()).length || s.gmMissionDrafts().length || s.odmLedger().length) ? { gmOnly: { ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}), ...(s.odmLedger().length ? { odmLedger: s.odmLedger() } : {}) } } : {}) }),
            gmSession: s.gmSession(),
            presentedHotspot: s.presentedHotspot(),
            completedChaosContract: s.completedChaosContract(), // PD3 P2 — top-level: the TERMINAL contract record must REACH players (the phase gate)
            playerUnitCap: s.playerUnitCap(),
            resultsSlip: s.resultsSlip(),
            appliedSlips: s.appliedSlips(),
            odmProjection: s.odmProjection(),
            ...(Object.keys(s.odmSeatNotes()).length ? { odmSeatNotes: s.odmSeatNotes() } : {}), ...(s.odmSeatRequests().length ? { odmSeatRequests: s.odmSeatRequests() } : {}),
            odmGmMissions: s.odmGmMissions(),
        };
    }
    private slug(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'save';
    }
    private stamp(): string {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
    /** Smart default name from the current campaign, e.g. "4th Wolf Guards · Clan Invasion · 3050". */
    defaultName(): string {
        return this.defaultNameFrom(this.snapshot());
    }
    private defaultNameFrom(snap: CampaignSnapshot): string {
        const unit = snap.unit && snap.unit !== '__custom__' ? snap.unit : 'Custom command';
        const era = snap.era?.name ?? 'Unknown era';
        const yr = snap.startDate?.y ?? '';
        return `${unit} · ${era}${yr ? ' · ' + yr : ''}`;
    }
    private summaryFrom(snap: CampaignSnapshot): string {
        const fac = snap.faction ?? '—';
        const era = snap.era?.name ?? '—';
        const yr = snap.startDate?.y ?? '';
        const size = snap.unitSize?.name ?? '';
        return [fac, `${era}${yr ? ' ' + yr : ''}`, size].filter(Boolean).join(' · ');
    }
    private namedRecord(snap: CampaignSnapshot, name: string): SaveRecord {
        return { id: `named-${this.slug(name)}`, name, savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap };
    }

    // ── public save ops (interface-identical; the loaded-id bookkeeping feeds persistCurrent) ──
    /** Existing named save with this name (for confirm-on-overwrite). */
    async findByName(name: string): Promise<SaveRecord | null> {
        return this.get(`named-${this.slug(name)}`);
    }
    /** Save As — named record (overwrites a same-name save). Sets "last". */
    async saveAs(name: string): Promise<SaveRecord> {
        const rec = this.namedRecord(this.snapshot(), name.trim() || this.defaultName());
        const saved = await this.put(rec);
        await this.setLast(rec.id);
        this.trackLoaded(saved ?? rec);
        return rec;
    }
    /** Quick Save — a fresh autosave-<datestamp> record. Sets "last". */
    async quickSave(): Promise<SaveRecord> {
        const snap = this.snapshot();
        const st = this.stamp();
        const rec: SaveRecord = { id: `autosave-${st}`, name: `autosave-${st}`, savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap };
        const saved = await this.put(rec);
        await this.setLast(rec.id);
        this.trackLoaded(saved ?? rec);
        return rec;
    }
    /** Begin writes an initial autosave + sets "last" so Resume / refresh-restore work. */
    async beginSave(): Promise<SaveRecord> {
        return this.quickSave();
    }
    async beginEphemeralSession(): Promise<SaveRecord> {
        const snap = this.snapshot();
        const st = this.stamp();
        const rec: SaveRecord = { id: `quickmission-${st}`, name: 'Quick Mission', savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap, ephemeral: true };
        const saved = await this.put(rec); // upsert → the room exists (the player can bind + join)
        this.trackLoaded(saved ?? rec);    // sets campaignId() for the Lobby/Claims; marks loadedEphemeral; NO setLast (P3b: the server's record)
        return rec;
    }
    async persistCurrent(): Promise<void> {
        if (!this.loadedId) return;
        if (this.readOnly()) return;
                                     // (the host refuses the PUT anyway, A2 — this keeps the reader's view churn-free)
        this.persist$.next(); // debounced; the latest snapshot wins, an in-flight write is superseded
    }

    // ── load / rehydrate ──
    loadInto(rec: SaveRecord): void {
        this.state.hydrate(rec.snapshot);
        this.trackLoaded(rec);
    }
    async loadAndSetLast(rec: SaveRecord): Promise<void> {
        this.loadInto(rec);
        await this.setLast(rec.id);
    }
    /** Restore the "last" save into NewCampaignState (refresh-restore) — now HOST-fed. */
    async rehydrateLast(): Promise<boolean> {
        const rec = await this.getLast();
        if (!rec) return false;
        this.loadInto(rec);
        return true;
    }

    // ── DEPLOY-002 P4 — the hosted player join (account-less, cloud) ──────────────────────────────────
    setCampaignId(id: string): void {
        this.idSig.set(id);
    }
    /** Hydrate the roster/OpFor from the host snapshot delivered over the P3-confined socket (the cloud
     *  player's REST is gated — no GM account). Read-only: does NOT track a loaded record (no write-back). */
    hydrateFromSocket(snap: CampaignSnapshot): void {
        this.state.hydrate(snap);
    }

    private trackLoaded(rec: SaveRecord): void {
        this.loadedId = rec.id;
        this.loadedName = rec.name;
        this.loadedEphemeral = rec.ephemeral ?? false;
        this.idSig.set(rec.id);
        this.ownerIdSig.set(rec.ownerId ?? null);
        this.packIdSig.set((rec.snapshot as { packId?: unknown } | null | undefined)?.packId as string | null ?? null);
    }

    // ── legacy IndexedDB reader (the one-time import source; never written to anymore) ──
    private legacyReadAll(): Promise<{ saves: SaveRecord[]; lastId: string | null }> {
        return new Promise((resolve) => {
            let settled = false;
            const done = (saves: SaveRecord[], lastId: string | null) => {
                if (!settled) { settled = true; resolve({ saves, lastId }); }
            };
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    // a brand-new DB (no prior saves) — create the stores so .open succeeds, then it's empty.
                    const db = req.result;
                    if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'id' });
                    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
                };
                req.onerror = () => done([], null);
                req.onsuccess = () => {
                    const db = req.result;
                    try {
                        const tx = db.transaction([SAVES, META], 'readonly');
                        const savesReq = tx.objectStore(SAVES).getAll();
                        const lastReq = tx.objectStore(META).get(LAST_KEY);
                        tx.oncomplete = () => done((savesReq.result as SaveRecord[]) ?? [], (lastReq.result as string | undefined) ?? null);
                        tx.onerror = () => done([], null);
                    } catch {
                        done([], null);
                    }
                };
            } catch {
                done([], null);
            }
        });
    }
}
