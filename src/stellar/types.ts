/**
 * The boundary between Horizon and the ledger domain.
 *
 * A NormalizedMovement is what a parser produces from one Horizon record. It
 * carries no direction and no counterparty: those depend on which addresses the
 * workspace owns, which is not a property of the blockchain record. They are
 * resolved later by src/ledger/counterparty.ts.
 */
import type { Amount } from "../lib/money";
import type { MovementType, Network } from "../db/schema";

/** Identity of an asset, independent of any database row. */
export interface AssetRef {
  /** Deterministic: '<network>:native' or '<network>:<code>:<issuer>'. */
  id: string;
  network: Network;
  assetType: string;
  code: string | null;
  issuer: string | null;
  contractId: string | null;
  displayCode: string;
}

/**
 * Which endpoint of the record this movement's value actually belongs to.
 *
 * Almost every record is "both": one asset travels from `fromAddress` to
 * `toAddress`, so an owned account on either end is affected. Path payments are
 * the exception — they move a different asset on each side, so the source-asset
 * movement concerns only the sender and the destination-asset movement only the
 * receiver. Without this distinction an inbound path payment would be credited
 * with the asset the sender spent, which it never received.
 */
export type RelevantParty = "both" | "from" | "to";

export interface NormalizedMovement {
  /** Stable dedup key derived from Horizon identifiers. */
  externalKey: string;
  /** The Horizon operation type this came from. */
  sourceKind: string;
  movementType: MovementType;
  amount: Amount;
  asset: AssetRef;
  fromAddress: string | null;
  toAddress: string | null;
  relevantParty: RelevantParty;
  transactionHash: string | null;
  operationId: string | null;
  pagingToken: string | null;
  timestamp: string;
  /** Verbatim Horizon record, kept for diagnostics. */
  raw: unknown;
}

/** The XLM balance an account_merge moved, recovered from the operation's effects. */
export interface MergeAmount {
  amount: Amount;
  assetType: string;
  assetCode?: string | undefined;
  assetIssuer?: string | undefined;
}

/** Everything a parser needs beyond the record itself. */
export interface NormalizationContext {
  network: Network;
  /**
   * Merge amounts keyed by operation id.
   *
   * account_merge records carry no amount, so the sync pipeline resolves it
   * from the operation's effects before normalizing and passes it in here.
   * Keeping the lookup in the context lets every parser stay pure and
   * synchronous, which is what makes them straightforward to test.
   */
  mergeAmounts?: ReadonlyMap<string, MergeAmount> | undefined;
}

/** A record the parser understood but could not safely turn into a movement. */
export interface NormalizationIssue {
  externalId: string | null;
  kind: "unsupported_record" | "malformed_record" | "missing_amount";
  message: string;
  raw: unknown;
}

export interface NormalizationResult {
  movements: NormalizedMovement[];
  issues: NormalizationIssue[];
}

/**
 * A parser for one family of Horizon records.
 *
 * One Horizon record maps to zero, one, or many movements: a Stellar Asset
 * Contract invocation can carry several balance changes, and a path payment
 * affects two different assets.
 */
export interface MovementParser {
  /** Horizon operation type(s) this parser handles. */
  readonly name: string;
  supports(record: unknown): boolean;
  normalize(record: unknown, context: NormalizationContext): NormalizationResult;
}

export const emptyResult = (): NormalizationResult => ({ movements: [], issues: [] });
