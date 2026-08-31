/**
 * SqlDriver backed by SQLite compiled to WebAssembly.
 *
 * This exists for the browser preview, and it is the first real proof that the
 * SqlDriver seam works: the entire application — repositories, migrations,
 * sync, rules, backup — runs unmodified against it. The same driver is what a
 * future web build would use.
 *
 * In-memory only. The preview is a disposable sandbox, not somewhere to keep
 * a ledger.
 */
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import type { SqlDriver, SqlParam, Statement } from "../db/driver";

type BindValue = string | number | null;

function toBindValue(param: SqlParam): BindValue {
  if (typeof param === "boolean") return param ? 1 : 0;
  return param;
}

export class WasmSqlDriver implements SqlDriver {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<WasmSqlDriver> {
    // The published types deliberately omit init's parameter list, so it is
    // called bare rather than with Emscripten options.
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(":memory:", "c");
    const driver = new WasmSqlDriver(db);
    await driver.execute("PRAGMA foreign_keys = ON");
    return driver;
  }

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.exec({
      sql,
      bind: params.map(toBindValue),
      rowMode: "object",
      returnValue: "resultRows",
    }) as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    this.db.exec({ sql, bind: params.length > 0 ? params.map(toBindValue) : undefined });
  }

  async batch(statements: Statement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const { sql, params = [] } of statements) {
        this.db.exec({ sql, bind: params.length > 0 ? params.map(toBindValue) : undefined });
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
}
