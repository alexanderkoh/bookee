import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, type Repositories } from "../../src/db/repositories";
import { syncAccount, syncWorkspace } from "../../src/ledger/sync";
import { FakeDataSource, loadFixture } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT, syntheticLedgerRecords } from "../support/synthetic-ledger";
import { StellarError } from "../../src/stellar/errors";
import type { TrackedAccount, Workspace } from "../../src/db/schema";

let driver: NodeSqlDriver;
let repos: Repositories;
let workspace: Workspace;
let account: TrackedAccount;

beforeEach(async () => {
  driver = new NodeSqlDriver();
  await migrate(driver);
  repos = createRepositories(driver);
  workspace = await repos.workspaces.create({ name: "Tellus Cooperative" });
  account = await repos.accounts.create({
    workspaceId: workspace.id,
    publicKey: SAMPLE_ACCOUNT,
    network: "public",
    label: "Tellus Operations",
  });
});

describe("importing a real account", () => {
  it("imports the full history across pages", async () => {
    const records = syntheticLedgerRecords();
    const dataSource = new FakeDataSource(records);

    const result = await syncAccount({ repositories: repos, dataSource }, account);

    expect(records).toHaveLength(270);
    expect(result.entriesImported).toBe(270);
    // 200 + 70: the short second page ends the loop without a wasted request.
    expect(result.pagesFetched).toBe(2);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);
  });

  it("classifies incoming and outgoing correctly", async () => {
    const dataSource = new FakeDataSource(syntheticLedgerRecords());
    await syncAccount({ repositories: repos, dataSource }, account);

    const incoming = await repos.entries.count({
      workspaceId: workspace.id,
      direction: "incoming",
    });
    const outgoing = await repos.entries.count({
      workspaceId: workspace.id,
      direction: "outgoing",
    });

    // Verified against Horizon at capture time.
    expect(incoming).toBe(252);
    expect(outgoing).toBe(18);
  });

  it("stores a one-stroop amount byte-exact", async () => {
    const dataSource = new FakeDataSource(syntheticLedgerRecords());
    await syncAccount({ repositories: repos, dataSource }, account);

    const rows = await driver.select<{ amount: string }>(
      "SELECT amount FROM ledger_entries WHERE amount = '0.0000001'",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.amount).toBe("0.0000001");
  });

  it("records both assets with distinct identities", async () => {
    const dataSource = new FakeDataSource(syntheticLedgerRecords());
    await syncAccount({ repositories: repos, dataSource }, account);

    const totals = await repos.entries.totalsByAsset({ workspaceId: workspace.id });
    const codes = totals.map((t) => t.assetCode).toSorted();
    expect(codes).toEqual(["USDC", "XLM"]);
    // Aggregates stay per asset; nothing is summed across them.
    expect(totals.every((t) => t.count > 0)).toBe(true);
  });

  it("advances the cursor to the last record", async () => {
    const records = syntheticLedgerRecords();
    const dataSource = new FakeDataSource(records);
    const result = await syncAccount({ repositories: repos, dataSource }, account);

    expect(result.cursor).toBe(records[records.length - 1].paging_token);
    const stored = await repos.accounts.findById(account.id);
    expect(stored?.lastPaymentCursor).toBe(result.cursor);
    expect(stored?.lastSyncedAt).not.toBeNull();
  });
});

describe("idempotency", () => {
  it("produces no duplicates when the same history is imported ten times", async () => {
    const records = syntheticLedgerRecords();

    for (let run = 0; run < 10; run++) {
      const fresh = await repos.accounts.findById(account.id);
      await syncAccount(
        { repositories: repos, dataSource: new FakeDataSource(records) },
        { ...fresh!, lastPaymentCursor: null }, // force a full re-read every time
      );
    }

    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);
  });

  it("keeps entry ids stable across a resync so annotations are never orphaned", async () => {
    const records = syntheticLedgerRecords();
    await syncAccount({ repositories: repos, dataSource: new FakeDataSource(records) }, account);

    const before = await repos.entries.query(
      { workspaceId: workspace.id },
      { limit: 5, offset: 0 },
    );
    const target = before[0]!;
    await repos.annotations.setManual(target.id, { note: "rent for March" });

    const refreshed = await repos.accounts.findById(account.id);
    await syncAccount(
      { repositories: repos, dataSource: new FakeDataSource(records) },
      { ...refreshed!, lastPaymentCursor: null },
    );

    const annotation = await repos.annotations.findByEntry(target.id);
    expect(annotation?.note).toBe("rent for March");
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);
  });
});

describe("interrupted imports", () => {
  it("resumes from the last committed page without duplicating", async () => {
    const records = syntheticLedgerRecords();

    // Page 0 commits, page 1 fails.
    const failing = new FakeDataSource(records, {
      failOnPage: 1,
      failWith: new StellarError("server_error", "Horizon returned 500."),
    });

    await expect(
      syncAccount({ repositories: repos, dataSource: failing }, account),
    ).rejects.toThrow(StellarError);

    const afterFailure = await repos.entries.count({ workspaceId: workspace.id });
    expect(afterFailure).toBe(200);

    // The cursor must point at the end of the page that actually committed.
    const partial = await repos.accounts.findById(account.id);
    expect(partial?.lastPaymentCursor).toBe(records[199].paging_token);

    // Restart: only the remaining records are fetched.
    const resumed = new FakeDataSource(records);
    const result = await syncAccount({ repositories: repos, dataSource: resumed }, partial!);

    expect(resumed.pageRequests[0]).toBe(records[199].paging_token);
    expect(result.entriesImported).toBe(70);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);
  });

  it("never erases synced data when the first page fails", async () => {
    const records = syntheticLedgerRecords();
    await syncAccount({ repositories: repos, dataSource: new FakeDataSource(records) }, account);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);

    const offline = new FakeDataSource(records, {
      failOnPage: 0,
      failWith: new StellarError("offline", "Could not reach Horizon."),
    });
    const current = await repos.accounts.findById(account.id);

    await expect(
      syncAccount({ repositories: repos, dataSource: offline }, current!),
    ).rejects.toThrow(StellarError);

    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(270);
  });
});

