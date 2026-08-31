/**
 * Access to the captured Horizon fixtures.
 *
 * Every file under tests/fixtures/stellar is a verbatim Horizon response,
 * captured by scripts/capture-fixtures.mjs with its provenance recorded in
 * _meta.json. Hand-written fixtures encode whatever field names the author
 * guessed, which is exactly how parser bugs get baked in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "stellar");

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;
}
