import type { SqlDriver, SqlParam, Statement } from "../driver";
import type { Direction, LedgerEntry, Network } from "../schema";
import type { AssetTotals, LedgerEntryView, LedgerFilters, Page } from "../../ledger/types";
import type { NormalizedMovement } from "../../stellar/types";
import type { Resolution } from "../../ledger/counterparty";
import type { RuleTarget } from "../../ledger/rules";
import { mapLedgerEntry } from "./mappers";
import { fromDbBool } from "../schema";
import { newId, nowIso } from "../../lib/ids";
import { add, subtract, ZERO } from "../../lib/money";

export interface ResolvedMovement {
  movement: NormalizedMovement;
  resolution: Resolution;
  memo?: { type: string | null; value: string | null } | undefined;
}

import type { SqlRow as Row } from "../row";

/**
 * How an entry's contact is resolved.
 *
 * Two routes, in order of precedence:
 *
 *  1. an explicit contact set on this one entry (an.contact_id)
 *  2. the address book: any contact that claims this counterparty address
 *
 * The second route is why assigning an address to a contact updates every
 * historical transaction at once — the name is joined at read time, never
 * copied onto the entries. Renaming a contact likewise updates all history.
 */
const CONTACT_JOIN = `
  LEFT JOIN contact_addresses ca_memo
    ON ca_memo.workspace_id = e.workspace_id
   AND ca_memo.network = e.network
   AND ca_memo.address = e.counterparty_address
   AND ca_memo.memo IS NOT NULL
   AND ca_memo.memo = e.memo_value
  LEFT JOIN contact_addresses ca_any
    ON ca_any.workspace_id = e.workspace_id
   AND ca_any.network = e.network
   AND ca_any.address = e.counterparty_address
   AND ca_any.memo IS NULL
  LEFT JOIN contacts c ON c.id = COALESCE(an.contact_id, ca_memo.contact_id, ca_any.contact_id)
`;

/**
 * The resolved contact id.
 *
 * Order is the whole point: an explicit assignment on the entry wins, then an
 * address row whose memo matches this payment exactly, then an address row that
 * claims the address regardless of memo. A shared exchange deposit address can
 * therefore have a catch-all contact and named sub-accounts at the same time,
 * with the specific one taking precedence.
 */
const RESOLVED_CONTACT = "COALESCE(an.contact_id, ca_memo.contact_id, ca_any.contact_id)";

const VIEW_SELECT = `
  SELECT
    e.id, e.workspace_id, e.network, e.external_key, e.timestamp, e.movement_type,
    e.direction, e.amount, e.asset_id, e.from_address, e.to_address,
    e.counterparty_address, e.memo_type, e.memo_value, e.transaction_hash, e.operation_id,
    a.display_code AS asset_code, a.issuer AS asset_issuer,
    ${RESOLVED_CONTACT} AS contact_id,
    an.category_id, an.note, an.excluded, an.reimbursable,
    c.name AS contact_name,
    cat.name AS category_name, cat.emoji AS category_emoji, cat.kind AS category_kind
  FROM ledger_entries e
  JOIN assets a ON a.id = e.asset_id
  LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
  ${CONTACT_JOIN}
  LEFT JOIN categories cat ON cat.id = an.category_id
`;

function mapView(row: Row): LedgerEntryView {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    network: row["network"],
    externalKey: row["external_key"],
    timestamp: row["timestamp"],
    movementType: row["movement_type"],
    direction: row["direction"],
    amount: row["amount"],
    assetId: row["asset_id"],
    assetCode: row["asset_code"],
    assetIssuer: row["asset_issuer"] ?? null,
    fromAddress: row["from_address"] ?? null,
    toAddress: row["to_address"] ?? null,
    counterpartyAddress: row["counterparty_address"] ?? null,
    memoType: row["memo_type"] ?? null,
    memoValue: row["memo_value"] ?? null,
    transactionHash: row["transaction_hash"] ?? null,
    operationId: row["operation_id"] ?? null,
    contactId: row["contact_id"] ?? null,
    contactName: row["contact_name"] ?? null,
    categoryId: row["category_id"] ?? null,
    categoryName: row["category_name"] ?? null,
    categoryEmoji: row["category_emoji"] ?? null,
    categoryKind: row["category_kind"] ?? null,
    note: row["note"] ?? null,
    excluded: fromDbBool(row["excluded"]),
    reimbursable: fromDbBool(row["reimbursable"]),
  };
}

