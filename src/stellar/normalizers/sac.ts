import { invokeHostFunctionOperationSchema } from "../schemas";
import { assetFromFields } from "../assets";
import { parseAmount } from "../../lib/money";
import { malformed, recordType } from "./shared";
import type { MovementType } from "../../db/schema";
import type { MovementParser, NormalizationResult, NormalizedMovement } from "../types";

const MOVEMENT_TYPE_BY_CHANGE: Record<string, MovementType> = {
  transfer: "sac_transfer",
  mint: "mint",
  burn: "burn",
  clawback: "clawback",
};

/**
 * Stellar Asset Contract activity, carried on invoke_host_function records as
 * `asset_balance_changes`.
 *
 * This is not an edge case: on a sampled contract-active account, 199 of 200
 * payment records were of this type. One operation produces zero, one, or many
 * movements.
 *
 * Two properties of the wire format drive the implementation:
 *
 *  1. A balance change has no identifier of its own. The only stable key is its
 *     position in the array, so external keys are `op:<id>:bc:<index>`. Hashing
 *     the contents instead would be unsafe: one operation can legitimately
 *     contain two changes with identical type, addresses, asset and amount, and
 *     they would collide. Horizon derives the array from the transaction meta
 *     event order, which is deterministic for a given ledger.
 *
 *  2. `from` and `to` are each optional. A mint has only `to`, a burn and a
 *     clawback have only `from`, a transfer has both. The Stellar SDK's types
 *     declare both required, which is wrong; that is why these records go
 *     through Zod first.
 */
export const sacParser: MovementParser = {
  name: "invoke_host_function",

  supports(record: unknown): boolean {
    return recordType(record) === "invoke_host_function";
  },

  normalize(record, context): NormalizationResult {
    const parsed = invokeHostFunctionOperationSchema.safeParse(record);
    if (!parsed.success) return malformed(record, parsed.error, "invoke_host_function");

    const op = parsed.data;
    const changes = op.asset_balance_changes ?? [];

    // A contract invocation that touched no classic balances is not ledger
    // activity. It is not an issue either — there is simply nothing to record.
    if (changes.length === 0) return { movements: [], issues: [] };

    const movements: NormalizedMovement[] = changes.map((change, index) => ({
      externalKey: `op:${op.id}:bc:${index}`,
      sourceKind: op.type,
      movementType: MOVEMENT_TYPE_BY_CHANGE[change.type] ?? "other",
      amount: parseAmount(change.amount),
      asset: assetFromFields(context.network, change),
      fromAddress: change.from ?? null,
      toAddress: change.to ?? null,
      relevantParty: "both",
      transactionHash: op.transaction_hash,
      operationId: op.id,
      pagingToken: op.paging_token,
      timestamp: op.created_at,
      raw: change,
    }));

    return { movements, issues: [] };
  },
};
