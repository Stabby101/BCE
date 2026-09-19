import { ConflictException, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';
import { AuthService } from '../auth/auth.service';
import { snapshotPackId, odmSingletonRefused, odmFlipRefused, odmRecordAccess, type OdmRecordRole, ODM_FEATURE, planOdmMigration } from './pack-gate';
import { carryLedgerAcrossRestore } from './odm-ledger';
import { WriterTokenService, writerDecision } from './writer-token.service';

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
    odmRecord?: boolean;
    ephemeral?: boolean;
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
    role?: string | null;
    features?: readonly string[];
    deviceId?: string | null;
}

const LAST_KEY = 'last';
const lastKey = (v: Viewer): string => (v.ownerId ? `last:${v.ownerId}` : LAST_KEY);

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
    readonly writerChanges$ = new Subject<string>();

    // pre-baton owner-only rule, byte-identical to P0; P5's per-device belt needs the store). Nest injects it in prod.
    constructor(@Optional() private readonly writer?: WriterTokenService) {}

    onModuleInit(): void {
        this.db = openDb(dbPath());
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
        if (!cols.includes('ephemeral')) this.db.exec('ALTER TABLE campaigns ADD COLUMN ephemeral INTEGER DEFAULT 0');
        // an honest dash rather than a guess; back-filling would mean decoding every retained blob).
        const ckCols = (this.db.prepare('PRAGMA table_info(checkpoints)').all() as { name: string }[]).map((c) => c.name);
        if (!ckCols.includes('gameDate')) this.db.exec('ALTER TABLE checkpoints ADD COLUMN gameDate TEXT');
        // deliberate act, so nothing is pinned retroactively; every existing row keeps ageing out as before.
        if (!ckCols.includes('pinned')) this.db.exec('ALTER TABLE checkpoints ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
        // Additive, default 0; the migration below sets it. Never used to delete — only to surface to the owner.
        if (!cols.includes('anomaly')) this.db.exec('ALTER TABLE campaigns ADD COLUMN anomaly INTEGER DEFAULT 0');
        this.pinOdmRecordAtBoot();
        this.log.log(`host record ready at ${dbPath()}`);
    }

    odmRecordId(): string | null { return process.env.ODM_RECORD_ID?.trim() || null; }

    private pinOdmRecordAtBoot(): void {
        const rows = this.db.prepare('SELECT id, snapshot FROM campaigns').all() as { id: string; snapshot: string }[];
        const odmIds: string[] = [];
        for (const r of rows) { try { if (snapshotPackId(JSON.parse(r.snapshot)) === 'odm') odmIds.push(r.id); } catch { /* opaque */ } }
        const plan = planOdmMigration(this.odmRecordId(), odmIds);
        if (plan.status === 'skipped') { this.log.log(`[] ${plan.message}`); return; }
        if (plan.status === 'error') { this.log.error(`[] ${plan.message}`); return; } // loud, NO change
        this.db.prepare('UPDATE campaigns SET anomaly = 0 WHERE id = ?').run(plan.recordId);
        if (plan.anomalies.length) {
            const mark = this.db.prepare('UPDATE campaigns SET anomaly = 1 WHERE id = ?');
            for (const id of plan.anomalies) mark.run(id);
        }
        this.log.log(`[] ${plan.message}`);
    }

    /** A viewer may touch a row iff admin, OR it is the row's owner, OR (legacy) the row is unowned-and-admin.
     *  A GM may NEVER reach a legacy/unowned row (null owner) — only admin can (the migration path). */
    private canAccess(ownerId: string | null, v: Viewer): boolean {
        if (v.admin) return true;
        if (ownerId == null) return false;
        return ownerId === v.ownerId;
    }

    private odmRoleOf(row: { id?: unknown; ownerId?: unknown; snapshot?: unknown }, v: Viewer): OdmRecordRole {
        let packId: string | null = null;
        try { packId = snapshotPackId(typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot); } catch { /* opaque row */ }
        if (packId !== 'odm') return 'none';
        const ownerId = (row.ownerId as string | null) ?? null;
        const role = odmRecordAccess({ admin: v.admin, isOwner: v.ownerId != null && v.ownerId === ownerId, role: v.role, features: v.features ?? [] });
        // set (dev/scratch) any odm row is readable. Owner/admin (write) are unaffected by the pin.
        if (role === 'read') { const pin = this.odmRecordId(); if (pin && row.id !== pin) return 'none'; }
        return role;
    }

    // ── reads (P2: owner-scoped; admin/dev see all) ──
    list(v: Viewer): SaveRecord[] {
        const rows = (v.admin
            ? this.db.prepare('SELECT * FROM campaigns WHERE COALESCE(ephemeral, 0) = 0 ORDER BY updatedAt DESC').all()
            : this.db.prepare('SELECT * FROM campaigns WHERE ownerId = ? AND COALESCE(ephemeral, 0) = 0 ORDER BY updatedAt DESC').all(v.ownerId)) as Record<string, unknown>[];
        // resumes THE one record instead of offering a fresh company. (One row in the world; a full scan here is
        // gated on the rare co-GM read and is cheap for the singleton — the ODM_RECORD_ID pin narrows it in A3.)
        if (!v.admin && v.role === 'gm' && (v.features ?? []).includes(ODM_FEATURE)) {
            const seen = new Set(rows.map((r) => r['id'] as string));
            for (const r of this.db.prepare('SELECT * FROM campaigns WHERE COALESCE(ephemeral, 0) = 0').all() as Record<string, unknown>[]) {
                if (!seen.has(r['id'] as string) && this.odmRoleOf(r, v) !== 'none') rows.push(r);
            }
        }
        return rows.map((r) => this.rowToRecord(r)).sort((a, b) => b.savedAt - a.savedAt);
    }
    get(id: string, v: Viewer): SaveRecord | null {
        const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        // non-ODM read is still "as if absent". The WRITE path (upsert) keeps canAccess, so a co-GM read never grants write.
        if (this.canAccess((row['ownerId'] as string | null) ?? null, v) || this.odmRoleOf(row, v) !== 'none') return this.rowToRecord(row);
        return null;
    }
    /** Whether a campaign row exists (P3: a player socket can't BIND to a phantom campaign id). */
    exists(id: string): boolean {
        return !!this.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(id);
    }
    socketReadAllowed(id: string, v: Viewer): boolean {
        const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return false;
        return this.canAccess((row['ownerId'] as string | null) ?? null, v) || this.odmRoleOf(row, v) !== 'none';
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
        const r = (v.admin
            ? this.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE COALESCE(ephemeral, 0) = 0').get()
            : this.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE ownerId = ? AND COALESCE(ephemeral, 0) = 0').get(v.ownerId)) as { n: number };
        return r.n;
    }
    /** DEPLOY-010 — the UNSCOPED total (the admin dashboard's "Campaigns" metric). */
    totalCount(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM campaigns').get() as { n: number }).n; }

    // ── write (upsert — create OR persist; owner stamped/checked server-side, NEVER from the client) ──
    private existingOdmOwner(exceptId: string): { exists: boolean; ownerId: string | null } {
        const rows = this.db.prepare('SELECT ownerId, snapshot FROM campaigns WHERE id != ?').all(exceptId) as { ownerId: string | null; snapshot: string }[];
        for (const r of rows) {
            try { if (snapshotPackId(JSON.parse(r.snapshot)) === 'odm') return { exists: true, ownerId: r.ownerId }; } catch { /* unparseable — not an ODM row */ }
        }
        return { exists: false, ownerId: null };
    }

    upsert(rec: SaveRecord, v: Viewer, opts?: { forceNew?: boolean }): SaveRecord {
        const now = Date.now();
        const snapshot = JSON.stringify(rec.snapshot ?? null);
        const existing = this.db.prepare('SELECT createdAt, ownerId, updatedAt, snapshot FROM campaigns WHERE id = ?').get(rec.id) as { createdAt: number; ownerId: string | null; updatedAt: number; snapshot: string } | undefined;
        if (existing) {
            // (the owner by DEFAULT; a handed-to co-GM while the baton is out; admin always), NOT plain ownership.
            // SAFE-BY-DEFAULT: with no hand-off holderOf is null ⇒ holder = owner ⇒ writerDecision === canAccess
            // owner-only, byte-identical to today. A non-holder is refused (the owner who handed away included);
            // the client keeps such a device read-only / routes its verbs as intents. Non-ODM rows: unchanged.
            let existingPackId: string | null = null;
            try { existingPackId = snapshotPackId(JSON.parse(existing.snapshot)); } catch { /* opaque row */ }
            if (existingPackId === 'odm') {
                // TAKES the table (the first owner device to reach the record — Q1; the socket join is the other road in). Else
                // only the holder DEVICE writes: a second device of the same account, a stale bundle without a device id, a
                // co-GM that was not handed it — all refused, 404-shaped (the belt that makes FACT B impossible).
                if (!this.writer) {
                    // no baton store wired (a unit spec's `new CampaignsService()`): the pre-baton rule, owner-only — byte-identical to P0
                    if (!this.canAccess(existing.ownerId, v)) throw new NotFoundException(`campaign ${rec.id} not found`);
                } else {
                    const holder = this.writer.holderOf(rec.id);
                    const mayTake = !holder && !!v.deviceId && !!v.ownerId && (v.admin || (existing.ownerId != null && existing.ownerId === v.ownerId));
                    if (mayTake) {
                        this.writer.hand(rec.id, { userId: v.ownerId as string, deviceId: v.deviceId as string }, now);
                        this.writerChanges$.next(rec.id);
                    } else if (!writerDecision({ userId: v.ownerId, deviceId: v.deviceId ?? null, ownerId: existing.ownerId, holder, admin: v.admin })) {
                        throw new NotFoundException(`campaign ${rec.id} not found`); // not the baton holder DEVICE → refused
                    }
                }
            } else if (!this.canAccess(existing.ownerId, v)) {
                throw new NotFoundException(`campaign ${rec.id} not found`); // cross-tenant write → no existence leak
            }
            if (odmFlipRefused(AuthService.authRequired(), existingPackId, rec.snapshot)) {
                throw new ConflictException('A campaign cannot be turned into an ODM campaign. ODM is a single ongoing company — open it from the ODM door.');
            }
        }
        // checkpoint row. Scope = campaigns whose snapshot carries packId (cheap — the incoming snapshot is
        // already an object; a plain/Classic/HS save records nothing). Skipped on create (nothing prior) and
        // on a byte-identical save (a no-change PUT must not mint duplicate rows). Pruned on every capture.
        if (existing && snapshotPackId(rec.snapshot) && existing.snapshot !== snapshot) {
            this.captureCheckpoint(rec.id, existing.snapshot, existing.updatedAt ?? now, now);
        }
        //    shared chokepoint so no future write path can forget it. ──
        const isCreate = !existing;
        const otherOdm = isCreate ? this.existingOdmOwner(rec.id) : { exists: false, ownerId: null };
        const isRecordOwner = v.ownerId != null && v.ownerId === otherOdm.ownerId; // the creator IS the one ODM record's owner
        if (odmSingletonRefused(AuthService.authRequired(), isCreate, otherOdm.exists, !!opts?.forceNew, isRecordOwner, rec.snapshot)) {
            throw new ConflictException('This account already has an ODM campaign. ODM is a single ongoing company — resume it, or use the explicit "start a second" control.');
        }
        const createdAt = existing?.createdAt ?? now;
        const ownerId = existing ? existing.ownerId : v.ownerId; // keep owner on update; stamp the viewer on create
        const ephemeral = rec.ephemeral ? 1 : 0;
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

    /** Store one prior-state blob (gzip at rest — DECISION: warranted, measured 5.0× on real ODM JSON;
     *  node:zlib, zero deps) stamped with WHEN that state was saved (`at`, the display stamp) AND when it
     *  was captured (`capturedAt`). Retention prunes on CAPTURE age (panel finding: pruning on `at` — the
     *  state's save age — made a 31-day-idle campaign's just-minted checkpoint, including the NON-NEGOTIABLE
     *  pre-restore capture, self-delete in the very next statement — a destructive restore). Prune is
     *  GLOBAL on purpose (one cheap indexed DELETE keeps every campaign's history bounded even if only one
     *  campaign is being played). */
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
        this.db.prepare('DELETE FROM checkpoints WHERE capturedAt < ? AND pinned = 0').run(now - CHECKPOINT_RETENTION_MS);
        return Number(res.lastInsertRowid);
    }


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
        // restore carries the CURRENT ledger forward and appends the rollback as an entry. ODM only.
        if (snapshotPackId(restored) === 'odm') {
            let current: unknown = null;
            try { current = JSON.parse(cur.snapshot); } catch { /* opaque — nothing to carry */ }
            carryLedgerAcrossRestore(current, restored, { ts: now, actor: 'GM', actorKey: 'gm', seat: null, seatLabel: null, field: 'campaign', was: 'the live state', now: `the checkpoint of ${stamp}`, verb: 'rollback', outcome: 'rollback' });
        }
        this.db.prepare('UPDATE campaigns SET snapshot = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(restored), now, campaignId);
        // Panel finding — the LIVE BATTLE CHANNEL must not outlive the state it was scored against: the
        // battle_state rows (per-instance armor/crit/ammo, keyed campaignId+engagementKey) are host truth
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

    removeCustomHotspot(campaignId: string, hotspotId: string): boolean {
        const row = this.db.prepare('SELECT snapshot FROM campaigns WHERE id = ?').get(campaignId) as { snapshot: string } | undefined;
        if (!row) return false;
        let snap: unknown;
        try { snap = JSON.parse(row.snapshot); } catch { return false; }
        if (!snap || typeof snap !== 'object') return false;
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
        // outlive the delete (30 days, or forever on a quiet server), and checkpoint authz derives from the
        // CURRENT campaigns row, so re-creating the well-known id (every past player holds it via the join
        // URL) would hand a NEW owner the OLD tenant's full snapshot history, gmOnly included.
        this.db.prepare('DELETE FROM checkpoints WHERE campaignId = ?').run(id);
        // ORDER-13 — the server-written SEAT LEDGER (names + unit labels + roles) dies with the campaign too (IP-002). The table is
        // the claims module's; it is absent only when this service runs alone (specs) — the battle_state pattern below.
        try { this.db.prepare('DELETE FROM seat_ledger WHERE campaignId = ?').run(id); } catch { /* table absent only when this service runs alone (specs) */ }
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
            // (defense in depth: the client already skips setLast for a QM, but the server enforces it too).
            const row = this.db.prepare('SELECT ephemeral FROM campaigns WHERE id = ?').get(id) as { ephemeral?: number } | undefined;
            if (row?.ephemeral) return;
            this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, id);
        } else {
            this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
        }
    }

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
            ephemeral: !!Number(row['ephemeral']),
            ...(this.odmRecordId() === String(row['id']) ? { odmRecord: true } : {}),
        };
    }
}
