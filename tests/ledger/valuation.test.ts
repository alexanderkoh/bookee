import { describe, it, expect } from "vitest";
import { valueHolding } from "../../src/ledger/valuation";
import { multiply } from "../../src/lib/money";
import type { MarketRate } from "../../src/stellar/prices";

const rate = (price: string): MarketRate => ({
  baseAssetId: "public:native",
  quoteAssetId: "public:USDC:GA5Z",
  price,
  source: "order_book",
  fetchedAt: "2026-08-19T11:55:00.000Z",
});

describe("valuing a holding", () => {
  it("multiplies exactly rather than in floating point", () => {
    const result = valueHolding("158974.6411849", rate("0.1643500"), "USDC");
    expect(result?.value).toBe("26127.482278738315");

    // The float path loses the tail.
    expect(String(158974.6411849 * 0.16435)).not.toBe("26127.482278738315");
  });

  it("keeps a one-stroop holding meaningful instead of rounding it away", () => {
    const result = valueHolding("0.0000001", rate("0.1643500"), "USDC");
    // Smaller than a stroop, and still exact rather than flattened to zero.
    expect(result?.value).toBe("0.000000016435");
  });

  it("carries the rate and its timestamp, so a figure is never undated", () => {
    const result = valueHolding("100", rate("0.1643500"), "USDC");
    expect(result?.rate).toBe("0.1643500");
    expect(result?.asOf).toBe("2026-08-19T11:55:00.000Z");
    expect(result?.quoteCode).toBe("USDC");
  });

  it("returns nothing when there is no rate, rather than assuming parity", () => {
    expect(valueHolding("100", null, "USDC")).toBeNull();
  });

  it("handles a zero balance", () => {
    expect(valueHolding("0", rate("0.1643500"), "USDC")?.value).toBe("0");
  });
});

describe("what the module deliberately cannot do", () => {
  it("exposes no way to total valuations across assets", async () => {
    const module = await import("../../src/ledger/valuation");
    const names = Object.keys(module);

    // A portfolio total would hide which rates were used and when. If one is
    // ever added, this test should be the argument against it.
    expect(names).toEqual(["valueHolding"]);
    expect(names.some((name) => /total|sum|portfolio/i.test(name))).toBe(false);
  });

  it("multiplication itself stays exact for awkward decimals", () => {
    expect(multiply("0.1", "0.2")).toBe("0.02");
    expect(0.1 * 0.2).not.toBe(0.02);
  });
});
