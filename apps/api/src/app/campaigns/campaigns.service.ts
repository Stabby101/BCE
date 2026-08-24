/*
 * BCE ENGINE slice 1 (DIRECTIVE-041) — the HOST RECORD. The campaign source of truth
 * relocates here from per-browser IndexedDB. SQLite via node:sqlite (Node 24 built-in,
 * zero native-dep risk; flag-free on 24.14, only a stderr ExperimentalWarning). BLOB-FIRST:
 * the client's CampaignSnapshot is stored as an opaque versioned JSON blob — NO normalization,
 * NO schema reshape this slice (DATA-002: SQLite authoritative; IndexedDB demoted to cache).
 * Table mirrors the client SaveRecord {id,name,savedAt,version,summary,snapshot}; the row adds
 * host-owned createdAt/updatedAt (updatedAt bumps on every PUT — the mutation proof).
 */
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { dbPath } from '../db-path';

/** The record shape the client CampaignSaveStore exchanges (snapshot kept opaque here). */
export interface SaveRecord {
    id: string;
    name: string;
    savedAt: number;
    version: number;
    summary: string;
    snapshot: unknown; // the CampaignSnapshot blob — opaque to the host (blob-first)
    createdAt?: number;
    updatedAt?: number;
    ownerId?: string | null; // DEPLOY-002 P2: server-owned (the GM user id); NEVER trusted from the client
    ephemeral?: boolean; // DIRECTIVE-069: a Quick Mission session — a REAL room (exists()→lobby/join work) but
                         // NOT a resumable save: excluded from list() (the Load browser) + never set "last" (Resume).
}

/**
 * DEPLOY-002 P2 — the request's tenant view, DERIVED SERVER-SIDE from the session (never client-supplied).
 *   admin=true  → sees/writes ALL (admin support, and single-tenant/dev where auth is off).
 *   admin=false → scoped to ownerId (a GM sees/writes ONLY its own campaigns).
 * ownerId is the id stamped on the GM's NEW records (null in dev → legacy/unowned rows).
 */
export interface Viewer {
    ownerId: string | null;
    admin: boolean;
}

const LAST_KEY = 'last';
const lastKey = (v: Viewer): string => (v.ownerId ? `last:${v.ownerId}` : LAST_KEY);

@Injectable()
export class CampaignsService implements OnModuleInit {
    private readonly log = new Logger('CampaignsService');
    private db!: DatabaseSync;

