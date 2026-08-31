/**
 * Schema migration runner.
 *
 * Migrations live in TypeScript rather than being registered with the Tauri SQL
 * plugin's Rust builder, so the schema travels with the domain code and remains
 * usable by a future SQLite-WASM web build.
 *
 * Each migration is applied inside a single transaction together with its
 * schema_migrations row, so a migration either lands completely or not at all.
 */
import type { SqlDriver } from "./driver";
import { MIGRATIONS, type Migration } from "./migrations";
import { createLogger } from "../lib/log";
import { nowIso } from "../lib/ids";

const log = createLogger("db");

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly version?: number,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

interface VersionRow {
  version: number;
}

/**
 * Splits a migration file into individual statements.
 *
 * SQLite's driver executes one statement per call. The schema uses no
 * semicolons inside string literals or triggers, so splitting on ';' at
 * statement level is sufficient; comments are stripped first so a ';' inside a
 * comment cannot split a statement.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => {
      const commentStart = line.indexOf("--");
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function currentVersion(driver: SqlDriver): Promise<number> {
  await driver.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const rows = await driver.select<VersionRow>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
  );
  return rows[0]?.version ?? 0;
}

/** Applies every migration newer than the recorded schema version. */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number> {
  const ordered = migrations.toSorted((a, b) => a.version - b.version);

  ordered.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `Migration versions must be contiguous starting at 1; found ${migration.version} at position ${index + 1}`,
        migration.version,
      );
    }
  });

  const from = await currentVersion(driver);
  const pending = ordered.filter((migration) => migration.version > from);

  if (pending.length === 0) {
    log.debug("schema up to date", { version: from });
    return from;
  }

  for (const migration of pending) {
    log.info("applying migration", { version: migration.version, name: migration.name });
    const statements = splitStatements(migration.sql).map((sql) => ({ sql }));
    try {
      await driver.batch([
        ...statements,
        {
          sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          params: [migration.version, migration.name, nowIso()],
        },
      ]);
    } catch (error) {
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        migration.version,
      );
    }
  }

  const to = ordered[ordered.length - 1]?.version ?? from;
  log.info("migrations complete", { from, to });
  return to;
}

/** Current schema version, for the diagnostics screen. */
export async function schemaVersion(driver: SqlDriver): Promise<number> {
  return currentVersion(driver);
}
