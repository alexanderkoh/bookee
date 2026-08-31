/**
 * Preview data.
 *
 * Synthetic, but shaped like the real thing: a year of activity across two
 * owned accounts and several counterparties, in two assets, including internal
 * transfers and a 1-stroop payment. Anything the interface has to cope with in
 * production should be visible here.
 *
 * Deterministic — the same ledger every run, so a screenshot diff means a real
 * change rather than reshuffled fake data.
 */
import type { Repositories } from "../db/repositories";
import { syncAccount } from "../ledger/sync";
import type { PaymentPage, StellarDataSource } from "../stellar/client";
import type { StellarAccount, StellarEffect, StellarTransaction } from "../stellar/schemas";
import type { Network } from "../db/schema";

const OPS = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const RESERVE = "GASTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTH6M5";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/**
 * Real, checksum-valid StrKey addresses, derived deterministically from fixed
 * byte patterns — no keypair is generated, so no secret key exists even here.
 *
 * Address-shaped strings would fail the same validation a user's input goes
 * through, which silently made the "name this party" flow impossible to
 * exercise against the preview.
 */
const COUNTERPARTIES = [
  {
    address: "GAQBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBBRUT",
    name: "Émile Aubert",
    org: "Studio Vantail",
  },
  {
    address: "GAQROFYXC4LROFYXC4LROFYXC4LROFYXC4LROFYXC4LROFYXC4LROTSZ",
    name: "Alderway Properties",
    org: null,
  },
  {
    address: "GARB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB55YW",
    name: "Fernbrook Foundation",
    org: "FBF",
  },
  { address: "GARSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKJJFEUSSKTT5", name: null, org: null },
  {
    address: "GASCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCZTSH",
    name: "Cloudmoor Hosting",
    org: null,
  },
];

/** A tiny deterministic PRNG so the preview never reshuffles between runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function payment(options: {
  id: number;
  from: string;
  to: string;
  amount: string;
  asset: "XLM" | "USDC";
  at: Date;
  memo?: string;
}) {
  const id = String(900_000_000 + options.id);
  const base = {
    id,
    paging_token: id,
    transaction_successful: true,
    source_account: options.from,
    type: "payment" as const,
    type_i: 1,
    created_at: options.at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    transaction_hash: `${options.id.toString(16).padStart(8, "0")}`.repeat(8).slice(0, 64),
    from: options.from,
    to: options.to,
    amount: options.amount,
  };

  return options.asset === "XLM"
    ? { ...base, asset_type: "native" }
    : { ...base, asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_ISSUER };
}

/** A Horizon payment record as this seed constructs it. */
type SeedRecord = ReturnType<typeof payment> & { paging_token: string };

