/**
 * SqlDriver backed by the Tauri SQL plugin.
 *
 * Reads and single writes go through the plugin. Batches go through the
 * `sql_batch` command instead, because the plugin runs statements over a
 * connection pool with no transaction support: BEGIN and COMMIT issued as
 * separate calls can land on different connections, which would silently break
 * atomicity for imports and migrations.
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { SqlDriver, SqlParam, Statement } from "./driver";
import { createLogger } from "../lib/log";

const log = createLogger("db");

/** Stored under the OS application data directory for this bundle identifier. */
export const DATABASE_FILE = "bookee.db";
const CONNECTION_STRING = `sqlite:${DATABASE_FILE}`;

export class TauriSqlDriver implements SqlDriver {
  private constructor(
    private readonly db: Database,
    private readonly connectionString: string,
  ) {}

  static async connect(connectionString = CONNECTION_STRING): Promise<TauriSqlDriver> {
    const db = await Database.load(connectionString);
    const driver = new TauriSqlDriver(db, connectionString);

    // WAL keeps reads from blocking during an import.
    await driver.execute("PRAGMA journal_mode = WAL");
    await driver.assertForeignKeys();
    return driver;
  }

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.select<T[]>(sql, params);
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    await this.db.execute(sql, params);
  }

  async batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    await invoke("sql_batch", {
      db: this.connectionString,
      statements: statements.map(({ sql, params = [] }) => ({ sql, params })),
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * sqlx enables foreign keys by default for SQLite, but the guarantee matters
   * enough here that it is checked rather than assumed. The result is surfaced
   * in Diagnostics.
   */
  async assertForeignKeys(): Promise<boolean> {
    const rows = await this.select<{ foreign_keys: number }>("PRAGMA foreign_keys");
    const enabled = rows[0]?.foreign_keys === 1;
    if (!enabled) {
      log.warn("foreign keys are not enabled on this connection");
    }
    return enabled;
  }
}
