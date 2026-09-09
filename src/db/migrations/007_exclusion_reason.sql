-- Why an entry was excluded.
--
-- Exclusion already existed, but it collapsed two unrelated intentions into one
-- flag. "I paid for this personally, keep it out of the books" and "a stranger
-- airdropped me dust to advertise a website" both read as excluded = 1, so the
-- ledger could hide them but never tell them apart, and neither could a report.
--
--   reason NULL       excluded, reason not recorded (every pre-existing row)
--   reason 'personal' deliberately kept out of these books
--   reason 'spam'     not a transaction the account holder took part in
--
-- The column is only meaningful when excluded = 1. It is left NULL rather than
-- defaulted, because guessing a reason for rows written before the distinction
-- existed would be inventing history.
ALTER TABLE entry_annotations ADD COLUMN exclusion_reason TEXT;

-- Spam is found by sweeping every excluded row for one reason, so the partial
-- index is worth more than a plain one: the non-excluded majority is not in it.
CREATE INDEX idx_entry_annotations_exclusion_reason
  ON entry_annotations (exclusion_reason)
  WHERE exclusion_reason IS NOT NULL;
