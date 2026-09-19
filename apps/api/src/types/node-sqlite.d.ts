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
