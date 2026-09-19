import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';

export interface BattleStateRow {
    instanceId: string;
    state: unknown; // MekBay CBTSerializedState — opaque to the host
    at: number;
}

@Injectable()
export class BattleStateService implements OnModuleInit {
    private readonly log = new Logger('BattleStateService');
    private db!: DatabaseSync;
    // state (a restart does not forget that the GM ended the fight). Key = `${campaignId}|${engagementKey}`.
    private readonly closedKeys = new Set<string>();

    onModuleInit(): void {
        this.db = openDb(dbPath());
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS battle_state (
                campaignId TEXT NOT NULL,
                engagementKey TEXT NOT NULL,
                instanceId TEXT NOT NULL,
                state TEXT NOT NULL,
                at INTEGER,
                PRIMARY KEY (campaignId, engagementKey, instanceId)
            );`,
        );
        // to a closed key are refused from then on (claims untouched). Persisted so a restart still refuses.
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS engagement_closed (
                campaignId TEXT NOT NULL,
                engagementKey TEXT NOT NULL,
                closedAt INTEGER,
                PRIMARY KEY (campaignId, engagementKey)
            );`,
        );
        for (const r of this.db.prepare('SELECT campaignId, engagementKey FROM engagement_closed').all() as Record<string, unknown>[]) {
            this.closedKeys.add(`${String(r['campaignId'])}|${String(r['engagementKey'])}`);
        }
        this.log.log('battle-state store ready');
    }

    close(campaignId: string, engagementKey: string, at: number): void {
        this.db
            .prepare('INSERT INTO engagement_closed (campaignId, engagementKey, closedAt) VALUES (?, ?, ?) ON CONFLICT(campaignId, engagementKey) DO NOTHING')
            .run(campaignId, engagementKey, at);
        this.closedKeys.add(`${campaignId}|${engagementKey}`);
    }
    isClosed(campaignId: string, engagementKey: string): boolean {
        return this.closedKeys.has(`${campaignId}|${engagementKey}`);
    }

    /** Current battle state for an engagement (reconnect/late-join resync). */
    list(campaignId: string, engagementKey: string): BattleStateRow[] {
        const rows = this.db
            .prepare('SELECT instanceId, state, at FROM battle_state WHERE campaignId = ? AND engagementKey = ?')
            .all(campaignId, engagementKey) as Record<string, unknown>[];
        return rows.map((r) => ({
            instanceId: String(r['instanceId']),
            state: this.parse(r['state']),
            at: Number(r['at']) || 0,
        }));
    }

    /** Upsert one instance's live battle state (the host record for the live channel). */
    set(campaignId: string, engagementKey: string, instanceId: string, state: unknown, at: number): void {
        this.db
            .prepare(`INSERT INTO battle_state (campaignId, engagementKey, instanceId, state, at)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(campaignId, engagementKey, instanceId)
                      DO UPDATE SET state = excluded.state, at = excluded.at`)
            .run(campaignId, engagementKey, instanceId, JSON.stringify(state ?? null), at);
    }

    private parse(v: unknown): unknown {
        try { return JSON.parse(String(v)); } catch { return null; }
    }
}
