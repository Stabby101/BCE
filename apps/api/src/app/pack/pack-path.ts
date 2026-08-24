/*
 * DIRECTIVE-ODM-1 Phase 1 — where server-served pack data lives. Root `packs/` in the PRIVATE repo (Railway
 * runs from the checkout, so cwd-relative repo files exist at runtime — the db-path default's own mechanism);
 * `BCE_PACK_DIR` overrides for tests/other hosts. The public source export NEVER carries it: publish-source
 * is an allowlist (root paths are excluded by default) + 'packs' sits in PRUNE_DIRS (defense in depth).
 */
import { resolve } from 'node:path';

export function packDir(): string {
    return process.env.BCE_PACK_DIR || resolve(process.cwd(), 'packs');
}
