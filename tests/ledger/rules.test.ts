import { describe, it, expect, beforeEach } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, type Repositories } from "../../src/db/repositories";
import {
  evaluateRules,
  matchesRule,
  parseRule,
  type ParsedRule,
  type RuleTarget,
} from "../../src/ledger/rules";
import { applyRules, previewMatches, reapplyRules } from "../../src/ledger/apply-rules";
import { syncAccount } from "../../src/ledger/sync";
import { FakeDataSource, loadFixture } from "../support/fake-data-source";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";
import type { Workspace } from "../../src/db/schema";

const ALEX = "GALEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

function target(overrides: Partial<RuleTarget> = {}): RuleTarget {
  return {
    id: "entry-1",
    counterpartyAddress: ALEX,
    contactId: null,
    direction: "outgoing",
    assetId: "public:USDC:GISSUER",
    memoValue: "March invoice",
    amount: "100",
    ...overrides,
  };
}

function rule(overrides: Partial<ParsedRule> = {}): ParsedRule {
  return {
    id: "rule-1",
    name: "Alex → Events",
    enabled: true,
    priority: 100,
    conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
    actions: [{ type: "set_category", value: "events" }],
    ...overrides,
  };
}

describe("condition matching", () => {
  it("matches an exact counterparty", () => {
    expect(matchesRule(target(), rule())).toBe(true);
    expect(matchesRule(target({ counterpartyAddress: "GOTHER" }), rule())).toBe(false);
  });

  it("requires every condition to match", () => {
    const both = rule({
      conditions: [
        { field: "counterparty_address", operator: "equals", value: ALEX },
        { field: "direction", operator: "equals", value: "outgoing" },
      ],
    });
    expect(matchesRule(target(), both)).toBe(true);
    expect(matchesRule(target({ direction: "incoming" }), both)).toBe(false);
  });

  it("matches memo text case-insensitively, by substring or exactly", () => {
    const contains = rule({
      conditions: [{ field: "memo", operator: "contains", value: "invoice" }],
    });
    expect(matchesRule(target(), contains)).toBe(true);
    expect(matchesRule(target({ memoValue: "INVOICE 12" }), contains)).toBe(true);
    expect(matchesRule(target({ memoValue: "rent" }), contains)).toBe(false);

    const equals = rule({
      conditions: [{ field: "memo", operator: "equals", value: "march invoice" }],
    });
    expect(matchesRule(target(), equals)).toBe(true);
  });

  it("never matches when the field is absent", () => {
    const memo = rule({ conditions: [{ field: "memo", operator: "contains", value: "x" }] });
    expect(matchesRule(target({ memoValue: null }), memo)).toBe(false);
  });

  it("compares amounts exactly, not as floats", () => {
    const over = rule({
      conditions: [{ field: "amount", operator: "greater_than", value: "0.0000001" }],
    });
    expect(matchesRule(target({ amount: "0.0000002" }), over)).toBe(true);
    expect(matchesRule(target({ amount: "0.0000001" }), over)).toBe(false);

    // Lexicographic comparison would call "9" greater than "10".
    const under = rule({
      conditions: [{ field: "amount", operator: "less_than", value: "10" }],
    });
    expect(matchesRule(target({ amount: "9" }), under)).toBe(true);
    expect(matchesRule(target({ amount: "100" }), under)).toBe(false);
  });

  it("treats a rule with no conditions as inert rather than matching everything", () => {
    expect(matchesRule(target(), rule({ conditions: [] }))).toBe(false);
  });
});

describe("priority", () => {
  it("lets the lowest priority number win a contested field", () => {
    const first = rule({
      id: "first",
      priority: 1,
      actions: [{ type: "set_category", value: "rent" }],
    });
    const second = rule({
      id: "second",
      priority: 50,
      actions: [{ type: "set_category", value: "events" }],
    });

    expect(evaluateRules(target(), [second, first]).categoryId).toBe("rent");
  });

  it("still lets a lower-priority rule fill a field the first one left alone", () => {
    const first = rule({
      id: "a",
      priority: 1,
      actions: [{ type: "set_category", value: "rent" }],
    });
    const second = rule({
      id: "b",
      priority: 2,
      actions: [{ type: "set_note", value: "from rule" }],
    });

    const outcome = evaluateRules(target(), [first, second]);
    expect(outcome.categoryId).toBe("rent");
    expect(outcome.note).toBe("from rule");
  });

  it("ignores disabled rules", () => {
    expect(evaluateRules(target(), [rule({ enabled: false })]).categoryId).toBeUndefined();
  });
});

describe("parseRule", () => {
  it("rejects an operator that cannot apply to its field", () => {
    const parsed = parseRule({
      id: "r",
      name: "bad",
      enabled: true,
      priority: 1,
      conditionsJson: JSON.stringify([
        { field: "direction", operator: "greater_than", value: "outgoing" },
      ]),
      actionsJson: "[]",
    });
    expect(parsed).toBeNull();
  });

  it("returns null for unreadable JSON instead of throwing", () => {
    const parsed = parseRule({
      id: "r",
      name: "broken",
      enabled: true,
      priority: 1,
      conditionsJson: "{not json",
      actionsJson: "[]",
    });
    expect(parsed).toBeNull();
  });
});

