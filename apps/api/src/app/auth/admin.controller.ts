/*
 * BCE multi-tenant (DEPLOY-002 P1 → DEPLOY-003 T-039) — the admin governance API. Class-level
 * @UseGuards(AdminGuard) gates EVERY route here (server-side authorization — never the frontend route
 * guard alone): a non-admin hitting any /api/admin/* gets 403. Three concerns: the approval queue, the
 * full user directory (ban/reinstate/role/remove), and the append-only audit log. Every mutation writes
 * an audit entry (actor = the admin from the guard). Self-lockout is blocked (you can't reject/ban/remove
 * or demote your own account).
 */
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { rmSync } from 'node:fs';
import { AdminGuard } from './auth.guards';
import { UsersService } from './users.service';
import { EntitlementsService } from './entitlements.service';
import { PresenceService } from './presence.service';
import { BackupService } from './backup.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import type { AdminStats, AuditAction, AuditEntry, AuthedRequest, User, UserStatus } from './auth.types';

const VALID_STATUS = new Set<UserStatus>(['pending', 'approved', 'rejected', 'banned']);
const DAY = 24 * 60 * 60 * 1000;

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
    constructor(
        private readonly users: UsersService,
        private readonly presence: PresenceService,
        private readonly campaigns: CampaignsService,
        private readonly backup: BackupService,
        private readonly grants: EntitlementsService, // ODM-1: per-account feature grants
    ) {}

    /** HARDEN-7 A1 — off-box DB export. Streams a CONSISTENT single-file snapshot (VACUUM INTO a temp file,
     *  never a raw copy of the live WAL DB), then deletes the temp. AdminGuard (class-level) → 403 for a
     *  non-admin; never public. The one durability the volume backups can't give (they die with the volume). */
    @Get('export')
    export(@Res() res: Response): void {
        const tmp = this.backup.exportToTemp();
        const filename = `bce-export-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
        res.download(tmp, filename, (err) => {
            try { rmSync(tmp, { force: true }); } catch { /* temp cleanup best-effort */ }
            if (err && !res.headersSent) res.status(500).end();
        });
    }

    // ── DEPLOY-010 dashboard metrics (AdminGuard-gated like every /admin/* route — 403 for non-admin) ──
    @Get('stats')
    stats(): AdminStats {
        const now = Date.now();
        return {
            totalUsers: this.users.total(),
            byStatus: this.users.countByStatus(),
            byRole: this.users.countByRole(),
            activeNow: this.presence.onlineCount(),
            activeToday: this.users.countActiveSince(now - DAY),
            active7d: this.users.countActiveSince(now - 7 * DAY),
            newToday: this.users.countNewSince(now - DAY),
            new7d: this.users.countNewSince(now - 7 * DAY),
            totalCampaigns: this.campaigns.totalCount(),
        };
    }

    // ── directory + approvals queue ──
    /** The full user directory (default) or one status via ?status= (the approvals queue uses ?status=pending). */
    @Get('users')
    list(@Query('status') status?: string): User[] {
        if (status && VALID_STATUS.has(status as UserStatus)) return this.users.listByStatus(status as UserStatus);
        return this.users.list();
    }
    @Get('users/pending')
    pending(): User[] {
        return this.users.listByStatus('pending');
    }
    @Get('users/pending-count')
    pendingCount(): { count: number } {
        return { count: this.users.pendingCount() };
    }

    // ── lifecycle mutations (each AUDITED; the ban is enforced live by the guards, not here) ──
    @Post('users/:id/approve')
    approve(@Req() req: AuthedRequest, @Param('id') id: string): { user: User | null } {
        return this.mutate(req, id, 'approve', () => this.users.setStatus(id, 'approved'));
    }
    @Post('users/:id/reject')
    reject(@Req() req: AuthedRequest, @Param('id') id: string): { user: User | null } {
        this.guardSelf(req, id);
        return this.mutate(req, id, 'reject', () => this.users.setStatus(id, 'rejected'));
    }
    @Post('users/:id/ban')
    ban(@Req() req: AuthedRequest, @Param('id') id: string): { user: User | null } {
        this.guardSelf(req, id);
        return this.mutate(req, id, 'ban', () => this.users.setStatus(id, 'banned'));
    }
    @Post('users/:id/unban')
    unban(@Req() req: AuthedRequest, @Param('id') id: string): { user: User | null } {
        return this.mutate(req, id, 'unban', () => this.users.setStatus(id, 'approved'));
    }
    @Post('users/:id/remove')
    remove(@Req() req: AuthedRequest, @Param('id') id: string): { ok: true } {
        this.guardSelf(req, id);
        this.users.remove(id);
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action: 'remove', targetUserId: id, ip: req.ip ?? null });
        return { ok: true };
    }
    /** DEPLOY-010 SOLE-ADMIN LOCK — NO runtime path creates an admin: admin is conferred ONLY via
     *  BCE_ADMIN_EMAILS (on sign-in). This endpoint may DEMOTE admin→gm but REFUSES role:'admin'. Self-
     *  demotion stays blocked. (The promote-to-admin UI is removed from admin-page.ts too.) */
    // ── DIRECTIVE-ODM-1 Phase 1 — per-account feature grants (the hidden-pack entitlement toggle) ──
    /** The whole grants directory (tiny table) — the console renders per-user chips from one call. */
    @Get('grants')
    listGrants(): { grants: { userId: string; feature: string; grantedBy: string | null; grantedAt: number }[] } {
        return { grants: this.grants.all() };
    }
    /** Grant a feature. Guests are REFUSED (ruled: guests never entitled). Idempotent; audited. */
    @Post('users/:id/grants/:feature')
    grantFeature(@Req() req: AuthedRequest, @Param('id') id: string, @Param('feature') feature: string): { ok: true; features: string[] } {
        if (!/^[a-z0-9-]{1,32}$/.test(feature)) throw new BadRequestException('bad feature id');
        const target = this.users.getById(id);
        if (!target) throw new BadRequestException('no such user');
        if (target.role === 'guest') throw new BadRequestException('guests cannot hold entitlements');
        this.grants.grant(id, feature, req.user?.id ?? null);
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action: 'grant', targetUserId: id, detail: feature, ip: req.ip ?? null });
        return { ok: true, features: this.grants.featuresFor(id) };
    }
    /** Revoke a feature. Idempotent; audited. */
    @Post('users/:id/grants/:feature/revoke')
    revokeFeature(@Req() req: AuthedRequest, @Param('id') id: string, @Param('feature') feature: string): { ok: true; features: string[] } {
        this.grants.revoke(id, feature);
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action: 'revoke', targetUserId: id, detail: feature, ip: req.ip ?? null });
        return { ok: true, features: this.grants.featuresFor(id) };
    }

    @Post('users/:id/role')
    role(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { role?: string }): { user: User | null } {
        if (body?.role === 'admin') throw new BadRequestException('admin is granted only via BCE_ADMIN_EMAILS');
        if (body?.role !== 'gm') throw new BadRequestException('role must be gm (demotion only)');
        if (id === req.user?.id) throw new BadRequestException('you cannot demote yourself'); // lockout guard
        const before = this.users.getById(id);
        const user = this.users.setRole(id, 'gm');
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action: 'role_change', targetUserId: id, detail: `${before?.role ?? '?'}→gm`, ip: req.ip ?? null });
        return { user };
    }

    // ── IMPORT-1 Part C — custom-hotspot takedown (DMCA-style response lever) ──
    /** Remove a specific custom hotspot (by id) from a campaign's snapshot. Admin-only (class @UseGuards).
     *  The campaign identifies the owner (campaigns are owner-scoped). Audited as a 'remove'. */
    @Post('campaigns/:campaignId/custom-hotspots/:hotspotId/remove')
    removeCustomHotspot(@Req() req: AuthedRequest, @Param('campaignId') campaignId: string, @Param('hotspotId') hotspotId: string): { removed: boolean } {
        const removed = this.campaigns.removeCustomHotspot(campaignId, hotspotId);
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action: 'remove', targetUserId: null, detail: `custom-hotspot ${hotspotId} @ campaign ${campaignId}`, ip: req.ip ?? null });
        return { removed };
    }

    // ── audit log (read-only; the store is append-only — no edit/delete route exists) ──
    @Get('audit')
    audit(
        @Query('user') user?: string,
        @Query('action') action?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
    ): AuditEntry[] {
        return this.users.listAudit({
            user: user || undefined,
            action: (action as AuditAction) || undefined,
            from: from ? Number(from) : undefined,
            to: to ? Number(to) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }

    private guardSelf(req: AuthedRequest, id: string): void {
        if (id === req.user?.id) throw new BadRequestException('you cannot do this to your own account');
    }
    private mutate(req: AuthedRequest, id: string, action: AuditAction, fn: () => User | null): { user: User | null } {
        const user = fn();
        this.users.recordAudit({ actorUserId: req.user?.id ?? null, action, targetUserId: id, detail: user?.email ?? null, ip: req.ip ?? null });
        return { user };
    }
}