/** Builds a year of plausible activity. */
function buildRecords(): { records: SeedRecord[]; memos: Map<string, string> } {
  const random = mulberry32(20260819);
  const records: SeedRecord[] = [];
  const memos = new Map<string, string>();
  let id = 1;

  const start = new Date(Date.UTC(2025, 8, 1));
  const monthsBack = 12;

  for (let month = 0; month < monthsBack; month++) {
    const monthStart = new Date(start);
    monthStart.setUTCMonth(start.getUTCMonth() + month);

    // A grant arrives most months.
    if (random() > 0.25) {
      const at = new Date(monthStart);
      at.setUTCDate(3 + Math.floor(random() * 4));
      const record = payment({
        id: id++,
        from: COUNTERPARTIES[2]!.address,
        to: OPS,
        amount: (12_000 + Math.floor(random() * 6000)).toFixed(7),
        asset: "USDC",
        at,
      });
      memos.set(
        record.transaction_hash,
        `Grant disbursement ${at.getUTCFullYear()}-${at.getUTCMonth() + 1}`,
      );
      records.push(record);
    }

    // Rent, every month, same counterparty.
    const rentAt = new Date(monthStart);
    rentAt.setUTCDate(5);
    const rent = payment({
      id: id++,
      from: OPS,
      to: COUNTERPARTIES[1]!.address,
      amount: "1042.0000000",
      asset: "USDC",
      at: rentAt,
    });
    memos.set(rent.transaction_hash, "Monthly rent");
    records.push(rent);

    // Contractor payments.
    const contractorCount = 1 + Math.floor(random() * 3);
    for (let n = 0; n < contractorCount; n++) {
      const at = new Date(monthStart);
      at.setUTCDate(8 + Math.floor(random() * 18));
      const record = payment({
        id: id++,
        from: OPS,
        to: COUNTERPARTIES[0]!.address,
        amount: (450 + Math.floor(random() * 900)).toFixed(7),
        asset: "USDC",
        at,
      });
      memos.set(record.transaction_hash, `Invoice ${1200 + id}`);
      records.push(record);
    }

    // Hosting, in XLM.
    const hostAt = new Date(monthStart);
    hostAt.setUTCDate(12);
    records.push(
      payment({
        id: id++,
        from: OPS,
        to: COUNTERPARTIES[4]!.address,
        amount: (180 + Math.floor(random() * 120)).toFixed(7),
        asset: "XLM",
        at: hostAt,
      }),
    );

    // Small unlabelled inbound payments.
    for (let n = 0; n < Math.floor(random() * 3); n++) {
      const at = new Date(monthStart);
      at.setUTCDate(2 + Math.floor(random() * 26));
      records.push(
        payment({
          id: id++,
          from: COUNTERPARTIES[3]!.address,
          to: OPS,
          amount: (5 + random() * 90).toFixed(7),
          asset: "XLM",
          at,
        }),
      );
    }

    // A transfer to the reserve account — this must show as internal.
    if (month % 3 === 1) {
      const at = new Date(monthStart);
      at.setUTCDate(25);
      records.push(
        payment({ id: id++, from: OPS, to: RESERVE, amount: "5000.0000000", asset: "USDC", at }),
      );
    }
  }

  // A shared custodial address: one Stellar account, two customers, told apart
  // only by memo. This is what address-level contacts alone cannot express.
  const EXCHANGE = COUNTERPARTIES[3]!.address;
  for (const [index, memo] of ["invoice-8841", "invoice-9002", "invoice-8841"].entries()) {
    const at = new Date(Date.UTC(2026, 6, 14 + index));
    const record = payment({
      id: id++,
      from: EXCHANGE,
      to: OPS,
      amount: (300 + index * 120).toFixed(7),
      asset: "USDC",
      at,
    });
    memos.set(record.transaction_hash, memo);
    records.push(record);
  }

  // The precision case: one stroop.
  records.push(
    payment({
      id: id++,
      from: COUNTERPARTIES[3]!.address,
      to: OPS,
      amount: "0.0000001",
      asset: "XLM",
      at: new Date(Date.UTC(2026, 7, 12, 13, 25, 49)),
    }),
  );

  records.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  // Paging tokens must ascend with time for cursor paging to behave.
  records.forEach((record, index) => {
    record.paging_token = String(900_000_000 + index);
  });

  return { records, memos };
}

class SeedDataSource implements StellarDataSource {
  readonly network: Network = "public";

  constructor(
    private readonly records: SeedRecord[],
    private readonly memos: Map<string, string>,
    private readonly balances: Record<string, string>,
  ) {}

  async getAccount(accountId: string): Promise<StellarAccount> {
    return {
      account_id: accountId,
      balances: [
        {
          balance: this.balances[`${accountId}:USDC`] ?? "0.0000000",
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER,
        },
        { balance: this.balances[`${accountId}:XLM`] ?? "0.0000000", asset_type: "native" },
      ],
    };
  }

  async getPaymentsPage(
    accountId: string,
    cursor: string | null,
    limit = 200,
  ): Promise<PaymentPage> {
    const mine = this.records.filter(
      (record) => record.from === accountId || record.to === accountId,
    );
    const startIndex = cursor === null ? 0 : mine.findIndex((r) => r.paging_token === cursor) + 1;
    const slice = mine.slice(startIndex, startIndex + limit);
    return { records: slice, cursor: slice.at(-1)?.paging_token ?? null };
  }

  async getTransactions(hashes: readonly string[]): Promise<StellarTransaction[]> {
    return hashes.map((hash) => {
      const memo = this.memos.get(hash);
      return {
        hash,
        created_at: "2026-01-01T00:00:00Z",
        ...(memo ? { memo_type: "text" as const, memo } : { memo_type: "none" as const }),
      };
    });
  }

