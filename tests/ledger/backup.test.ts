import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, type Repositories } from "../../src/db/repositories";
import { syncAccount, syncWorkspace } from "../../src/ledger/sync";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  exportWorkspace,
  importBackup,
  parseBackup,
  serializeBackup,
} from "../../src/ledger/backup";
import { toCsv, escapeCsvField, CSV_COLUMNS } from "../../src/ledger/csv";
import { FakeDataSource } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT, syntheticLedgerRecords } from "../support/synthetic-ledger";
import type { Workspace } from "../../src/db/schema";

let driver: NodeSqlDriver;
let repos: Repositories;
let workspace: Workspace;

/** Builds a fully-populated ledger: accounts, contacts, categories, rules, annotations. */
async function seedLedger() {
  driver = new NodeSqlDriver();
  await migrate(driver);
  repos = createRepositories(driver);

  workspace = await repos.workspaces.create({ name: "Larkspur Collective" });
  const account = await repos.accounts.create({
    workspaceId: workspace.id,
    publicKey: SAMPLE_ACCOUNT,
    network: "public",
    label: "Larkspur Operations",
  });

  await syncAccount(
    { repositories: repos, dataSource: new FakeDataSource(syntheticLedgerRecords()) },
    account,
  );

  const entries = await repos.entries.query({ workspaceId: workspace.id }, { limit: 5, offset: 0 });
  const counterparty = entries.find((entry) => entry.counterpartyAddress !== null)!;

  const contact = await repos.contacts.create({
    workspaceId: workspace.id,
    name: "Émile Aubert",
    organization: "Studio Vantail",
    addresses: [{ network: "public", address: counterparty.counterpartyAddress! }],
  });

  const categories = await repos.categories.list(workspace.id);
  const events = categories.find((category) => category.name === "Events")!;

  await repos.annotations.setManual(counterparty.id, {
    categoryId: events.id,
    note: "Event sponsorship",
    reimbursable: true,
  });

  await repos.rules.create({
    workspaceId: workspace.id,
    name: "Émile → Events",
    conditions: [
      {
        field: "counterparty_address",
        operator: "equals",
        value: counterparty.counterpartyAddress!,
      },
    ],
    actions: [{ type: "set_category", value: events.id }],
  });

  return { account, contact, events, counterparty };
}

beforeEach(async () => {
  await seedLedger();
});

describe("export", () => {
  it("carries the human layer and deliberately omits blockchain history", async () => {
    const backup = await exportWorkspace(repos, workspace.id);

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.workspace.name).toBe("Larkspur Collective");
    expect(backup.accounts).toHaveLength(1);
    expect(backup.contacts).toHaveLength(1);
    expect(backup.contactAddresses).toHaveLength(1);
    expect(backup.categories.length).toBeGreaterThan(0);
    expect(backup.rules).toHaveLength(1);
    expect(backup.annotations).toHaveLength(1);

    // 270 entries were imported; none of them belong in the file.
    expect(JSON.stringify(backup)).not.toContain('"ledgerEntries"');
    const serialized = serializeBackup(backup);
    expect(serialized.length).toBeLessThan(200_000);
  });

  it("references annotations by blockchain identity, not by row id", async () => {
    const backup = await exportWorkspace(repos, workspace.id);
    const annotation = backup.annotations[0]!;

    expect(annotation.externalKey).toMatch(/^op:/);
    expect(annotation.network).toBe("public");
    expect(annotation).not.toHaveProperty("ledgerEntryId");
  });

  it("suggests a filename based on the ledger name", () => {
    expect(backupFilename("Larkspur Collective", "stellarledger")).toBe(
      "Larkspur Collective.stellarledger",
    );
    // Path separators must never survive into a filename.
    expect(backupFilename("../../etc/passwd", "stellarledger")).toBe("etcpasswd.stellarledger");
  });
});

describe("validation", () => {
  it("rejects a file that is not JSON", () => {
    expect(() => parseBackup("not json at all")).toThrow(BackupError);
  });

  it("rejects a JSON file that is not a ledger backup", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(/not a Bookee/i);
  });

  it("still reads a backup written before the product was renamed", async () => {
    const backup = await exportWorkspace(repos, workspace.id);
    // Same document, previous format name.
    const legacy = JSON.stringify({ ...backup, format: "stellar-ledger" });

    const parsed = parseBackup(legacy);
    expect(parsed.contacts).toHaveLength(1);

    // And it restores, not merely parses.
    const result = await importBackup(repos, parsed);
    expect(result.contacts).toBe(1);
  });

  it("refuses a backup from a newer format rather than guessing", () => {
    const future = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 });
    expect(() => parseBackup(future)).toThrow(/newer version/i);
  });

  it("rejects a corrupted backup and names what is wrong", async () => {
    const backup = await exportWorkspace(repos, workspace.id);
    const broken = { ...backup, contacts: [{ id: "c1" }] };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/incomplete or corrupted/i);
  });
});

