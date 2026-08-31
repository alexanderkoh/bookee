import { describe, it, expect } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate, schemaVersion, splitStatements, MigrationError } from "../../src/db/migrator";
import { MIGRATIONS } from "../../src/db/migrations";

interface TableRow {
  name: string;
}

async function migratedDriver(): Promise<NodeSqlDriver> {
  const driver = new NodeSqlDriver();
  await migrate(driver);
  return driver;
}

describe("splitStatements", () => {
  it("strips comments so a semicolon inside one cannot split a statement", () => {
    const statements = splitStatements(`
      -- a comment; with a semicolon
      CREATE TABLE a (id TEXT);
      CREATE TABLE b (id TEXT);
    `);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE a");
    expect(statements[1]).toContain("CREATE TABLE b");
  });
});

describe("migrations", () => {
  it("creates every table in the data model", async () => {
    const driver = await migratedDriver();
    const rows = await driver.select<TableRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = rows.map((r) => r.name);

    for (const table of [
      "app_settings",
      "assets",
      "categories",
      "contact_addresses",
      "contacts",
      "entry_annotations",
      "ledger_entries",
      "rules",
      "schema_migrations",
      "stellar_transactions",
      "sync_issues",
      "tracked_accounts",
      "workspaces",
    ]) {
      expect(names, `missing table ${table}`).toContain(table);
    }
    await driver.close();
  });

  it("records the schema version and is idempotent when run twice", async () => {
    const driver = new NodeSqlDriver();
    const first = await migrate(driver);
    const second = await migrate(driver);

    expect(first).toBe(MIGRATIONS.length);
    expect(second).toBe(MIGRATIONS.length);
    expect(await schemaVersion(driver)).toBe(MIGRATIONS.length);

    const applied = await driver.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );
    expect(applied[0]?.count).toBe(MIGRATIONS.length);
    await driver.close();
  });

  it("enforces foreign keys", async () => {
    const driver = await migratedDriver();
    expect(driver.foreignKeysEnabled()).toBe(true);

    await expect(
      driver.execute(
        `INSERT INTO tracked_accounts
           (id, workspace_id, public_key, network, created_at, updated_at)
         VALUES ('a', 'workspace-does-not-exist', 'GABC', 'public', '2026-01-01', '2026-01-01')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await driver.close();
  });

  it("rolls back a failed batch entirely", async () => {
    const driver = await migratedDriver();
    await expect(
      driver.batch([
        {
          sql: "INSERT INTO workspaces (id, name, reporting_currency, created_at, updated_at) VALUES (?, ?, 'USD', '2026-01-01', '2026-01-01')",
          params: ["ws-1", "Good"],
        },
        { sql: "INSERT INTO workspaces (id, nope) VALUES ('ws-2', 'bad')" },
      ]),
    ).rejects.toThrow();

    const rows = await driver.select<{ count: number }>("SELECT COUNT(*) AS count FROM workspaces");
    expect(rows[0]?.count, "first insert must have rolled back").toBe(0);
    await driver.close();
  });

  it("rejects non-contiguous migration versions", async () => {
    const driver = new NodeSqlDriver();
    await expect(
      migrate(driver, [
        { version: 1, name: "a", sql: "CREATE TABLE a (id TEXT)" },
        { version: 3, name: "c", sql: "CREATE TABLE c (id TEXT)" },
      ]),
    ).rejects.toThrow(MigrationError);
    await driver.close();
  });

  it("enforces the ledger entry dedup constraint", async () => {
    const driver = await migratedDriver();
    const setup = [
      {
        sql: "INSERT INTO workspaces (id, name, reporting_currency, created_at, updated_at) VALUES ('ws', 'W', 'USD', 't', 't')",
      },
      {
        sql: "INSERT INTO assets (id, network, asset_type, display_code, created_at) VALUES ('public:native', 'public', 'native', 'XLM', 't')",
      },
    ];
    await driver.batch(setup);

    const entry = (id: string) => ({
      sql: `INSERT INTO ledger_entries
              (id, workspace_id, network, external_key, source_kind, timestamp,
               movement_type, direction, amount, asset_id, created_at, updated_at)
            VALUES (?, 'ws', 'public', 'op:1', 'payment', 't', 'payment', 'incoming', '1.0000000', 'public:native', 't', 't')`,
      params: [id],
    });

    await driver.batch([entry("e1")]);
    await expect(driver.batch([entry("e2")])).rejects.toThrow(/UNIQUE/i);
    await driver.close();
  });
});