/** Builds the WHERE clause shared by the list, count and totals queries. */
function buildWhere(
  filters: LedgerFilters,
  accountAddress?: string | null,
): { clause: string; params: SqlParam[] } {
  const conditions: string[] = ["e.workspace_id = ?"];
  const params: SqlParam[] = [filters.workspaceId];

  if (filters.from) {
    conditions.push("e.timestamp >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("e.timestamp <= ?");
    params.push(filters.to);
  }
  if (filters.direction) {
    conditions.push("e.direction = ?");
    params.push(filters.direction);
  }
  if (filters.assetId) {
    conditions.push("e.asset_id = ?");
    params.push(filters.assetId);
  }
  if (filters.categoryId) {
    conditions.push("an.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.contactId) {
    conditions.push(`${RESOLVED_CONTACT} = ?`);
    params.push(filters.contactId);
  }
  if (filters.status === "uncategorized") {
    conditions.push("an.category_id IS NULL");
  }
  if (filters.status === "categorized") {
    conditions.push("an.category_id IS NOT NULL");
  }
  if (!filters.includeExcluded) {
    conditions.push("COALESCE(an.excluded, 0) = 0");
  }
  if (accountAddress) {
    conditions.push("(e.from_address = ? OR e.to_address = ?)");
    params.push(accountAddress, accountAddress);
  }
  if (filters.search) {
    // Search spans blockchain identifiers and human context alike.
    conditions.push(`(
      e.from_address LIKE ? OR e.to_address LIKE ? OR e.counterparty_address LIKE ?
      OR e.memo_value LIKE ? OR e.transaction_hash LIKE ?
      OR c.name LIKE ? OR an.note LIKE ?
    )`);
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term, term, term);
  }

  return { clause: conditions.join(" AND "), params };
}

export class LedgerEntryRepository {
  constructor(private readonly driver: SqlDriver) {}

  /**
   * Statements that write a batch of movements idempotently.
   *
   * Returned rather than executed so the sync engine can commit the entries and
   * the paging cursor in a single transaction: if the process dies mid-import,
   * the cursor never points past data that was not written.
   *
   * ON CONFLICT keeps the existing row id, which is what stops a resync from
   * orphaning the annotations attached to an entry.
   */
  buildUpsertStatements(
    workspaceId: string,
    network: Network,
    resolved: readonly ResolvedMovement[],
  ): Statement[] {
    const now = nowIso();
    const statements: Statement[] = [];
    const seenAssets = new Set<string>();

    for (const { movement, resolution, memo } of resolved) {
      if (!seenAssets.has(movement.asset.id)) {
        seenAssets.add(movement.asset.id);
        statements.push({
          sql: `INSERT INTO assets (id, network, asset_type, code, issuer, contract_id, display_code, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING`,
          params: [
            movement.asset.id,
            movement.asset.network,
            movement.asset.assetType,
            movement.asset.code,
            movement.asset.issuer,
            movement.asset.contractId,
            movement.asset.displayCode,
            now,
          ],
        });
      }

      statements.push({
        sql: `INSERT INTO ledger_entries (
                id, workspace_id, network, external_key, source_kind,
                transaction_hash, operation_id, paging_token, timestamp,
                movement_type, direction, amount, asset_id,
                from_address, to_address, counterparty_address,
                memo_type, memo_value, raw_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(workspace_id, network, external_key) DO UPDATE SET
                direction = excluded.direction,
                counterparty_address = excluded.counterparty_address,
                memo_type = COALESCE(excluded.memo_type, ledger_entries.memo_type),
                memo_value = COALESCE(excluded.memo_value, ledger_entries.memo_value),
                paging_token = excluded.paging_token,
                updated_at = excluded.updated_at`,
        params: [
          newId(),
          workspaceId,
          network,
          movement.externalKey,
          movement.sourceKind,
          movement.transactionHash,
          movement.operationId,
          movement.pagingToken,
          movement.timestamp,
          movement.movementType,
          resolution.direction,
          movement.amount,
          movement.asset.id,
          movement.fromAddress,
          movement.toAddress,
          resolution.counterpartyAddress,
          memo?.type ?? null,
          memo?.value ?? null,
          JSON.stringify(movement.raw),
          now,
          now,
        ],
      });
    }

    return statements;
  }

  async query(
    filters: LedgerFilters,
    page: Page = { limit: 100, offset: 0 },
  ): Promise<LedgerEntryView[]> {
    const account = await this.resolveAccountAddress(filters.accountId);
    const { clause, params } = buildWhere(filters, account);
    const rows = await this.driver.select<Row>(
      `${VIEW_SELECT} WHERE ${clause} ORDER BY e.timestamp DESC, e.id DESC LIMIT ? OFFSET ?`,
      [...params, page.limit, page.offset],
    );
    return rows.map(mapView);
  }

  async count(filters: LedgerFilters): Promise<number> {
    const account = await this.resolveAccountAddress(filters.accountId);
    const { clause, params } = buildWhere(filters, account);
    const rows = await this.driver.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ledger_entries e
       JOIN assets a ON a.id = e.asset_id
       LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
       ${CONTACT_JOIN}
       WHERE ${clause}`,
      params,
    );
    return rows[0]?.count ?? 0;
  }

  async findById(id: string): Promise<LedgerEntryView | undefined> {
    const rows = await this.driver.select<Row>(`${VIEW_SELECT} WHERE e.id = ?`, [id]);
    return rows[0] ? mapView(rows[0]) : undefined;
  }

  async findRawById(id: string): Promise<LedgerEntry | undefined> {
    const rows = await this.driver.select<Row>("SELECT * FROM ledger_entries WHERE id = ?", [id]);
    return rows[0] ? mapLedgerEntry(rows[0]) : undefined;
  }

  /**
   * Per-asset incoming/outgoing/net totals.
   *
   * Aggregation happens in TypeScript with exact decimal arithmetic rather than
   * with SQL's SUM(), which would coerce the TEXT amounts to floats and
   * reintroduce exactly the rounding this schema exists to avoid.
   */
  async totalsByAsset(filters: LedgerFilters): Promise<AssetTotals[]> {
    const account = await this.resolveAccountAddress(filters.accountId);
    const { clause, params } = buildWhere(filters, account);
    const rows = await this.driver.select<Row>(
      `SELECT e.asset_id, a.display_code AS asset_code, e.direction, e.amount
       FROM ledger_entries e
       JOIN assets a ON a.id = e.asset_id
       LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
       ${CONTACT_JOIN}
       WHERE ${clause}`,
      params,
    );

    const byAsset = new Map<string, AssetTotals>();
    for (const row of rows) {
      const key = row["asset_id"] as string;
      const totals = byAsset.get(key) ?? {
        assetId: key,
        assetCode: row["asset_code"] as string,
        incoming: ZERO,
        outgoing: ZERO,
        net: ZERO,
        count: 0,
      };
      const amount = row["amount"] as string;
      const direction = row["direction"] as Direction;

      if (direction === "incoming") totals.incoming = add(totals.incoming, amount);
      if (direction === "outgoing") totals.outgoing = add(totals.outgoing, amount);
      totals.count += 1;
      byAsset.set(key, totals);
    }

    return [...byAsset.values()]
      .map((totals) => ({ ...totals, net: subtract(totals.incoming, totals.outgoing) }))
      .toSorted((a, b) => a.assetCode.localeCompare(b.assetCode));
  }

  /** Entries with no category assigned, the "needs attention" count. */
  async uncategorizedCount(workspaceId: string): Promise<number> {
    return this.count({ workspaceId, status: "uncategorized" });
  }

  /**
   * Recomputes direction and counterparty for stored entries.
   *
   * Run after adding or removing a tracked account: an entry that was recorded
   * as incoming from a stranger becomes an internal transfer the moment the
   * other side of it becomes one of the workspace's own accounts.
   */
  async reresolveDirections(
    workspaceId: string,
    network: Network,
    owned: ReadonlySet<string>,
  ): Promise<number> {
    const rows = await this.driver.select<Row>(
      `SELECT id, from_address, to_address, source_kind, external_key
       FROM ledger_entries WHERE workspace_id = ? AND network = ?`,
      [workspaceId, network],
    );

    const statements: Statement[] = [];
    const now = nowIso();

    for (const row of rows) {
      const externalKey = row["external_key"] as string;
      // Path payment sides keep their fixed orientation; see counterparty.ts.
      const relevantParty = externalKey.endsWith(":src")
        ? "from"
        : externalKey.endsWith(":dst")
          ? "to"
          : "both";

      const from = (row["from_address"] as string | null) ?? null;
      const to = (row["to_address"] as string | null) ?? null;
      const fromOwned = from !== null && owned.has(from);
      const toOwned = to !== null && owned.has(to);

      let direction: Direction;
      let counterparty: string | null;

      if (relevantParty === "from") {
        direction = fromOwned ? "outgoing" : "neutral";
        counterparty = fromOwned ? to : null;
      } else if (relevantParty === "to") {
        direction = toOwned ? "incoming" : "neutral";
        counterparty = toOwned ? from : null;
      } else if (fromOwned && toOwned) {
        direction = "internal";
        counterparty = to;
      } else if (fromOwned) {
        direction = "outgoing";
        counterparty = to;
      } else if (toOwned) {
        direction = "incoming";
        counterparty = from;
      } else {
        direction = "neutral";
        counterparty = null;
      }

      statements.push({
        sql: `UPDATE ledger_entries
              SET direction = ?, counterparty_address = ?, updated_at = ?
              WHERE id = ? AND (direction <> ? OR counterparty_address IS NOT ?)`,
        params: [direction, counterparty, now, row["id"], direction, counterparty],
      });
    }

    if (statements.length > 0) await this.driver.batch(statements);
    return statements.length;
  }

  /**
   * The minimal projection the rules engine needs.
   *
   * Rules are evaluated in TypeScript rather than compiled into SQL: the
   * condition set is small, ledgers are in the tens of thousands of rows, and
   * exact decimal comparison of amounts is not something SQLite can do on TEXT
   * columns without coercing to float. One query, then in-memory evaluation.
   */
  async projectForRules(workspaceId: string): Promise<RuleTarget[]> {
    const rows = await this.driver.select<Row>(
      `SELECT e.id, e.counterparty_address, e.direction, e.asset_id, e.memo_value, e.amount,
              ${RESOLVED_CONTACT} AS contact_id
       FROM ledger_entries e
       LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
       ${CONTACT_JOIN}
       WHERE e.workspace_id = ?`,
      [workspaceId],
    );

    return rows.map((row) => ({
      id: row["id"],
      counterpartyAddress: row["counterparty_address"] ?? null,
      contactId: row["contact_id"] ?? null,
      direction: row["direction"],
      assetId: row["asset_id"],
      memoValue: row["memo_value"] ?? null,
      amount: row["amount"],
    }));
  }

  /** Transaction hashes on entries that still have no memo cached. */
  async hashesNeedingMemo(workspaceId: string, network: Network): Promise<string[]> {
    const rows = await this.driver.select<{ transaction_hash: string }>(
      `SELECT DISTINCT e.transaction_hash
       FROM ledger_entries e
       LEFT JOIN stellar_transactions t
         ON t.hash = e.transaction_hash AND t.network = e.network
       WHERE e.workspace_id = ? AND e.network = ?
         AND e.transaction_hash IS NOT NULL
         AND t.hash IS NULL`,
      [workspaceId, network],
    );
    return rows.map((row) => row.transaction_hash);
  }

  private async resolveAccountAddress(accountId?: string): Promise<string | null> {
    if (!accountId) return null;
    const rows = await this.driver.select<{ public_key: string }>(
      "SELECT public_key FROM tracked_accounts WHERE id = ?",
      [accountId],
    );
    return rows[0]?.public_key ?? null;
  }
}
