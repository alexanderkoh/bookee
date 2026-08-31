// @vitest-environment jsdom
/**
 * Rule editor invariants.
 *
 * The editor's job is to make an invalid rule hard to express, so these check
 * the constraints rather than the markup.
 */
import { describe, it, expect } from "vitest";
import {
  OPERATORS_BY_FIELD,
  CONDITION_FIELDS,
  conditionSchema,
  describeCondition,
} from "../../src/ledger/rules";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";

describe("operator offering", () => {
  it("offers at least one operator for every field", () => {
    for (const field of CONDITION_FIELDS) {
      expect(OPERATORS_BY_FIELD[field].length, field).toBeGreaterThan(0);
    }
  });

  it("only offers comparison operators for amounts", () => {
    expect(OPERATORS_BY_FIELD.amount).toEqual(["greater_than", "less_than"]);
    // Comparing an address with "greater than" is meaningless.
    expect(OPERATORS_BY_FIELD.counterparty_address).toEqual(["equals"]);
  });

  it("offers substring matching only where text is involved", () => {
    expect(OPERATORS_BY_FIELD.memo).toContain("contains");
    expect(OPERATORS_BY_FIELD.direction).not.toContain("contains");
  });

  it("rejects a field/operator pairing the editor would never produce", () => {
    const invalid = conditionSchema.safeParse({
      field: "direction",
      operator: "contains",
      value: "in",
    });
    expect(invalid.success).toBe(false);

    const valid = conditionSchema.safeParse({
      field: "memo",
      operator: "contains",
      value: "invoice",
    });
    expect(valid.success).toBe(true);
  });
});

describe("rule descriptions", () => {
  it("shows a contact's name rather than its id", () => {
    const text = describeCondition(
      { field: "contact", operator: "equals", value: "contact-123" },
      { contacts: { "contact-123": "Alex Hernández" } },
    );
    expect(text).toContain("Alex Hernández");
    expect(text).not.toContain("contact-123");
  });

  it("shortens a long address so the rules list stays readable", () => {
    const address = SAMPLE_ACCOUNT;
    const text = describeCondition({
      field: "counterparty_address",
      operator: "equals",
      value: address,
    });
    expect(text).toContain(`${address.slice(0, 4)}…${address.slice(-4)}`);
    expect(text).not.toContain(address);
  });
});
