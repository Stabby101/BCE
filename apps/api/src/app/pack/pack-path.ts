import { resolve } from 'node:path';

export function packDir(): string {
    return process.env.BCE_PACK_DIR || resolve(process.cwd(), 'packs');
}
