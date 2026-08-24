/* BCE ENGINE (D-041/D-042) — the single host-record DB path. Campaigns + claims share one
 * node:sqlite file (the synchronous API serializes writes on the event loop, so separate
 * DatabaseSync handles to the same file don't interleave). Override with BCE_DB_PATH. */
import { resolve } from 'node:path';

export function dbPath(): string {
    return process.env.BCE_DB_PATH || resolve(process.cwd(), 'apps/api/.data/campaigns.db');
}
