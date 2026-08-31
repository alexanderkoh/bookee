import type { SqlDriver } from "../driver";
import type { SqlRow } from "../row";
import type { Network } from "../schema";
import type { MarketRate } from "../../stellar/prices";

/**
 * Cache of market rates.
 *
 * A rate is only worth showing if you know when it was taken, so `fetchedAt`
 * travels with it everywhere and the UI states the age rather than implying
 * the number is live.
 */
export class PriceRepository {
  constructor(private readonly driver: SqlDriver) {}

  async get(
    network: Network,
    baseAssetId: string,
    quoteAssetId: string,
  ): Promise<MarketRate | null> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT base_asset_id, quote_asset_id, price, source, fetched_at
       FROM asset_prices
       WHERE network = ? AND base_asset_id = ? AND quote_asset_id = ?`,
      [network, baseAssetId, quoteAssetId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      baseAssetId: row["base_asset_id"],
      quoteAssetId: row["quote_asset_id"],
      price: row["price"],
      source: row["source"],
      fetchedAt: row["fetched_at"],
    };
  }

  async save(network: Network, rate: MarketRate): Promise<void> {
    await this.driver.execute(
      `INSERT INTO asset_prices
         (network, base_asset_id, quote_asset_id, price, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(network, base_asset_id, quote_asset_id) DO UPDATE SET
         price = excluded.price,
         source = excluded.source,
         fetched_at = excluded.fetched_at`,
      [network, rate.baseAssetId, rate.quoteAssetId, rate.price, rate.source, rate.fetchedAt],
    );
  }

  /** True when the cached rate is older than `maxAgeMs`, or absent. */
  static isStale(rate: MarketRate | null, maxAgeMs: number, now = Date.now()): boolean {
    if (!rate) return true;
    const age = now - new Date(rate.fetchedAt).getTime();
    return !Number.isFinite(age) || age > maxAgeMs;
  }
}
