import type { SqlDriver, Statement } from "../driver";
import type { SqlRow } from "../row";
import type { Contact, ContactAddress, Network } from "../schema";
import { mapContact, mapContactAddress } from "./mappers";
import { newId, nowIso } from "../../lib/ids";
import { add, ZERO } from "../../lib/money";

export class AddressAlreadyAssignedError extends Error {
  constructor(
    readonly address: string,
    readonly contactName: string,
    readonly memo: string | null = null,
  ) {
    super(
      memo
        ? `${address} with memo "${memo}" is already assigned to ${contactName}.`
        : `${address} is already assigned to ${contactName}.`,
    );
    this.name = "AddressAlreadyAssignedError";
  }
}

/**
 * Joins that resolve an entry to a contact, memo-aware.
 *
 * An exact memo match beats an address claimed regardless of memo, which is
 * what lets a shared exchange address hold both a catch-all contact and named
 * sub-accounts.
 */
const RESOLUTION_JOIN = `
  LEFT JOIN entry_annotations an ON an.ledger_entry_id = e.id
  LEFT JOIN contact_addresses ca_memo
    ON ca_memo.workspace_id = e.workspace_id
   AND ca_memo.network = e.network
   AND ca_memo.address = e.counterparty_address
   AND ca_memo.memo IS NOT NULL
   AND ca_memo.memo = e.memo_value
  LEFT JOIN contact_addresses ca_any
    ON ca_any.workspace_id = e.workspace_id
   AND ca_any.network = e.network
   AND ca_any.address = e.counterparty_address
   AND ca_any.memo IS NULL
`;

const RESOLVED = "COALESCE(an.contact_id, ca_memo.contact_id, ca_any.contact_id)";

export interface ContactSummary extends Contact {
  addressCount: number;
  entryCount: number;
}

/** A counterparty seen in the ledger that no contact claims yet. */
export interface UnnamedCounterparty {
  address: string;
  network: Network;
  /**
   * The memo these payments carried, if any.
   *
   * Grouped separately from the same address with a different memo, because on
   * a shared custodial address the memo is the only thing identifying who was
   * actually paid.
   */
  memo: string | null;
  memoType: string | null;
  entryCount: number;
  incomingCount: number;
  outgoingCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Asset codes this address has transacted in, most frequent first. */
  assetCodes: string[];
}

export class ContactRepository {
  constructor(private readonly driver: SqlDriver) {}

  /**
   * Contacts with their address and activity counts.
   *
   * Counted in SQL in one pass rather than per contact, so the contacts screen
   * does not fan out into an N+1 query.
   */
  async listWithCounts(workspaceId: string): Promise<ContactSummary[]> {
    // entry_count must reflect how entries actually resolve to a contact: an
    // explicit assignment on the entry, or any address in the contact's address
    // book matching the counterparty. Counting only the former would report
    // zero for a contact whose transactions all resolve through its addresses.
    const rows = await this.driver.select<SqlRow>(
      `SELECT
         c.*,
         (SELECT COUNT(*) FROM contact_addresses ca WHERE ca.contact_id = c.id) AS address_count,
         (
           SELECT COUNT(*)
           FROM ledger_entries e
           ${RESOLUTION_JOIN}
           WHERE e.workspace_id = c.workspace_id
             AND ${RESOLVED} = c.id
         ) AS entry_count
       FROM contacts c
       WHERE c.workspace_id = ?
       ORDER BY c.name COLLATE NOCASE ASC`,
      [workspaceId],
    );
    return rows.map((row) => ({
      ...mapContact(row),
      addressCount: row["address_count"] ?? 0,
      entryCount: row["entry_count"] ?? 0,
    }));
  }

  async findById(id: string): Promise<Contact | undefined> {
    const rows = await this.driver.select<SqlRow>("SELECT * FROM contacts WHERE id = ?", [id]);
    return rows[0] ? mapContact(rows[0]) : undefined;
  }

