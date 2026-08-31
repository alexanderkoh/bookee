/**
 * Market rates, from the Stellar DEX.
 *
 * Deliberately narrow in scope. This answers "what is one XLM trading at in
 * USDC right now" — an observation with a timestamp — and nothing else. It is
 * not a valuation engine: no balance is ever multiplied by a rate, and no
 * total is ever computed across assets. Those remain out of scope precisely
 * because a number like "portfolio: $19,472" implies a certainty the data
 * cannot support.
 *
 * The rate comes from Horizon's order book, so the only host contacted is the
 * one already supplying the ledger. A third-party price API would leak which
 * assets a user holds.
 */
import type { Amount } from "../lib/money";
import { greaterThan, isValidAmount, midpoint, parseAmount } from "../lib/money";
import type { Network } from "../db/schema";
import type { AssetRef } from "./types";
import { createLogger } from "../lib/log";

const log = createLogger("prices");

export interface MarketRate {
  baseAssetId: string;
  quoteAssetId: string;
  price: Amount;
  source: "order_book" | "last_trade";
  fetchedAt: string;
}

/**
 * The seam a future pricing source would implement.
 *
 * Anticipated in the architecture from the start; this is its first concrete
 * implementation.
 */
export interface PriceProvider {
  readonly network: Network;
  getRate(base: AssetRef, quote: AssetRef): Promise<MarketRate | null>;
}

function assetParams(asset: AssetRef, prefix: string): Record<string, string> {
  if (asset.assetType === "native") return { [`${prefix}_asset_type`]: "native" };
  return {
    [`${prefix}_asset_type`]: asset.assetType,
    [`${prefix}_asset_code`]: asset.code ?? "",
    [`${prefix}_asset_issuer`]: asset.issuer ?? "",
  };
}

/**
 * Midpoint of the best bid and ask.
 *
 * The mid is the honest single number for "the price": the bid alone
 * understates it and the ask overstates it, and on a thin book the two can sit
 * far apart. When the book is empty there is no price, and saying so is better
 * than reporting a stale one as current.
 */
export class HorizonPriceProvider implements PriceProvider {
  constructor(
    readonly network: Network,
    private readonly baseUrl: string,
    private readonly timeoutMs = 8000,
  ) {}

  async getRate(base: AssetRef, quote: AssetRef): Promise<MarketRate | null> {
    const params = new URLSearchParams({
      ...assetParams(base, "selling"),
      ...assetParams(quote, "buying"),
      limit: "1",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/order_book?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;

      const book = (await response.json()) as {
        bids?: Array<{ price?: string }>;
        asks?: Array<{ price?: string }>;
      };

      const bid = book.bids?.[0]?.price;
      const ask = book.asks?.[0]?.price;
      // One side alone is not a market; without both there is no honest mid.
      if (!bid || !ask) return null;

      if (!isValidAmount(bid) || !isValidAmount(ask)) return null;

      // Exact decimal arithmetic, like every other amount in this application.
      const mid = midpoint(bid, ask);
      if (!greaterThan(mid, "0")) return null;

      return {
        baseAssetId: base.id,
        quoteAssetId: quote.id,
        price: parseAmount(mid),
        source: "order_book",
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.warn("rate lookup failed", {
        base: base.displayCode,
        quote: quote.displayCode,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