  async getOperationEffects(): Promise<StellarEffect[]> {
    return [];
  }
}

const PREVIEW_BALANCES: Record<string, string> = {
  [`${OPS}:USDC`]: "18492.0000000",
  [`${OPS}:XLM`]: "384102.7460913",
  [`${RESERVE}:USDC`]: "30000.0000000",
  [`${RESERVE}:XLM`]: "2418.3200000",
};

/**
 * The data source the preview keeps using after seeding, so balances on the
 * dashboard are the seeded ones rather than empty.
 */
export function previewDataSource(): StellarDataSource {
  const { records, memos } = buildRecords();
  return new SeedDataSource(records, memos, PREVIEW_BALANCES);
}

/** Populates an empty database with the preview ledger. */
export async function seedPreview(repositories: Repositories): Promise<string> {
  const { records, memos } = buildRecords();
  const dataSource = new SeedDataSource(records, memos, PREVIEW_BALANCES);

  const workspace = await repositories.workspaces.create({ name: "Larkspur Collective" });

  const operations = await repositories.accounts.create({
    workspaceId: workspace.id,
    publicKey: OPS,
    network: "public",
    label: "Larkspur Operations",
  });
  const reserve = await repositories.accounts.create({
    workspaceId: workspace.id,
    publicKey: RESERVE,
    network: "public",
    label: "Reserve",
  });

  await syncAccount({ repositories, dataSource }, operations);
  await syncAccount({ repositories, dataSource }, reserve);

  const owned = await repositories.accounts.ownedAddresses(workspace.id, "public");
  await repositories.entries.reresolveDirections(workspace.id, "public", owned);

  // XLM and USDC marks are bundled, so the preview needs no icon seeding.

  // A cached market rate, so the ticker renders offline. Real runs fetch this
  // from Horizon's order book.
  await repositories.prices.save("public", {
    baseAssetId: "public:native",
    quoteAssetId: `public:USDC:${USDC_ISSUER}`,
    price: "0.1643500",
    source: "order_book",
    fetchedAt: new Date(Date.UTC(2026, 7, 19, 11, 55)).toISOString(),
  });

  // Contacts, so the address book has something to resolve.
  for (const person of COUNTERPARTIES) {
    if (!person.name) continue;
    await repositories.contacts.create({
      workspaceId: workspace.id,
      name: person.name,
      organization: person.org,
      addresses: [{ network: "public", address: person.address }],
    });
  }

  // A couple of rules, so the rules screen is not empty.
  const categories = await repositories.categories.list(workspace.id);
  const byName = (name: string) => categories.find((c) => c.name === name)!.id;
  const contacts = await repositories.contacts.listWithCounts(workspace.id);
  const contactByName = (name: string) => contacts.find((c) => c.name === name)?.id;

  await repositories.rules.create({
    workspaceId: workspace.id,
    name: "Alderway → Rent",
    priority: 10,
    conditions: [
      { field: "contact", operator: "equals", value: contactByName("Alderway Properties")! },
    ],
    actions: [{ type: "set_category", value: byName("Rent") }],
  });
  await repositories.rules.create({
    workspaceId: workspace.id,
    name: "Fernbrook incoming → Grants",
    priority: 20,
    conditions: [
      {
        field: "contact",
        operator: "equals",
        value: contactByName("Fernbrook Foundation")!,
      },
      { field: "direction", operator: "equals", value: "incoming" },
    ],
    actions: [{ type: "set_category", value: byName("Grants") }],
  });
  await repositories.rules.create({
    workspaceId: workspace.id,
    name: "Émile → Contractors",
    priority: 30,
    conditions: [{ field: "contact", operator: "equals", value: contactByName("Émile Aubert")! }],
    actions: [{ type: "set_category", value: byName("Contractors") }],
  });

  const { applyRules } = await import("../ledger/apply-rules");
  await applyRules(repositories, workspace.id);

  // A second ledger, so the workspace switcher has something to switch to.
  const personal = await repositories.workspaces.create({ name: "Personal" });
  await repositories.accounts.create({
    workspaceId: personal.id,
    publicKey: OPS,
    network: "public",
    label: "Personal wallet",
  });

  return workspace.id;
}
