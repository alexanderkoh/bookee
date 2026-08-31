import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import {
  createRepositories,
  AddressAlreadyAssignedError,
  type Repositories,
} from "../../src/db/repositories";
import { syncAccount } from "../../src/ledger/sync";
import { FakeDataSource, loadFixture } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";
import type { Workspace } from "../../src/db/schema";

/**
 * A shared custodial address: one Stellar account, many customers, told apart
 * only by the memo on each payment.
 */
const EXCHANGE = "GARSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKTT5";

let driver: NodeSqlDriver;
let repos: Repositories;
let workspace: Workspace;

/** Builds a payment from the exchange address carrying a memo. */
function payment(id: string, memo: string | null, amount = "100.0000000") {
  const template = loadFixture("operation-payment");
  return {
    record: {
      ...template,
      id,
      paging_token: id,
      from: EXCHANGE,
      to: SAMPLE_ACCOUNT,
      amount,
      transaction_hash: id.padStart(64, "0"),
    },
    memo,
  };
}

beforeEach(async () => {
  driver = new NodeSqlDriver();
  await migrate(driver);
  repos = createRepositories(driver);
  workspace = await repos.workspaces.create({ name: "Tellus" });

  const account = await repos.accounts.create({
    workspaceId: workspace.id,
    publicKey: SAMPLE_ACCOUNT,
    network: "public",
  });

  // Three payments from one address, two customers and one unlabelled.
  const built = [
    payment("1", "customer-alpha"),
    payment("2", "customer-beta", "250.0000000"),
    payment("3", "customer-alpha", "75.0000000"),
    payment("4", null, "10.0000000"),
  ];

  const dataSource = new FakeDataSource(
    built.map((b) => b.record),
    {
      transactions: built
        .filter((b) => b.memo !== null)
        .map((b) => ({
          hash: b.record.transaction_hash,
          created_at: "2026-01-01T00:00:00Z",
          memo_type: "text" as const,
          memo: b.memo!,
        })),
    },
  );

  await syncAccount({ repositories: repos, dataSource }, account);
});

describe("one address, several counterparties", () => {
  it("lists each memo as its own unnamed party", async () => {
    const unnamed = await repos.contacts.unnamedCounterparties(workspace.id);

    // Same address, but three distinct parties: two memos and the memo-less one.
    expect(unnamed).toHaveLength(3);
    expect(unnamed.every((p) => p.address === EXCHANGE)).toBe(true);
    // toSorted stringifies, so the memo-less party sorts last.
    expect(unnamed.map((p) => p.memo).toSorted()).toEqual([
      "customer-alpha",
      "customer-beta",
      null,
    ]);

    const alpha = unnamed.find((p) => p.memo === "customer-alpha")!;
    expect(alpha.entryCount).toBe(2);
  });

  it("resolves a memo-scoped contact only for its own memo", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    const named = entries.filter((e) => e.contactName === "Alpha Ltd");

    expect(named).toHaveLength(2);
    expect(named.every((e) => e.memoValue === "customer-alpha")).toBe(true);
    // The other customer on the very same address stays unnamed.
    expect(entries.filter((e) => e.memoValue === "customer-beta")[0]!.contactName).toBeNull();
  });

  it("lets two contacts share an address with different memos", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Beta GmbH",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-beta" }],
    });

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries.filter((e) => e.contactName === "Alpha Ltd")).toHaveLength(2);
    expect(entries.filter((e) => e.contactName === "Beta GmbH")).toHaveLength(1);
  });

  it("prefers the exact memo over a catch-all claim on the same address", async () => {
    // A catch-all first: "everything from this exchange".
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Some Exchange",
      addresses: [{ network: "public", address: EXCHANGE }],
    });
    // Then a specific customer on the same address.
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    // The specific one wins where the memo matches...
    expect(entries.filter((e) => e.contactName === "Alpha Ltd")).toHaveLength(2);
    // ...and the catch-all covers everything else on that address.
    expect(entries.filter((e) => e.contactName === "Some Exchange")).toHaveLength(2);
  });

  it("refuses only an identical address-and-memo claim", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });

    // Same address, different memo: allowed.
    await expect(
      repos.contacts.create({
        workspaceId: workspace.id,
        name: "Beta GmbH",
        addresses: [{ network: "public", address: EXCHANGE, memo: "customer-beta" }],
      }),
    ).resolves.toBeDefined();

    // Same address, same memo: refused.
    await expect(
      repos.contacts.create({
        workspaceId: workspace.id,
        name: "Impostor",
        addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
      }),
    ).rejects.toThrow(AddressAlreadyAssignedError);
  });

  it("counts activity per memo-scoped contact, not per address", async () => {
    const alpha = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });

    const summaries = await repos.contacts.listWithCounts(workspace.id);
    expect(summaries[0]!.entryCount).toBe(2);

    const activity = await repos.contacts.activity(workspace.id, alpha.id);
    // 100 + 75, not the whole address's 435.
    expect(activity[0]!.incoming).toBe("175");
  });

  it("carries memos through a backup and restores them", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alpha Ltd",
      addresses: [{ network: "public", address: EXCHANGE, memo: "customer-alpha" }],
    });

    const { exportWorkspace, importBackup, parseBackup, serializeBackup } =
      await import("../../src/ledger/backup");
    const backup = await exportWorkspace(repos, workspace.id);
    expect(backup.contactAddresses[0]!.memo).toBe("customer-alpha");

    const fresh = new NodeSqlDriver();
    await migrate(fresh);
    const restored = createRepositories(fresh);
    const result = await importBackup(restored, parseBackup(serializeBackup(backup)));

    const contact = (await restored.contacts.listWithCounts(result.workspaceId))[0]!;
    const addresses = await restored.contacts.addresses(contact.id);
    expect(addresses[0]!.memo).toBe("customer-alpha");
  });
});
