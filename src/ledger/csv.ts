/**
 * CSV export.
 *
 * Amounts are written as plain decimal strings, unformatted and unrounded, so a
 * spreadsheet receives the exact on-chain value rather than a display string
 * with thousands separators.
 */
import type { LedgerEntryView } from "./types";

export const CSV_COLUMNS = [
  "date",
  "direction",
  "amount",
  "asset_code",
  "asset_issuer",
  "from",
  "to",
  "counterparty",
  "contact",
  "category",
  "memo",
  "note",
  "transaction_hash",
  "operation_id",
] as const;

/**
 * Escapes one field.
 *
 * A leading =, +, - or @ is prefixed with a quote: spreadsheet software would
 * otherwise interpret the cell as a formula, which turns an exported memo into
 * code execution on the recipient's machine.
 */
export function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";

  const risky = /^[=+\-@\t\r]/.test(value);
  const escaped = risky ? `'${value}` : value;

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

function toRow(entry: LedgerEntryView): string[] {
  return [
    entry.timestamp,
    entry.direction,
    entry.amount,
    entry.assetCode,
    entry.assetIssuer ?? "",
    entry.fromAddress ?? "",
    entry.toAddress ?? "",
    entry.counterpartyAddress ?? "",
    entry.contactName ?? "",
    entry.categoryName ?? "",
    entry.memoValue ?? "",
    entry.note ?? "",
    entry.transactionHash ?? "",
    entry.operationId ?? "",
  ];
}

export function toCsv(entries: readonly LedgerEntryView[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    lines.push(toRow(entry).map(escapeCsvField).join(","));
  }
  // Trailing newline: some tools drop the final record without one.
  return `${lines.join("\n")}\n`;
}
