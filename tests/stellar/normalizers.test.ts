import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRecord, normalizeRecords } from "../../src/stellar/normalizers";
import { compare } from "../../src/lib/money";
import { resolveDirection, isRelevant } from "../../src/ledger/counterparty";
import type { NormalizationContext } from "../../src/stellar/types";
import { syntheticLedgerRecords, SAMPLE_TOTALS } from "../support/synthetic-ledger";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "stellar");

function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;
}

const ctx: NormalizationContext = { network: "public" };

/**
 * Amounts are stored in canonical decimal form, so "4.0000000" from Horizon is
 * stored as "4". What must never change is the value, so compare numerically
 * rather than by string representation.
 */
function expectSameAmount(actual: string, expected: string): void {
  expect(compare(actual, expected), `${actual} should equal ${expected}`).toBe(0);
}

describe("payment parser", () => {
  it("normalizes a classic payment from a real Horizon record", () => {
    const record = fixture("operation-payment");
    const { movements, issues } = normalizeRecord(record, ctx);

    expect(issues).toEqual([]);
    expect(movements).toHaveLength(1);

    const movement = movements[0]!;
    expect(movement.externalKey).toBe(`op:${record.id}`);
    expect(movement.movementType).toBe("payment");
    expectSameAmount(movement.amount, record.amount);
    expect(movement.fromAddress).toBe(record.from);
    expect(movement.toAddress).toBe(record.to);
    expect(movement.transactionHash).toBe(record.transaction_hash);
    expect(movement.asset.displayCode).toBe(record.asset_code);
    expect(movement.asset.issuer).toBe(record.asset_issuer);
  });

  it("distinguishes assets by code AND issuer, never by code alone", () => {
    const record = fixture("operation-payment");
    const impostor = { ...record, id: "999", asset_issuer: "GIMPOSTOR".padEnd(56, "X") };

    const a = normalizeRecord(record, ctx).movements[0]!;
    const b = normalizeRecord(impostor, ctx).movements[0]!;

    expect(a.asset.displayCode).toBe(b.asset.displayCode);
    expect(a.asset.id).not.toBe(b.asset.id);
  });

  it("reports a malformed record as an issue instead of throwing or dropping it", () => {
    const broken = { ...fixture("operation-payment"), amount: undefined };
    const { movements, issues } = normalizeRecord(broken, ctx);

    expect(movements).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("malformed_record");
    expect(issues[0]!.raw).toBe(broken);
  });
});

describe("create_account parser", () => {
  it("normalizes account creation as a native XLM movement", () => {
    const record = fixture("operation-create_account");
    const { movements, issues } = normalizeRecord(record, ctx);

    expect(issues).toEqual([]);
    expect(movements).toHaveLength(1);
    const movement = movements[0]!;
    expect(movement.movementType).toBe("create_account");
    expect(movement.asset.displayCode).toBe("XLM");
    expect(movement.asset.id).toBe("public:native");
    expect(movement.fromAddress).toBe(record.funder);
    expect(movement.toAddress).toBe(record.account);
    // Sponsored creations legitimately start at zero; the entry is still real.
    expectSameAmount(movement.amount, record.starting_balance);
  });
});

describe("path payment parser", () => {
  it("emits a source and a destination movement for a real asset conversion", () => {
    const record = fixture("operation-path_payment_strict_send");
    const { movements, issues } = normalizeRecord(record, ctx);

    expect(issues).toEqual([]);
    expect(movements).toHaveLength(2);

    const [source, destination] = movements;
    expect(source!.externalKey).toBe(`op:${record.id}:src`);
    expectSameAmount(source!.amount, record.source_amount);
    expect(source!.asset.displayCode).toBe(record.source_asset_code);
    expect(source!.relevantParty).toBe("from");

    expect(destination!.externalKey).toBe(`op:${record.id}:dst`);
    expectSameAmount(destination!.amount, record.amount);
    expect(destination!.asset.displayCode).toBe(record.asset_code ?? "XLM");
    expect(destination!.relevantParty).toBe("to");
  });

  it("keeps both sides of a self path payment, which is how a swap appears", () => {
    // This fixture really does have from === to: an account swapping SHX for USDC.
    const record = fixture("operation-path_payment_strict_send");
    expect(record.from).toBe(record.to);

    const owned = new Set<string>([record.from]);
    const { movements } = normalizeRecord(record, ctx);
    const resolved = movements.map((m) => resolveDirection(m, owned));

    expect(resolved[0]!.direction).toBe("outgoing");
    expect(resolved[1]!.direction).toBe("incoming");
  });

  it("drops the side that does not involve an owned account", () => {
    const record = fixture("operation-path_payment_strict_receive");
    const { movements } = normalizeRecord(record, ctx);

    // Only the receiving side is ours, so only the asset we actually received counts.
    const owned = new Set<string>([record.to]);
    const relevant = movements.filter((m) => isRelevant(m, owned));

    if (record.from === record.to) {
      expect(relevant).toHaveLength(movements.length);
    } else {
      expect(relevant).toHaveLength(1);
      expect(relevant[0]!.relevantParty).toBe("to");
    }
  });

  it("collapses to one internal movement when no conversion happened", () => {
    const record = {
      ...fixture("operation-path_payment_strict_send"),
      asset_type: "native",
      asset_code: undefined,
      asset_issuer: undefined,
      source_asset_type: "native",
      source_asset_code: undefined,
      source_asset_issuer: undefined,
      amount: "5.0000000",
      source_amount: "5.0000000",
    };
    const { movements } = normalizeRecord(record, ctx);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.relevantParty).toBe("both");
  });
});

