# Security

Bookee reads public blockchain data and stores your interpretation of it on your
own machine. That shape is deliberate, and it is the main security property this
project has to offer.

## What Bookee does and does not do

**It never asks for a secret key.** There is no field to type one into, no
import flow, no keystore. The application cannot sign a transaction because it
has no key material and no signing code path.

**It never submits anything to the network.** Every Stellar interaction is a
`GET` against Horizon. The application cannot move your funds — not through a
bug, not through a malicious contribution, because the capability is absent
rather than guarded.

**It has no backend.** No account, no login, no cloud sync, no telemetry, no
analytics, no crash reporting. Nothing is uploaded anywhere.

**Your data is a local SQLite file.** Contacts, categories, notes and rules live
in the OS application-data directory. Nobody else can read it, and nobody else
can restore it for you if you lose it.

### What leaves your machine

Being honest about this matters more than claiming "nothing":

| Destination | What is sent | Why |
|---|---|---|
| `horizon.stellar.org`, or whatever endpoint you configure | the public addresses you track, paging cursors, and DEX order-book queries for the assets you hold | to read transaction history and show an indicative price |
| an asset issuer's home domain | a request for `/.well-known/stellar.toml` | to find an asset's icon (SEP-1) |
| whatever host that TOML names for the icon | a request for the image | issuers commonly serve icons from a CDN, so this need not be the issuer's own domain |
| `api.github.com` | a version check against the latest release | to tell you an update exists |

Two consequences worth being explicit about. Horizon can observe which addresses
you are interested in and when; if that matters to you, point the app at your own
instance in Settings. And an asset issuer chooses the icon URL, so fetching it
discloses your IP to a host of their choosing — the request is held to `https`
so it cannot be downgraded to plaintext, but it is still a request. Icons are
cached after the first successful fetch.

Nothing about your ledger is included in any of these requests: no contact
names, no notes, no categories, no amounts you have entered.

Nothing you write — contact names, notes, categories, rules — is ever sent
anywhere.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/alexanderkoh/bookee/security/advisories/new).
That opens a private advisory visible only to the maintainers.

Please include what you would want to receive: what an attacker can do, the
steps to reproduce it, the version and platform, and anything you already tried.
A proof of concept helps enormously.

**What to expect.** This is a small project maintained by one person, so the
honest answer is that you will hear back within about a week, and a fix ships
when it is ready rather than on a schedule. There is no bug bounty. Credit is
given in the advisory and the changelog unless you prefer otherwise.

## Scope

Genuinely in scope, and worth reporting:

- anything that causes the app to acquire, request, store or transmit a secret
  key — the central invariant
- anything that submits a transaction, or constructs one
- data sent to any host beyond the three named above
- SQL injection, or any path where user-supplied text reaches SQL unparameterised
- code execution from imported data: a malicious `.bookee` backup, CSV, or a
  hostile Horizon or `stellar.toml` response
- a rendering path where attacker-controlled text (a memo, an asset code, a
  contact name) becomes markup or script
- reading or writing files outside the application's own data directory
- amounts that are silently wrong: rounding, precision loss, or the wrong asset

Out of scope:

- vulnerabilities in Horizon, the Stellar network, or an asset issuer
- **binaries are unsigned**, which is a known and disclosed limitation, not a
  vulnerability — see below
- an attacker who already has your unlocked machine and user account; the
  database is not encrypted at rest, and it is not claimed to be
- missing hardening that has no demonstrable impact
- automated scanner output with no working exploit

## Known limitations, stated plainly

**Releases are unsigned.** There is no Apple Developer ID signature and no
Windows Authenticode certificate, because both cost money this project does not
have. macOS Gatekeeper and Windows SmartScreen will warn you, and you should
treat that warning seriously: verify the download came from
[the releases page](https://github.com/alexanderkoh/bookee/releases), or build
from source, which is the option this project can actually vouch for.

**The database is not encrypted.** Anyone with access to your user account can
read it. Use full-disk encryption if that is a concern.

**There is no auto-update.** Bookee checks whether a newer release exists and
tells you; it never downloads or installs anything by itself. Updating is a
thing you do deliberately.

## Supported versions

The latest release is supported. Given the project's size, fixes go into the
next release rather than being backported.
