import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';
import type { SeatRole } from './odm-seats';

/** One seat change. The shape is the intent ledger's (apps/api odm-ledger.ts `OdmLedgerEntry`) + `id` + `role`, so the
 *  dashboard merges the two lists into one view without translation. `field` is always 'seat', `outcome` always 'applied'
 *  (a refused claim changes nothing and is not a seat change). */
export interface SeatLedgerEntry {
    id: number;
    ts: number;
    actor: string;
    actorKey: string;
    seat: string;
    seatLabel: string;
    field: 'seat';
    was: string | null;
    now: string | null;
    verb: 'seat' | 'unseat' | 'claim' | 'release';
    outcome: 'applied';
    role: SeatRole;
}

/** The fan carries the newest tail only (the DB is the record; the view shows the newest 200 of the merge). */
export const SEAT_LEDGER_FAN = 100;

@Injectable()
export class SeatLedgerService implements OnModuleInit {
    private readonly log = new Logger('SeatLedgerService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath());
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS seat_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaignId TEXT NOT NULL,
                ts INTEGER NOT NULL,
                verb TEXT NOT NULL,
                instanceId TEXT NOT NULL,
                seatLabel TEXT,
                wasName TEXT,
                nowName TEXT,
                actor TEXT NOT NULL,
                actorKey TEXT NOT NULL,
                role TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS seat_ledger_campaign ON seat_ledger (campaignId, id);`,
        );
        this.log.log('seat-ledger store ready');
    }

    /** Append one seat change (server clock, server-derived actor). Returns the stored entry. */
    record(campaignId: string, e: Omit<SeatLedgerEntry, 'id' | 'field' | 'outcome'>): SeatLedgerEntry {
        const r = this.db
            .prepare('INSERT INTO seat_ledger (campaignId, ts, verb, instanceId, seatLabel, wasName, nowName, actor, actorKey, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(campaignId, e.ts, e.verb, e.seat, e.seatLabel, e.was, e.now, e.actor, e.actorKey, e.role);
        return { id: Number(r.lastInsertRowid), field: 'seat', outcome: 'applied', ...e };
    }

    /** The newest `limit` entries of a campaign, OLDEST FIRST (the ledger's natural order — the view reverses). */
    list(campaignId: string, limit = SEAT_LEDGER_FAN): SeatLedgerEntry[] {
        const rows = this.db
            .prepare('SELECT id, ts, verb, instanceId, seatLabel, wasName, nowName, actor, actorKey, role FROM seat_ledger WHERE campaignId = ? ORDER BY id DESC LIMIT ?')
            .all(campaignId, limit) as Record<string, unknown>[];
        return rows.reverse().map((r) => ({
            id: Number(r['id']), ts: Number(r['ts']) || 0, verb: String(r['verb']) as SeatLedgerEntry['verb'], seat: String(r['instanceId']), seatLabel: String(r['seatLabel'] ?? ''),
            was: r['wasName'] == null ? null : String(r['wasName']), now: r['nowName'] == null ? null : String(r['nowName']),
            actor: String(r['actor']), actorKey: String(r['actorKey']), role: String(r['role']) as SeatRole, field: 'seat', outcome: 'applied',
        }));
    }

    /** How many entries a campaign has (the harness's exactly-one accounting). */
    count(campaignId: string): number {
        const r = this.db.prepare('SELECT COUNT(*) AS n FROM seat_ledger WHERE campaignId = ?').get(campaignId) as { n: number };
        return r.n;
    }

    purge(campaignId: string): void {
        this.db.prepare('DELETE FROM seat_ledger WHERE campaignId = ?').run(campaignId);
    }
}
