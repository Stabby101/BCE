import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService ', () => {
    let dir: string;
    let svc: EntitlementsService;
    const prev = process.env.BCE_DB_PATH;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'bce-ent-'));
        process.env.BCE_DB_PATH = join(dir, 'test.db');
        svc = new EntitlementsService();
        svc.onModuleInit();
    });
    afterAll(() => {
        process.env.BCE_DB_PATH = prev;
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ }
    });

    it('starts empty; null/undefined users have nothing', () => {
        expect(svc.featuresFor('usr-a')).toEqual([]);
        expect(svc.featuresFor(null)).toEqual([]);
        expect(svc.has(undefined, 'odm')).toBe(false);
    });

    it('grant → has/featuresFor; re-grant is idempotent', () => {
        svc.grant('usr-a', 'odm', 'usr-admin');
        svc.grant('usr-a', 'odm', 'usr-admin'); // no throw, no dup
        expect(svc.has('usr-a', 'odm')).toBe(true);
        expect(svc.featuresFor('usr-a')).toEqual(['odm']);
        expect(svc.has('usr-b', 'odm')).toBe(false);
    });

    it('multiple features sort; all() carries grant metadata', () => {
        svc.grant('usr-a', 'beta-x', null);
        expect(svc.featuresFor('usr-a')).toEqual(['beta-x', 'odm']);
        const rows = svc.all();
        expect(rows.length).toBe(2);
        expect(rows.find((r) => r.feature === 'odm')?.grantedBy).toBe('usr-admin');
        expect(rows.every((r) => r.grantedAt > 0)).toBe(true);
    });

    it('revoke removes exactly the named grant; re-revoke is idempotent', () => {
        svc.revoke('usr-a', 'odm');
        svc.revoke('usr-a', 'odm');
        expect(svc.has('usr-a', 'odm')).toBe(false);
        expect(svc.featuresFor('usr-a')).toEqual(['beta-x']);
    });
});
