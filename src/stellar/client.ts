/**
 * The Horizon adapter.
 *
 * Everything the application knows about fetching Stellar data goes through
 * StellarDataSource. Horizon is one implementation; an RPC or indexer backend
 * could be added later without the ledger domain changing, which is why the
 * ledger never imports this module's concrete class.
 *
 * Records are returned as plain JSON. The SDK's response objects carry helper
 * methods and link objects that must not leak into the domain, so parsers
 * receive validated plain data instead.
 */
import { Horizon } from "@stellar/stellar-sdk";
import type { Network } from "../db/schema";
import { StellarError, toStellarError } from "./errors";
import { accountSchema, effectSchema, transactionSchema } from "./schemas";
import type { StellarAccount, StellarEffect, StellarTransaction } from "./schemas";
import { createLogger } from "../lib/log";

const log = createLogger("horizon");

/** Horizon's maximum page size, verified against the live API. */
export const MAX_PAGE_SIZE = 200;

export const DEFAULT_HORIZON_URLS: Record<Network, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
};

export interface PaymentPage {
  records: unknown[];
  /** Paging token of the last record, or null for an empty page. */
  cursor: string | null;
}

export interface StellarDataSource {
  readonly network: Network;
  getAccount(accountId: string): Promise<StellarAccount>;
  /**
   * The issuer's declared home domain, used to find its stellar.toml.
   * Null when the account declares none.
   */
  getHomeDomain?(accountId: string): Promise<string | null>;
  getPaymentsPage(accountId: string, cursor: string | null, limit?: number): Promise<PaymentPage>;
  getTransactions(hashes: readonly string[]): Promise<StellarTransaction[]>;
  getOperationEffects(operationId: string): Promise<StellarEffect[]>;
}

export interface HorizonClientOptions {
  network: Network;
  url?: string;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  /** Delay between pages, to avoid hammering Horizon during a long import. */
  pageDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HorizonClient implements StellarDataSource {
  readonly network: Network;
  readonly url: string;
  private readonly server: Horizon.Server;
  private readonly maxAttempts: number;
  private readonly pageDelayMs: number;

  constructor(options: HorizonClientOptions) {
    this.network = options.network;
    this.url = options.url ?? DEFAULT_HORIZON_URLS[options.network];
    this.server = new Horizon.Server(this.url);
    this.maxAttempts = options.maxAttempts ?? 4;
    this.pageDelayMs = options.pageDelayMs ?? 0;
  }

  async getAccount(accountId: string): Promise<StellarAccount> {
    const raw = await this.withRetry(() => this.server.accounts().accountId(accountId).call(), {
      accountId,
    });
    const parsed = accountSchema.safeParse(raw);
    if (!parsed.success) {
      throw new StellarError(
        "malformed_response",
        "Account response was not in the expected shape.",
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  async getHomeDomain(accountId: string): Promise<string | null> {
    try {
      const raw = (await this.withRetry(() =>
        this.server.accounts().accountId(accountId).call(),
      )) as { home_domain?: string };
      return raw.home_domain ?? null;
    } catch {
      // A missing issuer account simply means no icon.
      return null;
    }
  }

  async getPaymentsPage(
    accountId: string,
    cursor: string | null,
    limit = MAX_PAGE_SIZE,
  ): Promise<PaymentPage> {
    if (this.pageDelayMs > 0) await sleep(this.pageDelayMs);

    const page = await this.withRetry(
      () => {
        let builder = this.server.payments().forAccount(accountId).order("asc").limit(limit);
        if (cursor) builder = builder.cursor(cursor);
        return builder.call();
      },
      { accountId },
    );

    // Strip the SDK's helper methods and links; parsers work on plain records.
    const records = (page.records ?? []).map((record) => toPlainRecord(record));
    const last = records[records.length - 1] as { paging_token?: string } | undefined;

    return { records, cursor: last?.paging_token ?? null };
  }

  async getTransactions(hashes: readonly string[]): Promise<StellarTransaction[]> {
    const results: StellarTransaction[] = [];

    for (const hash of hashes) {
      try {
        const raw = await this.withRetry(() => this.server.transactions().transaction(hash).call());
        const parsed = transactionSchema.safeParse(toPlainRecord(raw));
        if (parsed.success) {
          results.push(parsed.data);
        } else {
          log.warn("transaction response did not match schema", { hash });
        }
      } catch (error) {
        // Memo enrichment is best-effort: a failure must not abandon the import.
        log.warn("could not fetch transaction", {
          hash,
          reason: error instanceof StellarError ? error.kind : "unknown",
        });
      }
    }
    return results;
  }

  async getOperationEffects(operationId: string): Promise<StellarEffect[]> {
    const page = await this.withRetry(() =>
      this.server.effects().forOperation(operationId).limit(MAX_PAGE_SIZE).call(),
    );
    const effects: StellarEffect[] = [];
    for (const record of page.records ?? []) {
      const parsed = effectSchema.safeParse(toPlainRecord(record));
      if (parsed.success) effects.push(parsed.data);
    }
    return effects;
  }

  /**
   * Retries transient failures with exponential backoff, honouring Horizon's
   * Retry-After when it rate-limits. Non-retryable failures (404, 400) throw
   * immediately rather than burning attempts.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    context?: { accountId?: string },
  ): Promise<T> {
    let lastError: StellarError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const stellarError = toStellarError(error, {
          ...context,
          network: this.network,
        });
        lastError = stellarError;

        if (!stellarError.retryable || attempt === this.maxAttempts) throw stellarError;

        const backoffMs =
          stellarError.options.retryAfterSeconds !== undefined
            ? stellarError.options.retryAfterSeconds * 1000
            : Math.min(500 * 2 ** (attempt - 1), 8000);

        log.warn("retrying Horizon request", {
          attempt,
          kind: stellarError.kind,
          backoffMs,
        });
        await sleep(backoffMs);
      }
    }

    throw lastError ?? new StellarError("unknown", "Horizon request failed.");
  }
}

/**
 * Converts an SDK response object into plain JSON.
 *
 * The SDK attaches navigation helpers to each record. Serialising and reparsing
 * drops them, leaving exactly the wire data the fixtures contain.
 */
function toPlainRecord(record: unknown): unknown {
  return JSON.parse(JSON.stringify(record));
}
