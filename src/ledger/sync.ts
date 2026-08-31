/**
 * Incremental import of an account's payment history.
 *
 * The loop is deliberately simple and strictly sequential:
 *
 *   fetch page -> normalize -> enrich -> write entries AND cursor together -> next
 *
 * Two properties matter more than speed:
 *
 *  - Atomicity. A page's entries and the paging cursor advance in the same
 *    transaction. If the process dies mid-import the cursor never points past
 *    data that was not written, so restarting resumes exactly where it stopped.
 *
 *  - Idempotency. Entries are keyed by a stable external key, so importing the
 *    same page ten times produces the same rows. The key excludes the tracked
 *    account, which is what collapses a transfer between two owned accounts
 *    into a single internal entry instead of a duplicated pair.
 *
 * History is never held in memory: each page is written before the next is
 * requested.
 */
import type { Repositories, ResolvedMovement } from "../db/repositories";
import type { Statement } from "../db/driver";
import type { MemoType, Network, SyncIssueKind, TrackedAccount } from "../db/schema";
import type { StellarDataSource } from "../stellar/client";
import { MAX_PAGE_SIZE } from "../stellar/client";
import { normalizeRecords } from "../stellar/normalizers";
import type { MergeAmount, NormalizationIssue } from "../stellar/types";
import { resolveDirection } from "./counterparty";
import { StellarError } from "../stellar/errors";
import { applyRules } from "./apply-rules";
import { refreshAssetIcons } from "../stellar/asset-icons";
import { createLogger } from "../lib/log";
import { nowIso } from "../lib/ids";

const log = createLogger("sync");

export interface SyncProgress {
  accountId: string;
  publicKey: string;
  pagesFetched: number;
  entriesImported: number;
  issues: number;
  done: boolean;
}

export interface SyncResult {
  accountId: string;
  pagesFetched: number;
  entriesImported: number;
  issues: number;
  cursor: string | null;
}

