-- Annotations waiting for their ledger entry to exist.
--
-- This is what makes a portable backup safe to restore. A backup deliberately
-- does not carry blockchain history — that is reconstructable — so at import
-- time the entries an annotation belongs to have not been synced yet.
--
-- Restoring writes annotations here, keyed by the blockchain-derived
-- (network, external_key) rather than by a database row id. After a resync
-- recreates the entries with the same deterministic keys, the pending rows are
-- attached and removed. An annotation therefore cannot be orphaned by the
-- delete / reinstall / import / resync cycle.

CREATE TABLE pending_annotations (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  network         TEXT NOT NULL,
  external_key    TEXT NOT NULL,

  contact_id      TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  category_id     TEXT REFERENCES categories(id) ON DELETE CASCADE,
  note            TEXT,
  excluded        INTEGER NOT NULL DEFAULT 0,
  reimbursable    INTEGER NOT NULL DEFAULT 0,

  contact_source  TEXT,
  category_source TEXT,
  note_source     TEXT,
  excluded_source TEXT,

  created_at      TEXT NOT NULL,

  UNIQUE (workspace_id, network, external_key)
);

CREATE INDEX idx_pending_annotations_lookup
  ON pending_annotations (workspace_id, network, external_key);
