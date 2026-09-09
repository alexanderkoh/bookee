/**
 * Spam scoring.
 *
 * These are mostly tests about what must NOT be flagged. Surfacing junk that
 * turns out to be real costs the user a glance; hiding a real payment because
 * it happened to look repetitive costs them their books, so the asymmetry is
 * the thing being pinned down here.
 */
import { describe, it, expect } from "vitest";
import { assessSpam, DUST_THRESHOLD, type CounterpartyActivity } from "../../src/ledger/spam";

function activity(overrides: Partial<CounterpartyActivity> = {}): CounterpartyActivity {
  return {
    address: "GARSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKTT5",
    memo: null,
    network: "public",
    entryCount: 1,
    incomingCount: 1,
    outgoingCount: 0,
    distinctAmountCount: 1,
    largestAmount: "0.0000001",
    assetCodes: ["FREEBIE"],
    onlyUnfamiliarAssets: true,
    memoSamples: [],
    ...overrides,
  };
}

describe("recognising spam", () => {
  it("flags the classic shape: dust, unknown asset, never paid, advertising memo", () => {
    const result = assessSpam(activity({ memoSamples: ["Claim your bonus at https://x.example"] }));
    expect(result.verdict).toBe("likely");
    expect(result.signals).toContain("dust-only");
    expect(result.signals).toContain("promotional-memo");
    expect(result.signals).toContain("never-sent-to");
  });

  it("flags a scripted airdrop with no memo at all", () => {
    const result = assessSpam(activity({ entryCount: 40, distinctAmountCount: 1 }));
    expect(result.verdict).toBe("likely");
    expect(result.signals).toContain("repetitive");
  });
});

describe("what must never be flagged", () => {
  it("leaves a salary alone, though it is repetitive and never reciprocated", () => {
    // Incoming only, identical every month, from someone never paid — three
    // signals if amount were ignored. The amount is the whole point.
    const result = assessSpam(
      activity({
        entryCount: 12,
        distinctAmountCount: 1,
        largestAmount: "4200.00",
        assetCodes: ["USDC"],
        onlyUnfamiliarAssets: false,
        memoSamples: ["Salary"],
      }),
    );
    expect(result.verdict).toBe("unremarkable");
  });

  it("leaves a grant alone even when the memo mentions a website", () => {
    const result = assessSpam(
      activity({
        largestAmount: "15000",
        assetCodes: ["USDC"],
        onlyUnfamiliarAssets: false,
        memoSamples: ["Grant disbursement, see https://foundation.example/terms"],
      }),
    );
    expect(result.verdict).toBe("unremarkable");
  });

  it("leaves a tiny refund from someone you actually trade with alone", () => {
    const result = assessSpam(
      activity({
        incomingCount: 1,
        outgoingCount: 9,
        largestAmount: "0.0031",
        assetCodes: ["XLM"],
        onlyUnfamiliarAssets: false,
        memoSamples: ["Overpayment refund"],
      }),
    );
    expect(result.verdict).toBe("unremarkable");
  });

  it("does not read an invoice number as advertising", () => {
    const result = assessSpam(
      activity({
        largestAmount: "0.005",
        incomingCount: 3,
        outgoingCount: 3,
        entryCount: 6,
        distinctAmountCount: 4,
        assetCodes: ["USDC"],
        onlyUnfamiliarAssets: false,
        memoSamples: ["invoice 4021", "invoice 4022"],
      }),
    );
    expect(result.signals).not.toContain("promotional-memo");
    expect(result.verdict).toBe("unremarkable");
  });
});

describe("the dust boundary", () => {
  it("treats the threshold itself as dust, and a hair above it as money", () => {
    expect(assessSpam(activity({ largestAmount: DUST_THRESHOLD })).signals).toContain("dust-only");
    expect(assessSpam(activity({ largestAmount: "0.0100001" })).signals).not.toContain("dust-only");
  });

  it("judges on the largest amount, so one real payment rescues the whole group", () => {
    const result = assessSpam(
      activity({ entryCount: 30, distinctAmountCount: 2, largestAmount: "250.00" }),
    );
    expect(result.verdict).toBe("unremarkable");
  });
});

describe("degrees of confidence", () => {
  it("is only tentative when dust is the sole corroborated signal", () => {
    const result = assessSpam(
      activity({ assetCodes: ["XLM"], onlyUnfamiliarAssets: false, largestAmount: "0.002" }),
    );
    expect(result.verdict).toBe("possible");
    expect(result.signals).toEqual(["never-sent-to", "dust-only"]);
  });

  it("says nothing about a dust payment from an established counterparty", () => {
    const result = assessSpam(
      activity({
        incomingCount: 2,
        outgoingCount: 5,
        entryCount: 7,
        distinctAmountCount: 6,
        assetCodes: ["XLM"],
        onlyUnfamiliarAssets: false,
        largestAmount: "0.004",
      }),
    );
    expect(result.verdict).toBe("unremarkable");
  });
});
