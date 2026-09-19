import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Req } from '@nestjs/common';
import { CampaignsService, type CheckpointInfo, type SaveRecord, type Viewer } from './campaigns.service';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../auth/users.service';
import { EntitlementsService } from '../auth/entitlements.service';
import { guestCustomHotspotRefused, gmOnlyRefused } from './custom-hotspot-gate';
import { packRefused, snapshotPackId } from './pack-gate';
import type { AuthedRequest } from '../auth/auth.types';

@Controller('campaigns')
export class CampaignsController {
    constructor(
        private readonly svc: CampaignsService,
        private readonly users: UsersService, // DEPLOY-010: operational audit (campaign created) — AuthModule is @Global
        private readonly grants: EntitlementsService,
    ) {}

    /** The tenant view for this request — server-derived, never from the client body. */
    private viewer(req: AuthedRequest): Viewer {
        if (!AuthService.authRequired()) return { ownerId: null, admin: true, role: 'admin', features: [] }; // dev/single-tenant: unscoped
        const u = req.user; // set by the global ApprovedGmGuard (approved gm/admin)
        // device. Validated to the mint's alphabet; absent/malformed = no device (a cached bundle) → an ODM write is refused.
        const raw = req.headers?.['x-bce-device'];
        const deviceId = typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
        return { ownerId: u?.id ?? null, admin: u?.role === 'admin', role: u?.role ?? null, features: u ? this.grants.featuresFor(u.id) : [], deviceId };
    }

    private assertCustomHotspotsAllowed(req: AuthedRequest, rec: SaveRecord): void {
        if (guestCustomHotspotRefused(req.user?.role, AuthService.authRequired(), rec?.snapshot)) {
            throw new ForbiddenException('Sign in with Google to import your own missions — guest accounts cannot save custom hotspots.');
        }
    }

    private assertPackAllowed(req: AuthedRequest, rec: SaveRecord): void {
        const packId = snapshotPackId(rec?.snapshot);
        const entitled = !!packId && !!req.user && this.grants.has(req.user.id, packId);
        if (packRefused(req.user?.role, AuthService.authRequired(), entitled, rec?.snapshot)) {
            throw new ForbiddenException('This campaign pack requires an entitlement on your account.');
        }
    }

    private assertGmOnlyAllowed(req: AuthedRequest, rec: SaveRecord): void {
        // carries gmOnly.pilotNotes as the GM of their pack campaign; the pack gate enforces the same grant).
        const packId = snapshotPackId(rec?.snapshot);
        const entitled = !!req.user && (this.grants.has(req.user.id, 'gm-mode') || (!!packId && this.grants.has(req.user.id, packId)));
        if (gmOnlyRefused(req.user?.role, AuthService.authRequired(), entitled, rec?.snapshot)) {
            throw new ForbiddenException('A Game Master session requires the gm-mode entitlement on your account.');
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
        this.assertCustomHotspotsAllowed(req, rec);
        this.assertPackAllowed(req, rec);
        this.assertGmOnlyAllowed(req, rec);
        const v = this.viewer(req);
        // DEPLOY-010: audit a genuinely NEW campaign (gated only — an actor exists) for the admin activity feed.
        const isNew = AuthService.authRequired() && !!req.user && !this.svc.get(rec.id, v);
        // intent for THIS write and is never persisted. Client-supplied and therefore forgeable — see
        // pack-gate.odmSingletonRefused: a data-integrity guard for the user's own account, NOT a security
        // boundary (tenancy is canAccess/ownerId, elsewhere).
        const forceNew = (rec as unknown as { forceNew?: unknown })?.forceNew === true;
        const saved = this.svc.upsert(rec, v, { forceNew }); // ownerId stamped from the session, not rec
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
        this.assertCustomHotspotsAllowed(req, rec);
        this.assertPackAllowed(req, rec);
        this.assertGmOnlyAllowed(req, rec);
        // via PUT (campaign-save-store.put), and a PUT to an id that does not exist IS a create — which is
        // precisely why the guard lives in upsert rather than only on the POST route.
        const forceNew = (rec as unknown as { forceNew?: unknown })?.forceNew === true;
        return this.svc.upsert({ ...rec, id }, this.viewer(req), { forceNew }); // path id wins; owner checked/kept server-side
    }
    @Delete(':id')
    @HttpCode(204)
    remove(@Req() req: AuthedRequest, @Param('id') id: string): void {
        this.svc.remove(id, this.viewer(req));
    }

    @Get(':id/checkpoints')
    listCheckpoints(@Req() req: AuthedRequest, @Param('id') id: string): CheckpointInfo[] {
        return this.svc.listCheckpoints(id, this.viewer(req));
    }
    @Post(':id/pin')
    pin(@Req() req: AuthedRequest, @Param('id') id: string): CheckpointInfo {
        return this.svc.pinCurrent(id, this.viewer(req));
    }
    /** Pin/unpin an existing checkpoint. Unpinning returns it to the 30-day sweep — a decision you cannot
     *  reverse is a trap, not a safeguard. */
    @Post(':id/checkpoints/:cid/pin')
    setPin(@Req() req: AuthedRequest, @Param('id') id: string, @Param('cid') cid: string, @Body() body: { pinned?: unknown }): CheckpointInfo {
        const checkpointId = Number(cid);
        if (!Number.isInteger(checkpointId) || checkpointId < 1) throw new NotFoundException('checkpointId required');
        return this.svc.setCheckpointPinned(id, checkpointId, body?.pinned === true, this.viewer(req));
    }

    @Post(':id/restore')
    restore(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { checkpointId?: number }): SaveRecord {
        const checkpointId = Number(body?.checkpointId);
        if (!Number.isInteger(checkpointId) || checkpointId < 1) throw new NotFoundException('checkpointId required');
        const v = this.viewer(req);
        // The PUT-path belts re-run on the RESTORED content BEFORE the swap: an entitlement revoked since
        // the checkpoint was taken blocks the restore exactly as it would block the save.
        const restored = this.svc.getCheckpointSnapshot(id, checkpointId, v);
        const pseudo = { id, snapshot: restored } as SaveRecord;
        this.assertCustomHotspotsAllowed(req, pseudo);
        this.assertPackAllowed(req, pseudo);
        this.assertGmOnlyAllowed(req, pseudo);
        return this.svc.restoreCheckpoint(id, checkpointId, v);
    }
}
