#!/usr/bin/env node
/**
 * Captures REAL Horizon responses into tests/fixtures/stellar/.
 *
 * Why this exists: hand-written fixtures encode whatever field names the author
 * guessed, which is exactly how parser bugs get baked in. Every fixture in this
 * project is a verbatim Horizon response, captured by this script, with its
 * provenance recorded in _meta.json.
 *
 * The committed fixtures come from the public network's GLOBAL feeds — the
 * operation and transaction samples the parsers are tested against. They belong
 * to no particular account.
 *
 * Account history is different. It is somebody's finances, and committing one
 * would publish their balance, counterparties and timing permanently, so this
 * repository ships none and there is no default account here. Pass --account to
 * capture your own; the output is gitignored and must stay that way.
 *
 * Usage:
 *   node scripts/capture-fixtures.mjs                  global samples only
 *   node scripts/capture-fixtures.mjs --account G...    also capture that account
 *   node scripts/capture-fixtures.mjs --pages 40        how far to walk the feed
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HORIZON = "https://horizon.stellar.org";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "stellar");

const pagesArgIndex = process.argv.indexOf("--pages");
const MAX_PAGES = pagesArgIndex === -1 ? 40 : Number(process.argv[pagesArgIndex + 1]);

/**
 * Optional, and deliberately not defaulted: whose account this is has to be a
 * decision the person running the script makes, not one the repository makes
 * for them.
 */
const accountArgIndex = process.argv.indexOf("--account");
const TEST_ACCOUNT = accountArgIndex === -1 ? null : process.argv[accountArgIndex + 1];

if (accountArgIndex !== -1 && !/^G[A-Z2-7]{55}$/.test(TEST_ACCOUNT ?? "")) {
  console.error("--account needs a valid Stellar public address (G...)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${HORIZON}${path}`);
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
      console.warn(`  429, waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
    return res.json();
  }
  throw new Error(`giving up on ${path}`);
}

async function save(name, data, provenance) {
  await writeFile(join(OUT, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
  console.log(`  saved ${name}.json  (${provenance})`);
}

/** Collect the first example of each wanted operation type by walking the global feed. */
async function captureOperationSamples() {
  const wantedOps = new Set([
    "payment",
    "path_payment_strict_send",
    "path_payment_strict_receive",
    "create_account",
    "account_merge",
  ]);
  /** SAC balance-change types we want at least one record for. */
  const wantedSac = new Set(["transfer", "mint", "burn", "clawback"]);

  const found = new Map();
  const sacFound = new Map();
  let multiSac = null;
  let cursor = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `/operations?limit=200&order=desc${cursor ? `&cursor=${cursor}` : ""}`;
    const body = await get(q);
    const records = body._embedded.records;
    if (records.length === 0) break;
    cursor = records[records.length - 1].paging_token;

    for (const r of records) {
      if (wantedOps.has(r.type) && !found.has(r.type)) found.set(r.type, r);

      const changes = r.asset_balance_changes ?? [];
      if (changes.length > 1 && multiSac === null) multiSac = r;
      for (const c of changes) {
        if (wantedSac.has(c.type) && !sacFound.has(c.type)) sacFound.set(c.type, r);
      }
    }

    const opsLeft = [...wantedOps].filter((t) => !found.has(t));
    const sacLeft = [...wantedSac].filter((t) => !sacFound.has(t));
    console.log(
      `  page ${page + 1}: still missing ops=[${opsLeft}] sac=[${sacLeft}]${multiSac ? "" : " multi-sac"}`,
    );
    if (opsLeft.length === 0 && sacLeft.length === 0 && multiSac) break;
    await sleep(120);
  }

  for (const [type, record] of found) {
    await save(`operation-${type}`, record, `live ${HORIZON}/operations id=${record.id}`);
  }
  for (const [type, record] of sacFound) {
    await save(`sac-${type}`, record, `live invoke_host_function id=${record.id}`);
  }
  if (multiSac) {
    await save(
      "sac-multiple-balance-changes",
      multiSac,
      `live invoke_host_function id=${multiSac.id}, ${multiSac.asset_balance_changes.length} changes`,
    );
  }

  // account_merge carries no amount; the credited amount lives in its effects.
  const merge = found.get("account_merge");
  if (merge) {
    const effects = await get(`/operations/${merge.id}/effects?limit=200`);
    await save("operation-account_merge-effects", effects, `effects for merge op ${merge.id}`);
  }

  return { found, sacFound };
}

/** Collect one transaction per memo type. */
async function captureMemoSamples() {
  const wanted = new Set(["none", "text", "id", "hash", "return"]);
  const found = new Map();
  let cursor = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `/transactions?limit=200&order=desc${cursor ? `&cursor=${cursor}` : ""}`;
    const body = await get(q);
    const records = body._embedded.records;
    if (records.length === 0) break;
    cursor = records[records.length - 1].paging_token;

    for (const t of records) {
      if (wanted.has(t.memo_type) && !found.has(t.memo_type)) found.set(t.memo_type, t);
    }
    const left = [...wanted].filter((t) => !found.has(t));
    console.log(`  page ${page + 1}: still missing memo types=[${left}]`);
    if (left.length === 0) break;
    await sleep(120);
  }

  for (const [type, tx] of found) {
    await save(`transaction-memo-${type}`, tx, `live transaction hash=${tx.hash}`);
  }
  return found;
}

/**
 * Full pages from a chosen account: pagination, idempotency, precision.
 *
 * These files are gitignored. The suite runs without them, against generated
 * pages built from the captured operation template (tests/support/synthetic-ledger.ts).
 */
async function captureAccountPages() {
  const p1 = await get(`/accounts/${TEST_ACCOUNT}/payments?limit=200&order=asc`);
  await save("account-payments-page1", p1, `${TEST_ACCOUNT} payments asc page 1`);

  const last = p1._embedded.records[p1._embedded.records.length - 1];
  const p2 = await get(
    `/accounts/${TEST_ACCOUNT}/payments?limit=200&order=asc&cursor=${last.paging_token}`,
  );
  await save("account-payments-page2", p2, `${TEST_ACCOUNT} payments asc page 2`);

  const account = await get(`/accounts/${TEST_ACCOUNT}`);
  await save("account-details", account, `${TEST_ACCOUNT} account resource`);

  return p1._embedded.records.length + p2._embedded.records.length;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log("Capturing operation samples...");
  const { found, sacFound } = await captureOperationSamples();
  console.log("Capturing memo samples...");
  const memos = await captureMemoSamples();
  if (TEST_ACCOUNT) {
    console.log(`Capturing account pages for ${TEST_ACCOUNT}...`);
    console.log("  NOTE: these files are gitignored. Do not commit them.");
    const total = await captureAccountPages();
    // Reported, never recorded: _meta is committed, and the count is a fact
    // about somebody's account.
    console.log(`  captured ${total} payment records`);
  } else {
    console.log("No --account given; skipping account pages (this is the default).");
  }

  await save(
    "_meta",
    {
      capturedAt: new Date().toISOString(),
      horizon: HORIZON,
      network: "Public Global Stellar Network ; September 2015",
      note:
        "Verbatim Horizon responses sampled from the public network's global feeds. " +
        "No account history is committed: see tests/support/synthetic-ledger.ts. " +
        "Regenerate with scripts/capture-fixtures.mjs.",
      operationTypes: [...found.keys()],
      sacChangeTypes: [...sacFound.keys()],
      memoTypes: [...memos.keys()],
    },
    "capture metadata",
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
