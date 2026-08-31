/**
 * The database seam.
 *
 * Every SQL statement in the application goes through this interface. Three
 * things depend on it:
 *
 *  - production runs on SQLite via the Tauri SQL plugin (tauri-driver.ts)
 *  - tests run on real SQLite via node:sqlite, with no Tauri runtime
 *  - a future web build can supply a SQLite-WASM driver without the ledger
 *    domain noticing
 *
 * `batch` is not a convenience wrapper. The Tauri SQL plugin pools connections
 * and has no transaction support, so issuing BEGIN/COMMIT as separate execute()
 * calls can spread a "transaction" across different pooled connections and
 * silently lose atomicity. Any write that must be all-or-nothing — importing a
 * page of ledger entries together with its paging cursor, applying a migration,
 * restoring a backup — must use `batch`, never a sequence of `execute` calls.
 */

export type SqlParam = string | number | boolean | null;

export interface Statement {
  sql: string;
  params?: SqlParam[];
}

export interface SqlDriver {
  /** Runs a query and returns typed rows. */
  select<T>(sql: string, params?: SqlParam[]): Promise<T[]>;

  /** Runs a single statement. Not atomic with anything else. */
  execute(sql: string, params?: SqlParam[]): Promise<void>;

  /** Runs every statement inside one transaction. Rolls back entirely on error. */
  batch(statements: Statement[]): Promise<void>;

  close(): Promise<void>;
}

/** Convenience: first row of a query, or undefined. */
export async function selectOne<T>(
  driver: SqlDriver,
  sql: string,
  params?: SqlParam[],
): Promise<T | undefined> {
  const rows = await driver.select<T>(sql, params);
  return rows[0];
}
