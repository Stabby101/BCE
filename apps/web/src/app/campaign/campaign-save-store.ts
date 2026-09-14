/*
 * BCE ENGINE slice 1 (DIRECTIVE-041) — the campaign store, now HOST-BACKED.
 * The source of truth relocated from per-browser IndexedDB to the apps/api host record
 * (NestJS + SQLite, REST /api/campaigns) — DATA-002 (SQLite authoritative) + ARCH-001
 * (host authoritative) + T-019 ("resume from the host record" made literally true).
 *
 * THE PAYOFF: the public interface is UNCHANGED, so the 40+ persistCurrent call sites and the
 * APP_INITIALIZER need ZERO edits — only the backend swapped (IndexedDB → HttpClient). Blob-first:
 * the CampaignSnapshot is shipped/stored as an opaque versioned JSON blob (no reshape this slice).
 *
 * persistCurrent() → DEBOUNCED PUT (switchMap cancels an in-flight write when a newer one arrives —
 * the narrator abort pattern; a damage burst collapses to one write of the latest state).
 * One-time import: on first boot with a reachable+empty host and legacy IndexedDB saves present,
 * they import to the host once (idempotent). Engine-offline (MERGE-002/T-003): host unreachable →
 * an honest `online`/`offlineReason` state the campaign surfaces read; reads safe-default, writes
 * no-op (never silent nowhere-success), a reconnect resumes. Door-3 /app stays client-side.
 */
import { contractSummaryOf } from './chaos/chaos-contract'; // GM-2 P2a — the player-safe projection of the primary
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, type Observable, Subject, TimeoutError, catchError, debounceTime, firstValueFrom, switchMap, tap, timeout } from 'rxjs';
import { NewCampaignState } from './new-campaign-state';
import type { CampaignSnapshot } from './campaign-persistence.service';
import { daysBetween, type CampaignDate } from './clock/campaign-clock';

const SCHEMA_VERSION = 1;
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api'; // localhost-first; LAN via localStorage 'bce.engine.url'
const ENGINE_URL_KEY = 'bce.engine.url';
const MIGRATED_FLAG = 'bce.migrated.host'; // one-time IndexedDB→host import marker
const HOST_TIMEOUT_MS = 6000; // a hung connection backstop (a refused localhost fails far faster)
const PERSIST_DEBOUNCE_MS = 400; // collapse a write burst; small enough to bound the loss window

// ── legacy IndexedDB (D-013) — read-only now, the one-time import source ──
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
    ephemeral?: boolean; // DIRECTIVE-069: a Quick Mission session — a real host room (lobby/join work) but never
                         // a resumable save (the host excludes it from the Load list + refuses it as "last").
    // ODM-20 — SERVER-OWNED stamps. The host has always sent these (campaigns.service rowToRecord); the client
    // contract simply never declared them. Optional + read-only in practice: the client never writes them, and
    // the server ignores them on the way back in. Additive, so every existing reader is unaffected.
    createdAt?: number;
    updatedAt?: number;
}

