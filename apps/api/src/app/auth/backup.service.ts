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
