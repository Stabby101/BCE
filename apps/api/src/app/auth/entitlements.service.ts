import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';

const CREATE = `CREATE TABLE IF NOT EXISTS feature_grants (
  userId    TEXT NOT NULL,
  feature   TEXT NOT NULL,
  grantedBy TEXT,
  grantedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, feature)
);`;

@Injectable()
export class EntitlementsService implements OnModuleInit {
    private readonly log = new Logger('EntitlementsService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath());
        this.db.exec(CREATE);
        this.log.log('feature_grants store ready');
    }

    /** Every feature granted to a user (the /me entitlements[] source). */
    featuresFor(userId: string | null | undefined): string[] {
        if (!userId) return [];
        const rows = this.db.prepare('SELECT feature FROM feature_grants WHERE userId = ? ORDER BY feature').all(userId) as { feature: string }[];
        return rows.map((r) => r.feature);
    }

    has(userId: string | null | undefined, feature: string): boolean {
        if (!userId) return false;
        return !!this.db.prepare('SELECT 1 FROM feature_grants WHERE userId = ? AND feature = ?').get(userId, feature);
    }

    /** Idempotent grant (INSERT OR IGNORE — re-granting is a no-op). */
    grant(userId: string, feature: string, grantedBy: string | null): void {
        this.db.prepare('INSERT OR IGNORE INTO feature_grants (userId, feature, grantedBy, grantedAt) VALUES (?, ?, ?, ?)')
            .run(userId, feature, grantedBy, Date.now());
    }

    /** Idempotent revoke. */
    revoke(userId: string, feature: string): void {
        this.db.prepare('DELETE FROM feature_grants WHERE userId = ? AND feature = ?').run(userId, feature);
    }

    /** The whole (tiny) table — the admin console renders the directory in one call. */
    all(): { userId: string; feature: string; grantedBy: string | null; grantedAt: number }[] {
        return this.db.prepare('SELECT userId, feature, grantedBy, grantedAt FROM feature_grants ORDER BY userId, feature').all() as never;
    }
}
