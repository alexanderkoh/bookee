/**
 * Ordered migration list.
 *
 * Migrations are plain SQL files imported as raw text so the schema is readable
 * as SQL rather than assembled from strings. Add new migrations by appending to
 * this array; never edit an already-released migration.
 */
import init001 from "./001_init.sql?raw";
import pending002 from "./002_pending_annotations.sql?raw";
import icons003 from "./003_asset_icons.sql?raw";
import prices004 from "./004_asset_prices.sql?raw";
import memos005 from "./005_address_memos.sql?raw";
import emoji006 from "./006_category_emoji.sql?raw";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: init001 },
  { version: 2, name: "pending_annotations", sql: pending002 },
  { version: 3, name: "asset_icons", sql: icons003 },
  { version: 4, name: "asset_prices", sql: prices004 },
  { version: 5, name: "address_memos", sql: memos005 },
  { version: 6, name: "category_emoji", sql: emoji006 },
];
