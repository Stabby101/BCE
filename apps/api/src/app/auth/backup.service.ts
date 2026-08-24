/*
 * BCE ENGINE — DIRECTIVE-HARDEN-7 A1: the off-box DB export. `VACUUM INTO` writes a CONSISTENT single-file
 * snapshot of the whole host DB (all tables) to a temp file — never a raw byte-copy of the live file (which,
 * under WAL + concurrent writes, could be torn). The admin route streams that temp file and deletes it.
 * This is the one protection Railway's volume backups don't give: they live WITH the volume, so a volume
 * delete / account loss takes them too; an admin can pull an off-box copy here any time. AdminGuard-gated.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb } from '../open-db';
import { dbPath } from '../db-path';

@Injectable()
export class BackupService implements OnModuleInit {
    private readonly log = new Logger('BackupService');
    private db!: DatabaseSync;

    onModuleInit(): void {
        this.db = openDb(dbPath()); // its own handle to the shared host file (read-mostly; VACUUM on demand)
    }

    /** Write a consistent snapshot to a fresh temp file and return its path. The caller streams it, then deletes
     *  it. VACUUM INTO fails if the target exists, so the randomised name guarantees a clean write. */
    exportToTemp(): string {
        const out = join(tmpdir(), `bce-export-${Date.now()}-${randomUUID().slice(0, 8)}.db`).split('\\').join('/');
        this.db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
        this.log.log(`export snapshot written to a temp file (${out})`);
        return out;
    }
}
