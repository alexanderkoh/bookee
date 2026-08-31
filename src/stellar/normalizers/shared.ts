import type { ZodError } from "zod";
import type { NormalizationResult } from "../types";

/** Horizon's operation type discriminator, read defensively. */
export function recordType(record: unknown): string | undefined {
  return (record as { type?: string } | null)?.type;
}

export function recordId(record: unknown): string | null {
  return (record as { id?: string } | null)?.id ?? null;
}

/**
 * A record whose shape we did not expect.
 *
 * This never throws and never drops the record: the raw JSON travels with the
 * issue so unsupported or changed Horizon output shows up in Diagnostics
 * instead of vanishing from the ledger.
 */
export function malformed(record: unknown, error: ZodError, what: string): NormalizationResult {
  return {
    movements: [],
    issues: [
      {
        externalId: recordId(record),
        kind: "malformed_record",
        message: `Unexpected ${what} record shape: ${error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
        raw: record,
      },
    ],
  };
}
