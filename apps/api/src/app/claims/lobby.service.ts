import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';

export interface LobbyPlayer {
    token: string;
    name: string;
    side: string; // 'BLUFOR' | 'OPFOR' (free string — sides are social signals this slice)
    joinedAt: number;
    connected: boolean;
    sidePref?: string | null;
    pendingPhase?: number; // REBASE-1 P3 item 1: this device's UN-ENDED-pick count this phase (EPHEMERAL, like `connected`; never persisted)
}

@Injectable()
export class LobbyService implements OnModuleInit {
    private readonly log = new Logger('LobbyService');
    private db!: DatabaseSync;
    // must not survive a host restart (a stale "connected:true" would lie). campaignId → Set of live tokens.
    // The lobby ROW stays durable (the roster survives a reconnect); only the green/red dot is ephemeral.
    private readonly live = new Map<string, Set<string>>();
    // REBASE-1 P3 item 1 — per-token UN-ENDED-PHASE pick count, IN-MEMORY (never persisted, like `live`): a transient
    // per-phase signal that feeds the GM's "who hasn't ended their phase" view. A stale count must not survive a restart.
    private readonly pending = new Map<string, Map<string, number>>();

    private liveSet(campaignId: string): Set<string> {
        let s = this.live.get(campaignId);
        if (!s) { s = new Set<string>(); this.live.set(campaignId, s); }
        return s;
    }
    private pendingMap(campaignId: string): Map<string, number> {
        let m = this.pending.get(campaignId);
        if (!m) { m = new Map<string, number>(); this.pending.set(campaignId, m); }
        return m;
    }

    onModuleInit(): void {
        this.db = openDb(dbPath());
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
        const cols = this.db.prepare('PRAGMA table_info(lobby)').all() as { name: string }[];
        if (!cols.some((c) => c.name === 'sidePref')) this.db.exec('ALTER TABLE lobby ADD COLUMN sidePref TEXT');
        this.log.log('lobby store ready');
    }

    list(campaignId: string): LobbyPlayer[] {
        const rows = this.db.prepare('SELECT token, name, side, joinedAt, sidePref FROM lobby WHERE campaignId = ? ORDER BY joinedAt ASC').all(campaignId) as Record<string, unknown>[];
        const live = this.live.get(campaignId);
        return rows.map((r) => {
            const token = String(r['token']);
            return { token, name: String(r['name'] ?? ''), side: String(r['side'] ?? 'BLUFOR'), joinedAt: Number(r['joinedAt']) || 0, connected: live?.has(token) ?? false, sidePref: r['sidePref'] == null ? null : String(r['sidePref']), pendingPhase: this.pending.get(campaignId)?.get(token) ?? 0 };
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
        this.liveSet(campaignId).add(token);
        return this.list(campaignId);
    }

    setConnected(campaignId: string, token: string, connected: boolean): LobbyPlayer[] {
        if (connected) this.liveSet(campaignId).add(token);
        else { this.live.get(campaignId)?.delete(token); this.pending.get(campaignId)?.delete(token); } // REBASE-1 P3 item 1: a gone device has no pending picks
        return this.list(campaignId);
    }

    /** REBASE-1 P3 item 1 — this device's UN-ENDED-pick count this phase (EPHEMERAL). count 0 clears it. Fresh roster. */
    setPending(campaignId: string, token: string, count: number): LobbyPlayer[] {
        const m = this.pendingMap(campaignId);
        if (count > 0) m.set(token, count); else m.delete(token);
        return this.list(campaignId);
    }

    /** GM reassigns a player's side. */
    reassign(campaignId: string, token: string, side: string): LobbyPlayer[] {
        this.db.prepare('UPDATE lobby SET side = ? WHERE campaignId = ? AND token = ?').run(side, campaignId, token);
        return this.list(campaignId);
    }

    setSidePref(campaignId: string, token: string, pref: string | null): LobbyPlayer[] {
        this.db.prepare('UPDATE lobby SET sidePref = ? WHERE campaignId = ? AND token = ?').run(pref, campaignId, token);
        return this.list(campaignId);
    }

    /** A player leaves, or the GM kicks (token removed; ROLE-001 — re-join is possible, the room is trusted). */
    remove(campaignId: string, token: string): LobbyPlayer[] {
        this.db.prepare('DELETE FROM lobby WHERE campaignId = ? AND token = ?').run(campaignId, token);
        this.live.get(campaignId)?.delete(token);
        this.pending.get(campaignId)?.delete(token); // REBASE-1 P3 item 1: and the pending-picks bit
        return this.list(campaignId);
    }
}
