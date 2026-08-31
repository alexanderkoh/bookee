# Data model

SQLite, one file, in the OS application data directory for `app.bookee`.
Schema lives in `src/db/migrations/`.

## Tables

### Blockchain-derived — reconstructable

| Table | Holds |
| --- | --- |
| `ledger_entries` | one normalized movement of value |
| `assets` | asset identities, deterministic ids |
| `stellar_transactions` | memo cache, keyed by transaction hash |

### User metadata — irreplaceable

| Table | Holds |
| --- | --- |
| `workspaces` | one set of books |
| `tracked_accounts` | monitored addresses + paging cursors |
| `entry_annotations` | contact, category, note, excluded, reimbursable |
| `contacts`, `contact_addresses` | the address book |
| `categories` | chart of accounts |
| `rules` | automatic classification |

### Operational

| Table | Holds |
| --- | --- |
| `sync_issues` | records the importer could not interpret |
| `pending_annotations` | restored annotations waiting for their entry to sync |
| `app_settings` | endpoint overrides and preferences |
| `schema_migrations` | applied migration versions |

## Amount representation

Amounts are **TEXT decimal strings**. Never `REAL`, never a JavaScript `number`.

Real accounts routinely hold a 1-stroop payment (`0.0000001`) and a six-figure
balance at the same time. Arithmetic goes through `src/lib/money.ts`, which
wraps big.js with `Big.NE`/`Big.PE` widened so `toString()` never emits
exponential notation — otherwise a stroop would be written to the database as
`1e-7`.

Amounts are stored in canonical form, so Horizon's `4.0000000` becomes `4`. The
value is identical; only trailing zeros differ. Compare amounts with
`compare()`, never with `===`.

Two consequences worth knowing:

- `SUM(amount)` in SQL would coerce TEXT to float. Aggregation therefore happens
  in TypeScript (`totalsByAsset`), not in SQL.
- `ORDER BY amount` on TEXT sorts lexicographically (`"10" < "9"`). Sort by
  timestamp; if amount sorting is ever needed, cast explicitly and only for
  display ordering.

## Stable identifiers

Row ids are random UUIDs, not autoincrement integers, so a portable backup can
be re-imported into a fresh database without collisions.

