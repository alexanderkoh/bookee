/**
 * Row mapping between SQLite's snake_case columns and domain camelCase types.
 *
 * Kept in one place so the SQL stays close to the schema while the rest of the
 * application only ever sees domain objects.
 */
import { fromDbBool } from "../schema";
import type {
  Asset,
  Category,
  Contact,
  ContactAddress,
  EntryAnnotation,
  LedgerEntry,
  Rule,
  StellarTransactionRecord,
  SyncIssue,
  TrackedAccount,
  Workspace,
} from "../schema";

import type { SqlRow as Row } from "../row";

export function mapWorkspace(row: Row): Workspace {
  return {
    id: row["id"],
    name: row["name"],
    reportingCurrency: row["reporting_currency"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapTrackedAccount(row: Row): TrackedAccount {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    publicKey: row["public_key"],
    label: row["label"] ?? null,
    network: row["network"],
    lastPaymentCursor: row["last_payment_cursor"] ?? null,
    lastSyncedAt: row["last_synced_at"] ?? null,
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapAsset(row: Row): Asset {
  return {
    id: row["id"],
    network: row["network"],
    assetType: row["asset_type"],
    code: row["code"] ?? null,
    issuer: row["issuer"] ?? null,
    contractId: row["contract_id"] ?? null,
    displayCode: row["display_code"],
    createdAt: row["created_at"],
  };
}

export function mapLedgerEntry(row: Row): LedgerEntry {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    network: row["network"],
    externalKey: row["external_key"],
    sourceKind: row["source_kind"],
    transactionHash: row["transaction_hash"] ?? null,
    operationId: row["operation_id"] ?? null,
    pagingToken: row["paging_token"] ?? null,
    timestamp: row["timestamp"],
    movementType: row["movement_type"],
    direction: row["direction"],
    amount: row["amount"],
    assetId: row["asset_id"],
    fromAddress: row["from_address"] ?? null,
    toAddress: row["to_address"] ?? null,
    counterpartyAddress: row["counterparty_address"] ?? null,
    memoType: row["memo_type"] ?? null,
    memoValue: row["memo_value"] ?? null,
    rawJson: row["raw_json"] ?? null,
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapAnnotation(row: Row): EntryAnnotation {
  return {
    id: row["id"],
    ledgerEntryId: row["ledger_entry_id"],
    contactId: row["contact_id"] ?? null,
    categoryId: row["category_id"] ?? null,
    note: row["note"] ?? null,
    excluded: fromDbBool(row["excluded"]),
    reimbursable: fromDbBool(row["reimbursable"]),
    contactSource: row["contact_source"] ?? null,
    categorySource: row["category_source"] ?? null,
    noteSource: row["note_source"] ?? null,
    excludedSource: row["excluded_source"] ?? null,
    appliedRuleId: row["applied_rule_id"] ?? null,
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapContact(row: Row): Contact {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    name: row["name"],
    organization: row["organization"] ?? null,
    notes: row["notes"] ?? null,
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapContactAddress(row: Row): ContactAddress {
  return {
    id: row["id"],
    contactId: row["contact_id"],
    workspaceId: row["workspace_id"],
    network: row["network"],
    address: row["address"],
    memo: row["memo"] ?? null,
    label: row["label"] ?? null,
    createdAt: row["created_at"],
  };
}

export function mapCategory(row: Row): Category {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    parentId: row["parent_id"] ?? null,
    name: row["name"],
    emoji: row["emoji"] ?? null,
    kind: row["kind"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapRule(row: Row): Rule {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    name: row["name"],
    enabled: fromDbBool(row["enabled"]),
    priority: row["priority"],
    conditionsJson: row["conditions_json"],
    actionsJson: row["actions_json"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function mapSyncIssue(row: Row): SyncIssue {
  return {
    id: row["id"],
    workspaceId: row["workspace_id"],
    trackedAccountId: row["tracked_account_id"] ?? null,
    externalId: row["external_id"] ?? null,
    kind: row["kind"],
    message: row["message"],
    rawJson: row["raw_json"] ?? null,
    resolved: fromDbBool(row["resolved"]),
    createdAt: row["created_at"],
  };
}

export function mapStellarTransaction(row: Row): StellarTransactionRecord {
  return {
    network: row["network"],
    hash: row["hash"],
    memoType: row["memo_type"] ?? null,
    memo: row["memo"] ?? null,
    memoBytes: row["memo_bytes"] ?? null,
    sourceAccount: row["source_account"] ?? null,
    ledger: row["ledger"] ?? null,
    createdAt: row["created_at"] ?? null,
    fetchedAt: row["fetched_at"],
  };
}