describe("applying rules to a ledger", () => {
  let driver: NodeSqlDriver;
  let repos: Repositories;
  let workspace: Workspace;
  let eventsCategoryId: string;

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

    // A small, deterministic set of real-shaped records.
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
        from: ALEX,
        to: SAMPLE_ACCOUNT,
        amount: "75.0000000",
      },
      {
        ...template,
        id: "3",
        paging_token: "3",
        from: "GSTRANGER",
        to: SAMPLE_ACCOUNT,
        amount: "10.0000000",
      },
    ];
    await syncAccount({ repositories: repos, dataSource: new FakeDataSource(records) }, account);

    const categories = await repos.categories.list(workspace.id);
    eventsCategoryId = categories.find((category) => category.name === "Events")!.id;
  });

  it("previews how many existing transactions a rule would match", async () => {
    const count = await previewMatches(
      repos,
      workspace.id,
      rule({ actions: [{ type: "set_category", value: eventsCategoryId }] }),
    );
    expect(count).toBe(2);
  });

  it("classifies matching entries and leaves others alone", async () => {
    await repos.rules.create({
      workspaceId: workspace.id,
      name: "Alex → Events",
      conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
      actions: [{ type: "set_category", value: eventsCategoryId }],
    });

    const result = await applyRules(repos, workspace.id);
    expect(result.changed).toBe(2);

    const categorized = await repos.entries.count({
      workspaceId: workspace.id,
      categoryId: eventsCategoryId,
    });
    expect(categorized).toBe(2);

    const uncategorized = await repos.entries.uncategorizedCount(workspace.id);
    expect(uncategorized).toBe(1);
  });

  it("never overwrites a category the user set by hand", async () => {
    const entries = await repos.entries.query({ workspaceId: workspace.id });
    const alexEntry = entries.find((entry) => entry.counterpartyAddress === ALEX)!;

    const categories = await repos.categories.list(workspace.id);
    const rentId = categories.find((category) => category.name === "Rent")!.id;

    await repos.annotations.setManual(alexEntry.id, { categoryId: rentId });

    await repos.rules.create({
      workspaceId: workspace.id,
      name: "Alex → Events",
      conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
      actions: [{ type: "set_category", value: eventsCategoryId }],
    });
    await applyRules(repos, workspace.id);

    const annotation = await repos.annotations.findByEntry(alexEntry.id);
    expect(annotation?.categoryId).toBe(rentId);
    expect(annotation?.categorySource).toBe("manual");
  });

  it("is idempotent across repeated runs", async () => {
    await repos.rules.create({
      workspaceId: workspace.id,
      name: "Alex → Events",
      conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
      actions: [{ type: "set_category", value: eventsCategoryId }],
    });

    await applyRules(repos, workspace.id);
    const second = await applyRules(repos, workspace.id);

    // Nothing left to change on the second pass.
    expect(second.changed).toBe(0);
    expect(
      await repos.entries.count({ workspaceId: workspace.id, categoryId: eventsCategoryId }),
    ).toBe(2);
  });

  it("clears rule results when a rule is removed, keeping manual edits", async () => {
    const created = await repos.rules.create({
      workspaceId: workspace.id,
      name: "Alex → Events",
      conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
      actions: [{ type: "set_category", value: eventsCategoryId }],
    });
    await applyRules(repos, workspace.id);

    const entries = await repos.entries.query({ workspaceId: workspace.id });
    const stranger = entries.find((entry) => entry.counterpartyAddress === "GSTRANGER")!;
    await repos.annotations.setManual(stranger.id, { note: "kept by hand" });

    await repos.rules.remove(created.id);
    await reapplyRules(repos, workspace.id);

    expect(
      await repos.entries.count({ workspaceId: workspace.id, categoryId: eventsCategoryId }),
    ).toBe(0);
    const annotation = await repos.annotations.findByEntry(stranger.id);
    expect(annotation?.note).toBe("kept by hand");
  });

  it("classifies newly imported entries during sync", async () => {
    await repos.rules.create({
      workspaceId: workspace.id,
      name: "Alex → Events",
      conditions: [{ field: "counterparty_address", operator: "equals", value: ALEX }],
      actions: [{ type: "set_category", value: eventsCategoryId }],
    });

    const { syncWorkspace } = await import("../../src/ledger/sync");
    const template = loadFixture("operation-payment");
    const newRecords = [
      {
        ...template,
        id: "4",
        paging_token: "4",
        from: ALEX,
        to: SAMPLE_ACCOUNT,
        amount: "9.0000000",
      },
    ];

    await syncWorkspace(
      { repositories: repos, dataSourceFor: () => new FakeDataSource(newRecords) },
      workspace.id,
    );

    // The rule ran as part of the sync, without a separate user action.
    expect(
      await repos.entries.count({ workspaceId: workspace.id, categoryId: eventsCategoryId }),
    ).toBeGreaterThanOrEqual(1);
  });
});
