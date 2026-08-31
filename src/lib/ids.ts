/**
 * Identifier generation.
 *
 * Entity ids are random UUIDs rather than autoincrement integers so that a
 * portable backup can be re-imported into a fresh database without id
 * collisions, and so annotations keep referring to the same rows across a
 * delete/reinstall/restore cycle.
 */

export function newId(): string {
  return crypto.randomUUID();
}

/** ISO-8601 UTC timestamp, the canonical time format for every stored row. */
export function nowIso(): string {
  return new Date().toISOString();
}
