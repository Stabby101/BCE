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
    sidePref?: string | null; // GM-1 P2: the player's ADVISORY side preference ('a' | 'b' | null) — GM-only on the wire (redactLobby strips it for other players)
    pendingPhase?: number; // REBASE-1 P3 item 1: this device's UN-ENDED-pick count this phase (EPHEMERAL, like `connected`; never persisted)
}

@Injectable()
export class LobbyService implements OnModuleInit {
    private readonly log = new Logger('LobbyService');
    private db!: DatabaseSync;
    // HOTFIX-030 — per-token LIVE presence, deliberately IN-MEMORY (never persisted): a socket-connected bit
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
        // GM-1 P2 — sidePref column, idempotent for existing DBs (the Railway prod file persists on /data).
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
        this.liveSet(campaignId).add(token); // HOTFIX-030: (re)join = this device's socket is connected
        return this.list(campaignId);
    }

    /** HOTFIX-030 — flip a token's live presence (on socket disconnect → false; a reconnect re-joins → true).
     *  Returns the fresh roster so the gateway can re-fan it to the room. */
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

    /** GM-1 P2 — a player's ADVISORY side preference for the presented hotspot ('a' | 'b' | null = cleared).
     *  Row-scoped like reassign; the join() upsert deliberately never touches it (a re-announce keeps it). */
    setSidePref(campaignId: string, token: string, pref: string | null): LobbyPlayer[] {
        this.db.prepare('UPDATE lobby SET sidePref = ? WHERE campaignId = ? AND token = ?').run(pref, campaignId, token);
        return this.list(campaignId);
    }

    /** A player leaves, or the GM kicks (token removed; ROLE-001 — re-join is possible, the room is trusted). */
    remove(campaignId: string, token: string): LobbyPlayer[] {
        this.db.prepare('DELETE FROM lobby WHERE campaignId = ? AND token = ?').run(campaignId, token);
        this.live.get(campaignId)?.delete(token); // HOTFIX-030: drop the live bit too
        this.pending.get(campaignId)?.delete(token); // REBASE-1 P3 item 1: and the pending-picks bit
        return this.list(campaignId);
    }
}
