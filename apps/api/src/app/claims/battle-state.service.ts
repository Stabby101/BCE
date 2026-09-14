/*
 * BCE ENGINE — the per-instance BATTLE STATE store (DIRECTIVE-048 phase B). The host-authoritative
 * live battle state (DATA-001): each deployed/OpFor 'Mech's serialized armor/internal/crit/ammo/heat,
 * keyed (campaignId, engagementKey, instanceId). A player edits its claimed sheet -> the edit lands
 * here and fans to the room over the D-042 socket, so every tablet + the GM update live. Mirrors
 * ClaimsService 1:1 — its OWN node:sqlite handle to the shared host file, a DEDICATED table (NOT the
 * campaign snapshot blob → no version churn, no persistCurrent race). The state is opaque JSON to the
 * host (MekBay's CBTSerializedState); the host never interprets it — it stores + fans + resyncs.
 * Heat rides the live fan (shown live) but the CLIENT neutralizes it before persisting to the snapshot
 * (D-030 live-only-heat) — the host stores whatever the client sent for the live channel.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
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
    // ORDER-4 H18 — CLOSED engagements, in memory (the per-write check is a Set lookup) AND persisted beside the battle
    // state (a restart does not forget that the GM ended the fight). Key = `${campaignId}|${engagementKey}`.
    private readonly closedKeys = new Set<string>();

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
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
        // ORDER-4 H18 — the engagement CLOSE mark: the GM's resolve tells the server the fight is over; battle writes
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

    /** ORDER-4 H18 — mark an engagement CLOSED (idempotent; the first closedAt is kept). */
    close(campaignId: string, engagementKey: string, at: number): void {
        this.db
            .prepare('INSERT INTO engagement_closed (campaignId, engagementKey, closedAt) VALUES (?, ?, ?) ON CONFLICT(campaignId, engagementKey) DO NOTHING')
            .run(campaignId, engagementKey, at);
        this.closedKeys.add(`${campaignId}|${engagementKey}`);
    }
    /** ORDER-4 H18 — is this engagement closed? (a Set lookup — read on every battle write) */
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
