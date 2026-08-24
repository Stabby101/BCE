/*
 * BCE ENGINE — the player LOBBY (DIRECTIVE-048 phase A). Who has joined the campaign room, their name +
 * side (BLUFOR/OPFOR). Host-authoritative + durable (survives a wifi drop / reconnect — the token is the
 * identity, ROLE-001; the room is the boundary). Mirrors ClaimsService 1:1 — its own node:sqlite handle
 * to the shared host file (the synchronous API serializes writes). The GM lobby reassigns/kicks; a player
 * joins/leaves. No accounts, no server-side role ENFORCEMENT this slice (sides are social + token signals).
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db'; // HARDEN-7 A2 — shared durability-PRAGMA opener
import { dbPath } from '../db-path';

export interface LobbyPlayer {
    token: string;
    name: string;
    side: string; // 'BLUFOR' | 'OPFOR' (free string — sides are social signals this slice)
    joinedAt: number;
    connected: boolean; // HOTFIX-030: live socket presence (ephemeral — see the `live` overlay below)
}

@Injectable()
export class LobbyService implements OnModuleInit {
    private readonly log = new Logger('LobbyService');
    private db!: DatabaseSync;
    // HOTFIX-030 — per-token LIVE presence, deliberately IN-MEMORY (never persisted): a socket-connected bit
    // must not survive a host restart (a stale "connected:true" would lie). campaignId → Set of live tokens.
    // The lobby ROW stays durable (the roster survives a reconnect); only the green/red dot is ephemeral.
    private readonly live = new Map<string, Set<string>>();

    private liveSet(campaignId: string): Set<string> {
        let s = this.live.get(campaignId);
        if (!s) { s = new Set<string>(); this.live.set(campaignId, s); }
        return s;
    }

    onModuleInit(): void {
        this.db = openDb(dbPath()); // HARDEN-7 A2 — shared opener (WAL + busy_timeout + synchronous=NORMAL, asserted)
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS lobby (
                campaignId TEXT NOT NULL,
                token TEXT NOT NULL,
                name TEXT,
                side TEXT,
                joinedAt INTEGER,
                PRIMARY KEY (campaignId, token)
            );`,
        );
        this.log.log('lobby store ready');
    }

    list(campaignId: string): LobbyPlayer[] {
        const rows = this.db.prepare('SELECT token, name, side, joinedAt FROM lobby WHERE campaignId = ? ORDER BY joinedAt ASC').all(campaignId) as Record<string, unknown>[];
        const live = this.live.get(campaignId);
        return rows.map((r) => {
            const token = String(r['token']);
            return { token, name: String(r['name'] ?? ''), side: String(r['side'] ?? 'BLUFOR'), joinedAt: Number(r['joinedAt']) || 0, connected: live?.has(token) ?? false };
        });
    }

    /** A player joins (or re-announces — preserves joinedAt). Marks the token LIVE. Returns the fresh roster. */
    join(campaignId: string, token: string, name: string, side: string, at: number): LobbyPlayer[] {
        const existing = this.db.prepare('SELECT joinedAt FROM lobby WHERE campaignId = ? AND token = ?').get(campaignId, token) as { joinedAt: number } | undefined;
        const joinedAt = existing?.joinedAt ?? at;
        this.db
            .prepare(`INSERT INTO lobby (campaignId, token, name, side, joinedAt) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(campaignId, token) DO UPDATE SET name = excluded.name, side = excluded.side`)
            .run(campaignId, token, name, side, joinedAt);
        this.liveSet(campaignId).add(token); // HOTFIX-030: (re)join = this device's socket is connected
        return this.list(campaignId);
    }

    /** HOTFIX-030 — flip a token's live presence (on socket disconnect → false; a reconnect re-joins → true).
     *  Returns the fresh roster so the gateway can re-fan it to the room. */
    setConnected(campaignId: string, token: string, connected: boolean): LobbyPlayer[] {
        if (connected) this.liveSet(campaignId).add(token);
        else this.live.get(campaignId)?.delete(token);
        return this.list(campaignId);
    }

    /** GM reassigns a player's side. */
    reassign(campaignId: string, token: string, side: string): LobbyPlayer[] {
        this.db.prepare('UPDATE lobby SET side = ? WHERE campaignId = ? AND token = ?').run(side, campaignId, token);
        return this.list(campaignId);
    }

    /** A player leaves, or the GM kicks (token removed; ROLE-001 — re-join is possible, the room is trusted). */
    remove(campaignId: string, token: string): LobbyPlayer[] {
        this.db.prepare('DELETE FROM lobby WHERE campaignId = ? AND token = ?').run(campaignId, token);
        this.live.get(campaignId)?.delete(token); // HOTFIX-030: drop the live bit too
        return this.list(campaignId);
    }
}
