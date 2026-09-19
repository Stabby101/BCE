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
