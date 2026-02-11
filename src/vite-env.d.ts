/// <reference types="vite/client" />

declare module 'sql.js' {
  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>;
    free(): boolean;
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
  }

  export type { Database };
  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