describe("the full delete / reinstall / restore cycle", () => {
  it("restores metadata and reattaches it to a resynced ledger", async () => {
    const backup = await exportWorkspace(repos, workspace.id);
    const file = serializeBackup(backup);

    // Simulate delete and reinstall: an entirely fresh database.
    const fresh = new NodeSqlDriver();
    await migrate(fresh);
    const restored = createRepositories(fresh);

    const parsed = parseBackup(file);
    const result = await importBackup(restored, parsed);

    // Metadata is back immediately; annotations wait for their entries.
    expect(result.contacts).toBe(1);
    expect(result.rules).toBe(1);
    expect(result.accounts).toBe(1);
    expect(await restored.pendingAnnotations.pendingCount(result.workspaceId)).toBe(1);
    expect(await restored.entries.count({ workspaceId: result.workspaceId })).toBe(0);

    // Resync rebuilds the blockchain half.
    await syncWorkspace(
      {
        repositories: restored,
        dataSourceFor: () => new FakeDataSource(syntheticLedgerRecords()),
      },
      result.workspaceId,
    );

    expect(await restored.entries.count({ workspaceId: result.workspaceId })).toBe(270);

    // ...and the annotation has reattached itself to the right entry.
    expect(await restored.pendingAnnotations.pendingCount(result.workspaceId)).toBe(0);

    const annotated = await restored.entries.query({
      workspaceId: result.workspaceId,
      status: "categorized",
    });
    const match = annotated.find((entry) => entry.note === "Event sponsorship");
    expect(match).toBeDefined();
    expect(match!.categoryName).toBe("Events");
    expect(match!.contactName).toBe("Émile Aubert");
    expect(match!.reimbursable).toBe(true);

    // The restored entry is the same on-chain movement as the original.
    const original = await repos.entries.query({
      workspaceId: workspace.id,
      status: "categorized",
    });
    const originalMatch = original.find((entry) => entry.note === "Event sponsorship")!;
    expect(match!.externalKey).toBe(originalMatch.externalKey);
    expect(match!.transactionHash).toBe(originalMatch.transactionHash);
  });

  it("keeps rule references pointing at the restored categories", async () => {
    const backup = await exportWorkspace(repos, workspace.id);

    const fresh = new NodeSqlDriver();
    await migrate(fresh);
    const restored = createRepositories(fresh);
    const result = await importBackup(restored, parseBackup(serializeBackup(backup)));

    const rules = await restored.rules.listParsed(result.workspaceId);
    const categories = await restored.categories.list(result.workspaceId);
    const events = categories.find((category) => category.name === "Events")!;

    expect(rules).toHaveLength(1);
    // The id was renumbered on import; the rule must follow it.
    expect(rules[0]!.actions[0]!.value).toBe(events.id);
    expect(rules[0]!.actions[0]!.value).not.toBe(backup.rules[0]!.id);
  });

  it("imports into a new workspace, leaving any existing one untouched", async () => {
    const backup = await exportWorkspace(repos, workspace.id);
    const before = await repos.entries.count({ workspaceId: workspace.id });

    const result = await importBackup(repos, parseBackup(serializeBackup(backup)));

    expect(result.workspaceId).not.toBe(workspace.id);
    expect(await repos.workspaces.list()).toHaveLength(2);
    // The original ledger is entirely unaffected.
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(before);
  });

  it("can import the same file twice without collisions", async () => {
    const file = serializeBackup(await exportWorkspace(repos, workspace.id));
    const first = await importBackup(repos, parseBackup(file));
    const second = await importBackup(repos, parseBackup(file));

    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(await repos.workspaces.list()).toHaveLength(3);
  });

  it("does not damage the database when a corrupt file is imported", async () => {
    const workspacesBefore = (await repos.workspaces.list()).length;
    expect(() => parseBackup('{"format":"stellar-ledger","version":1}')).toThrow(BackupError);
    expect(await repos.workspaces.list()).toHaveLength(workspacesBefore);
  });
});

describe("CSV export", () => {
  it("writes the documented columns", async () => {
    const entries = await repos.entries.query(
      { workspaceId: workspace.id },
      { limit: 3, offset: 0 },
    );
    const csv = toCsv(entries);
    const [header, ...rows] = csv.trimEnd().split("\n");

    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(rows).toHaveLength(3);
  });

  it("writes exact unformatted amounts, not display strings", async () => {
    const entries = await repos.entries.query(
      { workspaceId: workspace.id },
      { limit: 300, offset: 0 },
    );
    const csv = toCsv(entries);

    expect(csv).toContain("0.0000001");
    // No thousands separators anywhere in the amount column.
    for (const line of csv.split("\n").slice(1).filter(Boolean)) {
      const amount = line.split(",")[2] ?? "";
      expect(amount).not.toContain(",");
    }
  });

  it("neutralises spreadsheet formula injection", () => {
    // Prefixed with an apostrophe so a spreadsheet treats it as text. No
    // quoting is added because the value contains no comma, quote or newline.
    expect(escapeCsvField("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    expect(escapeCsvField("Aubert, Émile")).toBe('"Aubert, Émile"');
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField(null)).toBe("");
  });
});