  async addresses(contactId: string): Promise<ContactAddress[]> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM contact_addresses WHERE contact_id = ? ORDER BY created_at ASC",
      [contactId],
    );
    return rows.map(mapContactAddress);
  }

  /**
   * The contact an address belongs to, if any.
   *
   * With a memo, an exact match wins and the memo-less claim is the fallback —
   * the same precedence the ledger uses.
   */
  async findByAddress(
    workspaceId: string,
    network: Network,
    address: string,
    memo: string | null = null,
  ): Promise<Contact | undefined> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT c.*, ca.memo AS matched_memo
       FROM contacts c
       JOIN contact_addresses ca ON ca.contact_id = c.id
       WHERE ca.workspace_id = ? AND ca.network = ? AND ca.address = ?
         AND (ca.memo IS NULL OR ca.memo = ?)
       ORDER BY ca.memo IS NULL
       LIMIT 1`,
      [workspaceId, network, address, memo],
    );
    return rows[0] ? mapContact(rows[0]) : undefined;
  }

  /**
   * Creates a contact, optionally claiming addresses at the same time.
   *
   * This is the fast path behind "Add contact" on an unknown transaction: after
   * it commits, every historical entry involving those addresses resolves to
   * the new contact through the join, with no rows rewritten.
   */
  async create(input: {
    workspaceId: string;
    name: string;
    organization?: string | null;
    notes?: string | null;
    addresses?: ReadonlyArray<{
      network: Network;
      address: string;
      /** Null claims the address for any memo; a value claims only that memo. */
      memo?: string | null;
      label?: string | null;
    }>;
  }): Promise<Contact> {
    const now = nowIso();
    const contact: Contact = {
      id: newId(),
      workspaceId: input.workspaceId,
      name: input.name,
      organization: input.organization ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    for (const entry of input.addresses ?? []) {
      await this.assertAddressFree(
        input.workspaceId,
        entry.network,
        entry.address,
        entry.memo ?? null,
      );
    }

    const statements: Statement[] = [
      {
        sql: `INSERT INTO contacts (id, workspace_id, name, organization, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          contact.id,
          contact.workspaceId,
          contact.name,
          contact.organization,
          contact.notes,
          now,
          now,
        ],
      },
      ...(input.addresses ?? []).map((entry) => ({
        sql: `INSERT INTO contact_addresses (id, contact_id, workspace_id, network, address, memo, label, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId(),
          contact.id,
          input.workspaceId,
          entry.network,
          entry.address,
          entry.memo ?? null,
          entry.label ?? null,
          now,
        ] as (string | null)[],
      })),
    ];

    await this.driver.batch(statements);
    return contact;
  }

  async update(
    id: string,
    changes: { name?: string; organization?: string | null; notes?: string | null },
  ): Promise<void> {
    const fields: string[] = [];
    const params: (string | null)[] = [];

    if (changes.name !== undefined) {
      fields.push("name = ?");
      params.push(changes.name);
    }
    if (changes.organization !== undefined) {
      fields.push("organization = ?");
      params.push(changes.organization);
    }
    if (changes.notes !== undefined) {
      fields.push("notes = ?");
      params.push(changes.notes);
    }
    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    params.push(nowIso(), id);
    await this.driver.execute(`UPDATE contacts SET ${fields.join(", ")} WHERE id = ?`, params);
  }

  async addAddress(input: {
    contactId: string;
    workspaceId: string;
    network: Network;
    address: string;
    memo?: string | null;
    label?: string | null;
  }): Promise<void> {
    await this.assertAddressFree(
      input.workspaceId,
      input.network,
      input.address,
      input.memo ?? null,
    );
    await this.driver.execute(
      `INSERT INTO contact_addresses (id, contact_id, workspace_id, network, address, memo, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        input.contactId,
        input.workspaceId,
        input.network,
        input.address,
        input.memo ?? null,
        input.label ?? null,
        nowIso(),
      ],
    );
  }

  async removeAddress(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM contact_addresses WHERE id = ?", [id]);
  }

  /** Deleting a contact clears it from annotations but never deletes entries. */
  async remove(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM contacts WHERE id = ?", [id]);
  }

  /** Moves every address and annotation from one contact onto another. */
  async merge(sourceId: string, targetId: string): Promise<void> {
    const now = nowIso();
    await this.driver.batch([
      {
        sql: "UPDATE contact_addresses SET contact_id = ? WHERE contact_id = ?",
        params: [targetId, sourceId],
      },
      {
        sql: "UPDATE entry_annotations SET contact_id = ?, updated_at = ? WHERE contact_id = ?",
        params: [targetId, now, sourceId],
      },
      { sql: "DELETE FROM contacts WHERE id = ?", params: [sourceId] },
    ]);
  }

  /**
   * Counterparties with no name yet, busiest first.
   *
   * This is the "who are these people" worklist: every address the ledger has
   * seen that no contact claims. Naming one here resolves it across all of that
   * address's history at once, so the list is a queue that shortens as you work
   * through it.
   *
   * The workspace's own tracked accounts are excluded — they already have
   * labels, and an internal transfer does not need a contact.
   */
  async unnamedCounterparties(workspaceId: string, limit = 100): Promise<UnnamedCounterparty[]> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT
         e.counterparty_address AS address,
         e.network              AS network,
         e.memo_value           AS memo,
         e.memo_type            AS memo_type,
         COUNT(*)               AS entry_count,
         SUM(CASE WHEN e.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
         SUM(CASE WHEN e.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
         MIN(e.timestamp)       AS first_seen,
         MAX(e.timestamp)       AS last_seen,
         GROUP_CONCAT(DISTINCT a.display_code) AS asset_codes
       FROM ledger_entries e
       JOIN assets a ON a.id = e.asset_id
       ${RESOLUTION_JOIN}
       WHERE e.workspace_id = ?
         AND e.counterparty_address IS NOT NULL
         AND ${RESOLVED} IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM tracked_accounts t
           WHERE t.workspace_id = e.workspace_id
             AND t.network = e.network
             AND t.public_key = e.counterparty_address
         )
       GROUP BY e.counterparty_address, e.network, e.memo_value
       ORDER BY entry_count DESC, last_seen DESC
       LIMIT ?`,
      [workspaceId, limit],
    );

    return rows.map((row) => ({
      address: row["address"],
      network: row["network"],
      memo: row["memo"] ?? null,
      memoType: row["memo_type"] ?? null,
      entryCount: row["entry_count"] ?? 0,
      incomingCount: row["incoming_count"] ?? 0,
      outgoingCount: row["outgoing_count"] ?? 0,
      firstSeen: row["first_seen"],
      lastSeen: row["last_seen"],
      assetCodes: String(row["asset_codes"] ?? "")
        .split(",")
        .filter(Boolean),
    }));
  }

  /**
   * A contact's activity, per asset.
   *
   * Never a single total: this contact may have been paid in USDC and XLM, and
   * adding those together would invent a number no exchange rate backs.
   */
  async activity(
    workspaceId: string,
    contactId: string,
  ): Promise<Array<{ assetCode: string; incoming: string; outgoing: string; count: number }>> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT a.display_code AS asset_code, e.direction, e.amount
       FROM ledger_entries e
       JOIN assets a ON a.id = e.asset_id
       ${RESOLUTION_JOIN}
       WHERE e.workspace_id = ?
         AND ${RESOLVED} = ?`,
      [workspaceId, contactId],
    );

    const byAsset = new Map<
      string,
      { assetCode: string; incoming: string; outgoing: string; count: number }
    >();
    for (const row of rows) {
      const code = row["asset_code"] as string;
      const totals = byAsset.get(code) ?? {
        assetCode: code,
        incoming: ZERO,
        outgoing: ZERO,
        count: 0,
      };
      if (row["direction"] === "incoming") totals.incoming = add(totals.incoming, row["amount"]);
      if (row["direction"] === "outgoing") totals.outgoing = add(totals.outgoing, row["amount"]);
      totals.count += 1;
      byAsset.set(code, totals);
    }
    return [...byAsset.values()].toSorted((a, b) => a.assetCode.localeCompare(b.assetCode));
  }

  /**
   * Refuses only an exact duplicate claim.
   *
   * The same address with a different memo is a different counterparty, so it
   * must be allowed; only the identical (address, memo) pair is a conflict.
   */
  private async assertAddressFree(
    workspaceId: string,
    network: Network,
    address: string,
    memo: string | null,
  ): Promise<void> {
    const rows = await this.driver.select<SqlRow>(
      `SELECT c.name FROM contacts c
       JOIN contact_addresses ca ON ca.contact_id = c.id
       WHERE ca.workspace_id = ? AND ca.network = ? AND ca.address = ?
         AND COALESCE(ca.memo, '') = COALESCE(?, '')`,
      [workspaceId, network, address, memo],
    );
    if (rows[0]) throw new AddressAlreadyAssignedError(address, rows[0]["name"], memo);
  }
}
