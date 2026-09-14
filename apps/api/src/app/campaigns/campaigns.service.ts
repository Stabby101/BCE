/*
 * BCE ENGINE slice 1 (DIRECTIVE-041) — the HOST RECORD. The campaign source of truth
 * relocates here from per-browser IndexedDB. SQLite via node:sqlite (Node 24 built-in,
 * zero native-dep risk; flag-free on 24.14, only a stderr ExperimentalWarning). BLOB-FIRST:
 * the client's CampaignSnapshot is stored as an opaque versioned JSON blob — NO normalization,
 * NO schema reshape this slice (DATA-002: SQLite authoritative; IndexedDB demoted to cache).
 * Table mirrors the client SaveRecord {id,name,savedAt,version,summary,snapshot}; the row adds
 * host-owned createdAt/updatedAt (updatedAt bumps on every PUT — the mutation proof).
 */
import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib'; // ODM-18 P2 — checkpoint blobs at rest (measured 5× on ODM JSON)
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { dbPath } from '../db-path';
import { AuthService } from '../auth/auth.service'; // ODM-21 — the singleton's auth-off short-circuit (static; the claims gateway imports it the same way)
import { snapshotPackId, odmSingletonRefused } from './pack-gate'; // ODM-18 P2 — history records for pack campaigns only · ODM-21 — the singleton

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

/** ODM-18 P2 — a dated checkpoint row (list shape; the blob never rides the list).
 *  ODM-22: `gameDate` is the CAMPAIGN date the checkpoint holds, as `{y,m,d}` JSON (null on rows captured
 *  before ODM-22, and on any snapshot with no date). Without it the rollback list showed wall-clock and KB
 *  only — so nobody could pick "the one holding 15 FEB" without restoring it to find out, which is the
 *  difference between a rollback LIST and a rollback TOOL. It is a stored COLUMN rather than a decode of
 *  each blob at list time: the list would otherwise gunzip + parse every row on every open. */
