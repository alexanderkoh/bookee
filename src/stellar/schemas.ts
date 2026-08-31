/**
 * Zod schemas for Horizon responses.
 *
 * These exist because the Stellar SDK's TypeScript definitions are not a
 * reliable description of the wire format. The clearest example: the SDK types
 * `BalanceChange.from` and `.to` as required strings, but the Horizon source
 * marks both `omitempty`, and live data confirms a `mint` has no `from` while a
 * `burn` has no `to`. Trusting the compile-time types there produces undefined
 * values at runtime with no warning.
 *
 * Every Horizon record is parsed through these schemas before any parser sees
 * it. A record that fails validation becomes a sync issue, never a crash and
 * never a silent drop.
 *
 * Field names here were verified against captured live responses in
 * tests/fixtures/stellar/ and against stellar/go's protocols/horizon package.
 */
import { z } from "zod";

/** Fields present on every operation record. */
export const baseOperationSchema = z.object({
  id: z.string(),
  paging_token: z.string(),
  transaction_successful: z.boolean().optional(),
  source_account: z.string().optional(),
  type: z.string(),
  type_i: z.number().optional(),
  created_at: z.string(),
  transaction_hash: z.string(),
});

/** Asset identification, shared by payments and balance changes. */
const assetFields = {
  asset_type: z.string(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
};

export const paymentOperationSchema = baseOperationSchema.extend({
  type: z.literal("payment"),
  from: z.string(),
  to: z.string(),
  amount: z.string(),
  to_muxed: z.string().optional(),
  to_muxed_id: z.string().optional(),
  ...assetFields,
});

export const createAccountOperationSchema = baseOperationSchema.extend({
  type: z.literal("create_account"),
  account: z.string(),
  funder: z.string(),
  // Real records include starting_balance "0.0000000".
  starting_balance: z.string(),
  sponsor: z.string().optional(),
});

const pathAssetSchema = z.object({
  asset_type: z.string(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
});

/** Both path payment variants share every field this parser needs. */
export const pathPaymentOperationSchema = baseOperationSchema.extend({
  type: z.enum(["path_payment_strict_send", "path_payment_strict_receive"]),
  from: z.string(),
  to: z.string(),
  amount: z.string(),
  source_amount: z.string(),
  source_asset_type: z.string(),
  source_asset_code: z.string().optional(),
  source_asset_issuer: z.string().optional(),
  path: z.array(pathAssetSchema).optional(),
  source_max: z.string().optional(),
  destination_min: z.string().optional(),
  ...assetFields,
});

export const accountMergeOperationSchema = baseOperationSchema.extend({
  type: z.literal("account_merge"),
  account: z.string(),
  into: z.string(),
  // Deliberately absent: account_merge carries NO amount. The merged balance is
  // only available from the operation's effects.
});

/**
 * One Stellar Asset Contract balance change.
 *
 * `from` and `to` are optional by design, not defensiveness: per
 * stellar/go, "From - this is classic account that asset balance was changed,
 * or absent if not applicable for function". A mint has only `to`; a burn and a
 * clawback have only `from`.
 */
export const balanceChangeSchema = z.object({
  type: z.enum(["transfer", "mint", "burn", "clawback"]),
  amount: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  destination_muxed_id: z.string().optional(),
  ...assetFields,
});

export const invokeHostFunctionOperationSchema = baseOperationSchema.extend({
  type: z.literal("invoke_host_function"),
  function: z.string().optional(),
  address: z.string().optional(),
  salt: z.string().optional(),
  parameters: z.array(z.object({ value: z.string(), type: z.string() })).optional(),
  // Absent when the invocation touched no classic balances.
  asset_balance_changes: z.array(balanceChangeSchema).optional(),
});

export const memoTypeSchema = z.enum(["none", "text", "id", "hash", "return"]);

export const transactionSchema = z.object({
  hash: z.string(),
  ledger: z.number().optional(),
  created_at: z.string(),
  source_account: z.string().optional(),
  memo_type: memoTypeSchema,
  memo: z.string().optional(),
  memo_bytes: z.string().optional(),
});

const balanceSchema = z.object({
  balance: z.string(),
  asset_type: z.string(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
  liquidity_pool_id: z.string().optional(),
});

export const accountSchema = z.object({
  account_id: z.string(),
  sequence: z.string().optional(),
  subentry_count: z.number().optional(),
  balances: z.array(balanceSchema),
});

/** Effect records, used only to recover the amount an account_merge moved. */
export const effectSchema = z.object({
  id: z.string(),
  type: z.string(),
  account: z.string().optional(),
  amount: z.string().optional(),
  asset_type: z.string().optional(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
});

export type PaymentOperation = z.infer<typeof paymentOperationSchema>;
export type CreateAccountOperation = z.infer<typeof createAccountOperationSchema>;
export type PathPaymentOperation = z.infer<typeof pathPaymentOperationSchema>;
export type AccountMergeOperation = z.infer<typeof accountMergeOperationSchema>;
export type InvokeHostFunctionOperation = z.infer<typeof invokeHostFunctionOperationSchema>;
export type BalanceChange = z.infer<typeof balanceChangeSchema>;
export type StellarTransaction = z.infer<typeof transactionSchema>;
export type StellarAccount = z.infer<typeof accountSchema>;
export type StellarEffect = z.infer<typeof effectSchema>;
export type MemoTypeValue = z.infer<typeof memoTypeSchema>;
