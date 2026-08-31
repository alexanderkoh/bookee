/**
 * Monthly report.
 *
 * A statement for one period: what came in, what went out, and against which
 * categories — per asset, always. It is the thing you would send an accountant
 * or put in front of a board, so it states its own scope and never implies a
 * total across assets.
 */
import type { Repositories } from "../db/repositories";
import type { Amount } from "../lib/money";
import { escapeCsvField } from "./csv";
import { categorySummary, type CategorySummary } from "./reporting";
import type { AssetTotals } from "./types";
import { BRANDING } from "../branding";

export interface MonthlyReport {
  workspaceName: string;
  periodLabel: string;
  from: string;
  to: string;
  generatedAt: string;
  totals: AssetTotals[];
  categories: CategorySummary[];
  entryCount: number;
  uncategorizedCount: number;
}

export function periodBounds(
  year: number,
  month: number,
): { from: string; to: string; label: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1) - 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: from.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export async function buildMonthlyReport(
  repositories: Repositories,
  workspaceId: string,
  year: number,
  month: number,
  generatedAt: string,
): Promise<MonthlyReport> {
  const workspace = await repositories.workspaces.findById(workspaceId);
  const { from, to, label } = periodBounds(year, month);

  const [totals, categories, entryCount, uncategorizedCount] = await Promise.all([
    repositories.entries.totalsByAsset({ workspaceId, from, to }),
    categorySummary(repositories, workspaceId, { from, to }),
    repositories.entries.count({ workspaceId, from, to }),
    repositories.entries.count({ workspaceId, from, to, status: "uncategorized" }),
  ]);

  return {
    workspaceName: workspace?.name ?? "Ledger",
    periodLabel: label,
    from,
    to,
    generatedAt,
    totals,
    categories,
    entryCount,
    uncategorizedCount,
  };
}

/**
 * The report as CSV.
 *
 * Sectioned rather than one flat table, because the sections answer different
 * questions and flattening them would invite a spreadsheet total across assets.
 */
export function reportToCsv(report: MonthlyReport): string {
  const lines: string[] = [];
  const row = (...cells: (string | number)[]) =>
    lines.push(cells.map(String).map(escapeCsvField).join(","));

  row(`${BRANDING.fullName} — monthly report`);
  row("Ledger", report.workspaceName);
  row("Period", report.periodLabel);
  row("Generated", report.generatedAt);
  row("Transactions", report.entryCount);
  row("Uncategorized", report.uncategorizedCount);
  lines.push("");

  row("Summary by asset");
  row("Asset", "Incoming", "Outgoing", "Net", "Transactions");
  for (const total of report.totals) {
    row(total.assetCode, total.incoming, total.outgoing, total.net, total.count);
  }
  lines.push("");

  row("By category");
  row("Kind", "Category", "Asset", "Amount", "Transactions");
  for (const category of report.categories) {
    for (const total of category.totals) {
      row(
        category.kind ?? "uncategorized",
        category.parentName
          ? `${category.parentName} / ${category.categoryName}`
          : category.categoryName,
        total.assetCode,
        total.amount,
        total.count,
      );
    }
  }
  lines.push("");
  row("Amounts are per asset and are never combined. This ledger holds no exchange rates.");

  return `${lines.join("\n")}\n`;
}

/** Net across a report's assets, as a list — never a single number. */
export function reportNet(report: MonthlyReport): Array<{ assetCode: string; net: Amount }> {
  return report.totals.map((total) => ({ assetCode: total.assetCode, net: total.net }));
}
