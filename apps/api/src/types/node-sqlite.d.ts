/*
 * BCE DIRECTIVE-041 — ambient types for node:sqlite.
 * The Node 24 runtime ships node:sqlite (verified flag-free on 24.14.1), but this workspace's
 * @types/node is pinned at 20.x, which predates the declarations (added in @types/node 22.5+).
 * Rather than bump @types/node across the whole monorepo (pinned dep, type churn), declare the
 * minimal surface the host record uses. Mirrors the real API. Remove when @types/node reaches 22.5+.
 */
declare module 'node:sqlite' {
    interface StatementResultingChanges {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
    }
    export class StatementSync {
        all(...params: unknown[]): unknown[];
        get(...params: unknown[]): unknown;
        run(...params: unknown[]): StatementResultingChanges;
    }
    export interface DatabaseSyncOptions {
        open?: boolean;
        readOnly?: boolean;
        enableForeignKeyConstraints?: boolean;
    }
    export class DatabaseSync {
        constructor(path: string, options?: DatabaseSyncOptions);
        exec(sql: string): void;
        prepare(sql: string): StatementSync;
        close(): void;
    }
}
