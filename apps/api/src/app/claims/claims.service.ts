import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';
import { SEAT_KEY } from './odm-seats';

export interface Claim {
    instanceId: string;
    holderName: string;
    holderToken: string;
    at: number;
}

@Injectable()
export class ClaimsService implements OnModuleInit {
    private readonly log = new Logger('ClaimsService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath());
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS claims (
                campaignId TEXT NOT NULL,
                engagementKey TEXT NOT NULL,
                instanceId TEXT NOT NULL,
                holderName TEXT,
                holderToken TEXT,
                at INTEGER,
                PRIMARY KEY (campaignId, engagementKey, instanceId)
            );`,
        );
        this.log.log('claim store ready');
    }

    /** The current claim set for one engagement (the fan-out payload + reconnect resync). */
    list(campaignId: string, engagementKey: string): Claim[] {
        const rows = this.db
            .prepare('SELECT instanceId, holderName, holderToken, at FROM claims WHERE campaignId = ? AND engagementKey = ? ORDER BY at ASC')
            .all(campaignId, engagementKey) as Record<string, unknown>[];
        return rows.map((r) => ({ instanceId: String(r['instanceId']), holderName: String(r['holderName'] ?? ''), holderToken: String(r['holderToken'] ?? ''), at: Number(r['at']) || 0 }));
    }

    seatHolders(campaignId: string): Claim[] {
        const rows = this.db
            .prepare('SELECT engagementKey, instanceId, holderName, holderToken, at FROM claims WHERE campaignId = ? ORDER BY at ASC')
            .all(campaignId) as Record<string, unknown>[];
        const latest = new Map<string, Claim>();
        for (const r of rows) {
            const c: Claim = { instanceId: String(r['instanceId']), holderName: String(r['holderName'] ?? ''), holderToken: String(r['holderToken'] ?? ''), at: Number(r['at']) || 0 };
            if (c.holderToken) latest.set(c.instanceId, c); // ASC by `at` → the last write per unit wins
            // of its `at` (every older claim stays on its own engagement's record, untouched); a later claim re-seats.
            else if (String(r['engagementKey']) === SEAT_KEY) latest.delete(c.instanceId);
        }
        return [...latest.values()];
    }

    /** First-tap claim (upsert — re-claim overwrites the holder; multiple-per-holder allowed). */
    claim(campaignId: string, engagementKey: string, instanceId: string, holderName: string, holderToken: string, at: number): Claim[] {
        this.db
            .prepare(
                `INSERT INTO claims (campaignId, engagementKey, instanceId, holderName, holderToken, at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(campaignId, engagementKey, instanceId) DO UPDATE SET
                   holderName = excluded.holderName, holderToken = excluded.holderToken, at = excluded.at`,
            )
            .run(campaignId, engagementKey, instanceId, holderName, holderToken, at);
        return this.list(campaignId, engagementKey);
    }

    /** Tap-release — back to the GM's hand (unclaimed). No enforcement this slice (ROLE-001 later). */
    release(campaignId: string, engagementKey: string, instanceId: string): Claim[] {
        this.db.prepare('DELETE FROM claims WHERE campaignId = ? AND engagementKey = ? AND instanceId = ?').run(campaignId, engagementKey, instanceId);
        return this.list(campaignId, engagementKey);
    }
}
