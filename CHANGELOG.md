# Changelog

Notable changes to Bookee. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, the database schema may change between
releases. Migrations always run forward automatically; there is no downgrade
path, so export a backup before installing a new version if your ledger matters
to you.

## [Unreleased]

### Changed

- Relicensed from MIT to **Apache-2.0**, which adds an explicit patent grant and
  makes contributions a licence grant in themselves — no separate CLA. The
  Bookee name and hedgehog logo are reserved; see [NOTICE](NOTICE).
- The repository no longer ships any account's payment history. The suite runs
  against a ledger generated from the captured Horizon payment record, so it
  keeps Horizon's real field shapes while owing its contents to nobody. Capture
  your own with `node scripts/capture-fixtures.mjs --account G...`; the output is
  gitignored.

### Security

- Asset icon URLs come from a third party's `stellar.toml` and are now required
  to be `https`. A plaintext fetch would have disclosed which assets you hold to
  anyone on the network path.

### Added

- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `NOTICE`, issue and
  pull request templates, and Dependabot.

## [0.1.1] — 2026-08-19

### Added

- **Memo-scoped contacts.** An address plus a memo can now be its own contact.
  Shared deposit addresses, where the memo is the only thing distinguishing one
  payer from the next, resolve to the right person instead of collapsing into
  one. An address saved without a memo still claims every memo at that address,
  so existing ledgers resolve exactly as before.
- **Category emoji.** The fourteen default categories are seeded with one, and
  the picker offers a curated palette. It is a single tab stop with arrow-key
  movement, and stores joined sequences such as flags whole.

### Changed

- Named contacts now sit above the unnamed worklist, and the worklist collapses.
  Its state persists.

### Fixed

- The emoji chip rendered as a bordered box with the glyph off-centre. Emoji
  fonts carry their own metrics, so a text-baseline layout never centres them.
- The custom-emoji field truncated joined sequences: `maxLength` counts UTF-16
  code units, so pasting 🏳️‍🌈 stored a flag followed by a dangling zero-width
  joiner. It now clamps to the first grapheme cluster.

## [0.1.0] — 2026-08-19

First release. Local-first, read-only bookkeeping for Stellar accounts.

### Added

- Import of full payment history for any public address on public or testnet,
  covering payments, path payments, account creation, merges, and Stellar Asset
  Contract transfers, mints, burns and clawbacks
- Exact decimal amounts end to end — a 1-stroop payment and a six-figure balance
  are both stored byte-exact
- Internal transfers between tracked accounts recognised as one transfer rather
  than an expense plus an income
- Contacts, categories, notes, and a rules engine that never overwrites a manual
  choice
- Dense filterable ledger, per-asset balances and totals, category summaries,
  monthly reports, and overview charts
- Asset icons via SEP-1, and indicative per-asset rates from the Stellar DEX
- CSV, QuickBooks Online bank CSV, and monthly report exports
- Portable `.bookee` backup that survives a delete and reinstall
- Multiple independent ledgers
- Installers for macOS, Windows and Linux

[Unreleased]: https://github.com/alexanderkoh/bookee/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/alexanderkoh/bookee/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alexanderkoh/bookee/releases/tag/v0.1.0
