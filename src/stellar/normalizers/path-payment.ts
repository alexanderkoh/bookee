import { pathPaymentOperationSchema } from "../schemas";
import { assetFromFields, sourceAssetFromPathPayment } from "../assets";
import { parseAmount } from "../../lib/money";
import { malformed, recordType } from "./shared";
import type { MovementParser, NormalizationResult, NormalizedMovement } from "../types";

const PATH_PAYMENT_TYPES = new Set(["path_payment_strict_send", "path_payment_strict_receive"]);

/**
 * Path payment: the sender spends one asset and the receiver gets another.
 *
 * A path payment is the only common record where a single operation moves two
 * *different* assets, so it can produce two movements:
 *
 *   op:<id>:src   the source asset leaving `from`
 *   op:<id>:dst   the destination asset arriving at `to`
 *
 * Both are emitted, and the counterparty resolver keeps whichever side involves
 * an owned account. This matters for self path payments — where `from` equals
 * `to`, which is how a DEX swap appears — because collapsing those into one
 * entry would hide either the asset spent or the asset received. Real examples
 * of exactly that appear in the captured fixtures.
 *
 * The one case that collapses to a single movement is a genuine internal
 * transfer: same asset in and out, meaning no conversion happened.
 */
export const pathPaymentParser: MovementParser = {
  name: "path_payment",

  supports(record: unknown): boolean {
    const type = recordType(record);
    return type !== undefined && PATH_PAYMENT_TYPES.has(type);
  },

  normalize(record, context): NormalizationResult {
    const parsed = pathPaymentOperationSchema.safeParse(record);
    if (!parsed.success) return malformed(record, parsed.error, "path payment");

    const op = parsed.data;
    const destinationAsset = assetFromFields(context.network, op);
    const sourceAsset = sourceAssetFromPathPayment(context.network, op);

    const common = {
      sourceKind: op.type,
      movementType: "path_payment" as const,
      fromAddress: op.from,
      toAddress: op.to,
      transactionHash: op.transaction_hash,
      operationId: op.id,
      pagingToken: op.paging_token,
      timestamp: op.created_at,
      raw: record,
    };

    // Same asset on both sides means no conversion took place, so there is a
    // single movement of value rather than a spend and a receipt.
    if (sourceAsset.id === destinationAsset.id && op.source_amount === op.amount) {
      return {
        movements: [
          {
            ...common,
            externalKey: `op:${op.id}`,
            amount: parseAmount(op.amount),
            asset: destinationAsset,
            relevantParty: "both",
          },
        ],
        issues: [],
      };
    }

    const movements: NormalizedMovement[] = [
      {
        ...common,
        externalKey: `op:${op.id}:src`,
        amount: parseAmount(op.source_amount),
        asset: sourceAsset,
        // Only the sender spent this asset.
        relevantParty: "from",
      },
      {
        ...common,
        externalKey: `op:${op.id}:dst`,
        amount: parseAmount(op.amount),
        asset: destinationAsset,
        // Only the receiver got this asset.
        relevantParty: "to",
      },
    ];

    return { movements, issues: [] };
  },
};
