#!/usr/bin/env bash
#
# Collapses the repository to a single clean initial commit.
#
# WHY THIS IS NEEDED, ONCE, BEFORE GOING PUBLIC
#
# Every commit before this one contains a real mainnet account's payment
# history in the test fixtures: its balance, its counterparties, and the timing
# of every transfer. The working tree no longer does. Git history does, and
# making the repository public would publish all of it permanently.
#
# Removing it commit-by-commit is not worth it here: the address is in every
# commit including the root, so a filter would rewrite all of them anyway, and
# it would leave intermediate commits whose tests reference fixtures that no
# longer exist. A single honest initial commit is the cleaner result.
#
# WHAT IT DOES
#
#   1. refuses to run if anything is uncommitted
#   2. writes a full backup bundle you can restore from
#   3. replaces history with one commit containing the current tree
#   4. verifies that no commit mentions the account, and stops before pushing
#      if one still does — origin is left untouched in that case
#   5. force-pushes main, and re-points the v0.1.0 / v0.1.1 tags at it
#      (the tags must move: a tag keeps its old commit reachable, so leaving
#       them behind would publish exactly what this script removes)
#   6. disables the Release workflow across the tag push, because release.yml
#      fires on `v*` and would otherwise start two more full three-platform
#      builds and attach a second set of draft releases
#
# The published release binaries are unaffected and do not need rebuilding —
# preview code is tree-shaken out of the production bundle, so no shipped
# artifact ever contained the account.
#
# Run from the repository root, passing the account id in the environment:
#
#   ACCOUNT=G... bash scripts/collapse-history.sh
#
# The id is deliberately not written anywhere in this file. Hard-coding it would
# republish, in the very commit meant to be clean, the identifier this rewrite
# exists to remove. Without ACCOUNT the rewrite still runs, but step 4 is
# skipped and you are pushing on trust.

set -euo pipefail

BACKUP="${TMPDIR:-/tmp}/bookee-history-backup-$(git rev-parse --short HEAD).bundle"

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to run: you have uncommitted changes. Commit or stash first."
  exit 1
fi

echo "==> Backing up every ref to:"
echo "    $BACKUP"
git bundle create "$BACKUP" --all >/dev/null
echo "    restore with:  git clone $BACKUP restored-bookee"
echo

echo "==> Current history (about to be replaced):"
git log --oneline | sed 's/^/    /'
echo

read -r -p "Replace this with a single commit and force-push? [y/N] " reply
[ "$reply" = "y" ] || { echo "Aborted. Nothing changed."; exit 0; }

echo
echo "==> Creating the new root commit"
git checkout --orphan clean-main
git add -A
git commit --no-verify -q -F - <<'MSG'
Bookee — local-first, read-only bookkeeping for Stellar accounts

The Stellar network records every payment you have ever made. It does not record
that one address is your landlord, that a transfer moved between two of your own
wallets rather than out of the business, or that a payment was for an event and
not a salary. Bookee adds that layer and keeps it on your machine.

Two ideas do most of the work.

The first is a hard split between blockchain data and human data. Ledger entries
are a cache: delete them, resync, and nothing is lost. Contacts, categories,
notes and rules are irreplaceable, live only here, and no sync may overwrite
them. Annotations key off deterministic blockchain identifiers rather than row
ids, so a full resync reattaches them instead of orphaning them.

The second is that this is a reader, not a wallet. There is no field for a
secret key, no signing code, and no write path to the network. The inability to
move funds comes from the capability being absent rather than from a check that
some future patch could remove.

Everything else follows. Money is a decimal string end to end, because a float
round-trip corrupts either a 1-stroop payment or a six-figure balance. Totals are
per asset, because 5 XLM plus 5 USDC is not 10 of anything. Horizon responses are
parsed through Zod at the boundary and anything unrecognised becomes a visible
sync issue rather than a silent drop, since the SDK's own types declare fields
required that Horizon omits.

Tauri 2, React 19, TypeScript, SQLite. Two seams carry the design: SqlDriver,
which lets the same code run on the Tauri plugin, on node:sqlite in tests, and on
SQLite-WASM in the browser preview; and StellarDataSource, which keeps Horizon
behind an adapter.

The repository ships no account's transaction history. That is somebody's
finances, and the test suite runs against a generated ledger instead.
MSG

echo "==> Pointing main at it"
git branch -D main
git branch -m main

echo "==> Re-pointing tags"
for tag in v0.1.0 v0.1.1; do
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    git tag -d "$tag" >/dev/null
  fi
  git tag -a "$tag" -m "Bookee $tag" >/dev/null
done

echo "==> Dropping leftover rewrite refs"
git for-each-ref --format='%(refname)' refs/original | while read -r ref; do
  git update-ref -d "$ref"
done
git reflog expire --expire=now --all
git gc --prune=now --aggressive --quiet

if [ -n "${ACCOUNT:-}" ]; then
  # Check exactly what is about to be published, not every ref: until the push
  # lands, refs/remotes/origin/main still points at the old history, and a
  # --all sweep would abort on a ref this push does not touch.
  PUBLISHED="main v0.1.0 v0.1.1"
  echo "==> Verifying that nothing being pushed mentions the account"
  if git grep -I -q "$ACCOUNT" $(git rev-list $PUBLISHED) 2>/dev/null; then
    echo "    STILL PRESENT. Refusing to push. It appears in:"
    git grep -I -l "$ACCOUNT" $(git rev-list $PUBLISHED) | sed 's/^/      /'
    echo
    echo "    Local history was rewritten but nothing was pushed, so origin is"
    echo "    untouched. Restore with:  git clone $BACKUP restored-bookee"
    exit 1
  fi
  echo "    CLEAN: main, v0.1.0 and v0.1.1 carry no trace of it."

  # Other local refs are not pushed, but they keep the old objects alive here
  # and stop gc pruning them. Name them; deleting one is the operator's call.
  stale=$(
    for ref in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes refs/original); do
      if [ "$ref" = "refs/heads/main" ]; then continue; fi
      if git grep -I -q "$ACCOUNT" $(git rev-list "$ref" 2>/dev/null) 2>/dev/null; then
        echo "      $ref"
      fi
    done
  )
  if [ -n "$stale" ]; then
    echo
    echo "    Local refs that still contain it (not pushed, but not pruned):"
    printf '%s\n' "$stale"
  fi
else
  echo "==> ACCOUNT not set: skipping verification, pushing on trust."
fi

echo
echo "==> Full Stellar addresses left in the tree, for eyeballing:"
git grep -I -h -o -E '\bG[A-Z2-7]{55}\b' -- src scripts tests 2>/dev/null \
  | sort -u | sed 's/^/    /' || true
echo "    (expect only well-known issuers and generated addresses)"
echo

# release.yml triggers on `push: tags: ["v*"]`, so force-pushing the two tags
# would start two more three-platform builds and attach a second set of draft
# releases. Disable the workflow for the duration of the push.
release_workflow_off=0
if command -v gh >/dev/null 2>&1 && gh workflow disable release.yml >/dev/null 2>&1; then
  echo "==> Release workflow disabled for the push"
  release_workflow_off=1
else
  echo "==> Could not disable the Release workflow: the tag push will start two"
  echo "    builds. Delete the duplicate drafts afterwards (gh release list)."
fi

echo "==> Pushing"
git push --force origin main
git push --force origin v0.1.0 v0.1.1

if [ "$release_workflow_off" = "1" ]; then
  echo "==> Re-enabling the Release workflow"
  gh workflow enable release.yml
fi

echo
echo "Done. History is now:"
git log --oneline | sed 's/^/    /'
