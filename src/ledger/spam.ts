/**
 * Recognising unsolicited dust.
 *
 * Stellar lets anyone send anyone a payment, so an address that has done
 * nothing wrong accumulates advertising: a fraction of a token nobody has heard
 * of, a memo pointing at a website, repeated a hundred times. It is not fraud
 * and it is not a mistake, it is simply not a transaction the account holder
 * took part in, and leaving it in the books distorts every count on the screen.
 *
 * This module only ever *suggests*. Nothing here hides anything: it scores what
 * a counterparty looks like and the interface offers the judgement to the
 * person, who marks it as spam or does not. Silently deleting rows that turn
 * out to be a real if unusual payment would be a far worse failure than showing
 * five rows of junk, and only the account holder knows which is which.
 */
import { compare } from "../lib/money";
import type { Amount } from "../lib/money";
import type { Network } from "../db/schema";

/**
 * Below this, an incoming payment is too small to be about money. Stellar's
 * base reserve makes genuine payments of a millionth of a unit vanishingly
 * rare, while advertisers send exactly that to stay cheap.
 */
export const DUST_THRESHOLD: Amount = "0.01";

/** How many repeats before identical amounts stop looking like a coincidence. */
const REPETITION_FLOOR = 5;

/**
 * Memo text that is selling something. Deliberately narrow: it matches a way of
 * writing rather than any particular scam, so it does not need a blocklist that
 * ages badly, and it will never match "invoice 4021" or "rent March".
 */
const PROMOTIONAL_MEMO =
  /(https?:\/\/|www\.|\.(com|net|org|io|xyz|finance|app)\b|\bclaim\b|\bairdrop\b|\bbonus\b|\bfree\b|\bgift\b|\breward\b|\bvisit\b)/i;

export type SpamSignal =
  "never-sent-to" | "dust-only" | "promotional-memo" | "repetitive" | "single-unknown-asset";

/** What the ledger knows about one counterparty, grouped for assessment. */
export interface CounterpartyActivity {
  address: string;
  memo: string | null;
  network: Network;
  entryCount: number;
  incomingCount: number;
  outgoingCount: number;
  /** How many distinct amounts appear across the group. */
  distinctAmountCount: number;
  /** The largest single amount seen, as a decimal string. */
  largestAmount: Amount;
  assetCodes: readonly string[];
  /** True when every asset involved is one the workspace has never held otherwise. */
  onlyUnfamiliarAssets: boolean;
  memoSamples: readonly string[];
}

export type SpamVerdict = "likely" | "possible" | "unremarkable";

export interface SpamAssessment {
  signals: SpamSignal[];
  verdict: SpamVerdict;
}

/**
 * Scores one counterparty.
 *
 * Signals are counted rather than weighted. A weighted score would imply a
 * precision this has no way to earn, and the interface shows the reasons
 * anyway, so the person can disagree with any single one of them.
 */
export function assessSpam(activity: CounterpartyActivity): SpamAssessment {
  const signals: SpamSignal[] = [];

  // Money that only ever arrives, from someone never paid in return, is the
  // shape of every unsolicited payment — and of no ordinary business relationship.
  if (activity.incomingCount > 0 && activity.outgoingCount === 0) {
    signals.push("never-sent-to");
  }

  if (compare(activity.largestAmount, DUST_THRESHOLD) <= 0) {
    signals.push("dust-only");
  }

  if (activity.memoSamples.some((memo) => PROMOTIONAL_MEMO.test(memo))) {
    signals.push("promotional-memo");
  }

  // One amount repeated many times is a script, not a person.
  if (activity.entryCount >= REPETITION_FLOOR && activity.distinctAmountCount === 1) {
    signals.push("repetitive");
  }

  if (activity.onlyUnfamiliarAssets && activity.assetCodes.length > 0) {
    signals.push("single-unknown-asset");
  }

  // Dust is necessary, not merely contributing. Everything else here also
  // describes honest money: a salary arrives monthly, for the same amount, from
  // someone you have never paid — three signals, and obviously not spam. What
  // no real payment does is stay below a hundredth of a unit, because the point
  // of a real payment is the amount. Requiring it costs nothing (spam is dust
  // by economic necessity) and rules out the whole class of false positives
  // that would matter most.
  if (!signals.includes("dust-only")) {
    return { signals, verdict: "unremarkable" };
  }

  const corroborating = signals.length - 1;
  const verdict: SpamVerdict =
    corroborating >= 2 ? "likely" : corroborating === 1 ? "possible" : "unremarkable";

  return { signals, verdict };
}

/** Short human reasons, shown next to a suggestion so it can be argued with. */
export const SIGNAL_LABELS: Record<SpamSignal, string> = {
  "never-sent-to": "You have never paid them",
  "dust-only": `Nothing above ${DUST_THRESHOLD}`,
  "promotional-memo": "Memo advertises something",
  repetitive: "Same amount every time",
  "single-unknown-asset": "An asset you hold nowhere else",
};
