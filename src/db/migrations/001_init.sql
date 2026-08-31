-- Stellar Ledger initial schema (the product was later renamed to Bookee;
-- a released migration is never edited, not even its comments).
--
-- Two kinds of data live here and they must never be confused:
--
--   BLOCKCHAIN DATA (ledger_entries, assets, stellar_transactions)
--     Immutable, reconstructable. Delete it and a resync rebuilds it.
--
--   USER METADATA (annotations, contacts, categories, rules, workspaces)
--     Local, editable, irreplaceable. This is what the user actually owns.
--
-- Monetary amounts are TEXT decimal strings, never REAL. A 1-stroop payment
-- (0.0000001) and a six-figure balance both occur in real accounts and a float
-- round-trip corrupts one or the other.

CREATE TABLE workspaces (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  -- Reserved for a future pricing adapter. No fiat conversion exists in v0.1.
  reporting_currency TEXT NOT NULL DEFAULT 'USD',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE tracked_accounts (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  public_key          TEXT NOT NULL,
  label               TEXT,
  network             TEXT NOT NULL,
  -- Resume position for the account payments feed. Advanced only in the same
  -- transaction that writes the page's entries, so an interrupted import
  -- restarts from the last fully-committed page.
  last_payment_cursor TEXT,
  last_synced_at      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (workspace_id, network, public_key)
);

-- Asset identity is deterministic, not random: '<network>:native' or
-- '<network>:<code>:<issuer>'. Two assets are the same only when code AND
-- issuer match; sharing a code means nothing.
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  network      TEXT NOT NULL,
  asset_type   TEXT NOT NULL,
  code         TEXT,
  issuer       TEXT,
  contract_id  TEXT,
  display_code TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- Blockchain facts only. Nothing in this table is user-editable.
CREATE TABLE ledger_entries (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  network              TEXT NOT NULL,

  -- Stable dedup key derived from Horizon identifiers:
  --   'op:<operation_id>'              classic single-movement operations
  --   'op:<operation_id>:bc:<index>'   one Stellar Asset Contract balance change
  --   'op:<operation_id>:merge'        account merge
  -- Deliberately excludes the tracked account: when two owned accounts transact,
  -- the same operation appears in both accounts' feeds and must collapse into a
  -- single internal-transfer entry, not a duplicated expense/income pair.
  external_key         TEXT NOT NULL,
  source_kind          TEXT NOT NULL,

  transaction_hash     TEXT,
  operation_id         TEXT,
  paging_token         TEXT,

  timestamp            TEXT NOT NULL,

  movement_type        TEXT NOT NULL,
  direction            TEXT NOT NULL,

  amount               TEXT NOT NULL,
  asset_id             TEXT NOT NULL REFERENCES assets(id),

  from_address         TEXT,
  to_address           TEXT,
  counterparty_address TEXT,

  memo_type            TEXT,
  memo_value           TEXT,

  raw_json             TEXT,

  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,

  UNIQUE (workspace_id, network, external_key)
);

-- Human interpretation of immutable blockchain data, kept strictly separate so
-- a resync can never overwrite it.
--
-- The *_source columns implement the manual-over-rule precedence required by
-- the rules engine: a field whose source is 'manual' was set deliberately by
-- the user and no rule may overwrite it. Fields set by a rule carry 'rule' and
-- remain fair game for re-evaluation.
CREATE TABLE entry_annotations (
  id              TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL UNIQUE REFERENCES ledger_entries(id) ON DELETE CASCADE,

  contact_id      TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,

  note            TEXT,

  excluded        INTEGER NOT NULL DEFAULT 0,
  reimbursable    INTEGER NOT NULL DEFAULT 0,

  contact_source  TEXT,
  category_source TEXT,
  note_source     TEXT,
  excluded_source TEXT,
  applied_rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL,

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  organization TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- workspace_id is denormalised from contacts so that one address can resolve to
-- exactly one contact per workspace, enforced by the database rather than by
-- convention.
CREATE TABLE contact_addresses (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  network      TEXT NOT NULL,
  address      TEXT NOT NULL,
  label        TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (workspace_id, network, address)
);

CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE rules (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  -- Lower number runs first.
  priority        INTEGER NOT NULL DEFAULT 100,
  conditions_json TEXT NOT NULL,
  actions_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Anything Horizon returned that we could not confidently interpret. Unsupported
-- activity must surface here rather than vanish.
CREATE TABLE sync_issues (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tracked_account_id TEXT REFERENCES tracked_accounts(id) ON DELETE CASCADE,
  external_id        TEXT,
  kind               TEXT NOT NULL,
  message            TEXT NOT NULL,
  raw_json           TEXT,
  resolved           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);

-- Transaction metadata cache, keyed by hash so the same transaction is fetched
-- once no matter how many operations reference it.
CREATE TABLE stellar_transactions (
  network        TEXT NOT NULL,
  hash           TEXT NOT NULL,
  memo_type      TEXT,
  memo           TEXT,
  memo_bytes     TEXT,
  source_account TEXT,
  ledger         INTEGER,
  created_at     TEXT,
  fetched_at     TEXT NOT NULL,
  PRIMARY KEY (network, hash)
);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for the queries the ledger screen actually runs.
CREATE INDEX idx_entries_workspace_time    ON ledger_entries (workspace_id, timestamp DESC);
CREATE INDEX idx_entries_counterparty      ON ledger_entries (workspace_id, counterparty_address);
CREATE INDEX idx_entries_asset             ON ledger_entries (workspace_id, asset_id);
CREATE INDEX idx_entries_direction         ON ledger_entries (workspace_id, direction);
CREATE INDEX idx_entries_tx_hash           ON ledger_entries (transaction_hash);
CREATE INDEX idx_entries_operation_id      ON ledger_entries (operation_id);
CREATE INDEX idx_entries_from              ON ledger_entries (workspace_id, from_address);
CREATE INDEX idx_entries_to                ON ledger_entries (workspace_id, to_address);

CREATE INDEX idx_annotations_contact       ON entry_annotations (contact_id);
CREATE INDEX idx_annotations_category      ON entry_annotations (category_id);

CREATE INDEX idx_contact_addresses_lookup  ON contact_addresses (workspace_id, network, address);
CREATE INDEX idx_contact_addresses_contact ON contact_addresses (contact_id);

CREATE INDEX idx_tracked_accounts_ws       ON tracked_accounts (workspace_id);
CREATE INDEX idx_categories_ws             ON categories (workspace_id);
CREATE INDEX idx_contacts_ws               ON contacts (workspace_id);
CREATE INDEX idx_rules_ws                  ON rules (workspace_id, enabled, priority);
CREATE INDEX idx_sync_issues_ws            ON sync_issues (workspace_id, resolved);
