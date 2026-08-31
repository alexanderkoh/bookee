/**
 * SqlDriver backed by node:sqlite, for tests.
 *
 * This is real SQLite with real foreign keys and real transactions, so
 * migrations, constraints and idempotency behave exactly as they do in the
 * app — without needing a Tauri runtime. It lives under tests/ so node:sqlite
 * never reaches the browser bundle.
 */
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlParam, Statement } from "../../src/db/driver";

type BindValue = string | number | null | bigint | Uint8Array;

function toBindValue(param: SqlParam): BindValue {
  if (typeof param === "boolean") return param ? 1 : 0;
  return param;
}

export class NodeSqlDriver implements SqlDriver {
  private readonly db: DatabaseSync;

  constructor(location = ":memory:") {
    this.db = new DatabaseSync(location);
    // Must be set outside any transaction; it is a no-op inside one.
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return statement.all(...params.map(toBindValue)) as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    if (params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.prepare(sql).run(...params.map(toBindValue));
  }

  async batch(statements: Statement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const { sql, params = [] } of statements) {
        if (params.length === 0) {
          this.db.exec(sql);
        } else {
          this.db.prepare(sql).run(...params.map(toBindValue));
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Test helper: assert foreign key enforcement is actually on. */
  foreignKeysEnabled(): boolean {
    const row = this.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number };
    return row?.foreign_keys === 1;
  }
}
