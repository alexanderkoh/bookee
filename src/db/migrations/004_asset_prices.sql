-- Cached market rates.
--
-- Rates come from the Stellar DEX through Horizon — the same source as every
-- other fact in this application. No third-party price API is contacted, which
-- keeps the "the only host this app talks to is a Horizon endpoint" promise
-- intact and avoids telling a pricing service which assets a user holds.
--
-- A rate is a market observation with a timestamp, never a valuation of
-- holdings. Nothing in the ledger multiplies a balance by one of these.

CREATE TABLE asset_prices (
  network        TEXT NOT NULL,
  base_asset_id  TEXT NOT NULL,
  quote_asset_id TEXT NOT NULL,

  -- Exact decimal string, like every other amount.
  price          TEXT NOT NULL,
  -- 'order_book' (mid of best bid/ask) or 'last_trade'.
  source         TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,

  PRIMARY KEY (network, base_asset_id, quote_asset_id)
);
