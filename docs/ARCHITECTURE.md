# Architecture

## The one idea

Two kinds of data live in this application, and keeping them apart is the point
of the design.

```
BLOCKCHAIN DATA                        USER METADATA
ledger_entries, assets,                annotations, contacts,
stellar_transactions                   categories, rules, workspaces

immutable                              editable
reconstructable                        irreplaceable
delete it and resync                   delete it and it is gone
```

The blockchain already contains the financial history. It can always be fetched
again. What cannot be fetched again is the knowledge that `GD82…X22` is the
landlord, that a payment was for an event rather than a salary, or that a
transfer between two addresses was internal. That layer only exists locally,
which is why it is stored separately, never overwritten by a sync, and is the
only thing a portable backup must carry.

Everything else follows from this split.

## Flow

```
Stellar
   ↓
Horizon                      https://horizon.stellar.org
   ↓
HorizonClient                src/stellar/client.ts
   ↓  plain JSON
Zod schemas                  src/stellar/schemas.ts
   ↓  validated records
MovementParser registry      src/stellar/normalizers/
   ↓  NormalizedMovement[]
Counterparty resolution      src/ledger/counterparty.ts
   ↓  + direction, counterparty
LedgerEntryRepository        src/db/repositories/
   ↓  SQL statements
SQLite                       via SqlDriver
   ↓
TanStack Query
   ↓
React
```

The arrows only point one way. A React component never sees a Horizon object,
and never writes SQL.

## The two seams

Everything that might be swapped later sits behind an interface.

### `SqlDriver` — `src/db/driver.ts`

| Implementation | Where | Backed by |
| --- | --- | --- |
| `TauriSqlDriver` | production | Tauri SQL plugin + `sql_batch` |
| `NodeSqlDriver` | tests | `node:sqlite` |
| *(future)* | web build | SQLite WASM |

Tests therefore run against real SQLite — real foreign keys, real transactions,
real constraint violations — with no Tauri runtime and no mocking of the
database.

### `StellarDataSource` — `src/stellar/client.ts`

Horizon is one implementation. An RPC endpoint, Hubble, or a custom indexer
could be added without the ledger domain noticing, because nothing downstream
imports `HorizonClient` directly.

## Why there is Rust

Almost none. Business logic is TypeScript. `src-tauri/src/sql_batch.rs` exists
for one reason:

`tauri-plugin-sql` runs statements over an sqlx **connection pool** and has no
transaction support ([plugins-workspace#886]). Issuing `BEGIN` and `COMMIT` as
separate `execute` calls can send them to *different pooled connections*, so a
failure halfway through a batch leaves partial data committed with nothing to
roll back. For an importer that must write a page of entries and its paging
cursor atomically, that is not acceptable.

`sql_batch` borrows the pool the plugin already opened, takes one connection,
and runs the statements in a real transaction. Around sixty lines, and the only
place Rust does something the frontend could not.

[plugins-workspace#886]: https://github.com/tauri-apps/plugins-workspace/issues/886

## Idempotency

Every movement gets a stable `external_key` derived from Horizon identifiers:

| Record | Key |
| --- | --- |
| classic payment, create account | `op:<operation_id>` |
| path payment (converting) | `op:<operation_id>:src` and `:dst` |
| account merge | `op:<operation_id>:merge` |
| SAC balance change | `op:<operation_id>:bc:<index>` |

Unique on `(workspace_id, network, external_key)`, and writes are upserts that
keep the existing row id — which is what stops a resync from orphaning
annotations.

The key deliberately **excludes the tracked account**. When two owned accounts
transact, the same operation appears in both accounts' payment feeds; the shared
key collapses it into one entry classified `internal`, instead of a duplicated
expense-and-income pair.

## Direction

`resolveDirection` is a pure function of a movement plus the set of owned
addresses:

| From | To | Direction |
| --- | --- | --- |
| external | owned | `incoming` |
| owned | external | `outgoing` |
| owned | owned | `internal` |
| neither | neither | `neutral` (not stored) |

Because it is pure and depends only on the owned set, it can be re-run. Adding a
second tracked account triggers `reresolveDirections`, and history that looked
like an ordinary incoming payment becomes an internal transfer — with no
Horizon requests and no rows rewritten beyond direction.

## Sync

```
fetch page (200) → normalize → enrich memos → write entries AND cursor together → next
```

The cursor advances **inside the same transaction** as the entries it covers. If
the process dies mid-import, the cursor never points past data that was not
written, so restarting resumes exactly where it stopped. History is never held
in memory; each page is committed before the next is requested.

A failed request never deletes anything.

## Rules

`src/ledger/rules.ts` holds pure matching logic; `apply-rules.ts` owns the
database side. Splitting them keeps the interesting part directly testable.

Rules run in priority order, lowest number first, and **the first rule to set a
field wins**. Adding a lower-priority rule can therefore never silently change
what a higher-priority one already decided.

Above all of that sits one guarantee: a field the user set by hand is never
touched. `entry_annotations` records a `manual` or `rule` source per field, and
`AnnotationRepository.applyRule` refuses to write over `manual`. Rules re-run
after every sync, so without that rule your categorisation would quietly
disappear each time you fetched new history.

Rule application also skips writes that would not change anything, which keeps
a post-sync pass from issuing thousands of no-op UPDATEs.

## Backup and restore

The file carries user metadata only. Blockchain history is left out because a
resync rebuilds it, which keeps a backup small and makes it useful across
machines.

The problem this creates: at import time, the entries an annotation refers to do
not exist yet. The solution is `pending_annotations` —

```
import  →  annotations parked, keyed by (network, external_key)
resync  →  entries recreated with the same deterministic keys
        →  attachMatching() joins the two and clears the parked rows
```

Because the key is derived from the chain rather than from a database row, the
join survives a delete, a reinstall and a fresh database. Anything that cannot
be matched yet stays parked and is retried on the next sync rather than being
dropped, and Diagnostics reports how many are waiting.

A restore always creates a **new** workspace with fresh ids, remapping contact
and category references — including those inside rules — through an old→new
table. That is what makes importing the same file twice safe, and what
guarantees a failed import cannot corrupt an existing ledger.

## Directory map

```
src/
  branding.ts          all display strings; rename the product here
  lib/                 money (exact decimals), logging, ids
  db/
    driver.ts          the SqlDriver seam
    migrations/        .sql files, applied in order
    repositories/      the only place SQL lives
    schema.ts          domain entity types
  stellar/
    client.ts          Horizon adapter + StellarDataSource
    schemas.ts         Zod validation of wire data
    normalizers/       one parser per record family
  ledger/
    counterparty.ts    direction resolution
    sync.ts            the import loop
    rules.ts           pure rule matching
    apply-rules.ts     running rules against stored entries
    reporting.ts       per-asset category summaries
    backup.ts          .bookee export and restore
    csv.ts             CSV export
  features/            one folder per screen
  components/          small shared UI pieces
src-tauri/             Rust: plugin wiring + sql_batch
tests/
  fixtures/stellar/    captured real Horizon responses
```
