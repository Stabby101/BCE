/*
 * DIRECTIVE-ODM-1 Phase 1 — entitlement-guarded PACK serving. Pack data is server-side truth (never bundled
 * into the client, never in the public export); only an entitled GM (or an admin, or a dev/LAN single-tenant
 * host) can read it. Session players never touch these endpoints — pack content they may see rides the normal
 * campaign snapshot fan (the ruled SNAPSHOT-FAN model), so the entitlement boundary is exactly "who can pull
 * raw pack files".
 *
 * NOT @Public — the global ApprovedGmGuard applies first (when auth is on, an approved session is required
 * before the per-pack entitlement check below even runs). File access is whitelisted + path-jailed.
 */
import { Controller, ForbiddenException, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { AuthService } from '../auth/auth.service';
import { EntitlementsService } from '../auth/entitlements.service';
import type { AuthedRequest } from '../auth/auth.types';
import { packDir } from './pack-path';

const PACK_ID = /^[a-z0-9-]{1,32}$/;      // 'odm' — an open namespace of pack slugs
const FILE_NAME = /^[a-z0-9._-]{1,64}$/i; // flat files only — no separators, jailed below anyway

@Controller('pack')
export class PackController {
    constructor(private readonly grants: EntitlementsService) {}

    /** PM RULING (ODM-2 review, 2026-08-22): opfor packets are HOSTED-ENTITLED-ONLY. Permissive dev/LAN mode
     *  serves package/fragord/doctrine as ruled, but NEVER opfor — the player-peek cheat is exactly what the
     *  two-packet split prevents (the only LAN table holding ODM content is the author's own); LAN GMs print
     *  the opfor packet via tools/odm-docx/build.py instead. Hosted (auth ON) keeps the normal entitlement path. */
    private assertOpforServable(name: string): void {
        if (!AuthService.authRequired() && /^opfor/i.test(name)) {
            throw new ForbiddenException('OPFOR packets serve only on a hosted, entitled session. LAN tables: print via the build script.');
        }
    }

    /** admin ∨ granted ∨ dev/LAN(single-tenant). Guests can hold no grants → naturally refused. */
    private assertEntitled(req: AuthedRequest, packId: string): void {
        if (!AuthService.authRequired()) return; // dev/LAN — permissive, consistent with viewer()/the pack gate
        const user = req.user;
        if (user?.role === 'admin') return;
        if (user && this.grants.has(user.id, packId)) return;
        throw new ForbiddenException('This content requires a pack entitlement.');
    }

    /** Resolve a pack-relative path from PRE-VALIDATED segments (each already regex-whitelisted — no separator
     *  can enter a segment), then jail the resolved result under the pack root as the belt. */
    private filePath(packId: string, segments: string[]): string {
        if (!PACK_ID.test(packId)) throw new NotFoundException();
        const root = resolve(packDir(), packId);
        const full = resolve(root, segments.join(sep));
        if (!full.startsWith(root + sep)) throw new NotFoundException(); // path jail (belt — the whitelists already forbid separators)
        if (!existsSync(full) || !statSync(full).isFile()) throw new NotFoundException();
        return full;
    }

    /** The pack's manifest (a pack-authored index of its files). */
    @Get(':packId/manifest')
    manifest(@Req() req: AuthedRequest, @Param('packId') packId: string, @Res() res: Response): void {
        this.assertEntitled(req, packId);
        const full = this.filePath(packId, ['manifest.json']);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'private, no-store'); // ODM-2 hardening: no shared/disk cache may ever retain pack content
        createReadStream(full).pipe(res);
    }

    /** One pack file by (whitelisted, jailed) name. */
    @Get(':packId/file/:name')
    file(@Req() req: AuthedRequest, @Param('packId') packId: string, @Param('name') name: string, @Res() res: Response): void {
        this.assertEntitled(req, packId);
        this.assertOpforServable(name); // belt — no flat opfor file exists today, but the rule is file-shaped
        if (!FILE_NAME.test(name)) throw new NotFoundException();
        const full = this.filePath(packId, [name]);
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, no-store'); // ODM-2 hardening
        createReadStream(full).pipe(res);
    }

    /** ODM-2 — a mission-packet file (`missions/<mission>/<name>`). Same entitlement + per-segment whitelist +
     *  path jail as the flat route; each segment is validated alone so no separator ever enters a segment.
     *  The opfor packet ships through HERE TOO — the GM view is the only client of this route; session players
     *  never hold pack fetch paths (the snapshot-fan carries player-safe campaign state only). */
    @Get(':packId/missions/:mission/:name')
    missionFile(@Req() req: AuthedRequest, @Param('packId') packId: string, @Param('mission') mission: string, @Param('name') name: string, @Res() res: Response): void {
        this.assertEntitled(req, packId);
        this.assertOpforServable(name); // PM RULING: opfor is hosted-entitled-only
        if (!PACK_ID.test(mission) || !FILE_NAME.test(name)) throw new NotFoundException(); // mission slug shares the pack-slug shape
        const full = this.filePath(packId, ['missions', mission, name]);
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'private, no-store'); // ODM-2 hardening — the opfor packet especially must never sit in a cache
        createReadStream(full).pipe(res);
    }
}
