/**
 * Rates for every asset a workspace holds, quoted in USDC.
 *
 * One query for the cached rates, one background refresh for the stale ones.
 * Assets are looked up together rather than per row, so a balances panel with
 * six assets does not fire six independent request waterfalls.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServices } from "../../app/providers/app-context";
import { PriceRepository } from "../../db/repositories";
import { HorizonPriceProvider, type MarketRate } from "../../stellar/prices";
import { assetFromFields } from "../../stellar/assets";
import type { AssetRef } from "../../stellar/types";
import type { Network } from "../../db/schema";
import { RATE_MAX_AGE_MS, USDC_PUBLIC_ISSUER } from "./useMarketRate";

export interface RatesView {
  /** Rate per asset id. Absent means no market, which is shown as a blank. */
  rates: Map<string, MarketRate>;
  quote: AssetRef;
  isRefreshing: boolean;
}

/** The asset everything is quoted in. USDC, not USD — they are not the same thing. */
export function quoteAsset(network: Network): AssetRef {
  return assetFromFields(network, {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: USDC_PUBLIC_ISSUER,
  });
}

export function useMarketRates(
  assets: readonly AssetRef[],
  network: Network = "public",
): RatesView {
  const { repositories, horizonUrlFor } = useServices();
  const queryClient = useQueryClient();
  const quote = quoteAsset(network);

  // The quote asset needs no rate against itself.
  const priceable = assets.filter((asset) => asset.id !== quote.id);
  const key = priceable
    .map((asset) => asset.id)
    .toSorted()
    .join(",");

  const cached = useQuery({
    queryKey: ["market-rates", network, key],
    enabled: priceable.length > 0,
    queryFn: async () => {
      const found = new Map<string, MarketRate>();
      for (const asset of priceable) {
        const rate = await repositories.prices.get(network, asset.id, quote.id);
        if (rate) found.set(asset.id, rate);
      }
      return found;
    },
  });

  const staleIds = priceable
    .filter((asset) => PriceRepository.isStale(cached.data?.get(asset.id) ?? null, RATE_MAX_AGE_MS))
    .map((asset) => asset.id);

  const refresh = useQuery({
    queryKey: ["market-rates-refresh", network, staleIds.join(",")],
    enabled: cached.isFetched && staleIds.length > 0,
    staleTime: RATE_MAX_AGE_MS,
    refetchInterval: RATE_MAX_AGE_MS,
    queryFn: async () => {
      const provider = new HorizonPriceProvider(network, horizonUrlFor(network));
      let updated = 0;
      for (const asset of priceable.filter((candidate) => staleIds.includes(candidate.id))) {
        const rate = await provider.getRate(asset, quote);
        if (rate) {
          await repositories.prices.save(network, rate);
          updated += 1;
        }
      }
      return updated;
    },
  });

  useEffect(() => {
    if (refresh.data && refresh.data > 0) {
      void queryClient.invalidateQueries({ queryKey: ["market-rates", network, key] });
    }
  }, [refresh.data, queryClient, network, key]);

  return {
    rates: cached.data ?? new Map(),
    quote,
    isRefreshing: refresh.isFetching,
  };
}
