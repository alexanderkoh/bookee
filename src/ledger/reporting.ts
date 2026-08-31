/**
 * Category reporting.
 *
 * Every figure is per asset. There is no price feed, so USDC and XLM are never
 * added together — a total of "1,242" across two assets would be a fabrication,
 * not a rounding choice.
 */
import type { Repositories } from "../db/repositories";
import type { SqlRow } from "../db/row";
import type { CategoryKind } from "../db/schema";
import { add, ZERO, type Amount } from "../lib/money";

export interface CategoryAssetTotal {
  assetId: string;
  assetCode: string;
  amount: Amount;
  count: number;
}

export interface CategorySummary {
  categoryId: string | null;
  categoryName: string;
  categoryEmoji: string | null;
  kind: CategoryKind | null;
  parentName: string | null;
  /** One row per asset. Never summed across assets. */
  totals: CategoryAssetTotal[];
}

export interface PeriodRange {
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Totals per category and asset for a period.
 *
 * Excluded entries are left out, and internal transfers are counted separately
 * rather than appearing as both income and expense. Amounts are aggregated in
 * TypeScript with exact decimal arithmetic; SQL SUM() would coerce the TEXT
 * columns to float.
 */
export async function categorySummary(
  repositories: Repositories,
  workspaceId: string,
  period: PeriodRange = {},
): Promise<CategorySummary[]> {
  const conditions = ["e.workspace_id = ?", "COALESCE(an.excluded, 0) = 0"];
  const params: (string | number)[] = [workspaceId];

  if (period.from) {
    conditions.push("e.timestamp >= ?");
    params.push(period.from);
  }
  if (period.to) {
    conditions.push("e.timestamp <= ?");
    params.push(period.to);
  }

  const rows = await repositories.driver.select<SqlRow>(
    `SELECT
       an.category_id,
       cat.name  AS category_name,
       cat.emoji AS category_emoji,
       cat.kind  AS category_kind,
       parent.name AS parent_name,
       e.asset_id,
       a.display_code AS asset_code,
       e.amount,
       e.direction
     FROM ledger_entries e
     JOIN assets a ON a.id = e.asset_id
     LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
     LEFT JOIN categories cat ON cat.id = an.category_id
     LEFT JOIN categories parent ON parent.id = cat.parent_id
     WHERE ${conditions.join(" AND ")}`,
    params,
  );

  const summaries = new Map<string, CategorySummary>();

  for (const row of rows) {
    const categoryId = (row["category_id"] as string | null) ?? null;
    const key = categoryId ?? "__uncategorized__";

    const summary = summaries.get(key) ?? {
      categoryId,
      categoryName: (row["category_name"] as string | null) ?? "Uncategorized",
      categoryEmoji: (row["category_emoji"] as string | null) ?? null,
      kind: (row["category_kind"] as CategoryKind | null) ?? null,
      parentName: (row["parent_name"] as string | null) ?? null,
      totals: [],
    };

    const assetId = row["asset_id"] as string;
    let total = summary.totals.find((candidate) => candidate.assetId === assetId);
    if (!total) {
      total = {
        assetId,
        assetCode: row["asset_code"] as string,
        amount: ZERO,
        count: 0,
      };
      summary.totals.push(total);
    }

    total.amount = add(total.amount, row["amount"] as string);
    total.count += 1;
    summaries.set(key, summary);
  }

  for (const summary of summaries.values()) {
    summary.totals.sort((a, b) => a.assetCode.localeCompare(b.assetCode));
  }

  return [...summaries.values()].toSorted((a, b) => {
    // Uncategorized last; it is a to-do list, not a category.
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return (
      (a.kind ?? "").localeCompare(b.kind ?? "") || a.categoryName.localeCompare(b.categoryName)
    );
  });
}

/** Calendar month boundaries in UTC, for the default reporting period. */
export function monthRange(date = new Date()): Required<PeriodRange> {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
