/*
 * BCE multi-tenant (DEPLOY-002 P1) — the GM users store (server-authoritative, node:sqlite, in the
 * same host DB as campaigns/claims). The approval state-machine lives here: status pending|approved|
 * rejected, role admin|gm. NO password column — OAuth identity only (provider + providerUserId).
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { randomUUID } from 'node:crypto';
import { dbPath } from '../db-path';
import type { AuditAction, AuditEntry, AuditFilter, OAuthProfile, User, UserRole, UserStatus } from './auth.types';

const CREATE = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  providerUserId TEXT NOT NULL,
  email TEXT,
  displayName TEXT,
  role TEXT NOT NULL DEFAULT 'gm',
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt INTEGER NOT NULL,
  lastSeen INTEGER,
  recoveryHash TEXT,
  linkedTo TEXT,
  UNIQUE(provider, providerUserId)
);`;
// LINK-1: linkedTo — set on a guest retired by an upgrade (the durable account id it merged into). Dormant,
// never deleted; recoverGuest refuses a linked guest (its recovery code is irrelevant post-upgrade).
// DEPLOY-009: recoveryHash is a keyed HASH of the guest recovery code (never the plaintext) — it never
// flows into the User DTO (toUser omits it), so a /me or admin list can't leak it.
// DEPLOY-003: append-only governance log. There is intentionally NO update/delete path — entries are
// immutable records (schema left open for a richer in-app activity feed later, §3 out-of-scope note).
const AUDIT_CREATE = `CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  actorUserId TEXT,
  action TEXT NOT NULL,
  targetUserId TEXT,
  detail TEXT,
  ip TEXT
);`;

type Row = Record<string, unknown>;

@Injectable()
export class UsersService implements OnModuleInit {
    private readonly log = new Logger('UsersService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
        this.db.exec(CREATE);
        this.db.exec(AUDIT_CREATE);
        // DEPLOY-003 migration: a pre-existing users table lacks lastSeen — add it (NULL = never seen).
        const cols = (this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('lastSeen')) this.db.exec('ALTER TABLE users ADD COLUMN lastSeen INTEGER');
        // DEPLOY-009 migration: a pre-DEPLOY-009 users table lacks recoveryHash (NULL = not a recoverable guest).
        if (!cols.includes('recoveryHash')) this.db.exec('ALTER TABLE users ADD COLUMN recoveryHash TEXT');
        // LINK-1 migration: a pre-LINK-1 users table lacks linkedTo (NULL = a live account, never upgraded).
        if (!cols.includes('linkedTo')) this.db.exec('ALTER TABLE users ADD COLUMN linkedTo TEXT');
        this.log.log('users + audit store ready');
    }

    private toUser(r: Row | undefined): User | null {
        if (!r) return null;
        return {
            id: r.id as string,
            provider: r.provider as User['provider'],
            providerUserId: r.providerUserId as string,
            email: (r.email as string) ?? null,
            displayName: (r.displayName as string) ?? null,
            role: r.role as UserRole,
            status: r.status as UserStatus,
            createdAt: r.createdAt as number,
            lastSeen: (r.lastSeen as number) ?? undefined,
            linkedTo: (r.linkedTo as string) ?? null, // LINK-1
        };
    }

    getById(id: string): User | null {
        return this.toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
    }
    getByProvider(provider: string, providerUserId: string): User | null {
        return this.toUser(this.db.prepare('SELECT * FROM users WHERE provider = ? AND providerUserId = ?').get(provider, providerUserId) as Row | undefined);
    }

    /**
     * Upsert from an OAuth/dev identity. Admin-bootstrap: an admin email → role admin + status approved
     * (idempotent, never downgrades). A NEW non-admin → gm; APPROVED by default (LINK-1 policy: moderation is
     * reactive, not an entry gate) UNLESS `gmRequiresApproval` (BCE_GM_REQUIRES_APPROVAL) → pending. An existing
     * non-admin keeps its role/status (only email/displayName refresh) — so an admin can't accidentally re-pend
     * an approved GM, and a returning banned/rejected account is never silently re-approved.
     */
    upsert(profile: OAuthProfile, isAdmin: boolean, gmRequiresApproval = false): User {
        const existing = this.getByProvider(profile.provider, profile.providerUserId);
        if (existing) {
            const role: UserRole = isAdmin ? 'admin' : existing.role;
            const status: UserStatus = isAdmin ? 'approved' : existing.status;
            this.db.prepare('UPDATE users SET email = ?, displayName = ?, role = ?, status = ? WHERE id = ?')
                .run(profile.email, profile.displayName, role, status, existing.id);
            return this.getById(existing.id)!;
        }
        const id = `usr-${randomUUID()}`;
        const role: UserRole = isAdmin ? 'admin' : 'gm';
        const status: UserStatus = isAdmin ? 'approved' : (gmRequiresApproval ? 'pending' : 'approved'); // LINK-1: approved by default; gate only when BCE_GM_REQUIRES_APPROVAL
        this.db.prepare('INSERT INTO users (id, provider, providerUserId, email, displayName, role, status, createdAt) VALUES (?,?,?,?,?,?,?,?)')
            .run(id, profile.provider, profile.providerUserId, profile.email, profile.displayName, role, status, Date.now());
        return this.getById(id)!;
    }

    /**
     * DEPLOY-009 — mint a login-free GUEST. No OAuth identity: provider='guest', providerUserId = the new id
     * (keeps the UNIQUE(provider, providerUserId) invariant). Auto-approved by default — the whole point of the
     * "+ guest" lane — unless BCE_GUEST_REQUIRES_APPROVAL routes it through the queue (status 'pending'). The
     * recoveryHash is a keyed hash of the code (computed in AuthService); the plaintext is returned to the
     * client ONCE and never stored here.
     */
    createGuest(recoveryHash: string, requiresApproval: boolean): User {
        const id = `gst-${randomUUID()}`;
        const status: UserStatus = requiresApproval ? 'pending' : 'approved';
        this.db.prepare('INSERT INTO users (id, provider, providerUserId, email, displayName, role, status, createdAt, recoveryHash) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(id, 'guest', id, null, null, 'guest', status, Date.now(), recoveryHash);
        return this.getById(id)!;
    }
    /** DEPLOY-009 — the guest behind a recovery hash (the recover flow's lookup). Null if no match. The hash
     *  is keyed by the server secret, so this is a constant-shape lookup an attacker can't precompute offline. */
    getByRecoveryHash(recoveryHash: string): User | null {
        return this.toUser(this.db.prepare('SELECT * FROM users WHERE recoveryHash = ?').get(recoveryHash) as Row | undefined);
    }
    /** HARDEN-7 B2 — replace a user's recoveryHash (regenerate-while-logged-in). Row-scoped UPDATE; the row
     *  (and its ownerId link to campaigns) is otherwise untouched. The old hash no longer resolves — the prior
     *  code is invalidated the instant the new one is minted. */
    setRecoveryHash(id: string, recoveryHash: string): void {
        this.db.prepare('UPDATE users SET recoveryHash = ? WHERE id = ?').run(recoveryHash, id);
    }

    listByStatus(status: UserStatus): User[] {
        return (this.db.prepare('SELECT * FROM users WHERE status = ? ORDER BY createdAt').all(status) as Row[]).map((r) => this.toUser(r)!);
    }
    pendingCount(): number {
        return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").get() as { n: number }).n;
    }
    setStatus(id: string, status: UserStatus): User | null {
        this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
        return this.getById(id);
    }
    /** LINK-1 — retire a GUEST that upgraded to a durable account: mark it dormant (linkedTo = the account id),
     *  NEVER delete (destructive-action safety). Role-guarded so only a guest can be retired this way. Row-scoped
     *  UPDATE — the guest row and its audit trail survive; its recovery code stops resolving (see recoverGuest). */
    linkGuest(guestId: string, toUserId: string): void {
        this.db.prepare("UPDATE users SET linkedTo = ? WHERE id = ? AND role = 'guest'").run(toUserId, guestId);
    }

    // ── DEPLOY-010 dashboard metrics (counts only — no PII leaves the row aggregates) ──
    total(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n; }
    countByStatus(): Record<UserStatus, number> {
        const out: Record<UserStatus, number> = { pending: 0, approved: 0, rejected: 0, banned: 0 };
        for (const r of this.db.prepare('SELECT status, COUNT(*) AS n FROM users GROUP BY status').all() as { status: UserStatus; n: number }[]) {
            if (r.status in out) out[r.status] = r.n;
        }
        return out;
    }
    countByRole(): Record<UserRole, number> {
        const out: Record<UserRole, number> = { admin: 0, gm: 0, guest: 0 };
        for (const r of this.db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all() as { role: UserRole; n: number }[]) {
            if (r.role in out) out[r.role] = r.n;
        }
        return out;
    }
    /** Users registered since ts (createdAt >= ts) — drives newToday / new7d. */
    countNewSince(ts: number): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE createdAt >= ?').get(ts) as { n: number }).n; }
    /** Users last seen since ts (lastSeen >= ts) — drives activeToday / active7d (the durable activity proxy). */
    countActiveSince(ts: number): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE lastSeen >= ?').get(ts) as { n: number }).n; }

    // ── DEPLOY-003 directory + governance ──
    /** The full user directory (admin Users table). */
    list(): User[] {
        return (this.db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all() as Row[]).map((r) => this.toUser(r)!);
    }
    setRole(id: string, role: UserRole): User | null {
        this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        return this.getById(id);
    }
    remove(id: string): void {
        this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }

    // lastSeen — the ApprovedGmGuard calls this per request; throttled (≤1 write/min/user) so the
    // debounced campaign-PUT hot path doesn't churn the row.
    private readonly seenThrottle = new Map<string, number>();
    touchLastSeen(id: string): void {
        const now = Date.now();
        if (now - (this.seenThrottle.get(id) ?? 0) < 60_000) return;
        this.seenThrottle.set(id, now);
        this.db.prepare('UPDATE users SET lastSeen = ? WHERE id = ?').run(now, id);
    }

    // ── DEPLOY-003 audit (append-only — NO update/delete method exists anywhere, by design) ──
    recordAudit(e: { actorUserId?: string | null; action: AuditAction; targetUserId?: string | null; detail?: string | null; ip?: string | null }): void {
        this.db.prepare('INSERT INTO audit_log (id, ts, actorUserId, action, targetUserId, detail, ip) VALUES (?,?,?,?,?,?,?)')
            .run(`aud-${randomUUID()}`, Date.now(), e.actorUserId ?? null, e.action, e.targetUserId ?? null, e.detail ?? null, e.ip ?? null);
    }
    listAudit(f: AuditFilter = {}): AuditEntry[] {
        const where: string[] = [];
        const args: unknown[] = [];
        if (f.user) { where.push('(actorUserId = ? OR targetUserId = ?)'); args.push(f.user, f.user); }
        if (f.action) { where.push('action = ?'); args.push(f.action); }
        if (f.from) { where.push('ts >= ?'); args.push(f.from); }
        if (f.to) { where.push('ts <= ?'); args.push(f.to); }
        const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`;
        args.push(Math.min(Math.max(f.limit ?? 200, 1), 1000));
        return (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({
            id: r.id as string, ts: r.ts as number, actorUserId: (r.actorUserId as string) ?? null,
            action: r.action as AuditAction, targetUserId: (r.targetUserId as string) ?? null,
            detail: (r.detail as string) ?? null, ip: (r.ip as string) ?? null,
        }));
    }
}
