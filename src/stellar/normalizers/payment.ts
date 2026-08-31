import { paymentOperationSchema } from "../schemas";
import { assetFromFields } from "../assets";
import { parseAmount } from "../../lib/money";
import { malformed, recordType } from "./shared";
import type { MovementParser, NormalizationResult } from "../types";

/** Classic payment: one asset moving from one account to another. */
export const paymentParser: MovementParser = {
  name: "payment",

  supports(record: unknown): boolean {
    return recordType(record) === "payment";
  },

  normalize(record, context): NormalizationResult {
    const parsed = paymentOperationSchema.safeParse(record);
    if (!parsed.success) return malformed(record, parsed.error, "payment");

    const op = parsed.data;
    return {
      movements: [
        {
          externalKey: `op:${op.id}`,
          sourceKind: op.type,
          movementType: "payment",
          amount: parseAmount(op.amount),
          asset: assetFromFields(context.network, op),
          fromAddress: op.from,
          toAddress: op.to,
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
