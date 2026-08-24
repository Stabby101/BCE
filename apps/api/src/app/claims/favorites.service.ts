/*
 * BCE ENGINE — per-player FAVORITES (DIRECTIVE-048 phase C). A player's starred unit/pilot for quick
 * reference on the single-screen surface: {playerId -> instanceId/pilotId}, campaign-persistent. Host-
 * authoritative + durable (DATA-002 — the client is a cache, never the system of record), keyed
 * (campaignId, token). Mirrors ClaimsService/LobbyService 1:1 (own node:sqlite handle, dedicated
 * table). Per-player (no fan needed) — set + sync-own over the D-042 socket; the map exists host-side
 * for a later GM view. instanceId/pilotId are opaque ids; the host never interprets them.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { dbPath } from '../db-path';

export interface Favorite {
    instanceId: string | null;
    pilotId: string | null;
}

@Injectable()
export class FavoritesService implements OnModuleInit {
    private readonly log = new Logger('FavoritesService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS favorites (
                campaignId TEXT NOT NULL,
                token TEXT NOT NULL,
                instanceId TEXT,
                pilotId TEXT,
                at INTEGER,
                PRIMARY KEY (campaignId, token)
            );`,
        );
        this.log.log('favorites store ready');
    }

    get(campaignId: string, token: string): Favorite {
        const row = this.db.prepare('SELECT instanceId, pilotId FROM favorites WHERE campaignId = ? AND token = ?').get(campaignId, token) as Record<string, unknown> | undefined;
        return { instanceId: (row?.['instanceId'] as string) ?? null, pilotId: (row?.['pilotId'] as string) ?? null };
    }

    set(campaignId: string, token: string, instanceId: string | null, pilotId: string | null, at: number): Favorite {
        this.db
            .prepare(`INSERT INTO favorites (campaignId, token, instanceId, pilotId, at) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(campaignId, token) DO UPDATE SET instanceId = excluded.instanceId, pilotId = excluded.pilotId, at = excluded.at`)
            .run(campaignId, token, instanceId ?? null, pilotId ?? null, at);
        return this.get(campaignId, token);
    }
}
