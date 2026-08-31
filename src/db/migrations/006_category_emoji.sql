-- Categories carry an emoji.
--
-- A ledger is read by scanning, and a glyph is recognised faster than a word.
-- Optional: a category with no emoji falls back to a neutral dot, so nothing
-- depends on one being chosen.
--
-- The defaults below are applied by name and only where the user has not
-- already set one, so a workspace seeded before this migration picks them up
-- without overwriting anything deliberate.

ALTER TABLE categories ADD COLUMN emoji TEXT;

UPDATE categories SET emoji = '💰' WHERE emoji IS NULL AND name = 'Sales';
UPDATE categories SET emoji = '🎁' WHERE emoji IS NULL AND name = 'Grants';
UPDATE categories SET emoji = '🤝' WHERE emoji IS NULL AND name = 'Contributions';
UPDATE categories SET emoji = '📥' WHERE emoji IS NULL AND name = 'Income';
UPDATE categories SET emoji = '📤' WHERE emoji IS NULL AND name = 'Expenses';
UPDATE categories SET emoji = '👷' WHERE emoji IS NULL AND name = 'Contractors';
UPDATE categories SET emoji = '🏠' WHERE emoji IS NULL AND name = 'Rent';
UPDATE categories SET emoji = '🎉' WHERE emoji IS NULL AND name = 'Events';
UPDATE categories SET emoji = '✈️' WHERE emoji IS NULL AND name = 'Travel';
UPDATE categories SET emoji = '💻' WHERE emoji IS NULL AND name = 'Software';
UPDATE categories SET emoji = '📣' WHERE emoji IS NULL AND name = 'Marketing';
UPDATE categories SET emoji = '🔄' WHERE emoji IS NULL AND name = 'Transfer';
UPDATE categories SET emoji = '❓' WHERE emoji IS NULL AND name = 'Uncategorized';
UPDATE categories SET emoji = '📁' WHERE emoji IS NULL AND name = 'Other';