    /** DEPLOY-002 P4 (player live-sync) — emits a campaign id after every authoritative WRITE (upsert).
     *  The ClaimsGateway subscribes and fans the fresh snapshot to that campaign's room, so a joined
     *  player's roster/OpFor/mission-tree tracks the GM LIVE (the GM generates a track / deploys a 'Mech →
     *  the player's engagement unfreezes) instead of only at the one-shot connect pull. No REST coupling. */
    readonly changes$ = new Subject<string>();

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                summary TEXT,
                version INTEGER,
                createdAt INTEGER,
                updatedAt INTEGER,
                snapshot TEXT NOT NULL,
                ownerId TEXT,
                ephemeral INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`,
        );
        // P2 migration: pre-DEPLOY-002 DBs lack ownerId — add it (NULL = legacy/unowned → admin-only when gated).
        const cols = (this.db.prepare('PRAGMA table_info(campaigns)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('ownerId')) this.db.exec('ALTER TABLE campaigns ADD COLUMN ownerId TEXT');
        // D-069 migration: pre-D-069 DBs lack ephemeral — add it (0 = a normal, resumable, listed save).
        if (!cols.includes('ephemeral')) this.db.exec('ALTER TABLE campaigns ADD COLUMN ephemeral INTEGER DEFAULT 0');
        this.log.log(`host record ready at ${dbPath()}`);
    }

    /** A viewer may touch a row iff admin, OR it is the row's owner, OR (legacy) the row is unowned-and-admin.
     *  A GM may NEVER reach a legacy/unowned row (null owner) — only admin can (the migration path). */
    private canAccess(ownerId: string | null, v: Viewer): boolean {
        if (v.admin) return true;
        if (ownerId == null) return false;
        return ownerId === v.ownerId;
    }

    // ── reads (P2: owner-scoped; admin/dev see all) ──
    list(v: Viewer): SaveRecord[] {
        // D-069: EPHEMERAL (Quick Mission) sessions are real rows but NOT saves — never listed in the Load browser.
        const rows = (v.admin
            ? this.db.prepare('SELECT * FROM campaigns WHERE COALESCE(ephemeral, 0) = 0 ORDER BY updatedAt DESC').all()
            : this.db.prepare('SELECT * FROM campaigns WHERE ownerId = ? AND COALESCE(ephemeral, 0) = 0 ORDER BY updatedAt DESC').all(v.ownerId)) as Record<string, unknown>[];
        return rows.map((r) => this.rowToRecord(r)).sort((a, b) => b.savedAt - a.savedAt);
    }
    get(id: string, v: Viewer): SaveRecord | null {
        const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row || !this.canAccess((row['ownerId'] as string | null) ?? null, v)) return null; // cross-tenant → as if absent
        return this.rowToRecord(row);
    }
    /** Whether a campaign row exists (P3: a player socket can't BIND to a phantom campaign id). */
    exists(id: string): boolean {
        return !!this.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(id);
    }
    /** The raw owner of a record (for the socket gateway's ownership gate) — null if unowned/missing. */
    getOwnerId(id: string): string | null {
        const row = this.db.prepare('SELECT ownerId FROM campaigns WHERE id = ?').get(id) as { ownerId: string | null } | undefined;
        return row ? (row.ownerId ?? null) : null;
    }
    /** DEPLOY-002 P4 — the raw parsed snapshot for a campaign id, UNSCOPED (no Viewer). For the socket
     *  gateway's player session-sync ONLY: the account-less player's REST is gated in cloud mode, but the
     *  socket is P3-confined to the campaign it bound to, so the gateway has already authorized this read.
     *  NEVER call from a REST path — REST stays owner-scoped (P2). Null when absent/unparseable. */
    rawSnapshot(id: string): unknown | null {
        const row = this.db.prepare('SELECT snapshot FROM campaigns WHERE id = ?').get(id) as { snapshot: string } | undefined;
        if (!row) return null;
        try { return JSON.parse(row.snapshot); } catch { return null; }
    }
    count(v: Viewer): number {
        // D-069: matches list() — ephemeral Quick Mission sessions don't count toward a GM's saved campaigns.
        const r = (v.admin
            ? this.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE COALESCE(ephemeral, 0) = 0').get()
            : this.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE ownerId = ? AND COALESCE(ephemeral, 0) = 0').get(v.ownerId)) as { n: number };
        return r.n;
    }
    /** DEPLOY-010 — the UNSCOPED total (the admin dashboard's "Campaigns" metric). */
    totalCount(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM campaigns').get() as { n: number }).n; }

    // ── write (upsert — create OR persist; owner stamped/checked server-side, NEVER from the client) ──
    upsert(rec: SaveRecord, v: Viewer): SaveRecord {
        const now = Date.now();
        const snapshot = JSON.stringify(rec.snapshot ?? null);
        const existing = this.db.prepare('SELECT createdAt, ownerId FROM campaigns WHERE id = ?').get(rec.id) as { createdAt: number; ownerId: string | null } | undefined;
        if (existing && !this.canAccess(existing.ownerId, v)) {
            throw new NotFoundException(`campaign ${rec.id} not found`); // cross-tenant write → no existence leak
        }
        const createdAt = existing?.createdAt ?? now;
        const ownerId = existing ? existing.ownerId : v.ownerId; // keep owner on update; stamp the viewer on create
        const ephemeral = rec.ephemeral ? 1 : 0; // D-069: a Quick Mission session row (excluded from list/Resume)
        this.db
            .prepare(
                `INSERT INTO campaigns (id, name, summary, version, createdAt, updatedAt, snapshot, ownerId, ephemeral)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name, summary = excluded.summary, version = excluded.version,
                   updatedAt = excluded.updatedAt, snapshot = excluded.snapshot, ephemeral = excluded.ephemeral`,
            )
            .run(rec.id, rec.name, rec.summary ?? '', rec.version ?? 1, createdAt, now, snapshot, ownerId, ephemeral);
        this.changes$.next(rec.id); // fan the fresh snapshot to the campaign room (player live-sync)
        return this.rowToRecord(this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(rec.id) as Record<string, unknown>);
    }

    /** LINK-1 — additive RE-OWN: transfer every campaign owned by `fromOwnerId` to `toOwnerId`, and move the
     *  per-owner "last" pointer (only if the target has none — a returning OAuth user keeps their own "last").
     *  A MERGE, not a replace: campaign ids are globally unique, so the target keeps its existing campaigns and
     *  gains the guest's. The campaigns UPDATE is a single atomic statement — it either re-owns all or none, so
     *  a failure can never half-migrate (the guest keeps its data). UNSCOPED: only the server-side upgrade path
     *  (a guest completing OAuth) calls this. Idempotent + a no-op on a missing/equal owner. Returns the count moved. */
    reassignOwner(fromOwnerId: string, toOwnerId: string): number {
        if (!fromOwnerId || !toOwnerId || fromOwnerId === toOwnerId) return 0;
        const moved = this.db.prepare('UPDATE campaigns SET ownerId = ?, updatedAt = ? WHERE ownerId = ?').run(toOwnerId, Date.now(), fromOwnerId).changes ?? 0;
        // transfer the "last" pointer — keep the target's own if it already has one (merge semantics).
        const fromLast = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`last:${fromOwnerId}`) as { value: string } | undefined;
        if (fromLast) {
            const toKey = `last:${toOwnerId}`;
            if (!this.db.prepare('SELECT 1 FROM meta WHERE key = ?').get(toKey)) {
                this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(toKey, fromLast.value);
            }
            this.db.prepare('DELETE FROM meta WHERE key = ?').run(`last:${fromOwnerId}`);
        }
        return Number(moved);
    }

    /** IMPORT-1 Part C — ADMIN takedown of a single custom hotspot (DMCA-style response lever). Parses the
     *  campaign's opaque snapshot, drops the `custom` hotspot whose id matches from snapshot.customHotSpots[],
     *  re-serializes + bumps updatedAt, and fans the change (the joined players' live-sync drops it too).
     *  UNSCOPED (the caller is the admin-guarded AdminController). Returns true iff a hotspot was removed. */
    removeCustomHotspot(campaignId: string, hotspotId: string): boolean {
        const row = this.db.prepare('SELECT snapshot FROM campaigns WHERE id = ?').get(campaignId) as { snapshot: string } | undefined;
        if (!row) return false;
        let snap: unknown;
        try { snap = JSON.parse(row.snapshot); } catch { return false; }
        if (!snap || typeof snap !== 'object') return false;
        const list = (snap as { customHotSpots?: unknown }).customHotSpots;
        if (!Array.isArray(list)) return false;
        const kept = list.filter((h) => !(h && typeof h === 'object' && (h as { id?: string }).id === hotspotId));
        if (kept.length === list.length) return false; // nothing matched → no write, no fan
        (snap as { customHotSpots?: unknown }).customHotSpots = kept;
        this.db.prepare('UPDATE campaigns SET snapshot = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(snap), Date.now(), campaignId);
        this.changes$.next(campaignId); // player live-sync drops the taken-down hotspot too
        return true;
    }

    /** Returns false (no-op) on a cross-tenant or missing id. */
    remove(id: string, v: Viewer): boolean {
        const existing = this.db.prepare('SELECT ownerId FROM campaigns WHERE id = ?').get(id) as { ownerId: string | null } | undefined;
        if (!existing || !this.canAccess(existing.ownerId, v)) return false;
        this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
        if (this.getLast(v) === id) {
            const rest = this.list(v);
            this.setLast(rest[0]?.id ?? null, v);
        }
        return true;
    }

    // ── the "last" pointer (meta row, scoped per owner — dev/global = 'last') ──
    getLast(v: Viewer): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(lastKey(v)) as { value: string } | undefined;
        return row?.value ?? null;
    }
    setLast(id: string | null, v: Viewer): void {
        const key = lastKey(v);
        if (id) {
            // D-069: an EPHEMERAL session (Quick Mission) is never resumable — never let it become "last"
            // (defense in depth: the client already skips setLast for a QM, but the server enforces it too).
            const row = this.db.prepare('SELECT ephemeral FROM campaigns WHERE id = ?').get(id) as { ephemeral?: number } | undefined;
            if (row?.ephemeral) return;
            this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, id);
        } else {
            this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
        }
    }

    // ── HARDEN-7 A3/B1 — generic meta key/value accessors (the DurabilityService reads/writes the boot markers:
    //    the "was-populated" wipe sentinel + the session-secret fingerprint). Distinct key namespace from the
    //    per-owner "last:" pointers above; additive, no schema change (the meta table already exists). ──
    getMeta(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }
    setMeta(key: string, value: string): void {
        this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    }

    /** Row → client SaveRecord. savedAt is read from the blob (the client sorts/display by it);
     *  createdAt/updatedAt ride along as host-owned proof fields (the client ignores extras). */
    private rowToRecord(row: Record<string, unknown>): SaveRecord {
        let snapshot: unknown = null;
        try { snapshot = JSON.parse(String(row['snapshot'])); } catch { snapshot = null; }
        const snapSavedAt = (snapshot && typeof snapshot === 'object' ? (snapshot as { savedAt?: number }).savedAt : undefined);
        return {
            id: String(row['id']),
            name: String(row['name']),
            savedAt: snapSavedAt ?? Number(row['updatedAt']) ?? 0,
            version: Number(row['version']) || 1,
            summary: row['summary'] == null ? '' : String(row['summary']),
            snapshot,
            createdAt: Number(row['createdAt']) || undefined,
            updatedAt: Number(row['updatedAt']) || undefined,
            ownerId: (row['ownerId'] as string | null) ?? null,
            ephemeral: !!Number(row['ephemeral']), // D-069
        };
    }
}
