/*
 * BCE ENGINE (DIRECTIVE-041; DEPLOY-002 P2 owner-scoping) — REST for the host record under /api/campaigns.
 * Every read/write/delete is scoped to the authenticated owner: the Viewer is DERIVED SERVER-SIDE from the
 * session (the global ApprovedGmGuard sets req.user) — a client-supplied ownerId is NEVER trusted. Admin
 * (and single-tenant/dev where auth is off) sees all. The catalog is global (separate, @Public).
 * ROUTE ORDER: static `last` routes before `:id` (Express matches /campaigns/last to the pointer).
 */
import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Req } from '@nestjs/common';
import { CampaignsService, type SaveRecord, type Viewer } from './campaigns.service';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../auth/users.service';
import { EntitlementsService } from '../auth/entitlements.service';
import { guestCustomHotspotRefused } from './custom-hotspot-gate';
import { packRefused, snapshotPackId } from './pack-gate';
import type { AuthedRequest } from '../auth/auth.types';

@Controller('campaigns')
export class CampaignsController {
    constructor(
        private readonly svc: CampaignsService,
        private readonly users: UsersService, // DEPLOY-010: operational audit (campaign created) — AuthModule is @Global
        private readonly grants: EntitlementsService, // ODM-1: the pack persistence gate — AuthModule is @Global
    ) {}

    /** The tenant view for this request — server-derived, never from the client body. */
    private viewer(req: AuthedRequest): Viewer {
        if (!AuthService.authRequired()) return { ownerId: null, admin: true }; // dev/single-tenant: unscoped
        const u = req.user; // set by the global ApprovedGmGuard (approved gm/admin)
        return { ownerId: u?.id ?? null, admin: u?.role === 'admin' };
    }

    /** IMPORT-1 Part A — the server-authoritative custom-hotspot gate. Custom hotspots ride in the snapshot
     *  blob, so this save path is the chokepoint: a GUEST persisting a snapshot that carries custom hotspots is
     *  refused (403) and NOTHING is stored. gm/admin (and dev/LAN where auth is off) are unaffected. */
    private assertCustomHotspotsAllowed(req: AuthedRequest, rec: SaveRecord): void {
        if (guestCustomHotspotRefused(req.user?.role, AuthService.authRequired(), rec?.snapshot)) {
            throw new ForbiddenException('Sign in with Google to import your own missions — guest accounts cannot save custom hotspots.');
        }
    }

    /** DIRECTIVE-ODM-1 — the server-authoritative PACK gate (the IMPORT-1 shape): a pack-tagged snapshot
     *  (snapshot.packId) persists only for an admin or an account holding that pack's feature grant. */
    private assertPackAllowed(req: AuthedRequest, rec: SaveRecord): void {
        const packId = snapshotPackId(rec?.snapshot);
        const entitled = !!packId && !!req.user && this.grants.has(req.user.id, packId);
        if (packRefused(req.user?.role, AuthService.authRequired(), entitled, rec?.snapshot)) {
            throw new ForbiddenException('This campaign pack requires an entitlement on your account.');
        }
    }

    // ── the "last" pointer (per-owner) — declared FIRST (static beats :id) ──
    @Get('last')
    getLast(@Req() req: AuthedRequest): { id: string | null } {
        return { id: this.svc.getLast(this.viewer(req)) };
    }
    @Put('last')
    setLast(@Req() req: AuthedRequest, @Body() body: { id: string | null }): { id: string | null } {
        const v = this.viewer(req);
        this.svc.setLast(body?.id ?? null, v);
        return { id: this.svc.getLast(v) };
    }

    // ── collection ──
    @Get()
    list(@Req() req: AuthedRequest): SaveRecord[] {
        return this.svc.list(this.viewer(req));
    }
    @Post()
    create(@Req() req: AuthedRequest, @Body() rec: SaveRecord): SaveRecord {
        this.assertCustomHotspotsAllowed(req, rec); // IMPORT-1: guest cannot persist custom hotspots
        this.assertPackAllowed(req, rec); // ODM-1: pack campaigns need the feature grant
        const v = this.viewer(req);
        // DEPLOY-010: audit a genuinely NEW campaign (gated only — an actor exists) for the admin activity feed.
        const isNew = AuthService.authRequired() && !!req.user && !this.svc.get(rec.id, v);
        const saved = this.svc.upsert(rec, v); // ownerId stamped from the session, not rec
        if (isNew) this.users.recordAudit({ actorUserId: req.user!.id, action: 'campaign_created', targetUserId: req.user!.id, detail: saved.name, ip: req.ip ?? null });
        return saved;
    }

    // ── item ──
    @Get(':id')
    get(@Req() req: AuthedRequest, @Param('id') id: string): SaveRecord {
        const rec = this.svc.get(id, this.viewer(req));
        if (!rec) throw new NotFoundException(`campaign ${id} not found`);
        return rec;
    }
    @Put(':id')
    put(@Req() req: AuthedRequest, @Param('id') id: string, @Body() rec: SaveRecord): SaveRecord {
        this.assertCustomHotspotsAllowed(req, rec); // IMPORT-1: guest cannot persist custom hotspots
        this.assertPackAllowed(req, rec); // ODM-1: pack campaigns need the feature grant
        return this.svc.upsert({ ...rec, id }, this.viewer(req)); // path id wins; owner checked/kept server-side
    }
    @Delete(':id')
    @HttpCode(204)
    remove(@Req() req: AuthedRequest, @Param('id') id: string): void {
        this.svc.remove(id, this.viewer(req));
    }
}
