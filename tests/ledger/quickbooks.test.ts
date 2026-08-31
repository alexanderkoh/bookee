import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, type Repositories } from "../../src/db/repositories";
import { syncAccount } from "../../src/ledger/sync";
import {
  QUICKBOOKS_HEADERS,
  toQuickBooksAmount,
  toQuickBooksCsv,
  toQuickBooksDate,
} from "../../src/ledger/quickbooks";
import { buildMonthlyReport, periodBounds, reportToCsv } from "../../src/ledger/report";
import { monthlyActivity, recentMonthKeys } from "../../src/ledger/monthly";
import { FakeDataSource, loadFixture } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";
import type { Workspace } from "../../src/db/schema";

const EMILE = "GEMILEAUBERTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const RESERVE = "GAQ53YUIVQKQ2CZJJ7QSHDPWM3E4JLNZINK24T3LD2RXNSNZFC6WTJ4N";

let driver: NodeSqlDriver;
let repos: Repositories;
let workspace: Workspace;

function payment(id: string, from: string, to: string, amount: string, at: string, native = false) {
  const template = loadFixture("operation-payment");
  const base = { ...template, id, paging_token: id, from, to, amount, created_at: at };
  return native
    ? { ...base, asset_type: "native", asset_code: undefined, asset_issuer: undefined }
    : base;
}

beforeEach(async () => {
  driver = new NodeSqlDriver();
  await migrate(driver);
  repos = createRepositories(driver);
  workspace = await repos.workspaces.create({ name: "Larkspur Collective" });

  const account = await repos.accounts.create({
    workspaceId: workspace.id,
    publicKey: SAMPLE_ACCOUNT,
    network: "public",
  });
  await repos.accounts.create({
    workspaceId: workspace.id,
    publicKey: RESERVE,
    network: "public",
    label: "Reserve",
  });

  const records = [
    payment("1", EMILE, SAMPLE_ACCOUNT, "1500.0000000", "2026-07-04T10:00:00Z"),
    payment("2", SAMPLE_ACCOUNT, EMILE, "1042.5000000", "2026-07-06T10:00:00Z"),
    payment("3", SAMPLE_ACCOUNT, RESERVE, "5000.0000000", "2026-07-20T10:00:00Z"),
    payment("4", EMILE, SAMPLE_ACCOUNT, "250.0000000", "2026-07-25T10:00:00Z", true),
  ];
  await syncAccount({ repositories: repos, dataSource: new FakeDataSource(records) }, account);

  const owned = await repos.accounts.ownedAddresses(workspace.id, "public");
  await repos.entries.reresolveDirections(workspace.id, "public", owned);
});

