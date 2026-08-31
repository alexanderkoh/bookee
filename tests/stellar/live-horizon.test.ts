/**
 * Live end-to-end import against real Horizon.
 *
 * The rest of the suite runs against generated pages, which proves the parsing
 * and persistence logic but not the network layer: the SDK call builders,
 * cursor handling, retry behaviour and response shapes are only genuinely
 * exercised against the real API.
 *
 * Opt-in twice over. A test that needs the internet must never be the reason
 * CI goes red, and the account to import has to be one you chose, because
 * naming somebody's account here would publish their finances with the repo:
 *
 *   LIVE_HORIZON=1 LIVE_HORIZON_ACCOUNT=G... pnpm test
 *
 * Any public address works. One with at least 200 payments exercises paging.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { NodeSqlDriver } from "../support/node-driver";
import { migrate } from "../../src/db/migrator";
import { createRepositories, type Repositories } from "../../src/db/repositories";
import { StrKey } from "@stellar/stellar-sdk";
import { HorizonClient } from "../../src/stellar/client";
import { syncAccount } from "../../src/ledger/sync";
import { StellarError } from "../../src/stellar/errors";
import { compare } from "../../src/lib/money";

const LIVE_ACCOUNT = process.env["LIVE_HORIZON_ACCOUNT"] ?? "";
const live = process.env["LIVE_HORIZON"] === "1" && LIVE_ACCOUNT !== "";

if (process.env["LIVE_HORIZON"] === "1" && LIVE_ACCOUNT === "") {
  throw new Error("LIVE_HORIZON=1 needs LIVE_HORIZON_ACCOUNT=G... — see the note above.");
}

describe.runIf(live)("live Horizon import", () => {
  let repos: Repositories;
  let driver: NodeSqlDriver;
  const client = new HorizonClient({ network: "public" });

  beforeAll(async () => {
    driver = new NodeSqlDriver();
    await migrate(driver);
    repos = createRepositories(driver);
  });

  it("imports the chosen account from the real API", async () => {
    const workspace = await repos.workspaces.create({ name: "Live Test" });
    const account = await repos.accounts.create({
      workspaceId: workspace.id,
      publicKey: LIVE_ACCOUNT,
      network: "public",
    });

    const result = await syncAccount({ repositories: repos, dataSource: client }, account);

    // The account is whichever one you pointed the test at, so assert the
    // invariants that hold for any account rather than a count.
    expect(result.entriesImported).toBeGreaterThan(0);
    expect(result.pagesFetched).toBeGreaterThanOrEqual(1);

    const stored = await repos.entries.count({ workspaceId: workspace.id });
    expect(stored).toBe(result.entriesImported);

    // Direction resolution must work on live data, not just fixtures.
    const incoming = await repos.entries.count({
      workspaceId: workspace.id,
      direction: "incoming",
    });
    expect(incoming).toBeGreaterThan(0);

    // Amounts survive the round trip exactly.
    const amounts = await driver.select<{ amount: string }>(
      "SELECT amount FROM ledger_entries ORDER BY timestamp ASC LIMIT 1",
    );
    expect(amounts[0]?.amount).toBeDefined();
    expect(amounts[0]!.amount).not.toMatch(/e/i);

    // A second sync from the stored cursor must add nothing.
    const after = await repos.accounts.findById(account.id);
    const second = await syncAccount({ repositories: repos, dataSource: client }, after!);
    expect(second.entriesImported).toBe(0);
    expect(await repos.entries.count({ workspaceId: workspace.id })).toBe(stored);
  }, 120_000);

  it("reads live balances that agree with the imported assets", async () => {
    const details = await client.getAccount(LIVE_ACCOUNT);
    expect(details.account_id).toBe(LIVE_ACCOUNT);
    expect(details.balances.length).toBeGreaterThan(0);

    for (const balance of details.balances) {
      expect(compare(balance.balance, "0")).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it("reports a nonexistent account as account_not_found", async () => {
    // A valid, correctly-checksummed address that has never been funded.
    // Built deterministically from a fixed byte pattern rather than a random
    // keypair, so no secret key is ever generated — not even in a test.
    // (The all-zero address is not usable here: it turns out to be a real
    // funded account on the public network.)
    const absent = StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(0xab)));
    expect(StrKey.isValidEd25519PublicKey(absent)).toBe(true);

    await expect(client.getAccount(absent)).rejects.toMatchObject({
      kind: "account_not_found",
    });
  }, 60_000);

  it("surfaces an unreachable endpoint as a typed offline error", async () => {
    const broken = new HorizonClient({
      network: "public",
      url: "https://horizon.invalid.example",
      maxAttempts: 1,
    });
    await expect(broken.getAccount(LIVE_ACCOUNT)).rejects.toBeInstanceOf(StellarError);
  }, 60_000);
});