// ── D-053: specific save labels — "where am I" derived PURELY from existing snapshot fields ──────────
// James can't tell which datestamp autosave is his 24-day campaign. These derive the human progress
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

    // engine-offline state (MERGE-002 / T-003) — the campaign surfaces read these.
    private readonly onlineSig = signal(true);
    private readonly reasonSig = signal<string | null>(null);
    readonly online = this.onlineSig.asReadonly();
    readonly offlineReason = this.reasonSig.asReadonly();

    // the loaded campaign's id, exposed for the D-042 realtime room (campaignId = the WebSocket room).
    private readonly idSig = signal<string | null>(null);
    readonly campaignId = this.idSig.asReadonly();

    // the currently-loaded record, tracked in-memory so persistCurrent needs no host round-trip.
    private loadedId: string | null = null;
    private loadedName: string | null = null;
    private loadedEphemeral = false; // D-069: keep a Quick Mission session ephemeral across every persistCurrent PUT

    // the debounced persist pipe (switchMap = abort the in-flight PUT when a newer one queues).
    private readonly persist$ = new Subject<void>();

    constructor() {
        this.persist$
            .pipe(
                debounceTime(PERSIST_DEBOUNCE_MS),
                switchMap(() => {
                    const id = this.loadedId;
                    if (!id) return EMPTY;
                    const snap = this.snapshot();
                    // D-069: carry the ephemeral flag on every autosave PUT so a Quick Mission row never reverts
                    // to a listed/resumable save (the upsert would otherwise overwrite ephemeral back to 0).
                    const rec: SaveRecord = { id, name: this.loadedName ?? id, savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap, ephemeral: this.loadedEphemeral };
                    return this.http.put(`${this.base()}/campaigns/${encodeURIComponent(id)}`, rec).pipe(
                        timeout(HOST_TIMEOUT_MS),
                        tap(() => this.markReachable()),
                        catchError((e) => {
                            if (this.isUnreachable(e)) this.markOffline();
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
    /** ODM-21 — arm the singleton override for exactly ONE write (the confirm-gated "start a second"
     *  control). One-shot by construction: consumed by the next put, so it can never leak into a later
     *  save. It rides the request BODY and is never stored in the snapshot. */
    private forceNewOnce = false;
    armForceNew(): void { this.forceNewOnce = true; }
    async put(rec: SaveRecord): Promise<void> {
        const body = this.forceNewOnce ? { ...rec, forceNew: true } : rec;
        this.forceNewOnce = false;
        await this.call(this.http.put(`${this.base()}/campaigns/${encodeURIComponent(rec.id)}`, body));
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
            rating: s.rating(),
            logisticsProfile: s.logisticsProfile(),
            contractMarket: s.contractMarket(),
            ...(s.gmSession() ? {} : { acceptedContract: s.acceptedContract() }), // GM-2 P2a — GM session: the synthetic offer rides under gmOnly (H14); plain campaigns byte-identical
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
            outcomeLedger: s.outcomeLedger(),             // D-077
            escalationByThread: s.escalationByThread(),   // D-077
            escalationCampaign: s.escalationCampaign(),    // D-077
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
            currentLocation: s.currentLocation(), // D-079
            gameSystem: s.gameSystem(), // D-083
            campaignSystem: s.campaignSystem(), // D-108
            packId: s.packId(), // ODM-1
            odmOutcomes: s.odmOutcomes(), odmActiveNodeId: s.odmActiveNodeId(), // ODM-3 — additive
            odmSeeds: s.odmSeeds(), // ODM-7 — the seed is the only OpFor artifact in the fanned snapshot
            odmStocks: s.odmStocks(), // ODM-11 — the survival-economy stocks (GM-adjusted; display-only v1)
            odmFleetStatus: s.odmFleetStatus(), // ODM-17 P2 — the live vessel-status overlay
            odmBench: s.odmBench(), // ODM-17 P3 — the MAC-7 bench queue
            odmMaintenance: s.odmMaintenance(), // ODM-17 P4
            odmSupport: s.odmSupport(), // ODM-17 P4 (empty = pack truth)
            hotSpotCampaign: s.hotSpotCampaign(),
            warchestSP: s.warchestSP(), // D-109 — the Warchest SP economy (Hot Spots): balance/rep/scale/ledger
            reputation: s.reputation(),
            contractScale: s.contractScale(),
            warchestLedger: s.warchestLedger(),
            ...(s.gmSession() ? { contractSummary: contractSummaryOf(s.activeChaosContract()) } : { activeChaosContract: s.activeChaosContract() }), // D-110 · GM-2 P2a — GM session: the terms move under gmOnly (H14), the player-safe summary rides here
            gmDifficulty: s.gmDifficulty(), // D-124
            chaosTrackPresets: s.chaosTrackPresets(), // D-116
            // GM-1 P2 — in a GM SESSION the offer/chamber state rides under the ONE well-known gmOnly key
            // (the server fan strips it for non-GM recipients; hydrate accepts both layouts). Plain HS keeps
            // today's top-level layout, keys in the same positions — byte-identical for every non-GM campaign.
            ...(s.gmSession() ? {} : { customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion() }), // D-124 · HSFORGE-1 · P2
            hiredMercs: s.hiredMercs(), contractHiredKeys: s.contractHiredKeys(), // IMPORT-3 P2
            ...(s.gmSession()
                ? { gmOnly: { activeChaosContract: s.activeChaosContract(), acceptedContract: s.acceptedContract(), participantContracts: s.participantContracts(), voidedContracts: s.voidedContracts(), customHotSpots: s.customHotSpots(), forgedHotSpots: s.forgedHotSpots(), hsRegion: s.hsRegion(), hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}) } }
                : { hotSpotOffer: s.hotSpotOffer(), hotSpotShowAll: s.hotSpotShowAll(), reckoningBegun: s.reckoningBegun(), ...((Object.keys(s.gmPilotNotes()).length || s.gmMissionDrafts().length) ? { gmOnly: { ...(Object.keys(s.gmPilotNotes()).length ? { pilotNotes: s.gmPilotNotes() } : {}), ...(s.gmMissionDrafts().length ? { gmMissionDrafts: s.gmMissionDrafts() } : {}) } } : {}) }), // D-124b · D-129 · D-135 · ODM-18 P1 (pilotNotes ride gmOnly — stripped for players)
            gmSession: s.gmSession(), // GM-1 P1
            presentedHotspot: s.presentedHotspot(), // GM-1 P2 — top-level: the published brief must REACH players
            completedChaosContract: s.completedChaosContract(), // PD3 P2 — top-level: the TERMINAL contract record must REACH players (the phase gate)
            playerUnitCap: s.playerUnitCap(), // GM-1 P3 — top-level: players must SEE the cap
            resultsSlip: s.resultsSlip(), // GM-1 P3 — top-level: the take-home record must reach players
            appliedSlips: s.appliedSlips(), // GM-2 P1 — top-level: the home campaign's idempotency ledger (a re-save must not drop it)
            odmProjection: s.odmProjection(), // ODM-18 P1 — top-level: the pack-walled cards' data must reach players
            odmGmMissions: s.odmGmMissions(), // ODM-18 P3 — top-level: PUBLISHED composed missions must reach players
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
        await this.put(rec);
        await this.setLast(rec.id);
        this.trackLoaded(rec);
        return rec;
    }
    /** Quick Save — a fresh autosave-<datestamp> record. Sets "last". */
    async quickSave(): Promise<SaveRecord> {
        const snap = this.snapshot();
        const st = this.stamp();
        const rec: SaveRecord = { id: `autosave-${st}`, name: `autosave-${st}`, savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap };
        await this.put(rec);
        await this.setLast(rec.id);
        this.trackLoaded(rec);
        return rec;
    }
    /** Begin writes an initial autosave + sets "last" so Resume / refresh-restore work. */
    async beginSave(): Promise<SaveRecord> {
        return this.quickSave();
    }
    /** DIRECTIVE-069 — a Quick Mission's EPHEMERAL server session. Upserts a real campaign row (so
     *  campaigns.exists() is true → the D-048 lobby / claims / join-QR bind to this campaignId) and sets
     *  campaignId() for the Lobby — but NEVER sets "last" and flags the row ephemeral, so it stays OUT of
     *  Resume and the Load browser. "Ephemeral" = not a resumable save, NOT "no server room" (the D-067
     *  reconciliation). persistCurrent keeps the row fresh (ephemeral preserved) for the joined player's sync. */
    async beginEphemeralSession(): Promise<SaveRecord> {
        const snap = this.snapshot();
        const st = this.stamp();
        const rec: SaveRecord = { id: `quickmission-${st}`, name: 'Quick Mission', savedAt: snap.savedAt, version: snap.version, summary: this.summaryFrom(snap), snapshot: snap, ephemeral: true };
        await this.put(rec);   // upsert → the room exists (the player can bind + join)
        this.trackLoaded(rec); // sets campaignId() for the Lobby/Claims; marks loadedEphemeral; NO setLast
        return rec;
    }
    /** In-place mutation persist (D-019, host-backed D-041): overwrite the CURRENTLY-LOADED record
     *  with current state via a DEBOUNCED PUT (same id + name, fresh snapshot). Spawns no new record;
     *  "last" unchanged. No-op when nothing is loaded. The 40+ call sites are unchanged. */
    async persistCurrent(): Promise<void> {
        if (!this.loadedId) return;
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
    /** Adopt a campaignId from the hosted join URL WITHOUT marking a loaded record: the account-less player
     *  joins the right room (campaignId() drives the socket) but never writes back — persistCurrent stays a
     *  no-op (loadedId untouched), keeping the player non-authoritative (D-048). */
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
        this.loadedEphemeral = rec.ephemeral ?? false; // D-069: normal loads → false; a QM session → true
        this.idSig.set(rec.id);
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
