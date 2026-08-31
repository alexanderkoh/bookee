import type { SqlDriver, Statement } from "../driver";
import type { AnnotationSource, Network } from "../schema";
import { toDbBool } from "../schema";
import { newId, nowIso } from "../../lib/ids";

export interface PendingAnnotation {
  network: Network;
  externalKey: string;
  contactId: string | null;
  categoryId: string | null;
  note: string | null;
  excluded: boolean;
  reimbursable: boolean;
  contactSource: AnnotationSource | null;
  categorySource: AnnotationSource | null;
  noteSource: AnnotationSource | null;
  excludedSource: AnnotationSource | null;
}

/**
 * Annotations whose ledger entry does not exist yet.
 *
 * A restored backup carries the user's metadata but no blockchain history, so
 * at import time there is nothing to attach to. Annotations are parked here
 * keyed by (network, external_key) — identifiers derived from the chain, not
 * from any database row — and attached once a resync recreates the entries.
 *
 * This is the mechanism that stops a backup from orphaning annotations.
 */
export class PendingAnnotationRepository {
  constructor(private readonly driver: SqlDriver) {}

  buildInsertStatements(
    workspaceId: string,
    annotations: readonly PendingAnnotation[],
  ): Statement[] {
    const now = nowIso();
    return annotations.map((annotation) => ({
      sql: `INSERT INTO pending_annotations (
              id, workspace_id, network, external_key,
              contact_id, category_id, note, excluded, reimbursable,
              contact_source, category_source, note_source, excluded_source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, network, external_key) DO UPDATE SET
              contact_id = excluded.contact_id,
              category_id = excluded.category_id,
              note = excluded.note,
              excluded = excluded.excluded,
              reimbursable = excluded.reimbursable`,
      params: [
        newId(),
        workspaceId,
        annotation.network,
        annotation.externalKey,
        annotation.contactId,
        annotation.categoryId,
        annotation.note,
        toDbBool(annotation.excluded),
        toDbBool(annotation.reimbursable),
        annotation.contactSource,
        annotation.categorySource,
        annotation.noteSource,
        annotation.excludedSource,
        now,
      ],
    }));
  }

  /**
   * Attaches every pending annotation whose entry now exists, then removes the
   * pending rows. Anything still unmatched stays parked for the next sync.
   */
  async attachMatching(workspaceId: string): Promise<number> {
    const matched = await this.driver.select<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM pending_annotations p
       JOIN ledger_entries e
         ON e.workspace_id = p.workspace_id
        AND e.network = p.network
        AND e.external_key = p.external_key
       WHERE p.workspace_id = ?`,
      [workspaceId],
    );
    const count = matched[0]?.count ?? 0;
    if (count === 0) return 0;

    const now = nowIso();
    await this.driver.batch([
      {
        // A manual annotation made since the import wins over the restored one,
        // so existing rows are left alone rather than overwritten.
        sql: `INSERT INTO entry_annotations (
                id, ledger_entry_id, contact_id, category_id, note, excluded, reimbursable,
                contact_source, category_source, note_source, excluded_source,
                created_at, updated_at
              )
              SELECT
                lower(hex(randomblob(16))), e.id, p.contact_id, p.category_id, p.note,
                p.excluded, p.reimbursable,
                p.contact_source, p.category_source, p.note_source, p.excluded_source,
                ?, ?
              FROM pending_annotations p
              JOIN ledger_entries e
                ON e.workspace_id = p.workspace_id
               AND e.network = p.network
               AND e.external_key = p.external_key
              WHERE p.workspace_id = ?
              ON CONFLICT(ledger_entry_id) DO NOTHING`,
        params: [now, now, workspaceId],
      },
      {
        sql: `DELETE FROM pending_annotations
              WHERE workspace_id = ?
                AND EXISTS (
                  SELECT 1 FROM ledger_entries e
                  WHERE e.workspace_id = pending_annotations.workspace_id
                    AND e.network = pending_annotations.network
                    AND e.external_key = pending_annotations.external_key
                )`,
        params: [workspaceId],
      },
    ]);

    return count;
  }

  /** How many annotations are still waiting, shown in Diagnostics. */
  async pendingCount(workspaceId: string): Promise<number> {
    const rows = await this.driver.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM pending_annotations WHERE workspace_id = ?",
      [workspaceId],
    );
    return rows[0]?.count ?? 0;
  }
}
