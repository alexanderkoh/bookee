import { createAccountOperationSchema } from "../schemas";
import { nativeAsset } from "../assets";
import { parseAmount } from "../../lib/money";
import { malformed, recordType } from "./shared";
import type { MovementParser, NormalizationResult } from "../types";

/**
 * Account creation: the funder sends the new account its starting XLM balance.
 *
 * Always native XLM. `starting_balance` is legitimately "0.0000000" in real
 * records (sponsored account creation), so a zero amount is kept as a real
 * entry rather than being discarded.
 */
export const createAccountParser: MovementParser = {
  name: "create_account",

  supports(record: unknown): boolean {
    return recordType(record) === "create_account";
  },

  normalize(record, context): NormalizationResult {
    const parsed = createAccountOperationSchema.safeParse(record);
    if (!parsed.success) return malformed(record, parsed.error, "create_account");

    const op = parsed.data;
    return {
      movements: [
        {
          externalKey: `op:${op.id}`,
          sourceKind: op.type,
          movementType: "create_account",
          amount: parseAmount(op.starting_balance),
          asset: nativeAsset(context.network),
          fromAddress: op.funder,
          toAddress: op.account,
          relevantParty: "both",
          transactionHash: op.transaction_hash,
          operationId: op.id,
          pagingToken: op.paging_token,
          timestamp: op.created_at,
          raw: record,
        },
      ],
      issues: [],
    };
  },
};