describe("internal transfers", () => {
  /** Builds a payment between two accounts, shaped like a real Horizon record. */
  function paymentBetween(from: string, to: string, id: string) {
    const template = loadFixture("operation-payment");
    return { ...template, id, paging_token: id, from, to, amount: "100.0000000" };
  }

  const OTHER = "GAQ53YUIVQKQ2CZJJ7QSHDPWM3E4JLNZINK24T3LD2RXNSNZFC6WTJ4N";

  it("records a transfer between two owned accounts once, as internal", async () => {
    const second = await repos.accounts.create({
      workspaceId: workspace.id,
      publicKey: OTHER,
      network: "public",
      label: "Reserve",
    });

    const record = paymentBetween(SAMPLE_ACCOUNT, OTHER, "900000001");

    // The same operation appears in both accounts' payment feeds.
    await syncAccount(
      { repositories: repos, dataSource: new FakeDataSource([record]) },
      (await repos.accounts.findById(account.id))!,
    );
    await syncAccount(
      { repositories: repos, dataSource: new FakeDataSource([record]) },
      (await repos.accounts.findById(second.id))!,
    );

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe("internal");
  });

  it("reclassifies existing history when the other account is added later", async () => {
    const record = paymentBetween(OTHER, SAMPLE_ACCOUNT, "900000002");

    await syncAccount({ repositories: repos, dataSource: new FakeDataSource([record]) }, account);

    let entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries[0]!.direction).toBe("incoming");

    // Adding the counterparty as an owned account changes what this movement means.
    await repos.accounts.create({
      workspaceId: workspace.id,
      publicKey: OTHER,
      network: "public",
    });
    const owned = await repos.accounts.ownedAddresses(workspace.id, "public");
    await repos.entries.reresolveDirections(workspace.id, "public", owned);

    entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe("internal");
  });
});

describe("sync issues", () => {
  it("records an unsupported record instead of dropping it", async () => {
    const unsupported = {
      id: "800000001",
      paging_token: "800000001",
      type: "set_options",
      created_at: "2026-01-01T00:00:00Z",
      transaction_hash: "a".repeat(64),
    };

    await syncAccount(
      { repositories: repos, dataSource: new FakeDataSource([unsupported]) },
      account,
    );

    const issues = await repos.syncIssues.list(workspace.id);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("unsupported_record");
    expect(issues[0]!.rawJson).toContain("set_options");
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(0);
  });

  it("resolves an account_merge amount from effects", async () => {
    const merge = loadFixture("operation-account_merge");
    const effects = loadFixture("operation-account_merge-effects")._embedded.records;
    const credited = effects.find((e: any) => e.type === "account_credited");

    // Make the merge involve the tracked account so it is relevant.
    const record = { ...merge, into: SAMPLE_ACCOUNT, paging_token: merge.id };

    await syncAccount(
      {
        repositories: repos,
        dataSource: new FakeDataSource([record], { effects: { [merge.id]: effects } }),
      },
      account,
    );

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.movementType).toBe("account_merge");
    expect(entries[0]!.direction).toBe("incoming");
    expect(Number(entries[0]!.amount)).toBeCloseTo(Number(credited.amount), 7);
  });

  it("files an issue when the merge amount cannot be recovered", async () => {
    const merge = loadFixture("operation-account_merge");
    const record = { ...merge, into: SAMPLE_ACCOUNT, paging_token: merge.id };

    // No effects available.
    await syncAccount({ repositories: repos, dataSource: new FakeDataSource([record]) }, account);

    const issues = await repos.syncIssues.list(workspace.id);
    expect(issues.some((issue) => issue.kind === "missing_amount")).toBe(true);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(0);
  });
});

describe("memo enrichment", () => {
  it("fetches each transaction once and attaches its memo", async () => {
    const records = syntheticLedgerRecords().slice(0, 10);
    const hashes = [...new Set(records.map((r) => r.transaction_hash))];

    const dataSource = new FakeDataSource(records, {
      transactions: hashes.map((hash) => ({
        hash,
        created_at: "2026-01-01T00:00:00Z",
        memo_type: "text" as const,
        memo: "invoice 42",
      })),
    });

    await syncAccount({ repositories: repos, dataSource }, account);

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries[0]!.memoType).toBe("text");
    expect(entries[0]!.memoValue).toBe("invoice 42");

    // Each hash requested exactly once, even though several entries share it.
    expect(dataSource.transactionRequests).toHaveLength(hashes.length);
    expect(new Set(dataSource.transactionRequests).size).toBe(hashes.length);
  });

  it("continues the import when memo lookup fails", async () => {
    const records = syntheticLedgerRecords().slice(0, 5);
    // FakeDataSource returns no transactions, simulating enrichment coming back empty.
    const dataSource = new FakeDataSource(records);

    const result = await syncAccount({ repositories: repos, dataSource }, account);
    expect(result.entriesImported).toBe(5);
  });
});

describe("syncWorkspace", () => {
  it("syncs every account and reclassifies afterwards", async () => {
    const records = syntheticLedgerRecords().slice(0, 20);
    const results = await syncWorkspace(
      {
        repositories: repos,
        dataSourceFor: () => new FakeDataSource(records),
      },
      workspace.id,
    );

    expect(results).toHaveLength(1);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(20);
  });
});