`external_key` is the dedup key and is derived deterministically from Horizon
identifiers (see [ARCHITECTURE.md](ARCHITECTURE.md#idempotency)). It is what
makes sync idempotent and what a backup uses to reattach annotations.

### Why the SAC key uses an array index

A Stellar Asset Contract balance change has **no identifier of its own** —
verified against `stellar/go`'s `AssetContractBalanceChange`, which has only
`type`, `from`, `to`, `amount` and asset fields. One operation can carry several
changes (20 of 121 sampled records did), and two of them can legitimately be
identical in every field. Hashing the contents would therefore collide, so the
position in the array is the only available discriminator. Horizon builds that
array from the transaction meta event order, which is deterministic for a given
ledger.

## The annotation split

`entry_annotations` is separate from `ledger_entries` so that a resync can
rewrite blockchain facts without ever touching what the user wrote.

The `*_source` columns hold `manual` or `rule` per field:

| Column | Meaning |
| --- | --- |
| `contact_source` | who set `contact_id` |
| `category_source` | who set `category_id` |
| `note_source` | who set `note` |
| `excluded_source` | who set `excluded` |
| `applied_rule_id` | which rule last wrote here |

A rule may only write to a field whose source is not `manual`. Without this,
every sync would silently undo deliberate categorisation. `clearRuleApplied`
resets only rule-set values, so rules can be re-evaluated from scratch while
manual choices survive.

## Contacts resolve through joins

A contact name is **never copied onto a ledger entry**. Assigning an address to
a contact inserts one row in `contact_addresses`; every historical entry
involving that address immediately displays the contact through the join. No
backfill, no rewrite, and renaming a contact updates all history at once.

`contact_addresses` carries a denormalised `workspace_id` purely so
`UNIQUE (workspace_id, network, address)` can be enforced by the database: one
address resolves to exactly one contact per workspace.

## Deletion rules

Deleting user metadata must never destroy blockchain history.

| Deleting | Effect |
| --- | --- |
| category | `ON DELETE SET NULL` — affected entries become uncategorized |
| contact | `ON DELETE SET NULL` — entries keep their raw address |
| tracked account | entries kept, unless "remove cached entries" is chosen |
| workspace | cascades to everything belonging to it |

Removing an account with its entries deletes only entries that involve **no
other tracked account**, so shared history is not lost.

## Indexes

Built with the schema, not retrofitted: `(workspace_id, timestamp DESC)` for the
ledger view, plus `counterparty_address`, `asset_id`, `direction`,
`from_address`, `to_address`, `transaction_hash`, `operation_id`, and lookup
indexes on annotations and contact addresses.

## Migrations

Plain `.sql` files in `src/db/migrations/`, listed in order in `index.ts`,
applied by `src/db/migrator.ts`.

- Each migration runs in **one transaction** together with its
  `schema_migrations` row, so it lands completely or not at all.
- Versions must be contiguous from 1; the runner refuses otherwise.
- **Never edit a released migration.** Add a new one.
- Migrations live in TypeScript rather than the Tauri plugin's Rust builder so
  the schema travels with the domain code and stays usable by a future
  SQLite-WASM build.

## Backup and restore

The cycle, implemented and covered by tests:

```
export .bookee  →  delete/reinstall  →  import  →  resync  →  annotations reattach
```

Blockchain history is deliberately **not** part of the backup — it is
reconstructable. The file carries metadata plus the identifiers needed to
reattach it: each annotation records the `external_key` and network of the entry
it belongs to, never a row id.

Because those entries do not exist at import time, restored annotations land in
`pending_annotations`. After a resync recreates the entries with the same
deterministic keys, `attachMatching()` joins them and clears the parked rows.
Anything unmatched stays parked and is retried on the next sync, so an
annotation is never silently dropped; Diagnostics shows the waiting count.

Two safety properties:

- **A restore never writes into an existing workspace.** It always creates a new
  one with fresh ids, so a corrupt or partial file cannot damage a ledger you
  already have, and the same file can be imported twice.
- **References are remapped.** Contact and category ids are renumbered on
  import, and the ids embedded inside rule conditions and actions are rewritten
  through the same old→new table — otherwise restored rules would point at
  nothing.

An existing annotation always wins over a restored one (`ON CONFLICT DO
NOTHING`), so importing a backup cannot overwrite work done since.

The format is versioned from the first release. A file from a newer version is
refused with an explanation rather than parsed on a guess.

## Rule storage

`conditions_json` and `actions_json` hold small JSON arrays validated by Zod on
read. A rule whose JSON cannot be parsed is skipped by the engine rather than
crashing a sync, and still appears in the rules list so it can be repaired.

Field/operator pairings are constrained (`OPERATORS_BY_FIELD`), so a rule like
"direction greater_than" is rejected at validation rather than silently never
matching. Amount comparisons use exact decimal arithmetic — a lexicographic
string comparison would rank `"9"` above `"10"`.

The `*_source` columns are what let rules and manual edits coexist; see
[the annotation split](#the-annotation-split).

## One address, several counterparties

Exchanges and custodians publish a single Stellar deposit address and identify
each customer by the memo on the payment. So an address is not reliably a
counterparty, and "who is GABC…?" has no answer without the memo.

`contact_addresses.memo` is therefore optional:

| memo | meaning |
| --- | --- |
| `NULL` | this contact owns the address whatever the memo |
| set | this contact owns the address only with that exact memo |

Both can coexist on one address, and the exact match wins — so a catch-all
"Some Exchange" contact and named sub-accounts live side by side. The unnamed
worklist groups by `(address, memo)`, so each customer is named separately.

Uniqueness is enforced with `UNIQUE (workspace_id, network, address,
COALESCE(memo, ''))`. The COALESCE matters: SQLite treats NULLs as distinct, so
a plain constraint would let two contacts each claim the same address with no
memo.

Migration 005 rebuilds the table, because SQLite cannot drop the original
`UNIQUE (workspace_id, network, address)` constraint that forbade exactly this.
Nothing references `contact_addresses`, which is what makes the rebuild safe.

## How a contact resolves

A contact name is never stored on an entry. It resolves at read time through
two routes, in order:

1. `entry_annotations.contact_id` — an explicit assignment on that one entry
2. `contact_addresses` — any contact claiming the entry's `counterparty_address`

```sql
COALESCE(an.contact_id, ca_memo.contact_id, ca_any.contact_id)
```

Three routes, in order: an explicit assignment on that one entry, an address row
whose memo matches this payment exactly, then an address row claiming the
address regardless of memo.

The second route is what makes assigning an address update all history at once,
and why renaming a contact propagates instantly. Filters, contact activity
counts and the rules engine all use the same resolved value, so a rule condition
on `contact` matches entries that resolve through the address book too.
