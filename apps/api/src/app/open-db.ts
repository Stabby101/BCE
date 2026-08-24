/*
 * BCE ENGINE — DIRECTIVE-HARDEN-7 A2: the SHARED DB opener. Every service that holds a node:sqlite handle to
 * the host file opens it through here, so the durability PRAGMAs are applied uniformly:
 *   · journal_mode=WAL       — a crash mid-write can't corrupt the main DB (the WAL is replayed on reopen);
 *                              also lets readers proceed during a write (the 7 handles no longer serialize hard).
 *   · busy_timeout=5000      — a handle that hits a write lock waits up to 5s instead of throwing SQLITE_BUSY.
 *   · synchronous=NORMAL     — the safe+fast pairing WITH WAL (durable across app crashes; a fsync only at
 *                              checkpoint, not every commit) — the standard WAL setting.
 * WAL is a property of the FILE (persisted in its header) so setting it on any handle is idempotent; the
 * busy_timeout + synchronous are per-connection, so every handle must set them — hence the shared opener.
 *
 * FAIL LOUD: if the filesystem rejects WAL (some network/overlay mounts do), journal_mode won't read back
 * 'wal' — we throw at boot rather than run silently in the weaker rollback-journal mode.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string): DatabaseSync {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('PRAGMA synchronous=NORMAL');
    const mode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined)?.journal_mode;
    if (mode?.toLowerCase() !== 'wal') {
        // An in-memory DB can't be WAL — never used for the host file, but keep the guard honest for it.
        if (path !== ':memory:') throw new Error(`openDb: expected journal_mode=wal at ${path}, got '${mode}' — the filesystem may not support WAL`);
    }
    return db;
}
