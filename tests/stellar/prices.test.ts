import { describe, it, expect, beforeEach, vi } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, PriceRepository, type Repositories } from "../../src/db/repositories";
import { HorizonPriceProvider } from "../../src/stellar/prices";
import { nativeAsset, assetFromFields } from "../../src/stellar/assets";

const USDC = assetFromFields("public", {
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
});
const XLM = nativeAsset("public");

function mockBook(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as unknown as Response);
}

describe("HorizonPriceProvider", () => {
  it("returns the midpoint of the best bid and ask", async () => {
    const fetchMock = mockBook({
      bids: [{ price: "0.1642343" }],
      asks: [{ price: "0.1644658" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HorizonPriceProvider("public", "https://horizon.example");
    const rate = await provider.getRate(XLM, USDC);

    // Exact decimal midpoint: (0.1642343 + 0.1644658) / 2, with no float error.
    expect(rate?.price).toBe("0.16435005");
    expect(rate?.source).toBe("order_book");
    expect(rate?.baseAssetId).toBe("public:native");
  });

  it("asks Horizon for the right pair", async () => {
    const fetchMock = mockBook({ bids: [{ price: "1" }], asks: [{ price: "1" }] });
    vi.stubGlobal("fetch", fetchMock);

    await new HorizonPriceProvider("public", "https://horizon.example").getRate(XLM, USDC);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("selling_asset_type=native");
    expect(url).toContain("buying_asset_code=USDC");
    expect(url).toContain("order_book");
  });

  it("reports no price rather than half a market when one side is empty", async () => {
    vi.stubGlobal("fetch", mockBook({ bids: [{ price: "0.16" }], asks: [] }));
    const rate = await new HorizonPriceProvider("public", "https://horizon.example").getRate(
      XLM,
      USDC,
    );
    expect(rate).toBeNull();
  });

  it("returns null instead of throwing when Horizon is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    const rate = await new HorizonPriceProvider("public", "https://horizon.example").getRate(
      XLM,
      USDC,
    );
    expect(rate).toBeNull();
  });

  it("computes the midpoint exactly, not in floating point", async () => {
    // Values chosen because the float sum is not exactly representable.
    vi.stubGlobal("fetch", mockBook({ bids: [{ price: "0.1" }], asks: [{ price: "0.2" }] }));
    const rate = await new HorizonPriceProvider("public", "https://horizon.example").getRate(
      XLM,
      USDC,
    );
    expect(rate?.price).toBe("0.15");
    expect((0.1 + 0.2) / 2).not.toBe(0.15);
  });

  it("rejects a nonsensical book", async () => {
    vi.stubGlobal("fetch", mockBook({ bids: [{ price: "0" }], asks: [{ price: "0" }] }));
    const rate = await new HorizonPriceProvider("public", "https://horizon.example").getRate(
      XLM,
      USDC,
    );
    expect(rate).toBeNull();
  });
});

describe("rate caching", () => {
  let repos: Repositories;

  beforeEach(async () => {
    const driver = new NodeSqlDriver();
    await migrate(driver);
    repos = createRepositories(driver);
  });

  it("round-trips a rate exactly", async () => {
    await repos.prices.save("public", {
      baseAssetId: XLM.id,
      quoteAssetId: USDC.id,
      price: "0.1643500",
      source: "order_book",
      fetchedAt: "2026-08-19T11:55:00.000Z",
    });

    const stored = await repos.prices.get("public", XLM.id, USDC.id);
    // The stored string is the stored string; no float round-trip.
    expect(stored?.price).toBe("0.1643500");
    expect(stored?.fetchedAt).toBe("2026-08-19T11:55:00.000Z");
  });

  it("overwrites rather than accumulating rows for the same pair", async () => {
    for (const price of ["0.16", "0.17", "0.18"]) {
      await repos.prices.save("public", {
        baseAssetId: XLM.id,
        quoteAssetId: USDC.id,
        price,
        source: "order_book",
        fetchedAt: new Date().toISOString(),
      });
    }
    const rows = await repos.driver.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM asset_prices",
    );
    expect(rows[0]?.count).toBe(1);
    expect((await repos.prices.get("public", XLM.id, USDC.id))?.price).toBe("0.18");
  });

  it("treats a missing or aged-out rate as stale", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    const fresh = {
      baseAssetId: XLM.id,
      quoteAssetId: USDC.id,
      price: "0.16",
      source: "order_book" as const,
      fetchedAt: "2026-08-19T11:58:00.000Z",
    };

    expect(PriceRepository.isStale(null, 300_000, now)).toBe(true);
    expect(PriceRepository.isStale(fresh, 300_000, now)).toBe(false);
    expect(
      PriceRepository.isStale({ ...fresh, fetchedAt: "2026-08-19T11:00:00.000Z" }, 300_000, now),
    ).toBe(true);
  });
});
