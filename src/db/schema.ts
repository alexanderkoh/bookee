/**
 * Entity types mirroring the database tables.
 *
 * These are application domain types, not Horizon types. Nothing from the
 * Stellar SDK's response shapes is allowed to leak in here: the normalizer is
 * the only place the two meet.
 */
import type { Amount } from "../lib/money";

export type Network = "public" | "testnet";

export const NETWORKS: readonly Network[] = ["public", "testnet"];

/** Where a ledger entry's value moved relative to the workspace's own accounts. */
export type Direction = "incoming" | "outgoing" | "internal" | "neutral";

/** What kind of on-chain movement produced the entry. Independent of direction. */
export type MovementType =
  | "payment"
  | "path_payment"
  | "create_account"
  | "account_merge"
  | "claimable_balance"
  | "sac_transfer"
  | "mint"
  | "burn"
  | "clawback"
  | "other";

export type CategoryKind = "income" | "expense" | "transfer" | "other";

/**
 * Whether an annotation field was set by the user or by a rule.
 * Rules may never overwrite a field whose source is "manual".
 */
export type AnnotationSource = "manual" | "rule";

export type MemoType = "none" | "text" | "id" | "hash" | "return";

export interface Workspace {
  id: string;
  name: string;
  /** Reserved for a future pricing adapter; unused in v0.1. */
  reportingCurrency: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedAccount {
  id: string;
  workspaceId: string;
  publicKey: string;
  label: string | null;
  network: Network;
  lastPaymentCursor: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  network: Network;
  assetType: string;
  code: string | null;
  issuer: string | null;
  contractId: string | null;
  displayCode: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  workspaceId: string;
  network: Network;
  externalKey: string;
  sourceKind: string;
  transactionHash: string | null;
  operationId: string | null;
  pagingToken: string | null;
  timestamp: string;
  movementType: MovementType;
  direction: Direction;
  amount: Amount;
  assetId: string;
  fromAddress: string | null;
  toAddress: string | null;
  counterpartyAddress: string | null;
  memoType: MemoType | null;
  memoValue: string | null;
  rawJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryAnnotation {
  id: string;
  ledgerEntryId: string;
  contactId: string | null;
  categoryId: string | null;
  note: string | null;
  excluded: boolean;
  reimbursable: boolean;
  contactSource: AnnotationSource | null;
  categorySource: AnnotationSource | null;
  noteSource: AnnotationSource | null;
  excludedSource: AnnotationSource | null;
  appliedRuleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  workspaceId: string;
  name: string;
  organization: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactAddress {
  id: string;
  contactId: string;
  workspaceId: string;
  network: Network;
  address: string;
  /** Null claims the address for any memo; a value claims only that memo. */
  memo: string | null;
  label: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  /** Optional glyph; the UI falls back to a neutral dot when absent. */
  emoji: string | null;
  kind: CategoryKind;
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditionsJson: string;
  actionsJson: string;
  createdAt: string;
  updatedAt: string;
}

export type SyncIssueKind =
  | "unsupported_record"
  | "malformed_record"
  | "missing_amount"
  | "enrichment_failed"
  | "network_error";

export interface SyncIssue {
  id: string;
  workspaceId: string;
  trackedAccountId: string | null;
  externalId: string | null;
  kind: SyncIssueKind;
  message: string;
  rawJson: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface StellarTransactionRecord {
  network: Network;
  hash: string;
  memoType: MemoType | null;
  memo: string | null;
  memoBytes: string | null;
  sourceAccount: string | null;
  ledger: number | null;
  createdAt: string | null;
  fetchedAt: string;
}

/** SQLite has no boolean type; 0/1 integers are stored instead. */
export function toDbBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromDbBool(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}
