/**
 * Monthly activity, per asset.
 *
 * Feeds both the overview charts and the monthly report. Amounts are aggregated
 * with exact decimal arithmetic and never combined across assets — a chart that
 * added XLM to USDC would be inventing an exchange rate.
 */
import type { Repositories } from "../db/repositories";
import type { SqlRow } from "../db/row";
import { add, subtract, ZERO, type Amount } from "../lib/money";

export interface MonthlyBucket {
  /** "2026-08" */
  month: string;
  label: string;
  incoming: Amount;
  outgoing: Amount;
  net: Amount;
  count: number;
}

export interface AssetSeries {
  assetId: string;
  assetCode: string;
  months: MonthlyBucket[];
  totalIncoming: Amount;
  totalOutgoing: Amount;
  net: Amount;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

/** The last `months` calendar months, oldest first. */
export function recentMonthKeys(months: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Monthly in/out per asset.
 *
 * Internal transfers are excluded: value moving between the workspace's own
 * accounts is not income or expenditure, and counting it as both would inflate
 * every month. Excluded entries are left out too.
 */
export async function monthlyActivity(
  repositories: Repositories,
  workspaceId: string,
  options: { months?: number; now?: Date } = {},
): Promise<AssetSeries[]> {
  const months = options.months ?? 12;
  const keys = recentMonthKeys(months, options.now);
  const from = `${keys[0]}-01T00:00:00Z`;

  const rows = await repositories.driver.select<SqlRow>(
    `SELECT e.asset_id, a.display_code AS asset_code, e.direction, e.amount, e.timestamp
     FROM ledger_entries e
     JOIN assets a ON a.id = e.asset_id
     LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
     WHERE e.workspace_id = ?
       AND e.timestamp >= ?
       AND e.direction IN ('incoming', 'outgoing')
       AND COALESCE(an.excluded, 0) = 0`,
    [workspaceId, from],
  );

  const byAsset = new Map<string, AssetSeries>();

  for (const row of rows) {
    const assetId = row["asset_id"] as string;
    const key = monthKey(row["timestamp"] as string);
    if (!keys.includes(key)) continue;

    let series = byAsset.get(assetId);
    if (!series) {
      series = {
        assetId,
        assetCode: row["asset_code"] as string,
        months: keys.map((month) => ({
          month,
          label: monthLabel(month),
          incoming: ZERO,
          outgoing: ZERO,
          net: ZERO,
          count: 0,
        })),
        totalIncoming: ZERO,
        totalOutgoing: ZERO,
        net: ZERO,
      };
      byAsset.set(assetId, series);
    }

    const bucket = series.months.find((candidate) => candidate.month === key)!;
    const amount = row["amount"] as string;

    if (row["direction"] === "incoming") {
      bucket.incoming = add(bucket.incoming, amount);
      series.totalIncoming = add(series.totalIncoming, amount);
    } else {
      bucket.outgoing = add(bucket.outgoing, amount);
      series.totalOutgoing = add(series.totalOutgoing, amount);
    }
    bucket.count += 1;
  }

  for (const series of byAsset.values()) {
    for (const bucket of series.months) {
      bucket.net = subtract(bucket.incoming, bucket.outgoing);
    }
    series.net = subtract(series.totalIncoming, series.totalOutgoing);
  }

  // Busiest asset first: that is the one worth charting by default.
  return [...byAsset.values()].toSorted((a, b) => {
    const aCount = a.months.reduce((sum, m) => sum + m.count, 0);
    const bCount = b.months.reduce((sum, m) => sum + m.count, 0);
    return bCount - aCount;
  });
}