export interface SyncOptions {
  pageSize?: number;
  /** Stops the import cleanly at the next page boundary. */
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncDeps {
  repositories: Repositories;
  dataSource: StellarDataSource;
}

/** Imports everything newer than the account's stored cursor. */
export async function syncAccount(
  deps: SyncDeps,
  account: TrackedAccount,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { repositories: repos, dataSource } = deps;
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;

  const owned = await repos.accounts.ownedAddresses(account.workspaceId, account.network);

  let cursor = account.lastPaymentCursor;
  let pagesFetched = 0;
  let entriesImported = 0;
  let issueCount = 0;

  log.info("sync started", {
    account: account.publicKey,
    network: account.network,
    resumingFrom: cursor ?? "beginning",
  });

  for (;;) {
    if (options.signal?.aborted) {
      log.info("sync stopped by caller", { account: account.publicKey, pagesFetched });
      break;
    }

    const page = await dataSource.getPaymentsPage(account.publicKey, cursor, pageSize);
    if (page.records.length === 0) break;

    pagesFetched += 1;

    const { statements, imported, issues } = await buildPageStatements({
      repos,
      dataSource,
      account,
      records: page.records,
      owned,
    });

    // Entries, memos, issues and the cursor all land together or not at all.
    statements.push({
      sql: `UPDATE tracked_accounts
            SET last_payment_cursor = ?, updated_at = ?
            WHERE id = ?`,
      params: [page.cursor, nowIso(), account.id],
    });

    await repos.driver.batch(statements);

    cursor = page.cursor;
    entriesImported += imported;
    issueCount += issues;

    log.debug("page committed", {
      account: account.publicKey,
      page: pagesFetched,
      records: page.records.length,
      imported,
      cursor: cursor ?? "none",
    });

    options.onProgress?.({
      accountId: account.id,
      publicKey: account.publicKey,
      pagesFetched,
      entriesImported,
      issues: issueCount,
      done: false,
    });

    // A short page means Horizon has nothing newer.
    if (page.records.length < pageSize) break;
  }

  await repos.accounts.markSynced(account.id);

  options.onProgress?.({
    accountId: account.id,
    publicKey: account.publicKey,
    pagesFetched,
    entriesImported,
    issues: issueCount,
    done: true,
  });

  log.info("sync completed", {
    account: account.publicKey,
    pages: pagesFetched,
    entries: entriesImported,
    issues: issueCount,
  });

  return { accountId: account.id, pagesFetched, entriesImported, issues: issueCount, cursor };
}

interface PageInput {
  repos: Repositories;
  dataSource: StellarDataSource;
  account: TrackedAccount;
  records: readonly unknown[];
  owned: ReadonlySet<string>;
}

/** Turns one page of Horizon records into the statements that persist it. */
async function buildPageStatements({
  repos,
  dataSource,
  account,
  records,
  owned,
}: PageInput): Promise<{ statements: Statement[]; imported: number; issues: number }> {
  const mergeAmounts = await resolveMergeAmounts(dataSource, records);

  const { movements, issues } = normalizeRecords(records, {
    network: account.network,
    mergeAmounts,
  });

  // Keep only movements that actually touch one of the workspace's accounts.
  // A path payment's other side describes value that never reached us.
  const relevant: ResolvedMovement[] = [];
  for (const movement of movements) {
    const resolution = resolveDirection(movement, owned);
    if (resolution.direction === "neutral") continue;
    relevant.push({ movement, resolution });
  }

  const memoStatements = await buildMemoStatements({
    repos,
    dataSource,
    network: account.network,
    movements: relevant,
  });

  const statements: Statement[] = [
    ...repos.entries.buildUpsertStatements(account.workspaceId, account.network, relevant),
    ...memoStatements,
    ...repos.syncIssues.buildInsertStatements(
      account.workspaceId,
      account.id,
      issues.map((issue: NormalizationIssue) => ({
        externalId: issue.externalId,
        kind: issue.kind as SyncIssueKind,
        message: issue.message,
        raw: issue.raw,
      })),
    ),
  ];

  return { statements, imported: relevant.length, issues: issues.length };
}

/**
 * Looks up the amounts for any account_merge records on the page.
 *
 * Horizon's merge operation carries no amount, so the value that moved has to
 * come from the operation's effects. Merges are rare, so this costs one extra
 * request only on the pages that contain one.
 */
async function resolveMergeAmounts(
  dataSource: StellarDataSource,
  records: readonly unknown[],
): Promise<Map<string, MergeAmount>> {
  const merges = records.filter(
    (record): record is { id: string; into: string } =>
      (record as { type?: string })?.type === "account_merge",
  );
  const amounts = new Map<string, MergeAmount>();

  for (const merge of merges) {
    try {
      const effects = await dataSource.getOperationEffects(merge.id);
      const credited = effects.find(
        (effect) => effect.type === "account_credited" && effect.amount !== undefined,
      );
      const debited = effects.find(
        (effect) => effect.type === "account_debited" && effect.amount !== undefined,
      );
      const source = credited ?? debited;

      if (source?.amount) {
        amounts.set(merge.id, {
          amount: source.amount,
          assetType: source.asset_type ?? "native",
          assetCode: source.asset_code,
          assetIssuer: source.asset_issuer,
        });
      }
    } catch (error) {
      // The merge becomes a sync issue rather than an entry with a made-up amount.
      log.warn("could not resolve account_merge amount", {
        operationId: merge.id,
        reason: error instanceof StellarError ? error.kind : "unknown",
      });
    }
  }

  return amounts;
}

interface MemoInput {
  repos: Repositories;
  dataSource: StellarDataSource;
  network: Network;
  movements: readonly ResolvedMovement[];
}

/**
 * Fetches memos for transactions not already cached, and attaches them to the
 * movements about to be written.
 *
 * Deduplicated by hash: many operations share one transaction, so a page of 200
 * entries usually needs far fewer than 200 requests.
 */
async function buildMemoStatements({
  repos,
  dataSource,
  network,
  movements,
}: MemoInput): Promise<Statement[]> {
  const hashes = [
    ...new Set(
      movements
        .map(({ movement }) => movement.transactionHash)
        .filter((hash): hash is string => hash !== null),
    ),
  ];
  if (hashes.length === 0) return [];

  const cached = await repos.transactions.findMany(network, hashes);
  const cachedByHash = new Map(cached.map((record) => [record.hash, record]));
  const missing = hashes.filter((hash) => !cachedByHash.has(hash));

  const fetched = missing.length > 0 ? await dataSource.getTransactions(missing) : [];

  const statements = repos.transactions.buildUpsertStatements(
    network,
    fetched.map((transaction) => ({
      hash: transaction.hash,
      memoType: transaction.memo_type as MemoType,
      memo: transaction.memo ?? null,
      memoBytes: transaction.memo_bytes ?? null,
      sourceAccount: transaction.source_account ?? null,
      ledger: transaction.ledger ?? null,
      createdAt: transaction.created_at ?? null,
    })),
  );

  for (const transaction of fetched) {
    cachedByHash.set(transaction.hash, {
      network,
      hash: transaction.hash,
      memoType: transaction.memo_type as MemoType,
      memo: transaction.memo ?? null,
      memoBytes: transaction.memo_bytes ?? null,
      sourceAccount: transaction.source_account ?? null,
      ledger: transaction.ledger ?? null,
      createdAt: transaction.created_at ?? null,
      fetchedAt: nowIso(),
    });
  }

  // Attach memos in place so the entries are written with them already set.
  for (const resolved of movements) {
    const hash = resolved.movement.transactionHash;
    if (!hash) continue;
    const record = cachedByHash.get(hash);
    if (!record) continue;
    resolved.memo = {
      type: record.memoType,
      // Text memos arrive in `memo`; hash and return memos arrive base64-encoded
      // in the same field. `memo_bytes` is the fallback for binary content.
      value: record.memo ?? record.memoBytes ?? null,
    };
  }

  return statements;
}

/**
 * Syncs every account in a workspace, then reclassifies stored history.
 *
 * The reclassification pass is what makes internal transfers correct: once all
 * accounts are known, an entry previously recorded as an ordinary payment from
 * a stranger is recognised as movement between the workspace's own accounts.
 */
export async function syncWorkspace(
  deps: Omit<SyncDeps, "dataSource"> & {
    dataSourceFor: (network: Network) => StellarDataSource;
  },
  workspaceId: string,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const { repositories: repos } = deps;
  const accounts = await repos.accounts.listByWorkspace(workspaceId);
  const results: SyncResult[] = [];

  for (const account of accounts) {
    if (options.signal?.aborted) break;
    const dataSource = deps.dataSourceFor(account.network);
    results.push(await syncAccount({ repositories: repos, dataSource }, account, options));
  }

  const networks = new Set(accounts.map((account) => account.network));
  for (const network of networks) {
    const owned = await repos.accounts.ownedAddresses(workspaceId, network);
    await repos.entries.reresolveDirections(workspaceId, network, owned);
    await repos.driver.batch([repos.transactions.buildBackfillStatement(workspaceId, network)]);

    // Icons come from each issuer's own stellar.toml, once per asset ever.
    // Best-effort: a missing icon is a monogram, never a failed sync.
    const source = deps.dataSourceFor(network);
    if (source.getHomeDomain) {
      try {
        await refreshAssetIcons(repos, network, (issuer) => source.getHomeDomain!(issuer));
      } catch (error) {
        log.warn("asset icon refresh failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  // Reattach annotations restored from a backup whose entries now exist. This
  // is the second half of the restore cycle: import parks them, the resync
  // recreates the entries, and this joins the two by external key.
  const attached = await repos.pendingAnnotations.attachMatching(workspaceId);
  if (attached > 0) log.info("restored annotations attached", { count: attached });

  // Classify what was just imported. Rules never touch a field the user set by
  // hand, so this is safe to run after every sync.
  const applied = await applyRules(repos, workspaceId);
  if (applied.changed > 0) log.info("rules classified entries", { changed: applied.changed });

  return results;
}
