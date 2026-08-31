/**
 * The XLM rate, shown in the top bar.
 *
 * Strictly an observation: a rate, its pair, and how old it is. It is never
 * multiplied by a balance. The moment an application turns a rate into
 * "your portfolio is worth $X" it starts asserting a certainty that a thin
 * order book cannot support — which is why balances here stay per asset.
 */
import { AssetIcon, PopoverPanel, relativeTime } from "../../components";
import { formatAmount } from "../../lib/money";
import { useMarketRate, RATE_MAX_AGE_MS } from "./useMarketRate";
import { nativeAsset } from "../../stellar/assets";

export function MarketRateTicker() {
  const { rate, baseCode, quoteCode, isRefreshing } = useMarketRate();

  if (!rate) {
    return null;
  }

  const age = Date.now() - new Date(rate.fetchedAt).getTime();
  const stale = age > RATE_MAX_AGE_MS * 2;

  return (
    <PopoverPanel
      align="end"
      width={280}
      trigger={
        <button
          type="button"
          className="rate-ticker"
          aria-label={`${baseCode} price in ${quoteCode}`}
        >
          <AssetIcon assetId={nativeAsset("public").id} code={baseCode} size={14} />
          <span className="rate-ticker__value numeric">
            {formatAmount(rate.price, { minDecimals: 4, maxDecimals: 4 })}
          </span>
          <span className="rate-ticker__quote">{quoteCode}</span>
          {stale ? <span className="rate-ticker__stale" aria-hidden="true" /> : null}
        </button>
      }
    >
      <div className="panel__body stack stack--sm">
        <p className="text-sm">
          1 {baseCode} = <strong>{formatAmount(rate.price, { maxDecimals: 7 })}</strong> {quoteCode}
        </p>
        <p className="text-xs muted">
          Midpoint of the best bid and ask on the Stellar DEX, via Horizon. Updated{" "}
          {isRefreshing ? "now" : relativeTime(rate.fetchedAt)}.
        </p>
        <p className="text-xs subtle">
          Shown for reference only. Balances stay per asset — this ledger never converts one asset
          into another to produce a total.
        </p>
      </div>
    </PopoverPanel>
  );
}
