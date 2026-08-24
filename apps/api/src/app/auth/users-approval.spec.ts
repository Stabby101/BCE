/*
 * DIRECTIVE-LINK-1 policy — new-account approval default, at the UsersService seam (real temp DB, deleted after).
 * Pins: a new OAuth GM is APPROVED by default; PENDING only when BCE_GM_REQUIRES_APPROVAL (passed as the
 * gmRequiresApproval arg); admin email → admin + approved regardless; a returning banned/rejected account is
 * never silently re-approved (the ban path stays intact).
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersService } from './users.service';
import type { OAuthProfile } from './auth.types';

const prof = (id: string, email: string | null = null): OAuthProfile => ({ provider: 'google', providerUserId: id, email, displayName: 'X' });

describe('UsersService.upsert — approval default (LINK-1 policy)', () => {
    let svc: UsersService;
    let dbFile: string;
    let prevPath: string | undefined;

    beforeEach(() => {
        prevPath = process.env.BCE_DB_PATH;
        dbFile = join(tmpdir(), `bce-users-approval-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
        process.env.BCE_DB_PATH = dbFile;
        svc = new UsersService();
        svc.onModuleInit();
    });
    afterEach(() => {
        if (prevPath === undefined) delete process.env.BCE_DB_PATH; else process.env.BCE_DB_PATH = prevPath;
        for (const ext of ['', '-wal', '-shm']) { try { rmSync(dbFile + ext, { force: true }); } catch { /* best-effort */ } }
    });

    it('a NEW OAuth GM is APPROVED by default (flag off)', () => {
        const u = svc.upsert(prof('g1'), false, false);
        expect(u.role).toBe('gm');
        expect(u.status).toBe('approved');
    });

    it('a NEW OAuth GM is PENDING when gmRequiresApproval is on (BCE_GM_REQUIRES_APPROVAL)', () => {
        const u = svc.upsert(prof('g2'), false, true);
        expect(u.role).toBe('gm');
        expect(u.status).toBe('pending');
    });

    it('an admin email → admin + approved regardless of the flag', () => {
        const u = svc.upsert(prof('a1', 'admin@x.test'), true, true);
        expect(u.role).toBe('admin');
        expect(u.status).toBe('approved');
    });

    it('a returning BANNED account is NOT silently re-approved on the next sign-in', () => {
        const u = svc.upsert(prof('b1'), false, false); // approved by default
        svc.setStatus(u.id, 'banned');
        const again = svc.upsert(prof('b1'), false, false); // same identity signs in again
        expect(again.status).toBe('banned'); // the ban survives — moderation stands
    });
});
