-- Cached asset icons.
--
-- Icons are declared by the asset issuer in its stellar.toml (SEP-1), which is
-- the only authoritative source: nobody else gets to say what an issuer's asset
-- looks like. They are fetched once, stored as a data URI, and never fetched
-- again — so the ledger keeps working offline and no request is made while
-- simply browsing.
--
-- `state` records the outcome so a missing icon is not retried on every render:
--   ok        an image was found and cached
--   none      the issuer publishes no icon; use the fallback monogram
--   failed    the lookup failed; may be retried later

ALTER TABLE assets ADD COLUMN icon_data_uri TEXT;
ALTER TABLE assets ADD COLUMN icon_source_url TEXT;
ALTER TABLE assets ADD COLUMN icon_state TEXT;
ALTER TABLE assets ADD COLUMN icon_checked_at TEXT;
