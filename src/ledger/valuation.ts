/**
 * Converting a holding at a market rate.
 *
 * Deliberately narrow, and deliberately per asset. Converting one balance at a
 * stated rate and stated time is a useful, checkable statement. Adding those
 * converted figures together to produce "your portfolio is worth X" is not: it
 * hides which rates were used, when they were taken, and how thin the market
 * was. This module therefore has no sum function, and nothing calls for one.
 *
 * Note also that the quote asset is USDC, not USD. USDC is a dollar-referenced
 * stablecoin that trades near — but not exactly at — one dollar, so a figure
 * here is denominated in USDC and labelled as such. Writing "$" would be a
 * small lie in an application whose whole point is not telling those.
 */
import type { Amount } from "../lib/money";
import { multiply } from "../lib/money";
import type { MarketRate } from "../stellar/prices";

export interface Valuation {
  /** The converted figure, exact before display rounding. */
  value: Amount;
  quoteCode: string;
  rate: Amount;
  /** When the rate was observed. Always shown alongside the value. */
  asOf: string;
}

/**
 * Values one balance at one rate.
 *
 * Returns null when there is no rate: a blank is honest, an assumed 1:1 is not.
 */
export function valueHolding(
  balance: Amount,
  rate: MarketRate | null,
  quoteCode: string,
): Valuation | null {
  if (!rate) return null;
  return {
    value: multiply(balance, rate.price),
    quoteCode,
    rate: rate.price,
    asOf: rate.fetchedAt,
  };
}
