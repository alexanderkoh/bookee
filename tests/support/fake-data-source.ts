/**
 * An in-memory StellarDataSource.
 *
 * Serves records page by page, so pagination, cursors and resume behaviour are
 * exercised against the same data shapes Horizon actually returns — with the
 * ability to fail on demand, which a live endpoint cannot provide.
 */
import type { PaymentPage, StellarDataSource } from "../../src/stellar/client";
import type { StellarAccount, StellarEffect, StellarTransaction } from "../../src/stellar/schemas";
import type { Network } from "../../src/db/schema";
import { StellarError } from "../../src/stellar/errors";

export { loadFixture } from "./fixtures";

export interface FakeOptions {
  network?: Network;
  /** Throw this once, when the given page index (0-based) is requested. */
  failOnPage?: number;
  failWith?: StellarError;
  transactions?: StellarTransaction[];
  effects?: Record<string, StellarEffect[]>;
  account?: StellarAccount;
}

export class FakeDataSource implements StellarDataSource {
  readonly network: Network;
  pageRequests: Array<string | null> = [];
  transactionRequests: string[] = [];
  private failed = false;

  constructor(
    private readonly records: any[],
    private readonly options: FakeOptions = {},
  ) {
    this.network = options.network ?? "public";
  }

  async getAccount(accountId: string): Promise<StellarAccount> {
    if (this.options.account) return this.options.account;
    return { account_id: accountId, balances: [] };
  }

  async getPaymentsPage(
    _accountId: string,
    cursor: string | null,
    limit = 200,
  ): Promise<PaymentPage> {
    const pageIndex = this.pageRequests.length;
    this.pageRequests.push(cursor);

    if (!this.failed && this.options.failOnPage === pageIndex) {
      this.failed = true;
      throw this.options.failWith ?? new StellarError("server_error", "Simulated Horizon failure.");
    }

    const startIndex =
      cursor === null ? 0 : this.records.findIndex((r) => r.paging_token === cursor) + 1;
    const slice = this.records.slice(startIndex, startIndex + limit);
    const last = slice[slice.length - 1];

    return { records: slice, cursor: last?.paging_token ?? null };
  }

  async getTransactions(hashes: readonly string[]): Promise<StellarTransaction[]> {
    this.transactionRequests.push(...hashes);
    if (!this.options.transactions) return [];
    return this.options.transactions.filter((t) => hashes.includes(t.hash));
  }

  async getOperationEffects(operationId: string): Promise<StellarEffect[]> {
    return this.options.effects?.[operationId] ?? [];
  }
}