describe("QuickBooks CSV", () => {
  async function usdcEntries() {
    const all = await repos.entries.query({ workspaceId: workspace.id }, { limit: 500, offset: 0 });
    const usdc = all.find((entry) => entry.assetCode === "USDC")!;
    return { all, assetId: usdc.assetId };
  }

  it("writes the documented three-column header", async () => {
    const { all, assetId } = await usdcEntries();
    const { csv } = toQuickBooksCsv(all, assetId);
    expect(csv.split("\n")[0]).toBe(QUICKBOOKS_HEADERS["three-column"].join(","));
  });

  it("covers exactly one asset, because a bank feed is single-currency", async () => {
    const { all, assetId } = await usdcEntries();
    const { csv, rows } = toQuickBooksCsv(all, assetId);

    // The XLM payment must not appear in a USDC file.
    expect(csv).not.toContain("250");
    expect(rows).toBe(2);
  });

  it("signs money out negative in the three-column format", async () => {
    const { all, assetId } = await usdcEntries();
    const lines = toQuickBooksCsv(all, assetId).csv.trimEnd().split("\n").slice(1);

    expect(lines.some((line) => line.endsWith(",-1042.5"))).toBe(true);
    expect(lines.some((line) => line.endsWith(",1500"))).toBe(true);
  });

  it("splits credit and debit in the four-column format", async () => {
    const { all, assetId } = await usdcEntries();
    const { csv } = toQuickBooksCsv(all, assetId, { format: "four-column" });
    const [header, ...lines] = csv.trimEnd().split("\n");

    expect(header).toBe("Date,Description,Credit,Debit");
    // Money in fills Credit and leaves Debit empty; money out does the reverse.
    expect(lines.some((line) => line.endsWith(",1500,"))).toBe(true);
    expect(lines.some((line) => line.endsWith(",,1042.5"))).toBe(true);
  });

  it("excludes internal transfers, which are not income or expenditure", async () => {
    const { all, assetId } = await usdcEntries();
    const result = toQuickBooksCsv(all, assetId);

    expect(result.skippedInternal).toBe(1);
    expect(result.csv).not.toContain("5000");
  });

  it("never emits thousands separators or currency symbols", async () => {
    const { all, assetId } = await usdcEntries();
    const { csv } = toQuickBooksCsv(all, assetId);

    for (const line of csv.trimEnd().split("\n").slice(1)) {
      const amount = line.split(",").at(-1)!;
      expect(amount).not.toMatch(/[$,]/);
      expect(amount).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it("formats dates the way QuickBooks documents", () => {
    expect(toQuickBooksDate("2026-07-04T10:00:00Z")).toBe("07/04/2026");
    expect(toQuickBooksAmount("1,042.50")).toBe("1042.50");
  });

  it("describes a transaction with the human context the ledger holds", async () => {
    const { assetId } = await usdcEntries();
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Émile Aubert",
      addresses: [{ network: "public", address: EMILE }],
    });

    const refreshed = await repos.entries.query(
      { workspaceId: workspace.id },
      { limit: 500, offset: 0 },
    );
    const { csv } = toQuickBooksCsv(refreshed, assetId);
    expect(csv).toContain("Émile Aubert");
  });
});

describe("monthly report", () => {
  it("summarises a period per asset and never combines them", async () => {
    const report = await buildMonthlyReport(
      repos,
      workspace.id,
      2026,
      7,
      "2026-08-01T00:00:00.000Z",
    );

    expect(report.periodLabel).toContain("2026");
    expect(report.totals.map((t) => t.assetCode).toSorted()).toEqual(["USDC", "XLM"]);

    const usdc = report.totals.find((t) => t.assetCode === "USDC")!;
    expect(usdc.incoming).toBe("1500");
    expect(usdc.outgoing).toBe("1042.5");
    expect(usdc.net).toBe("457.5");
  });

  it("bounds the period to the calendar month", () => {
    const { from, to, label } = periodBounds(2026, 2);
    expect(from).toBe("2026-02-01T00:00:00.000Z");
    expect(to.startsWith("2026-02-28")).toBe(true);
    expect(label).toContain("February");
  });

  it("writes a sectioned CSV that states its own scope", async () => {
    const report = await buildMonthlyReport(
      repos,
      workspace.id,
      2026,
      7,
      "2026-08-01T00:00:00.000Z",
    );
    const csv = reportToCsv(report);

    expect(csv).toContain("Summary by asset");
    expect(csv).toContain("By category");
    // The caveat travels with the file, not just the screen.
    expect(csv).toContain("never combined");
  });
});

describe("monthly activity series", () => {
  it("buckets by month, per asset, excluding internal transfers", async () => {
    const series = await monthlyActivity(repos, workspace.id, {
      months: 3,
      now: new Date("2026-08-15T00:00:00Z"),
    });

    const usdc = series.find((s) => s.assetCode === "USDC")!;
    const july = usdc.months.find((m) => m.month === "2026-07")!;

    expect(july.incoming).toBe("1500");
    // The 5,000 internal transfer is not spending.
    expect(july.outgoing).toBe("1042.5");
    expect(july.net).toBe("457.5");
  });

  it("returns a contiguous run of months, oldest first", () => {
    const keys = recentMonthKeys(3, new Date("2026-01-15T00:00:00Z"));
    expect(keys).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});
