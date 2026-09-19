import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';

/** The holder: an account + the device it holds on. `deviceId` null = a legacy account-level row (the migration window). */
export interface WriterHolder { userId: string; deviceId: string | null }

/** The pure write decision: may this `{ userId, deviceId }` PERSIST this campaign? Admin always (support/break-glass).
 *  Otherwise ONLY the holder DEVICE writes: no holder ⇒ nobody (the take happens at join / on the first write — Q1);
 *  the holder account on another device ⇒ no; a request with NO device id (a cached bundle) ⇒ no, from day one
 *  (ruling 8 — the version banner prompts the reload); a legacy account-level row (device null) ⇒ any device of
 *  that account. Pure → unit-testable in isolation. */
export function writerDecision(input: { userId: string | null | undefined; deviceId?: string | null; ownerId: string | null; holder: WriterHolder | null; admin: boolean }): boolean {
    if (input.admin) return true;
    if (!input.userId || !input.deviceId || !input.holder) return false; // no device id (a cached bundle) → refused from day one (ruling 8)
    if (input.holder.userId !== input.userId) return false;
    if (input.holder.deviceId == null) return true; // a legacy account-level row — any DEVICE of that account (the migration window)
    return input.deviceId === input.holder.deviceId;
}

/** Where the baton goes when the holder DEVICE has left the room and the grace has expired (ruling 3):
 *  (a) another CONNECTED device of the same account → (b) a connected OWNER device → (c) nobody (null: released;
 *  the next owner device to join takes it). `connected` = the GM-app devices with a live socket in the room. Pure. */
export function writerFallbackDecision(input: { holder: { userId: string; deviceId: string | null }; ownerId: string | null; connected: readonly { userId: string; deviceId: string }[] }): { userId: string; deviceId: string } | null {
    const same = input.connected.find((d) => d.userId === input.holder.userId && d.deviceId !== input.holder.deviceId);
    if (same) return { userId: same.userId, deviceId: same.deviceId };
    if (input.ownerId != null) {
        const own = input.connected.find((d) => d.userId === input.ownerId && !(d.userId === input.holder.userId && d.deviceId === input.holder.deviceId));
        if (own) return { userId: own.userId, deviceId: own.deviceId };
    }
    return null; // never the device that left, even if a stale list still names it
}

@Injectable()
export class WriterTokenService implements OnModuleInit {
    private readonly log = new Logger('WriterTokenService');
    private db!: DatabaseSync;
    // in-memory mirror, boot-loaded — read on every ODM write. Key = campaignId → the EXPLICIT holder.
    private readonly holders = new Map<string, { holderId: string; deviceId: string | null; at: number }>();

    onModuleInit(): void {
        this.db = openDb(dbPath());
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS writer_token (
                campaignId TEXT NOT NULL PRIMARY KEY,
                holderId TEXT NOT NULL,
                at INTEGER
            );`,
        );
        // P5 — the additive device column (idempotent; a pre-existing table gains it, its rows read as NULL = account-level)
        const cols = (this.db.prepare('PRAGMA table_info(writer_token)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('deviceId')) this.db.exec('ALTER TABLE writer_token ADD COLUMN deviceId TEXT');
        for (const r of this.db.prepare('SELECT campaignId, holderId, deviceId, at FROM writer_token').all() as Record<string, unknown>[]) {
            this.holders.set(String(r['campaignId']), { holderId: String(r['holderId']), deviceId: r['deviceId'] == null ? null : String(r['deviceId']), at: Number(r['at']) || 0 });
        }
        this.log.log('writer-token store ready');
    }

    /** The EXPLICIT holder of a campaign — `{ userId, deviceId }` — or null (nobody holds it; the next owner device takes it). */
    holderOf(campaignId: string): WriterHolder | null {
        const h = this.holders.get(campaignId);
        return h ? { userId: h.holderId, deviceId: h.deviceId } : null;
    }

    /** Hand the baton to a holder DEVICE (idempotent replace). The gateway / upsert restrict WHO may call this. */
    hand(campaignId: string, holder: { userId: string; deviceId: string }, at: number): void {
        this.db
            .prepare('INSERT INTO writer_token (campaignId, holderId, deviceId, at) VALUES (?, ?, ?, ?) ON CONFLICT(campaignId) DO UPDATE SET holderId = excluded.holderId, deviceId = excluded.deviceId, at = excluded.at')
            .run(campaignId, holder.userId, holder.deviceId, at);
        this.holders.set(campaignId, { holderId: holder.userId, deviceId: holder.deviceId, at });
    }

    /** Release the baton (delete the row — nobody holds it; the next owner device to join takes it). Idempotent. */
    release(campaignId: string): void {
        this.db.prepare('DELETE FROM writer_token WHERE campaignId = ?').run(campaignId);
        this.holders.delete(campaignId);
    }

    /** The campaigns this account holds (read-only) — on THIS device when `deviceId` is given (a legacy account-level
     *  row matches any device of the account). The gateway's disconnect path asks this first, then starts the grace
     *  only for the rooms the device has truly LEFT. */
    heldBy(userId: string, deviceId?: string | null): string[] {
        const held: string[] = [];
        for (const [campaignId, h] of this.holders) {
            if (h.holderId !== userId) continue;
            if (deviceId !== undefined && h.deviceId != null && h.deviceId !== deviceId) continue;
            held.push(campaignId);
        }
        return held;
    }

    /** Release every campaign this account holds (any device). Returns the set it actually released. */
    releaseHeldBy(userId: string): string[] {
        const freed = this.heldBy(userId);
        for (const campaignId of freed) this.release(campaignId);
        return freed;
    }
}
