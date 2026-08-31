# Development

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Node | 24+ | `node:sqlite` powers the database tests |
| pnpm | 10+ | |
| Rust | 1.90+ | stable toolchain |
| Platform deps | | Xcode CLT (macOS), WebView2 (Windows), webkit2gtk (Linux) |

## Commands

```bash
pnpm install
pnpm tauri dev        # run the desktop app
pnpm dev              # frontend only, in a browser (database calls will fail)

pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm tauri build --debug    # native compile + bundle
```

Run all four checks after any change:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Toolchain notes

**TypeScript 7.** The Go-native compiler. Two differences bite:

- `baseUrl` was removed — `paths` entries must be relative (`"./src/*"`).
- `typescript-eslint` still peers `typescript <6.1.0`, so it cannot be used.
  Linting is [oxlint](https://oxc.rs) instead, with Prettier for formatting.

If a dependency's `.d.ts` ever fails under TS 7, pin `typescript@6.0.3` — the
last JS-based compiler. Nothing in this codebase depends on TS 7 semantics.

**`lib: ES2023`** for `toSorted`, supported by every webview Tauri 2 targets.

## Testing

```bash
pnpm test                    # no network, no account needed
LIVE_HORIZON=1 LIVE_HORIZON_ACCOUNT=G... pnpm test   # adds real Horizon tests
```

The live tests need an account to import, and there is deliberately no default:
pick any public address you are comfortable naming. One with 200+ payments
exercises pagination.

Database tests run on **real SQLite** via `node:sqlite` — real foreign keys,
real transactions, real constraint errors — with no Tauri runtime. See
`tests/support/node-driver.ts`.

### Fixtures are captured, never written by hand

`tests/fixtures/stellar/` contains verbatim Horizon responses. Hand-written
fixtures encode whatever field names the author guessed, which is precisely how
parser bugs get baked in. Regenerate with:

```bash
node scripts/capture-fixtures.mjs
```

`_meta.json` records when they were captured and from where.

**No account history is committed, and none ever should be.** An account's
payment history is somebody's finances: their balance, who they pay, and when.
Publishing that in a public repository is not ours to do, and "it is already
on-chain" does not make it our call. So the suite runs against a generated
history instead — `tests/support/synthetic-ledger.ts` builds a full ledger by
cloning the captured `operation-payment.json`, which keeps Horizon's real field
names while owing its contents to nobody.

To validate against a real account, capture your own:

```bash
node scripts/capture-fixtures.mjs --account G...
```

Those files match a `.gitignore` rule. Keep it that way.

Two fixtures in `derived/` are synthesized because the events did not occur in
12,000 sampled records (SAC `clawback`, `return` memos). Each carries a
`_derived` block stating what was changed and which authority the shape came
from.

### Adding support for a new record type

The order is not negotiable:

```
official docs → SDK types → capture a fixture → write the parser test → write the parser
```

Never guess a field name. The SDK's TypeScript definitions are **not** a
reliable description of the wire format — `BalanceChange.from`/`.to` are typed
as required strings but are `omitempty` in Horizon's Go source, and a real
`mint` has no `from`. That is why every record is validated with Zod before a
parser sees it.

Add the parser to the registry in `src/stellar/normalizers/index.ts`. Anything
no parser claims becomes a `sync_issue` carrying the raw record, so unsupported
activity appears in Diagnostics rather than silently vanishing.

## Reviewing the interface

```bash
pnpm dev:preview      # http://localhost:5273
pnpm preview:shots    # screenshots/ — every screen, light and dark, plus
                      # interaction states (menus, dialogs, the drawer)
```

Preview mode swaps `TauriSqlDriver` for `WasmSqlDriver` (SQLite-WASM) and seeds a
deterministic year of activity. Nothing else changes, so what you see is the real
application — which also means the preview is a live proof that the `SqlDriver`
seam works for a web target.

The screenshot script fails the run if the page logged an error, so a broken
screen cannot be silently captured as a pretty picture.

## Things that will trip you up

**Amounts are strings.** Never `Number(amount)`. Use `src/lib/money.ts`. SQL
`SUM()` on an amount column silently converts to float; aggregate in TypeScript.

**Batches are transactions.** Any multi-row write that must be atomic goes
through `driver.batch()`, never a sequence of `execute()` calls — the Tauri SQL
plugin pools connections and has no transaction support, so `BEGIN`/`COMMIT`
across separate calls is not atomic.

**Never edit a released migration.** Add a new file and append it to
`src/db/migrations/index.ts`.

**Direction is derived, not stored truth.** It depends on which addresses the
workspace owns, so it is recomputed by `reresolveDirections` whenever accounts
change.

**Contact names are joined, never stored on an entry.** If you add a query that
needs a contact, resolve it with `COALESCE(an.contact_id, ca.contact_id)` and
include the contact-address join — otherwise contacts assigned through the
address book will silently not appear.

**Rules must not fight the user.** Anything writing to `entry_annotations` on
behalf of a rule goes through `applyRule`, which respects the `manual` source
and skips no-op writes. Never write rule results with `setManual`.

**Chart colours are not the ledger's colours.** Green/red measures ΔE 5.9 under
deuteranopia — below the 6.0 floor — so it cannot carry meaning where the mark is
the message. Charts use a validated blue/red diverging pair (`--chart-in`,
`--chart-out`). In the table green/red is fine because a sign and a text label
carry the meaning there. Validate any new chart colour before using it; do not
eyeball it.

**One scroll region per screen.** Most screens scroll the page (`.content`).
The ledger is the exception: it scrolls its own `.table__scroll`, because the
table is virtualized with a sticky header and a pinned filter bar. Both put the
scrollbar at the same window edge, so it reads as one behaviour.

Two rules keep it that way:

- **Never make a table cell `nowrap` by default.** A long text column then grows
  until the table is wider than its pane and the whole page scrolls sideways.
  Opt in per cell with `.nowrap` (dates) — `.numeric` already does it.
- **Wrap a table that can outgrow its panel in `.table-wrap`**, so it scrolls
  inside the panel instead of widening the page. That wrapper sets
  `overflow-y: hidden` explicitly — setting overflow on one axis makes the other
  compute to `auto` rather than staying `visible`, which silently turns any such
  wrapper into a nested vertical scroll region.
- **The overview does not scroll** at laptop sizes, by design. It is a summary;
  if it needs a scrollbar for its last few pixels, trim it rather than accept
  one.

A stray horizontal scrollbar beside a vertical one is the most confusing thing a
layout can do. `scripts/screenshot.mjs` is the tool for catching it — measure
`scrollWidth > clientWidth` across viewport sizes rather than eyeballing at one.

**Asset icons: two are bundled, the rest are discovered.** The runtime path
reads the issuer's `stellar.toml` (SEP-1) and caches the image it declares. That
does not work for the two assets that matter most — native XLM has no issuer at
all, and USDC declares `home_domain: circle.com` on-chain, which serves no TOML
(404); its real metadata lives at `centre.io`, undiscoverable from Horizon. Both
are therefore bundled in `src/assets/`. Everything else still resolves through
the issuer's own domain, and a failure is cached so it is not retried forever.

**A balance may be valued; a portfolio may not.** `valueHolding` converts one
balance at one rate and carries the rate and its timestamp with the result, so
the figure is checkable. There is deliberately no function that sums those
across assets — a single total would hide which rates were used, when, and how
thin the market was. A test asserts the module exports nothing else.

**USDC is not USD.** It is a dollar-referenced stablecoin trading near, but not
at, one dollar. Converted figures are labelled USDC and prefixed with "≈".
Writing "$" would be a small lie in an application whose point is not telling
them.

**Prices are observations, never valuations.** `HorizonPriceProvider` reads the
order-book midpoint from Horizon — no third-party price API, so the app still
talks to exactly one host and never reveals which assets a user holds. Rates are
cached in `asset_prices` with their timestamp and shown with their age. Nothing
multiplies a balance by a rate: per-asset balances stay per-asset, and there is
no portfolio total. Keep it that way.

**QuickBooks exports are one asset per file.** A bank feed is single-currency, so
mixing assets would produce a file that imports cleanly and means nothing.

**Filesystem access is per-file.** There is no static fs scope; the dialog
plugin grants access to exactly the file the user picked. Read and write through
`src/lib/files.ts` so that stays true.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the directory map and the reasoning
behind the boundaries.

## Renaming the product

`Bookee` is provisional. Display strings live in `src/branding.ts`, and
`productName`/window title in `src-tauri/tauri.conf.json`.

Do **not** change the bundle identifier `app.bookee`: it determines the
application data directory, so changing it strands every existing user's local
database.