describe("account_merge parser", () => {
  const record = fixture("operation-account_merge");

  it("confirms Horizon supplies no amount for a merge", () => {
    expect(record).not.toHaveProperty("amount");
  });

  it("records a sync issue rather than inventing an amount", () => {
    const { movements, issues } = normalizeRecord(record, ctx);
    expect(movements).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("missing_amount");
  });

  it("normalizes the merge once the amount is resolved from effects", () => {
    const effects = fixture("operation-account_merge-effects");
    const credited = effects._embedded.records.find((e: any) => e.type === "account_credited");
    expect(credited).toBeDefined();

    const withAmount: NormalizationContext = {
      network: "public",
      mergeAmounts: new Map([
        [record.id, { amount: credited.amount, assetType: credited.asset_type }],
      ]),
    };

    const { movements, issues } = normalizeRecord(record, withAmount);
    expect(issues).toEqual([]);
    expect(movements).toHaveLength(1);
    const movement = movements[0]!;
    expect(movement.movementType).toBe("account_merge");
    expectSameAmount(movement.amount, credited.amount);
    expect(movement.asset.displayCode).toBe("XLM");
    expect(movement.fromAddress).toBe(record.account);
    expect(movement.toAddress).toBe(record.into);
    expect(movement.externalKey).toBe(`op:${record.id}:merge`);
  });
});

describe("Stellar Asset Contract parser", () => {
  it("normalizes a transfer with both endpoints present", () => {
    const record = fixture("sac-transfer");
    const change = record.asset_balance_changes[0];
    const { movements, issues } = normalizeRecord(record, ctx);

    expect(issues).toEqual([]);
    expect(movements).toHaveLength(record.asset_balance_changes.length);
    const movement = movements[0]!;
    expect(movement.movementType).toBe("sac_transfer");
    expect(movement.fromAddress).toBe(change.from);
    expect(movement.toAddress).toBe(change.to);
    expectSameAmount(movement.amount, change.amount);
    expect(movement.externalKey).toBe(`op:${record.id}:bc:0`);
  });

  it("handles a mint, which has no `from`", () => {
    const record = fixture("sac-mint");
    const { movements } = normalizeRecord(record, ctx);
    const mint = movements.find((m) => m.movementType === "mint");

    expect(mint).toBeDefined();
    expect(mint!.fromAddress).toBeNull();
    expect(mint!.toAddress).not.toBeNull();

    // With no sender, an owned recipient makes this incoming.
    const owned = new Set<string>([mint!.toAddress!]);
    expect(resolveDirection(mint!, owned).direction).toBe("incoming");
  });

  it("handles a burn, which has no `to`", () => {
    const record = fixture("sac-burn");
    const { movements } = normalizeRecord(record, ctx);
    const burn = movements.find((m) => m.movementType === "burn");

    expect(burn).toBeDefined();
    expect(burn!.toAddress).toBeNull();
    expect(burn!.fromAddress).not.toBeNull();

    const owned = new Set<string>([burn!.fromAddress!]);
    expect(resolveDirection(burn!, owned).direction).toBe("outgoing");
  });

  it("handles a clawback like a burn", () => {
    const record = fixture("derived/sac-clawback");
    const { movements } = normalizeRecord(record, ctx);
    const clawback = movements.find((m) => m.movementType === "clawback");

    expect(clawback).toBeDefined();
    expect(clawback!.toAddress).toBeNull();
    const owned = new Set<string>([clawback!.fromAddress!]);
    expect(resolveDirection(clawback!, owned).direction).toBe("outgoing");
  });

  it("produces one movement per balance change with index-based keys", () => {
    const record = fixture("sac-multiple-balance-changes");
    const changes = record.asset_balance_changes;
    expect(changes.length).toBeGreaterThan(1);

    const { movements } = normalizeRecord(record, ctx);
    expect(movements).toHaveLength(changes.length);

    const keys = movements.map((m) => m.externalKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(`op:${record.id}:bc:0`);
  });

  it("keeps two identical balance changes distinct, which a content hash could not", () => {
    const record = fixture("sac-transfer");
    const change = record.asset_balance_changes[0];
    // One operation may legitimately carry repeated identical changes.
    const duplicated = { ...record, asset_balance_changes: [change, { ...change }] };

    const { movements } = normalizeRecord(duplicated, ctx);
    expect(movements).toHaveLength(2);
    expect(movements[0]!.externalKey).not.toBe(movements[1]!.externalKey);
  });

  it("produces nothing for a contract call that touched no classic balances", () => {
    const record = { ...fixture("sac-transfer"), asset_balance_changes: [] };
    const { movements, issues } = normalizeRecord(record, ctx);
    expect(movements).toEqual([]);
    expect(issues).toEqual([]);
  });
});

describe("unsupported records", () => {
  it("keeps an unknown record as a diagnosable issue instead of discarding it", () => {
    const record = { id: "42", type: "set_options", created_at: "2026-01-01T00:00:00Z" };
    const { movements, issues } = normalizeRecord(record, ctx);

    expect(movements).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("unsupported_record");
    expect(issues[0]!.externalId).toBe("42");
    expect(issues[0]!.raw).toBe(record);
  });
});

describe("full page normalization", () => {
  it("normalizes a whole account history without issues or key collisions", () => {
    const records = syntheticLedgerRecords();
    const { movements, issues } = normalizeRecords(records, ctx);

    expect(records).toHaveLength(SAMPLE_TOTALS.entries);
    expect(issues).toEqual([]);
    expect(movements).toHaveLength(SAMPLE_TOTALS.entries);
    // Every entry needs its own dedup key, or a resync would collapse rows.
    expect(new Set(movements.map((m) => m.externalKey)).size).toBe(SAMPLE_TOTALS.entries);
  });
});
