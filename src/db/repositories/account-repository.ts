import type { SqlDriver } from "../driver";
import type { SqlRow } from "../row";
import type { Network, TrackedAccount } from "../schema";
import { mapTrackedAccount } from "./mappers";
import { newId, nowIso } from "../../lib/ids";

export class DuplicateAccountError extends Error {
  constructor(publicKey: string) {
    super(`This address is already tracked in this ledger: ${publicKey}`);
    this.name = "DuplicateAccountError";
  }
}

export class AccountRepository {
  constructor(private readonly driver: SqlDriver) {}

  async listByWorkspace(workspaceId: string): Promise<TrackedAccount[]> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM tracked_accounts WHERE workspace_id = ? ORDER BY created_at ASC",
      [workspaceId],
    );
    return rows.map(mapTrackedAccount);
  }

  async findById(id: string): Promise<TrackedAccount | undefined> {
    const rows = await this.driver.select<SqlRow>("SELECT * FROM tracked_accounts WHERE id = ?", [
      id,
    ]);
    return rows[0] ? mapTrackedAccount(rows[0]) : undefined;
  }

  /**
   * The set of addresses this workspace owns.
   *
   * Direction resolution depends on this, which is why it is read fresh rather
   * than cached: adding an account changes how existing history is classified.
   */
  async ownedAddresses(workspaceId: string, network: Network): Promise<Set<string>> {
    const rows = await this.driver.select<{ public_key: string }>(
      "SELECT public_key FROM tracked_accounts WHERE workspace_id = ? AND network = ?",
      [workspaceId, network],
    );
    return new Set(rows.map((row) => row.public_key));
  }

  async create(input: {
    workspaceId: string;
    publicKey: string;
    network: Network;
    label?: string | null;
  }): Promise<TrackedAccount> {
    const existing = await this.driver.select<{ id: string }>(
      `SELECT id FROM tracked_accounts
       WHERE workspace_id = ? AND network = ? AND public_key = ?`,
      [input.workspaceId, input.network, input.publicKey],
    );
    if (existing.length > 0) throw new DuplicateAccountError(input.publicKey);

    const now = nowIso();
    const account: TrackedAccount = {
      id: newId(),
      workspaceId: input.workspaceId,
      publicKey: input.publicKey,
      label: input.label ?? null,
      network: input.network,
      lastPaymentCursor: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.execute(
      `INSERT INTO tracked_accounts
         (id, workspace_id, public_key, label, network, last_payment_cursor, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      [
        account.id,
        account.workspaceId,
        account.publicKey,
        account.label,
        account.network,
        now,
        now,
      ],
    );
    return account;
  }

  async rename(id: string, label: string | null): Promise<void> {
    await this.driver.execute(
      "UPDATE tracked_accounts SET label = ?, updated_at = ? WHERE id = ?",
      [label, nowIso(), id],
    );
  }

  /**
   * Marks a sync as finished. The cursor is normally advanced page by page
   * inside the import transaction; this only records completion time.
   */
  async markSynced(id: string, syncedAt = nowIso()): Promise<void> {
    await this.driver.execute(
      "UPDATE tracked_accounts SET last_synced_at = ?, updated_at = ? WHERE id = ?",
      [syncedAt, syncedAt, id],
    );
  }

  /** Clears the cursor so the next sync re-imports from the beginning. */
  async resetCursor(id: string): Promise<void> {
    await this.driver.execute(
      "UPDATE tracked_accounts SET last_payment_cursor = NULL, updated_at = ? WHERE id = ?",
      [nowIso(), id],
    );
  }

  async remove(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM tracked_accounts WHERE id = ?", [id]);
  }

  /** Number of ledger entries in which this account is one of the endpoints. */
  async entryCount(account: TrackedAccount): Promise<number> {
    const rows = await this.driver.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ledger_entries
       WHERE workspace_id = ? AND network = ? AND (from_address = ? OR to_address = ?)`,
      [account.workspaceId, account.network, account.publicKey, account.publicKey],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Deletes entries that involve only this account, used by "remove tracking
   * and cached entries". Entries also touching another tracked account are
   * kept, because they remain part of that account's history.
   */
  async removeWithEntries(account: TrackedAccount): Promise<void> {
    await this.driver.batch([
      {
        sql: `DELETE FROM ledger_entries
              WHERE workspace_id = ? AND network = ?
                AND (from_address = ? OR to_address = ?)
                AND NOT EXISTS (
                  SELECT 1 FROM tracked_accounts other
                  WHERE other.workspace_id = ledger_entries.workspace_id
                    AND other.network = ledger_entries.network
                    AND other.id <> ?
                    AND (other.public_key = ledger_entries.from_address
                      OR other.public_key = ledger_entries.to_address)
                )`,
        params: [
          account.workspaceId,
          account.network,
          account.publicKey,
          account.publicKey,
          account.id,
        ],
      },
      { sql: "DELETE FROM tracked_accounts WHERE id = ?", params: [account.id] },
    ]);
  }
}
