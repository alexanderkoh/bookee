/**
 * Smaller repositories: sync issues, the transaction memo cache, and settings.
 */
import type { SqlDriver, Statement } from "../driver";
import type { SqlRow } from "../row";
import type {
  MemoType,
  Network,
  StellarTransactionRecord,
  SyncIssue,
  SyncIssueKind,
} from "../schema";
import { mapStellarTransaction, mapSyncIssue } from "./mappers";
import { newId, nowIso } from "../../lib/ids";

export class SyncIssueRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(workspaceId: string, includeResolved = false): Promise<SyncIssue[]> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT * FROM sync_issues
       WHERE workspace_id = ? ${includeResolved ? "" : "AND resolved = 0"}
       ORDER BY created_at DESC LIMIT 500`,
      [workspaceId],
    );
    return rows.map(mapSyncIssue);
  }

  async count(workspaceId: string): Promise<number> {
    const rows = await this.driver.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_issues WHERE workspace_id = ? AND resolved = 0",
      [workspaceId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Statements for recording issues, so they commit in the same transaction as
   * the page that produced them.
   *
   * Issues are keyed by (workspace, external_id, kind) so retrying a sync
   * updates the existing issue rather than accumulating duplicates.
   */
  buildInsertStatements(
    workspaceId: string,
    trackedAccountId: string | null,
    issues: ReadonlyArray<{
      externalId: string | null;
      kind: SyncIssueKind;
      message: string;
      raw?: unknown;
    }>,
  ): Statement[] {
    const now = nowIso();
    return issues.map((issue) => ({
      sql: `INSERT INTO sync_issues
              (id, workspace_id, tracked_account_id, external_id, kind, message, raw_json, resolved, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM sync_issues
              WHERE workspace_id = ? AND kind = ?
                AND external_id IS ?
            )`,
      params: [
        newId(),
        workspaceId,
        trackedAccountId,
        issue.externalId,
        issue.kind,
        issue.message,
        issue.raw === undefined ? null : JSON.stringify(issue.raw),
        now,
        workspaceId,
        issue.kind,
        issue.externalId,
      ],
    }));
  }

  async resolve(id: string): Promise<void> {
    await this.driver.execute("UPDATE sync_issues SET resolved = 1 WHERE id = ?", [id]);
  }

  /** Clears issues of a kind for a record that has since been imported. */
  async resolveForExternalIds(workspaceId: string, externalIds: readonly string[]): Promise<void> {
    if (externalIds.length === 0) return;
    const placeholders = externalIds.map(() => "?").join(", ");
    await this.driver.execute(
      `UPDATE sync_issues SET resolved = 1
       WHERE workspace_id = ? AND external_id IN (${placeholders})`,
      [workspaceId, ...externalIds],
    );
  }
}

/**
 * Cache of transaction metadata, keyed by hash.
 *
 * Many operations share one transaction, so memos are fetched once per hash
 * rather than once per entry.
 */
export class StellarTransactionRepository {
  constructor(private readonly driver: SqlDriver) {}

  async findMany(network: Network, hashes: readonly string[]): Promise<StellarTransactionRecord[]> {
    if (hashes.length === 0) return [];
    const placeholders = hashes.map(() => "?").join(", ");
    const rows = await this.driver.select<SqlRow>(
      `SELECT * FROM stellar_transactions WHERE network = ? AND hash IN (${placeholders})`,
      [network, ...hashes],
    );
    return rows.map(mapStellarTransaction);
  }

  async knownHashes(network: Network, hashes: readonly string[]): Promise<Set<string>> {
    const found = await this.findMany(network, hashes);
    return new Set(found.map((record) => record.hash));
  }

  buildUpsertStatements(
    network: Network,
    transactions: ReadonlyArray<{
      hash: string;
      memoType: MemoType | null;
      memo: string | null;
      memoBytes: string | null;
      sourceAccount: string | null;
      ledger: number | null;
      createdAt: string | null;
    }>,
  ): Statement[] {
    const fetchedAt = nowIso();
    return transactions.map((transaction) => ({
      sql: `INSERT INTO stellar_transactions
              (network, hash, memo_type, memo, memo_bytes, source_account, ledger, created_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(network, hash) DO UPDATE SET
              memo_type = excluded.memo_type,
              memo = excluded.memo,
              memo_bytes = excluded.memo_bytes,
              fetched_at = excluded.fetched_at`,
      params: [
        network,
        transaction.hash,
        transaction.memoType,
        transaction.memo,
        transaction.memoBytes,
        transaction.sourceAccount,
        transaction.ledger,
        transaction.createdAt,
        fetchedAt,
      ],
    }));
  }

  /** Copies cached memos onto entries imported before the memo was known. */
  buildBackfillStatement(workspaceId: string, network: Network): Statement {
    return {
      sql: `UPDATE ledger_entries
            SET memo_type = (
                  SELECT t.memo_type FROM stellar_transactions t
                  WHERE t.hash = ledger_entries.transaction_hash AND t.network = ledger_entries.network
                ),
                memo_value = (
                  SELECT COALESCE(t.memo, t.memo_bytes) FROM stellar_transactions t
                  WHERE t.hash = ledger_entries.transaction_hash AND t.network = ledger_entries.network
                )
            WHERE workspace_id = ? AND network = ?
              AND transaction_hash IS NOT NULL
              AND memo_type IS NULL
              AND EXISTS (
                SELECT 1 FROM stellar_transactions t
                WHERE t.hash = ledger_entries.transaction_hash AND t.network = ledger_entries.network
              )`,
      params: [workspaceId, network],
    };
  }
}

export class SettingsRepository {
  constructor(private readonly driver: SqlDriver) {}

  async get(key: string): Promise<string | undefined> {
    const rows = await this.driver.select<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [key],
    );
    return rows[0]?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.driver.execute(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, nowIso()],
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.driver.select<{ key: string; value: string }>(
      "SELECT key, value FROM app_settings",
    );
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }
}
