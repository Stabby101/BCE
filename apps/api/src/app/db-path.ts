import { resolve } from 'node:path';

export function dbPath(): string {
    return process.env.BCE_DB_PATH || resolve(process.cwd(), 'apps/api/.data/campaigns.db');
}
