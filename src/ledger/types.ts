/**
 * Ledger-facing domain types: what the UI reads, as opposed to what the
 * database stores.
 */
import type { Amount } from "../lib/money";
import type { CategoryKind, Direction, MemoType, MovementType, Network } from "../db/schema";

/**
 * A ledger entry with its human context already resolved.
 *
 * Contact and category names are resolved through joins rather than copied onto
 * the entry, so renaming a contact or assigning an address updates all history
 * at once without rewriting any rows.
 */
export interface LedgerEntryView {
  id: string;
  workspaceId: string;
  network: Network;
  externalKey: string;
  timestamp: string;
  movementType: MovementType;
  direction: Direction;
  amount: Amount;

  assetId: string;
  assetCode: string;
  assetIssuer: string | null;

  fromAddress: string | null;
  toAddress: string | null;
  counterpartyAddress: string | null;

  memoType: MemoType | null;
  memoValue: string | null;

  transactionHash: string | null;
  operationId: string | null;

  contactId: string | null;
  contactName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryKind: CategoryKind | null;
  note: string | null;
  excluded: boolean;
  reimbursable: boolean;
}

export type CategorizationStatus = "all" | "categorized" | "uncategorized";

export interface LedgerFilters {
  workspaceId: string;
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  direction?: Direction | undefined;
  assetId?: string | undefined;
  categoryId?: string | undefined;
  contactId?: string | undefined;
  status?: CategorizationStatus | undefined;
  /** Matches contact name, address, memo, transaction hash and note. */
  search?: string | undefined;
  includeExcluded?: boolean | undefined;
}

export interface Page {
  limit: number;
  offset: number;
}

/** Per-asset totals. Amounts of different assets are never added together. */
export interface AssetTotals {
  assetId: string;
  assetCode: string;
  incoming: Amount;
  outgoing: Amount;
  net: Amount;
  count: number;
}

export interface AssetBalance {
  assetId: string;
  assetCode: string;
  assetIssuer: string | null;
  balance: Amount;
}
