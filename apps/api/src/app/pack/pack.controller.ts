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
        res.setHeader('Cache-Control', 'private, no-store');
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
        res.setHeader('Cache-Control', 'private, no-store');
        createReadStream(full).pipe(res);
    }

    @Get(':packId/missions/:mission/:name')
    missionFile(@Req() req: AuthedRequest, @Param('packId') packId: string, @Param('mission') mission: string, @Param('name') name: string, @Res() res: Response): void {
        this.assertEntitled(req, packId);
        this.assertOpforServable(name);
        if (!PACK_ID.test(mission) || !FILE_NAME.test(name)) throw new NotFoundException(); // mission slug shares the pack-slug shape
        const full = this.filePath(packId, ['missions', mission, name]);
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'private, no-store');
        createReadStream(full).pipe(res);
    }
}
