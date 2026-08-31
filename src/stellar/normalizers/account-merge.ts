import { accountMergeOperationSchema } from "../schemas";
import { assetFromFields } from "../assets";
import { parseAmount } from "../../lib/money";
import { malformed, recordType } from "./shared";
import type { MovementParser, NormalizationResult } from "../types";

/**
 * Account merge: the source account is deleted and its XLM balance moves to
 * `into`.
 *
 * Horizon's account_merge operation carries NO amount — only `account` and
 * `into`. This is verified in stellar/go's AccountMerge struct and in the
 * captured fixture, whose accompanying effects show the 1.4989800 XLM that
 * actually moved. The amount is therefore resolved from the operation's
 * effects by the sync pipeline and handed to this parser via the context.
 *
 * If the amount could not be resolved, the record becomes a sync issue rather
 * than a ledger entry with an invented amount.
 */
export const accountMergeParser: MovementParser = {
  name: "account_merge",

  supports(record: unknown): boolean {
    return recordType(record) === "account_merge";
  },

  normalize(record, context): NormalizationResult {
    const parsed = accountMergeOperationSchema.safeParse(record);
    if (!parsed.success) return malformed(record, parsed.error, "account_merge");

    const op = parsed.data;
    const merged = context.mergeAmounts?.get(op.id);

    if (!merged) {
      return {
        movements: [],
        issues: [
          {
            externalId: op.id,
            kind: "missing_amount",
            message:
              "Account merge carries no amount in the payments feed and its effects could not be read. " +
              "The transfer is recorded here so it is not lost; retry the sync to resolve it.",
            raw: record,
          },
        ],
      };
    }

    return {
      movements: [
        {
          externalKey: `op:${op.id}:merge`,
          sourceKind: op.type,
          movementType: "account_merge",
          amount: parseAmount(merged.amount),
          asset: assetFromFields(context.network, {
            asset_type: merged.assetType,
            asset_code: merged.assetCode,
            asset_issuer: merged.assetIssuer,
          }),
          fromAddress: op.account,
          toAddress: op.into,
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
