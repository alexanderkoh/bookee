import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import {
  createRepositories,
  AddressAlreadyAssignedError,
  type Repositories,
} from "../../src/db/repositories";
import { syncAccount } from "../../src/ledger/sync";
import { categorySummary, monthRange } from "../../src/ledger/reporting";
import { FakeDataSource, loadFixture } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";
import type { Workspace } from "../../src/db/schema";

const ALEX = "GALEXHERNANDEZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const OTHER = "GSOMEONEELSEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

let driver: NodeSqlDriver;
let repos: Repositories;
let workspace: Workspace;

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

  const template = loadFixture("operation-payment");
  const records = [
    {
      ...template,
      id: "1",
      paging_token: "1",
      from: ALEX,
      to: SAMPLE_ACCOUNT,
      amount: "50.0000000",
    },
    {
      ...template,
      id: "2",
      paging_token: "2",
      from: SAMPLE_ACCOUNT,
      to: ALEX,
      amount: "20.0000000",
    },
    {
      ...template,
      id: "3",
      paging_token: "3",
      from: OTHER,
      to: SAMPLE_ACCOUNT,
      amount: "5.0000000",
    },
    {
      ...template,
      id: "4",
      paging_token: "4",
      from: ALEX,
      to: SAMPLE_ACCOUNT,
      amount: "7.0000000",
      asset_type: "native",
      asset_code: undefined,
      asset_issuer: undefined,
    },
  ];
  await syncAccount({ repositories: repos, dataSource: new FakeDataSource(records) }, account);
});

describe("assigning an address to a contact", () => {
  it("resolves every historical transaction at once, without rewriting them", async () => {
    // Before: the address is all we know.
    let entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries.every((entry) => entry.contactName === null)).toBe(true);

    const contact = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex Hernández",
      organization: "Stellar Chile",
      addresses: [{ network: "public", address: ALEX }],
    });

    // After: three existing entries display the name immediately.
    entries = await repos.entries.query({ workspaceId: workspace.id });
    const named = entries.filter((entry) => entry.contactName === "Alex Hernández");
    expect(named).toHaveLength(3);
    expect(named.every((entry) => entry.contactId === contact.id)).toBe(true);

    // The unrelated counterparty is untouched.
    expect(entries.find((entry) => entry.counterpartyAddress === OTHER)?.contactName).toBeNull();
  });

  it("does not copy the name onto the entries", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex Hernández",
      addresses: [{ network: "public", address: ALEX }],
    });

    // The ledger_entries table itself holds no contact column at all.
    const raw = await driver.select<Record<string, unknown>>(
      "SELECT * FROM ledger_entries LIMIT 1",
    );
    expect(Object.keys(raw[0]!)).not.toContain("contact_name");
    expect(Object.keys(raw[0]!)).not.toContain("contact_id");
  });

  it("follows a rename across all history", async () => {
    const contact = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex",
      addresses: [{ network: "public", address: ALEX }],
    });

    await repos.contacts.update(contact.id, { name: "Alex Hernández" });

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries.filter((entry) => entry.contactName === "Alex Hernández")).toHaveLength(3);
  });

  it("counts a contact's activity without inventing cross-asset totals", async () => {
    const contact = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex Hernández",
      addresses: [{ network: "public", address: ALEX }],
    });

    const summaries = await repos.contacts.listWithCounts(workspace.id);
    expect(summaries[0]!.entryCount).toBe(3);
    expect(summaries[0]!.addressCount).toBe(1);

    const activity = await repos.contacts.activity(workspace.id, contact.id);
    // USDC and XLM stay on separate rows.
    expect(activity.map((row) => row.assetCode).toSorted()).toEqual(["USDC", "XLM"]);
    const usdc = activity.find((row) => row.assetCode === "USDC")!;
    expect(usdc.incoming).toBe("50");
    expect(usdc.outgoing).toBe("20");
  });

  it("filters the ledger by contact", async () => {
    const contact = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex",
      addresses: [{ network: "public", address: ALEX }],
    });

    const count = await repos.entries.count({
      workspaceId: workspace.id,
      contactId: contact.id,
    });
    expect(count).toBe(3);
  });

  it("refuses to assign one address to two contacts", async () => {
    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex",
      addresses: [{ network: "public", address: ALEX }],
    });

    await expect(
      repos.contacts.create({
        workspaceId: workspace.id,
        name: "Someone else",
        addresses: [{ network: "public", address: ALEX }],
      }),
    ).rejects.toThrow(AddressAlreadyAssignedError);
  });

  it("keeps entries when a contact is deleted", async () => {
    const contact = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex",
      addresses: [{ network: "public", address: ALEX }],
    });

    await repos.contacts.remove(contact.id);

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.contactName === null)).toBe(true);
  });

  it("merges two contacts, keeping addresses and annotations", async () => {
    const duplicate = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "A. Hernández",
      addresses: [{ network: "public", address: ALEX }],
    });
    const canonical = await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex Hernández",
      addresses: [{ network: "public", address: OTHER }],
    });

    await repos.contacts.merge(duplicate.id, canonical.id);

    expect(await repos.contacts.listWithCounts(workspace.id)).toHaveLength(1);
    const entries = await repos.entries.query({ workspaceId: workspace.id });
    expect(entries.filter((entry) => entry.contactName === "Alex Hernández")).toHaveLength(4);
  });
});

