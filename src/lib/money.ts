/**
 * Exact decimal arithmetic for asset amounts.
 *
 * Stellar amounts are never JavaScript numbers in this application. Classic
 * amounts are int64 stroops with 7 decimal places, and the validation account
 * alone contains both a 1-stroop payment (0.0000001) and a six-figure balance;
 * a float round-trip corrupts one or the other. Amounts are stored as TEXT in
 * SQLite and manipulated only through this module.
 */
import Big from "big.js";

/**
 * Force plain (non-exponential) output from Big.prototype.toString().
 *
 * big.js switches to exponential notation outside [1e-6, 1e21) by default,
 * which would write "1e-7" into the database for a 1-stroop payment. Widening
 * these thresholds keeps every realistic Stellar amount in plain decimal form.
 */
Big.NE = -30;
Big.PE = 60;

/** An exact decimal amount, always in its plain-string canonical form. */
export type Amount = string;

/** Stellar classic assets carry 7 decimal places. */
export const STELLAR_DECIMALS = 7;

export class InvalidAmountError extends Error {
  constructor(value: string) {
    super(`Not a valid decimal amount: ${JSON.stringify(value)}`);
    this.name = "InvalidAmountError";
  }
}

function toBig(value: Amount): Big {
  try {
    return new Big(value);
  } catch {
    throw new InvalidAmountError(value);
  }
}

/** Parses and canonicalises an amount, throwing if it is not a valid decimal. */
export function parseAmount(value: string): Amount {
  return toBig(value).toString();
}

/** Returns true if the value is a well-formed decimal amount. */
export function isValidAmount(value: string): boolean {
  try {
    toBig(value);
    return true;
  } catch {
    return false;
  }
}

export const ZERO: Amount = "0";

export function add(a: Amount, b: Amount): Amount {
  return toBig(a).plus(toBig(b)).toString();
}

export function subtract(a: Amount, b: Amount): Amount {
  return toBig(a).minus(toBig(b)).toString();
}

export function negate(a: Amount): Amount {
  return toBig(a).times(-1).toString();
}

export function abs(a: Amount): Amount {
  return toBig(a).abs().toString();
}

/**
 * Exact product of two amounts.
 *
 * Used to convert a holding at a rate. Big.js multiplication is exact, so the
 * only rounding is the one the caller asks for when formatting.
 */
export function multiply(a: Amount, b: Amount): Amount {
  return toBig(a).times(toBig(b)).toString();
}

/**
 * Exact midpoint of two amounts.
 *
 * Halving a decimal always terminates, so this needs no rounding and stays
 * exact — unlike (Number(a) + Number(b)) / 2, which reintroduces the float
 * error the rest of this module exists to avoid.
 */
export function midpoint(a: Amount, b: Amount): Amount {
  return toBig(a).plus(toBig(b)).div(2).toString();
}

/** Sums a list of amounts exactly. Returns "0" for an empty list. */
export function sum(amounts: readonly Amount[]): Amount {
  return amounts.reduce<Amount>((total, amount) => add(total, amount), ZERO);
}

/** Returns -1, 0 or 1. */
export function compare(a: Amount, b: Amount): -1 | 0 | 1 {
  return toBig(a).cmp(toBig(b)) as -1 | 0 | 1;
}

export function isZero(a: Amount): boolean {
  return toBig(a).eq(0);
}

export function isNegative(a: Amount): boolean {
  return toBig(a).lt(0);
}

export function greaterThan(a: Amount, b: Amount): boolean {
  return toBig(a).gt(toBig(b));
}

export function lessThan(a: Amount, b: Amount): boolean {
  return toBig(a).lt(toBig(b));
}

/**
 * Decimal places appropriate for reading a figure at a glance.
 *
 * Storage and export always keep full precision; this is only about display.
 * A balance of 158,974.6411849 is noise on a dashboard, but 0.0000001 XLM
 * rounded to 0.00 would be a lie — so precision scales with magnitude rather
 * than being fixed.
 */
export function displayDecimals(value: Amount): number {
  const magnitude = toBig(value).abs();
  if (magnitude.gte(1000)) return 2;
  if (magnitude.gte(1)) return 4;
  return STELLAR_DECIMALS;
}

/** Formats a figure for reading rather than for auditing. */
export function formatDisplay(value: Amount, options: { signed?: boolean } = {}): string {
  return formatAmount(value, { maxDecimals: displayDecimals(value), ...options });
}

/**
 * Formats an amount for display with thousands separators.
 *
 * Trailing zeros beyond `minDecimals` are trimmed so 100.0000000 reads as
 * "100.00" while 0.0000001 keeps every significant digit rather than
 * collapsing to "0.00".
 */
export function formatAmount(
  value: Amount,
  options: { minDecimals?: number; maxDecimals?: number; signed?: boolean } = {},
): string {
  const { minDecimals = 2, maxDecimals = STELLAR_DECIMALS, signed = false } = options;

  const big = toBig(value);
  const negative = big.lt(0);
  const fixed = big.abs().toFixed(maxDecimals);

  const [wholePart = "0", fractionPart = ""] = fixed.split(".");
  let fraction = fractionPart.replace(/0+$/, "");
  while (fraction.length < minDecimals) fraction += "0";

  const grouped = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const magnitude = fraction.length > 0 ? `${grouped}.${fraction}` : grouped;

  if (negative) return `-${magnitude}`;
  if (signed && !big.eq(0)) return `+${magnitude}`;
  return magnitude;
}