export interface CheckpointInfo { id: number; at: number; bytes: number; gameDate: string | null; pinned: boolean; }
/** 30-day retention, pruned on every capture (the ruled window). */
const CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaignId TEXT NOT NULL,
                at INTEGER NOT NULL,
                capturedAt INTEGER NOT NULL,
                bytes INTEGER NOT NULL,
                snapshot BLOB NOT NULL,
                gameDate TEXT,
                pinned INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_checkpoints_camp ON checkpoints (campaignId, at);
            CREATE INDEX IF NOT EXISTS idx_checkpoints_cap ON checkpoints (capturedAt);`,
        );
        // P2 migration: pre-DEPLOY-002 DBs lack ownerId — add it (NULL = legacy/unowned → admin-only when gated).
        const cols = (this.db.prepare('PRAGMA table_info(campaigns)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('ownerId')) this.db.exec('ALTER TABLE campaigns ADD COLUMN ownerId TEXT');
        // D-069 migration: pre-D-069 DBs lack ephemeral — add it (0 = a normal, resumable, listed save).
        if (!cols.includes('ephemeral')) this.db.exec('ALTER TABLE campaigns ADD COLUMN ephemeral INTEGER DEFAULT 0');
        // ODM-22 migration: pre-ODM-22 checkpoint rows lack gameDate — add it (NULL = unknown, rendered as
        // an honest dash rather than a guess; back-filling would mean decoding every retained blob).
        const ckCols = (this.db.prepare('PRAGMA table_info(checkpoints)').all() as { name: string }[]).map((c) => c.name);
        if (!ckCols.includes('gameDate')) this.db.exec('ALTER TABLE checkpoints ADD COLUMN gameDate TEXT');
        // ODM-26 option 1 migration: pre-ODM-26 rows lack `pinned` — add it defaulting to 0. A pin is a
        // deliberate act, so nothing is pinned retroactively; every existing row keeps ageing out as before.
        if (!ckCols.includes('pinned')) this.db.exec('ALTER TABLE checkpoints ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
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
    /** ODM-21 — does this owner already hold an ODM campaign OTHER than `exceptId`? Owner-scoped, so the
     *  row count is a handful for a real account (never the whole table). The snapshot is an opaque blob,
     *  so packId is duck-read per row rather than queried in SQL. */
    private ownerHasOdmCampaign(ownerId: string, exceptId: string): boolean {
        const rows = this.db.prepare('SELECT id, snapshot FROM campaigns WHERE ownerId = ? AND id != ?').all(ownerId, exceptId) as { snapshot: string }[];
        for (const r of rows) {
            try { if (snapshotPackId(JSON.parse(r.snapshot)) === 'odm') return true; } catch { /* unparseable row — not an ODM campaign we can claim */ }
        }
        return false;
    }

    upsert(rec: SaveRecord, v: Viewer, opts?: { forceNew?: boolean }): SaveRecord {
        const now = Date.now();
        const snapshot = JSON.stringify(rec.snapshot ?? null);
        const existing = this.db.prepare('SELECT createdAt, ownerId, updatedAt, snapshot FROM campaigns WHERE id = ?').get(rec.id) as { createdAt: number; ownerId: string | null; updatedAt: number; snapshot: string } | undefined;
        if (existing && !this.canAccess(existing.ownerId, v)) {
            throw new NotFoundException(`campaign ${rec.id} not found`); // cross-tenant write → no existence leak
        }
        // ODM-18 P2 — CHECKPOINT HISTORY: before the overwrite lands, retain the PRIOR snapshot as a dated
        // checkpoint row. Scope = campaigns whose snapshot carries packId (cheap — the incoming snapshot is
        // already an object; a plain/Classic/HS save records nothing). Skipped on create (nothing prior) and
        // on a byte-identical save (a no-change PUT must not mint duplicate rows). Pruned on every capture.
        if (existing && snapshotPackId(rec.snapshot) && existing.snapshot !== snapshot) {
            this.captureCheckpoint(rec.id, existing.snapshot, existing.updatedAt ?? now, now);
        }
        // ── ODM-21 — THE SINGLETON, enforced at the shared chokepoint so no future write path can forget
        //    it. Refuses only an ODM CREATE for an owner who already holds one; see pack-gate for why
        //    null-owner accounts are deliberately unguarded and why forceNew is a guard, not a boundary. ──
        const isCreate = !existing;
        const owner = existing ? existing.ownerId : v.ownerId;
        if (odmSingletonRefused(AuthService.authRequired(), owner, isCreate, isCreate && owner != null ? this.ownerHasOdmCampaign(owner, rec.id) : false, !!opts?.forceNew, rec.snapshot)) {
            throw new ConflictException('This account already has an ODM campaign. ODM is a single ongoing company — resume it, or use the explicit "start a second" control.');
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

    /** ODM-18 P3 — the takedown lever REACHES a GM-COMPOSED mission (DESIGN-INVARIANTS IP-002: any feature
     *  retaining campaign content must answer the takedown, and composed prose is GM-typed user content of
     *  exactly the class the lever exists for). Removes the PUBLISHED record, its DRAFT (where the prose also
     *  lives), and its runtime branch — then purges the checkpoint history, because a restore would otherwise
     *  resurrect the removed content inside the 30-day window. UNSCOPED: the caller is the AdminController. */
    removeGmMission(campaignId: string, missionId: string): boolean {
        const row = this.db.prepare('SELECT snapshot FROM campaigns WHERE id = ?').get(campaignId) as { snapshot: string } | undefined;
        if (!row) return false;
        let snap: Record<string, unknown>;
        try { snap = JSON.parse(row.snapshot) as Record<string, unknown>; } catch { return false; }
        if (!snap || typeof snap !== 'object') return false;
        let hit = false;
        const pub = snap['odmGmMissions'];
        if (Array.isArray(pub)) {
            const kept = pub.filter((m) => !(m && typeof m === 'object' && (m as { id?: string }).id === missionId));
            if (kept.length !== pub.length) { snap['odmGmMissions'] = kept; hit = true; }
        }
        const gm = snap['gmOnly'] as Record<string, unknown> | undefined;
        const drafts = gm && typeof gm === 'object' ? gm['gmMissionDrafts'] : undefined;
        if (Array.isArray(drafts)) {
            const kept = drafts.filter((d) => !(d && typeof d === 'object' && (d as { id?: string }).id === missionId));
            if (kept.length !== drafts.length) { (gm as Record<string, unknown>)['gmMissionDrafts'] = kept; hit = true; }
        }
        const tree = snap['missionTree'];
        if (Array.isArray(tree)) {
            const kept = tree.filter((b) => !(b && typeof b === 'object' && (b as { branchId?: string }).branchId === missionId));
            if (kept.length !== tree.length) { snap['missionTree'] = kept; hit = true; }
        }
        if (!hit) return false;
        this.db.prepare('UPDATE campaigns SET snapshot = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(snap), Date.now(), campaignId);
        this.db.prepare('DELETE FROM checkpoints WHERE campaignId = ?').run(campaignId); // IP-002 — a restore must not resurrect it
        this.changes$.next(campaignId); // the fan drops the mission from every joined device
        return true;
    }

    // ── ODM-18 P2 — CHECKPOINT HISTORY + GM ROLLBACK ──
    /** Store one prior-state blob (gzip at rest — DECISION: warranted, measured 5.0× on real ODM JSON;
     *  node:zlib, zero deps) stamped with WHEN that state was saved (`at`, the display stamp) AND when it
     *  was captured (`capturedAt`). Retention prunes on CAPTURE age (panel finding: pruning on `at` — the
     *  state's save age — made a 31-day-idle campaign's just-minted checkpoint, including the NON-NEGOTIABLE
     *  pre-restore capture, self-delete in the very next statement — a destructive restore). Prune is
     *  GLOBAL on purpose (one cheap indexed DELETE keeps every campaign's history bounded even if only one
     *  campaign is being played). */
    /** ODM-22 — the campaign date the prior snapshot held, as compact `{y,m,d}` JSON (null when absent or
     *  unreadable — never a guess). Parsed once per capture; the gzip on the same string dominates the cost. */
    private gameDateOf(priorJson: string): string | null {
        try {
            const d = (JSON.parse(priorJson) as { currentDate?: { y?: unknown; m?: unknown; d?: unknown } } | null)?.currentDate;
            if (!d || typeof d.y !== 'number' || typeof d.m !== 'number' || typeof d.d !== 'number') return null;
            return JSON.stringify({ y: d.y, m: d.m, d: d.d });
        } catch { return null; }
    }

    private captureCheckpoint(campaignId: string, priorJson: string, at: number, now: number, pinned = false): number {
        const blob = gzipSync(Buffer.from(priorJson, 'utf8'));
        const res = this.db.prepare('INSERT INTO checkpoints (campaignId, at, capturedAt, bytes, snapshot, gameDate, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(campaignId, at, now, Buffer.byteLength(priorJson, 'utf8'), blob, this.gameDateOf(priorJson), pinned ? 1 : 0);
        /* ── ODM-26 option 1 — THE PIN IS EXEMPT FROM AGE, NEVER FROM DELETION FOR CAUSE (PM-ruled).
           THIS `AND pinned = 0` IS THE ONLY PLACE THE PIN IS EVER HONOURED, and that is the whole design.
           There are four `DELETE FROM checkpoints` sites in this file; the other three MUST take a pinned
           row exactly as they take any other:
             · removeGmMission + removeCustomHotspot — the IP-002 takedown purges. The source's own rule
               decides it: a compliance lever that a rollback can undo is not a lever. A pin surviving a
               takedown would resurrect removed content from a protected blob.
             · remove() — the campaign is gone. Checkpoint authz derives from the CURRENT campaigns row, so
               a surviving pinned row plus a re-created well-known id (every past player holds it via the
               join URL) would hand a NEW owner the OLD tenant's snapshot history, gmOnly included.
           Do not add this clause to any other statement. `checkpoints.spec.ts` drives all three deletion
           paths against a pinned row and requires it gone every time — the guard is structural, not
           remembered. ── */
        this.db.prepare('DELETE FROM checkpoints WHERE capturedAt < ? AND pinned = 0').run(now - CHECKPOINT_RETENTION_MS);
        return Number(res.lastInsertRowid);
    }

    /* ── ODM-26 option 1 — PIN THE CURRENT STATE, IN ONE STEP.
       A checkpoint holds the state as it was BEFORE the save that minted it, and there is no capture-now
       path — so "pin this state" using only the existing mechanics means saving twice and pinning the
       second capture. A GM does that wrong once and never finds out, and what they get wrong is the CANON
       every later session is measured against. So the capture and the mark are one operation: this reads
       the live snapshot and stores it already pinned. ── */

    /** Capture the CURRENT snapshot as a pinned checkpoint. Returns the row (or the existing one when the
     *  live state is byte-identical to the newest pin — pressing twice is not two canons, mirroring the
     *  no-change-save rule that already governs capture). */
    pinCurrent(campaignId: string, v: Viewer): CheckpointInfo {
        this.assertCampaignAccess(campaignId, v);
        const cur = this.db.prepare('SELECT snapshot, updatedAt FROM campaigns WHERE id = ?').get(campaignId) as { snapshot: string; updatedAt: number | null } | undefined;
        if (!cur) throw new NotFoundException(`campaign ${campaignId} not found`);
        const now = Date.now();
        const newest = this.db.prepare('SELECT id, snapshot FROM checkpoints WHERE campaignId = ? AND pinned = 1 ORDER BY at DESC, id DESC LIMIT 1').get(campaignId) as { id: number; snapshot: Uint8Array } | undefined;
        if (newest) {
            try {
                if (gunzipSync(Buffer.from(newest.snapshot)).toString('utf8') === cur.snapshot) return this.checkpointInfo(campaignId, newest.id);
            } catch { /* unreadable pin → fall through and mint a fresh one */ }
        }
        const id = this.captureCheckpoint(campaignId, cur.snapshot, cur.updatedAt ?? now, now, true);
        return this.checkpointInfo(campaignId, id);
    }

    /** Pin or unpin an existing checkpoint. Unpinning returns it to the 30-day sweep — the pin is a
     *  decision, and a decision you cannot reverse is a trap. */
    setCheckpointPinned(campaignId: string, checkpointId: number, pinned: boolean, v: Viewer): CheckpointInfo {
        this.assertCampaignAccess(campaignId, v);
        const res = this.db.prepare('UPDATE checkpoints SET pinned = ? WHERE id = ? AND campaignId = ?').run(pinned ? 1 : 0, checkpointId, campaignId);
        if (!Number(res.changes)) throw new NotFoundException(`checkpoint ${checkpointId} not found`);
        return this.checkpointInfo(campaignId, checkpointId);
    }

    private checkpointInfo(campaignId: string, id: number): CheckpointInfo {
        const r = this.db.prepare('SELECT id, at, bytes, gameDate, pinned FROM checkpoints WHERE id = ? AND campaignId = ?').get(id, campaignId) as (Omit<CheckpointInfo, 'pinned'> & { pinned: number }) | undefined;
        if (!r) throw new NotFoundException(`checkpoint ${id} not found`);
        return { ...r, pinned: !!r.pinned };
    }

    /** The dated checkpoint list (newest first) — owner-scoped through the campaign row; blobs never ride. */
    listCheckpoints(campaignId: string, v: Viewer): CheckpointInfo[] {
        this.assertCampaignAccess(campaignId, v);
        const rows = this.db.prepare('SELECT id, at, bytes, gameDate, pinned FROM checkpoints WHERE campaignId = ? ORDER BY pinned DESC, at DESC, id DESC').all(campaignId) as unknown as (Omit<CheckpointInfo, 'pinned'> & { pinned: number })[];
        return rows.map((r) => ({ ...r, pinned: !!r.pinned })); // SQLite has no boolean; the wire type does
    }

    /** The parsed snapshot a checkpoint holds — for the CONTROLLER's pre-apply belts (pack/gmOnly asserts
     *  re-run on the restored content before the swap; a revoked entitlement blocks a restore too). */
    getCheckpointSnapshot(campaignId: string, checkpointId: number, v: Viewer): unknown {
        this.assertCampaignAccess(campaignId, v);
        const row = this.db.prepare('SELECT snapshot FROM checkpoints WHERE id = ? AND campaignId = ?').get(checkpointId, campaignId) as { snapshot: Uint8Array } | undefined;
        if (!row) throw new NotFoundException(`checkpoint ${checkpointId} not found`);
        try { return JSON.parse(gunzipSync(Buffer.from(row.snapshot)).toString('utf8')); } catch { throw new NotFoundException(`checkpoint ${checkpointId} unreadable`); }
    }

    /** RESTORE — swaps the live snapshot for the chosen checkpoint AFTER an automatic pre-restore checkpoint
     *  of the current state (a rollback you can roll back — NEVER a destructive restore; the ruled law).
     *  The campaign log records the restore GM-attributed (the removeCustomHotspot precedent sanctions this
     *  parse: the server appends one line using the restored snapshot's own game date). Fans via changes$ —
     *  joined devices converge on the normal path. */
    restoreCheckpoint(campaignId: string, checkpointId: number, v: Viewer): SaveRecord {
        this.assertCampaignAccess(campaignId, v);
        const restored = this.getCheckpointSnapshot(campaignId, checkpointId, v) as Record<string, unknown> | null;
        const chk = this.db.prepare('SELECT at FROM checkpoints WHERE id = ? AND campaignId = ?').get(checkpointId, campaignId) as { at: number } | undefined;
        const cur = this.db.prepare('SELECT snapshot, updatedAt FROM campaigns WHERE id = ?').get(campaignId) as { snapshot: string; updatedAt: number } | undefined;
        if (!restored || !chk || !cur) throw new NotFoundException(`checkpoint ${checkpointId} not found`);
        const now = Date.now();
        // the NON-NEGOTIABLE pre-restore checkpoint: the current state is preserved BEFORE anything moves
        this.captureCheckpoint(campaignId, cur.snapshot, cur.updatedAt ?? now, now);
        // the GM-attributed log line, dated in game time from the restored state itself
        const when = new Date(chk.at);
        const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
        const gameDate = (restored['currentDate'] ?? restored['startDate'] ?? { y: 2767, m: 0, d: 1 }) as { y: number; m: number; d: number };
        const log = Array.isArray(restored['campaignLog']) ? restored['campaignLog'] : [];
        restored['campaignLog'] = [...log, { date: gameDate, text: `GM rollback — campaign restored to the checkpoint of ${stamp} (the pre-restore state was checkpointed first)`, kind: 'admin' }];
        this.db.prepare('UPDATE campaigns SET snapshot = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(restored), now, campaignId);
        // Panel finding — the LIVE BATTLE CHANNEL must not outlive the state it was scored against: the
        // battle_state rows (per-instance armor/crit/ammo, keyed campaignId+engagementKey) are host truth
        // for the D-048 live fan, and a mid-engagement rollback would otherwise re-apply the exact damage
        // the restore erased (battle-sync + the resolve-time reconcile read them back). Dropped for the
        // whole campaign — devices re-derive from the restored snapshot. (The table belongs to
        // BattleStateService — same shared host file by design; guarded for isolated unit contexts.)
        try { this.db.prepare('DELETE FROM battle_state WHERE campaignId = ?').run(campaignId); } catch { /* table absent only when this service runs alone (specs) */ }
        this.changes$.next(campaignId); // joined devices converge on the normal fan
        return this.rowToRecord(this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as Record<string, unknown>);
    }

    /** Owner-scoping for the checkpoint surfaces — the campaign row is the authority (cross-tenant reads
     *  the same not-found the campaign itself would). */
    private assertCampaignAccess(campaignId: string, v: Viewer): void {
        const row = this.db.prepare('SELECT ownerId FROM campaigns WHERE id = ?').get(campaignId) as { ownerId: string | null } | undefined;
        if (!row || !this.canAccess(row.ownerId ?? null, v)) throw new NotFoundException(`campaign ${campaignId} not found`);
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
        // GM-1 P2 — the takedown reaches BOTH layouts: top-level AND gmOnly.customHotSpots (GM sessions store
        // the chamber under gmOnly; a compliance lever that cannot reach the content it exists to remove is
        // dead). Opacity is a WIRE convention — the admin takedown is sanctioned to look inside.
        const dropFrom = (o: unknown): boolean => {
            if (!o || typeof o !== 'object') return false;
            const list = (o as { customHotSpots?: unknown }).customHotSpots;
            if (!Array.isArray(list)) return false;
            const kept = list.filter((h) => !(h && typeof h === 'object' && (h as { id?: string }).id === hotspotId));
            if (kept.length === list.length) return false;
            (o as { customHotSpots?: unknown }).customHotSpots = kept;
            return true;
        };
        const topRemoved = dropFrom(snap); // both layouts searched unconditionally (never short-circuit —
        const gmRemoved = dropFrom((snap as { gmOnly?: unknown }).gmOnly); // a duplicated id must not survive in the other)
        if (!topRemoved && !gmRemoved) return false; // nothing matched in either layout → no write, no fan
        this.db.prepare('UPDATE campaigns SET snapshot = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(snap), Date.now(), campaignId);
        // ODM-18 P2 rider (PM-ordered): PURGE-ON-TAKEDOWN — the checkpoint history retains prior snapshots,
        // so without this a DMCA-removed hotspot would survive at rest for 30 days and RESURRECT on a GM
        // restore (a compliance lever that a rollback can undo is not a lever). The takedown deletes the
        // campaign's history wholesale — checkpoints are convenience state; the compliance surface wins.
        // LAW (DESIGN-INVARIANTS IP-002): any feature retaining campaign content must answer the takedown.
        this.db.prepare('DELETE FROM checkpoints WHERE campaignId = ?').run(campaignId);
        this.changes$.next(campaignId); // player live-sync drops the taken-down hotspot too
        return true;
    }

    /** Returns false (no-op) on a cross-tenant or missing id. */
    remove(id: string, v: Viewer): boolean {
        const existing = this.db.prepare('SELECT ownerId FROM campaigns WHERE id = ?').get(id) as { ownerId: string | null } | undefined;
        if (!existing || !this.canAccess(existing.ownerId, v)) return false;
        this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
        // ODM-18 P2 (panel finding): the history dies WITH the campaign — orphaned checkpoint rows would
        // outlive the delete (30 days, or forever on a quiet server), and checkpoint authz derives from the
        // CURRENT campaigns row, so re-creating the well-known id (every past player holds it via the join
        // URL) would hand a NEW owner the OLD tenant's full snapshot history, gmOnly included.
        this.db.prepare('DELETE FROM checkpoints WHERE campaignId = ?').run(id);
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
