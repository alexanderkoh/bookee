import { describe, it, expect } from "vitest";
import {
  add,
  subtract,
  sum,
  compare,
  parseAmount,
  formatAmount,
  isValidAmount,
  InvalidAmountError,
  negate,
} from "../../src/lib/money";

/**
 * These values are not invented: both occur in the validation account
 * a 1-stroop payment alongside a six-figure XLM balance.
 * They are exactly the pair that a float representation cannot hold together.
 */
const ONE_STROOP = "0.0000001";
const LARGE_BALANCE = "384102.7460913";

describe("decimal precision", () => {
  it("round-trips the smallest and largest real amounts without loss", () => {
    expect(parseAmount(ONE_STROOP)).toBe("0.0000001");
    expect(parseAmount(LARGE_BALANCE)).toBe("384102.7460913");
  });

  it("never emits exponential notation, which would corrupt stored amounts", () => {
    // Big.js switches to exponential outside a default range; a 1-stroop amount
    // would otherwise be stored as "1e-7".
    expect(parseAmount(ONE_STROOP)).not.toMatch(/e/i);
    expect(parseAmount("0.0000000001")).not.toMatch(/e/i);
    expect(parseAmount("100000000000000000000000")).not.toMatch(/e/i);
  });

  it("adds a stroop to a large balance exactly", () => {
    expect(add(LARGE_BALANCE, ONE_STROOP)).toBe("384102.7460914");
  });

  it("sums repeated stroops without the drift a float accumulates", () => {
    const tenThousandStroops = Array.from({ length: 10_000 }, () => ONE_STROOP);
    expect(sum(tenThousandStroops)).toBe("0.001");

    // The same sum in floating point drifts away from the exact value.
    const floatTotal = tenThousandStroops.reduce((total, value) => total + Number(value), 0);
    expect(floatTotal).not.toBe(0.001);
  });

  it("avoids the classic 0.1 + 0.2 float error", () => {
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("subtracts exactly", () => {
    expect(subtract(LARGE_BALANCE, LARGE_BALANCE)).toBe("0");
    expect(subtract("1", ONE_STROOP)).toBe("0.9999999");
  });

  it("returns zero for an empty sum", () => {
    expect(sum([])).toBe("0");
  });

  it("compares by value, not by string", () => {
    expect(compare("4", "4.0000000")).toBe(0);
    expect(compare("10", "9")).toBe(1);
    expect(compare("0.0000001", "0.0000002")).toBe(-1);
  });

  it("negates without producing -0", () => {
    expect(negate("0")).toBe("0");
    expect(negate("5.5")).toBe("-5.5");
  });
});

describe("amount validation", () => {
  it("rejects values that are not decimals", () => {
    expect(isValidAmount("abc")).toBe(false);
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount("1.2.3")).toBe(false);
    expect(() => parseAmount("not-a-number")).toThrow(InvalidAmountError);
  });

  it("accepts the decimal forms Horizon actually returns", () => {
    for (const value of ["0.0000000", "3.6100000", "384102.7460913", "0.0000001", "-1.5"]) {
      expect(isValidAmount(value), value).toBe(true);
    }
  });
});

describe("formatting", () => {
  it("groups thousands and keeps two decimals by default", () => {
    expect(formatAmount("18492")).toBe("18,492.00");
    expect(formatAmount("2418.32")).toBe("2,418.32");
  });

  it("does not round a stroop away to 0.00", () => {
    expect(formatAmount(ONE_STROOP)).toBe("0.0000001");
  });

  it("keeps full precision for the large balance", () => {
    expect(formatAmount(LARGE_BALANCE)).toBe("384,102.7460913");
  });

  it("shows an explicit sign when asked", () => {
    expect(formatAmount("5000", { signed: true })).toBe("+5,000.00");
    expect(formatAmount("-1042", { signed: true })).toBe("-1,042.00");
    expect(formatAmount("0", { signed: true })).toBe("0.00");
  });
});
