/**
 * A generated account history, used wherever a test needs a full ledger rather
 * than a single record.
 *
 * Why this is generated rather than captured: a real account's payment history
 * is somebody's finances. Committing one to a public repository publishes their
 * balance, their counterparties and their timing permanently, and no amount of
 * "it is already on-chain" makes that a decision this project gets to make on
 * their behalf. So the repository ships no account history at all.
 *
 * What is NOT hand-written is the record *shape*. Every record here is built by
 * cloning `operation-payment.json`, which is a verbatim Horizon response, so the
 * field names and value formats stay exactly what Horizon really returns. Only
 * the identifiers, parties, assets and amounts are ours. Inventing the shape is
 * how parser bugs get baked in; inventing the contents is how privacy is kept.
 *
 * Contributors who want to validate against a real account can capture their own
 * fixtures — see `scripts/capture-fixtures.mjs` and docs/DEVELOPMENT.md. Those
 * captures are gitignored and never committed.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { loadFixture } from "./fixtures";

/**
 * Checksum-valid addresses derived from fixed byte patterns.
 *
 * No keypair is generated, so no secret key exists even in the test suite.
 * Address-shaped strings would fail the same StrKey validation a user's input
 * goes through, which would make these useless for anything that validates.
 */
function address(seed: number): string {
  const bytes = Buffer.alloc(32);
  bytes.fill(seed & 0xff);
  bytes[0] = seed & 0xff;
  bytes[31] = (seed >> 8) & 0xff;
  return StrKey.encodeEd25519PublicKey(bytes);
}

/** The account the generated history belongs to. */
export const SAMPLE_ACCOUNT = address(1);

/** Counterparties it transacts with. */
export const SAMPLE_COUNTERPARTIES = [2, 3, 4, 5, 6, 7].map(address);

const USDC_ISSUER = address(90);

/**
 * Totals the suite asserts against.
 *
 * These are properties of the generator, not of any real account, so they are
 * stated here once and the tests read them from here rather than repeating
 * magic numbers.
 */
export const SAMPLE_TOTALS = {
  entries: 270,
  incoming: 252,
  outgoing: 18,
  /** 200 + 70: the short second page ends the loop without a wasted request. */
  pages: 2,
  pageSize: 200,
} as const;

/** The smallest amount Stellar can express; must survive storage byte-exact. */
export const ONE_STROOP = "0.0000001";

/**
 * A full account history in ascending order.
 *
 * Deterministic: the same ledger every call, so a failing assertion means a real
 * change rather than reshuffled data.
 */
export function syntheticLedgerRecords(): any[] {
  const template = loadFixture<Record<string, unknown>>("operation-payment");
  const records: Record<string, unknown>[] = [];

  for (let i = 0; i < SAMPLE_TOTALS.entries; i++) {
    // The outgoing payments are spread through the history rather than bunched
    // at one end, so paging never lands on a page that is all one direction.
    const outgoing = i % 15 === 7;
    const counterparty = SAMPLE_COUNTERPARTIES[i % SAMPLE_COUNTERPARTIES.length]!;
    const native = i % 4 !== 0;

    // One stroop, once: the precision floor has to appear in real page data and
    // not only in the money module's own unit tests.
    const amount = i === 42 ? ONE_STROOP : `${(i + 1) * 3}.${String(1000000 + i).slice(1)}`;

    const id = String(900000000000000000n + BigInt(i));
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((i % 12) + 1).padStart(2, "0");

    const record: Record<string, unknown> = {
      ...template,
      id,
      paging_token: id,
      created_at: `2026-${month}-${day}T${String(i % 24).padStart(2, "0")}:00:00Z`,
      transaction_hash: `${String(i).padStart(4, "0")}`.repeat(16).slice(0, 64),
      source_account: outgoing ? SAMPLE_ACCOUNT : counterparty,
      from: outgoing ? SAMPLE_ACCOUNT : counterparty,
      to: outgoing ? counterparty : SAMPLE_ACCOUNT,
      amount,
    };

    if (native) {
      // Horizon omits these entirely for native, rather than sending nulls.
      record["asset_type"] = "native";
      delete record["asset_code"];
      delete record["asset_issuer"];
    } else {
      record["asset_type"] = "credit_alphanum4";
      record["asset_code"] = "USDC";
      record["asset_issuer"] = USDC_ISSUER;
    }

    records.push(record);
  }

  return records;
}
