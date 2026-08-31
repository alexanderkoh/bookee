/**
 * Parser registry.
 *
 * Adding support for a new Horizon record type means adding a parser module
 * here — never widening a switch statement inside a component. Anything no
 * parser claims becomes a sync issue carrying the raw record, so unsupported
 * activity is visible in Diagnostics instead of silently missing from the
 * ledger.
 */
import { paymentParser } from "./payment";
import { createAccountParser } from "./create-account";
import { pathPaymentParser } from "./path-payment";
import { accountMergeParser } from "./account-merge";
import { sacParser } from "./sac";
import { recordId, recordType } from "./shared";
import type {
  MovementParser,
  NormalizationContext,
  NormalizationResult,
  NormalizedMovement,
  NormalizationIssue,
} from "../types";

export const PARSERS: readonly MovementParser[] = [
  paymentParser,
  createAccountParser,
  pathPaymentParser,
  accountMergeParser,
  sacParser,
];

/** Normalizes one Horizon record using the first parser that claims it. */
export function normalizeRecord(
  record: unknown,
  context: NormalizationContext,
  parsers: readonly MovementParser[] = PARSERS,
): NormalizationResult {
  const parser = parsers.find((candidate) => candidate.supports(record));

  if (!parser) {
    return {
      movements: [],
      issues: [
        {
          externalId: recordId(record),
          kind: "unsupported_record",
          message: `No parser for Horizon record type "${recordType(record) ?? "unknown"}". The record was kept for diagnostics but produced no ledger entry.`,
          raw: record,
        },
      ],
    };
  }

  return parser.normalize(record, context);
}

/** Normalizes a page of records, collecting movements and issues together. */
export function normalizeRecords(
  records: readonly unknown[],
  context: NormalizationContext,
  parsers: readonly MovementParser[] = PARSERS,
): NormalizationResult {
  const movements: NormalizedMovement[] = [];
  const issues: NormalizationIssue[] = [];

  for (const record of records) {
    const result = normalizeRecord(record, context, parsers);
    movements.push(...result.movements);
    issues.push(...result.issues);
  }

  return { movements, issues };
}

export { paymentParser, createAccountParser, pathPaymentParser, accountMergeParser, sacParser };