describe("category summaries", () => {
  it("reports totals per category and per asset, never combined", async () => {
    const categories = await repos.categories.list(workspace.id);
    const events = categories.find((category) => category.name === "Events")!;

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    for (const entry of entries.filter((candidate) => candidate.counterpartyAddress === ALEX)) {
      await repos.annotations.setManual(entry.id, { categoryId: events.id });
    }

    const summary = await categorySummary(repos, workspace.id);
    const eventsRow = summary.find((row) => row.categoryId === events.id)!;

    expect(eventsRow.categoryName).toBe("Events");
    expect(eventsRow.totals.map((total) => total.assetCode).toSorted()).toEqual(["USDC", "XLM"]);
    expect(eventsRow.totals.find((total) => total.assetCode === "USDC")!.amount).toBe("70");
    expect(eventsRow.totals.find((total) => total.assetCode === "XLM")!.amount).toBe("7");
  });

  it("lists uncategorized activity last, as a to-do rather than a category", async () => {
    const summary = await categorySummary(repos, workspace.id);
    expect(summary.at(-1)!.categoryId).toBeNull();
    expect(summary.at(-1)!.categoryName).toBe("Uncategorized");
  });

  it("omits excluded entries from the summary", async () => {
    const entries = await repos.entries.query({ workspaceId: workspace.id });
    await repos.annotations.setManual(entries[0]!.id, { excluded: true });

    const summary = await categorySummary(repos, workspace.id);
    const counted = summary.flatMap((row) => row.totals).reduce((sum, t) => sum + t.count, 0);
    expect(counted).toBe(3);
  });

  it("restricts a summary to a calendar month", async () => {
    const range = monthRange(new Date("2026-08-15T00:00:00Z"));
    expect(range.from).toBe("2026-08-01T00:00:00.000Z");
    expect(range.to.startsWith("2026-08-31")).toBe(true);
  });
});

describe("naming unknown parties from the ledger", () => {
  it("lists counterparties nobody has named, busiest first", async () => {
    const unnamed = await repos.contacts.unnamedCounterparties(workspace.id);

    // ALEX appears three times, OTHER once.
    expect(unnamed[0]!.address).toBe(ALEX);
    expect(unnamed[0]!.entryCount).toBe(3);
    expect(unnamed[0]!.incomingCount).toBe(2);
    expect(unnamed[0]!.outgoingCount).toBe(1);
    expect(unnamed[0]!.assetCodes.toSorted()).toEqual(["USDC", "XLM"]);
    expect(unnamed.map((party) => party.address)).toContain(OTHER);
  });

  it("drops an address from the list once it is named", async () => {
    expect(await repos.contacts.unnamedCounterparties(workspace.id)).toHaveLength(2);

    await repos.contacts.create({
      workspaceId: workspace.id,
      name: "Alex Hernández",
      addresses: [{ network: "public", address: ALEX }],
    });

    const remaining = await repos.contacts.unnamedCounterparties(workspace.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.address).toBe(OTHER);
  });

  it("never asks you to name your own tracked accounts", async () => {
    // Add a second owned account and a transfer between the two.
    const second = await repos.accounts.create({
      workspaceId: workspace.id,
      publicKey: OTHER,
      network: "public",
    });
    const owned = await repos.accounts.ownedAddresses(workspace.id, "public");
    await repos.entries.reresolveDirections(workspace.id, "public", owned);

    const unnamed = await repos.contacts.unnamedCounterparties(workspace.id);
    expect(unnamed.map((party) => party.address)).not.toContain(second.publicKey);
  });

  it("reports the span of activity so an address can be judged before naming", async () => {
    const [busiest] = await repos.contacts.unnamedCounterparties(workspace.id);
    expect(busiest!.firstSeen <= busiest!.lastSeen).toBe(true);
    expect(busiest!.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
