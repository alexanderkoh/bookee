-- Addresses can be distinguished by memo.
--
-- On Stellar, exchanges and custodians publish a single deposit address and
-- identify each customer by the memo on the payment. So one address can be
-- dozens of unrelated counterparties, and "who is GABC…?" has no single answer
-- without the memo.
--
-- An address row may therefore carry an optional memo:
--
--   memo NULL   this contact owns the address regardless of memo
--   memo set    this contact owns the address only with that exact memo
--
-- Resolution prefers the exact memo match and falls back to the memo-less row,
-- so a catch-all contact and specific sub-accounts can coexist on one address.
--
-- The original table declared UNIQUE (workspace_id, network, address), which
-- would forbid exactly that. SQLite cannot drop a table constraint, so the
-- table is rebuilt. Nothing references contact_addresses, which is what makes
-- the rebuild safe.

CREATE TABLE contact_addresses_new (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  network      TEXT NOT NULL,
  address      TEXT NOT NULL,
  memo         TEXT,
  label        TEXT,
  created_at   TEXT NOT NULL
);

INSERT INTO contact_addresses_new (id, contact_id, workspace_id, network, address, memo, label, created_at)
SELECT id, contact_id, workspace_id, network, address, NULL, label, created_at
FROM contact_addresses;

DROP TABLE contact_addresses;

ALTER TABLE contact_addresses_new RENAME TO contact_addresses;

-- COALESCE rather than a plain UNIQUE: SQLite treats NULLs as distinct, so a
-- plain constraint would let the same address be claimed twice with no memo.
CREATE UNIQUE INDEX idx_contact_addresses_unique
  ON contact_addresses (workspace_id, network, address, COALESCE(memo, ''));

CREATE INDEX idx_contact_addresses_lookup ON contact_addresses (workspace_id, network, address);
CREATE INDEX idx_contact_addresses_contact ON contact_addresses (contact_id);
