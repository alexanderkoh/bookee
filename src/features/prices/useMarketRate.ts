/**
 * The XLM/USDC market rate, cached.
 *
 * Reads the cached rate immediately so the number is on screen without waiting
 * for the network, then refreshes in the background once it has gone stale.
 * The rate is always shown with its age; a price with no timestamp invites the
 * reader to assume it is live.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServices } from "../../app/providers/app-context";
import { PriceRepository } from "../../db/repositories";
import { HorizonPriceProvider, type MarketRate } from "../../stellar/prices";
import { DEFAULT_HORIZON_URLS } from "../../stellar/client";
import { nativeAsset, assetFromFields } from "../../stellar/assets";
import type { Network } from "../../db/schema";

/** A DEX mid does not need second-by-second polling. */
export const RATE_MAX_AGE_MS = 5 * 60 * 1000;

/** Circle's USDC on the public network — the pair most Stellar accounts care about. */
export const USDC_PUBLIC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export interface MarketRateView {
  rate: MarketRate | null;
  baseCode: string;
  quoteCode: string;
  isRefreshing: boolean;
}

export function useMarketRate(
  options: { network?: Network; quoteCode?: string; quoteIssuer?: string } = {},
): MarketRateView {
  const { repositories, horizonUrlFor } = useServices();
  const queryClient = useQueryClient();

  const network = options.network ?? "public";
  const quoteCode = options.quoteCode ?? "USDC";
  const quoteIssuer = options.quoteIssuer ?? USDC_PUBLIC_ISSUER;

  const base = nativeAsset(network);
  const quote = assetFromFields(network, {
    asset_type: "credit_alphanum4",
    asset_code: quoteCode,
    asset_issuer: quoteIssuer,
  });

  const cached = useQuery({
    queryKey: ["market-rate", network, base.id, quote.id],
    queryFn: () => repositories.prices.get(network, base.id, quote.id),
  });

  const stale = PriceRepository.isStale(cached.data ?? null, RATE_MAX_AGE_MS);

  const refresh = useQuery({
    queryKey: ["market-rate-refresh", network, base.id, quote.id],
    // Only reach for the network when the cached value has actually aged out.
    enabled: cached.isFetched && stale,
    staleTime: RATE_MAX_AGE_MS,
    refetchInterval: RATE_MAX_AGE_MS,
    queryFn: async () => {
      const provider = new HorizonPriceProvider(network, horizonUrlFor(network));
      const fresh = await provider.getRate(base, quote);
      if (fresh) await repositories.prices.save(network, fresh);
      return fresh;
    },
  });

  useEffect(() => {
    if (refresh.data) {
      void queryClient.invalidateQueries({
        queryKey: ["market-rate", network, base.id, quote.id],
      });
    }
  }, [refresh.data, queryClient, network, base.id, quote.id]);

  return {
    rate: refresh.data ?? cached.data ?? null,
    baseCode: base.displayCode,
    quoteCode: quote.displayCode,
    isRefreshing: refresh.isFetching,
  };
}

export { DEFAULT_HORIZON_URLS };
