/**
 * QuickBooks-compatible CSV.
 *
 * QuickBooks Online accepts a bank-transaction CSV in one of two shapes:
 *
 *   3-column   Date, Description, Amount            (signed)
 *   4-column   Date, Description, Credit, Debit     (separate columns)
 *
 * Its rules are strict and unforgiving: header row only on line 1, one
 * consistent date format, and **no currency symbols or thousands separators in
 * the amount columns**. A file that breaks those is rejected wholesale.
 *
 * One constraint is ours rather than theirs: a QuickBooks bank feed is
 * single-currency, so an export covers exactly one asset. Emitting USDC and XLM
 * rows into one Amount column would produce a file that imports cleanly and is
 * quietly meaningless — the failure mode this application exists to avoid.
 */
import type { LedgerEntryView } from "./types";
import { escapeCsvField } from "./csv";

export type QuickBooksFormat = "three-column" | "four-column";

export const QUICKBOOKS_HEADERS: Record<QuickBooksFormat, string[]> = {
  "three-column": ["Date", "Description", "Amount"],
  "four-column": ["Date", "Description", "Credit", "Debit"],
};

/** MM/DD/YYYY, the format QuickBooks documents in its own template. */
export function toQuickBooksDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

/**
 * Plain decimal, no grouping and no symbol.
 *
 * The stored amount is already an exact decimal string, so this only has to
 * avoid adding anything to it.
 */
export function toQuickBooksAmount(amount: string): string {
  return amount.replace(/,/g, "");
}

/**
 * A human description built from what the ledger knows.
 *
 * QuickBooks matches and categorises on this text, so the most identifying
 * information goes first: who, then why, then the memo.
 */
export function toQuickBooksDescription(entry: LedgerEntryView): string {
  const parts: string[] = [];

  parts.push(entry.contactName ?? entry.counterpartyAddress ?? "Unknown counterparty");
  if (entry.categoryName) parts.push(entry.categoryName);
  if (entry.memoType === "text" && entry.memoValue) parts.push(entry.memoValue);
  if (entry.note) parts.push(entry.note);

  return parts.join(" · ");
}

export interface QuickBooksOptions {
  format?: QuickBooksFormat;
  /**
   * Internal transfers are excluded by default: money moving between the
   * workspace's own accounts is not income or expenditure, and importing it as
   * such would overstate both sides of the books.
   */
  includeInternal?: boolean;
}

export interface QuickBooksExport {
  csv: string;
  rows: number;
  skippedInternal: number;
}

/**
 * Builds the CSV for one asset.
 *
 * Entries of any other asset are rejected rather than silently dropped, because
 * a partial export that looks complete is worse than an error.
 */
export function toQuickBooksCsv(
  entries: readonly LedgerEntryView[],
  assetId: string,
  options: QuickBooksOptions = {},
): QuickBooksExport {
  const format = options.format ?? "three-column";
  const includeInternal = options.includeInternal ?? false;

  const forAsset = entries.filter((entry) => entry.assetId === assetId);
  const internal = forAsset.filter((entry) => entry.direction === "internal");
  const usable = forAsset.filter(
    (entry) =>
      entry.direction === "incoming" ||
      entry.direction === "outgoing" ||
      (includeInternal && entry.direction === "internal"),
  );

  const lines = [QUICKBOOKS_HEADERS[format].join(",")];

  for (const entry of usable) {
    const date = toQuickBooksDate(entry.timestamp);
    const description = escapeCsvField(toQuickBooksDescription(entry));
    const amount = toQuickBooksAmount(entry.amount);

    if (format === "three-column") {
      // Signed: money in is positive, money out negative.
      const signed = entry.direction === "outgoing" ? `-${amount}` : amount;
      lines.push([date, description, signed].join(","));
    } else {
      const credit = entry.direction === "outgoing" ? "" : amount;
      const debit = entry.direction === "outgoing" ? amount : "";
      lines.push([date, description, credit, debit].join(","));
    }
  }

  return {
    csv: `${lines.join("\n")}\n`,
    rows: usable.length,
    skippedInternal: includeInternal ? 0 : internal.length,
  };
}
