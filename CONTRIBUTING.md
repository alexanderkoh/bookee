# Contributing to Bookee

Thanks for being here. This document is written so you can make a good change
without having to guess at the house rules or read the whole codebase first.

## Get it running

You need **Node 24+**, **pnpm 10+**, and the **Rust toolchain** (Tauri builds a
native binary). The floor is Node 24 because the database tests run on real
SQLite through `node:sqlite`. On Linux you also need the WebKitGTK development
packages — [Tauri's prerequisites page](https://tauri.app/start/prerequisites/)
is accurate and worth following.

```bash
git clone https://github.com/alexanderkoh/bookee.git
cd bookee
pnpm install
pnpm tauri dev
```

The first Rust build takes a few minutes. After that it is fast.

### The browser preview

You do not need to build the native app to work on the interface:

```bash
pnpm dev:preview     # http://localhost:5273
```

This runs the real application against SQLite compiled to WebAssembly, seeded
with a deterministic year of activity — two accounts, several counterparties,
two assets, internal transfers, a shared address distinguished only by memo, and
a 1-stroop payment. It exists because the same `SqlDriver` seam that makes the
database swappable for tests makes it swappable for the browser.

```bash
pnpm preview:shots   # screenshots of every screen, light and dark
```

The screenshot run fails on any console error, so it doubles as a smoke test.

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four must pass. CI runs exactly this, plus a Tauri compile check.

Live network tests are opt-in and need an account you have chosen, because this
repository deliberately ships no default account:

```bash
LIVE_HORIZON=1 LIVE_HORIZON_ACCOUNT=G... pnpm test
```

## The rules that are not negotiable

These are not style preferences. A change that breaks one of them will be asked
to change, however good the rest of it is.

**Never handle secret keys.** No field that accepts one, no import, no storage,
no generation — not even in a test. Bookee reads public data and that is the
whole security model. If a feature seems to need a key, it belongs in a
different application.

**Never sign or submit a transaction.** Every Stellar call is a `GET`. The
inability to move funds should come from the capability being absent, not from a
check that could be removed.

**Money is never a float.** Amounts are decimal strings end to end: `TEXT` in
SQLite, `Amount` in TypeScript, arithmetic through `src/lib/money.ts`. A
`number` in a monetary path is a bug even when the test passes, because the
failure shows up later on somebody's real balance.

**Never total across assets.** 5 XLM plus 5 USDC is not 10 of anything. Every
sum, chart and export is per-asset. There is no fiat conversion.

**Never edit a released migration.** Not the SQL, not the comments. Someone's
database has already applied it. Add `00N_whatever.sql` instead.

**Blockchain data and user data stay separate.** `ledger_entries` is a
reconstructable cache — deleting it and resyncing must lose nothing. Annotations,
contacts, categories and rules are irreplaceable and must survive any resync.
Anything that blurs this is the most expensive kind of bug this project can have.

**Never commit an account's history.** See below.

## Test fixtures

`tests/fixtures/stellar/` holds verbatim Horizon responses, captured by
`scripts/capture-fixtures.mjs`. Hand-written fixtures encode whatever field names
the author guessed, which is exactly how parser bugs get baked in — so fixtures
are captured, never typed.

They are captured from the network's **global** feeds, so they belong to no
particular account. Account history is different: it is somebody's finances, and
publishing it here would expose their balance, counterparties and timing
permanently. The suite therefore runs against a generated ledger
(`tests/support/synthetic-ledger.ts`) that clones the captured payment record for
its shape and owes its contents to nobody.

If you want to validate against a real account, capture your own — the output is
gitignored, and that rule should stay:

```bash
node scripts/capture-fixtures.mjs --account G...
```

## Adding support for a new record type

The order matters:

1. Capture a real example into the fixtures.
2. Write the Zod schema from the captured fields, not from the SDK's types —
   the SDK's `.d.ts` declares fields required that Horizon actually omits.
3. Write the failing test.
4. Write the normalizer.
5. Give it a stable `external_key` so a resync cannot duplicate it.

## Style

Prettier and oxlint decide formatting and lint; run `pnpm format`. Beyond that:

- **Comments explain why, not what.** The code says what it does. A comment
  earns its place by recording the reason, the constraint, or the bug that
  produced the line. Most lines need none.
- Prefer a clear name over a comment explaining a vague one.
- Match the surrounding code's density and idiom.

### Commits

Write a subject line that says what changed, in the imperative, and a body that
explains why if it is not obvious. Look at `git log` for the register.

Please **do not add `Co-Authored-By` trailers for AI tools**, and do not include
generated attribution footers.

### Pull requests

Small and focused beats large and comprehensive. Say what problem you are
solving and how you verified it. Screenshots for interface changes — both themes
if you touched styling.

If you are planning something substantial, open an issue first so you do not
spend a weekend on something that turns out to conflict with the design.

## Accessibility

This is a keyboard-driven tool and it stays that way.

- Everything reachable by keyboard, with a visible focus ring.
- Direction and status are never conveyed by colour alone — there is always a
  sign, a label, or an icon.
- Icon-only controls carry an accessible name.
- Semantic HTML first; ARIA only where HTML has no answer.
- Charts are validated for colour-vision deficiency, not eyeballed.

## Where things live

| Path | What is there |
|---|---|
| `src/db/` | schema, migrations, repositories — the only place SQL exists |
| `src/stellar/` | Horizon client, Zod schemas, per-type normalizers |
| `src/ledger/` | domain logic: sync, rules, exports, valuation |
| `src/features/` | one directory per screen |
| `src/components/` | shared presentational pieces |
| `src-tauri/` | the Rust shell and the transactional `sql_batch` command |
| `docs/` | architecture, data model, development, distribution |

`docs/ARCHITECTURE.md` explains the two seams — `SqlDriver` and
`StellarDataSource` — that most of the design hangs off. It is worth ten minutes
before a large change.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Contributions are licensed under Apache-2.0, the same as the project. Section 5
of the licence means opening a pull request is itself the grant — there is no
separate CLA to sign.
