import type { SqlDriver } from "../driver";
import type { SqlRow } from "../row";
import type { AnnotationSource, EntryAnnotation } from "../schema";
import { mapAnnotation } from "./mappers";
import { toDbBool } from "../schema";
import { newId, nowIso } from "../../lib/ids";

export interface AnnotationChanges {
  contactId?: string | null;
  categoryId?: string | null;
  note?: string | null;
  excluded?: boolean;
  reimbursable?: boolean;
}

/**
 * The user's interpretation layer.
 *
 * Every write records whether it came from the user or from a rule. A rule may
 * only fill in fields the user has not set: once a field's source is "manual",
 * re-running rules leaves it alone. Without that distinction every sync would
 * quietly undo deliberate categorisation.
 */
export class AnnotationRepository {
  constructor(private readonly driver: SqlDriver) {}

  async findByEntry(ledgerEntryId: string): Promise<EntryAnnotation | undefined> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM entry_annotations WHERE ledger_entry_id = ?",
      [ledgerEntryId],
    );
    return rows[0] ? mapAnnotation(rows[0]) : undefined;
  }

  /** Applies a user edit. Any field touched here is marked manual. */
  async setManual(ledgerEntryId: string, changes: AnnotationChanges): Promise<void> {
    await this.apply(ledgerEntryId, changes, "manual", null);
  }

  /**
   * Applies a rule result, skipping fields the user set by hand.
   * Returns true if anything changed.
   */
  async applyRule(
    ledgerEntryId: string,
    changes: AnnotationChanges,
    ruleId: string,
  ): Promise<boolean> {
    const existing = await this.findByEntry(ledgerEntryId);
    const allowed: AnnotationChanges = {};

    // A field is writable when the user has not set it by hand AND the rule
    // would actually change it. Skipping no-op writes matters: rules run after
    // every sync, and rewriting an unchanged value on every entry would mean
    // thousands of pointless UPDATEs each time.
    if (
      changes.contactId !== undefined &&
      existing?.contactSource !== "manual" &&
      (existing?.contactId ?? null) !== changes.contactId
    ) {
      allowed.contactId = changes.contactId;
    }
    if (
      changes.categoryId !== undefined &&
      existing?.categorySource !== "manual" &&
      (existing?.categoryId ?? null) !== changes.categoryId
    ) {
      allowed.categoryId = changes.categoryId;
    }
    if (
      changes.note !== undefined &&
      existing?.noteSource !== "manual" &&
      (existing?.note ?? null) !== changes.note
    ) {
      allowed.note = changes.note;
    }
    if (
      changes.excluded !== undefined &&
      existing?.excludedSource !== "manual" &&
      (existing?.excluded ?? false) !== changes.excluded
    ) {
      allowed.excluded = changes.excluded;
    }

    if (Object.keys(allowed).length === 0) return false;
    await this.apply(ledgerEntryId, allowed, "rule", ruleId);
    return true;
  }

  /** Clears rule-applied values so rules can be re-evaluated from scratch. */
  async clearRuleApplied(workspaceId: string): Promise<void> {
    await this.driver.execute(
      `UPDATE entry_annotations
       SET contact_id  = CASE WHEN contact_source  = 'rule' THEN NULL ELSE contact_id  END,
           category_id = CASE WHEN category_source = 'rule' THEN NULL ELSE category_id END,
           note        = CASE WHEN note_source     = 'rule' THEN NULL ELSE note        END,
           excluded    = CASE WHEN excluded_source = 'rule' THEN 0    ELSE excluded    END,
           contact_source  = CASE WHEN contact_source  = 'rule' THEN NULL ELSE contact_source  END,
           category_source = CASE WHEN category_source = 'rule' THEN NULL ELSE category_source END,
           note_source     = CASE WHEN note_source     = 'rule' THEN NULL ELSE note_source     END,
           excluded_source = CASE WHEN excluded_source = 'rule' THEN NULL ELSE excluded_source END,
           applied_rule_id = NULL,
           updated_at = ?
       WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE workspace_id = ?)`,
      [nowIso(), workspaceId],
    );
  }

  private async apply(
    ledgerEntryId: string,
    changes: AnnotationChanges,
    source: AnnotationSource,
    ruleId: string | null,
  ): Promise<void> {
    const now = nowIso();
    const existing = await this.findByEntry(ledgerEntryId);

    if (!existing) {
      await this.driver.execute(
        `INSERT INTO entry_annotations (
           id, ledger_entry_id, contact_id, category_id, note, excluded, reimbursable,
           contact_source, category_source, note_source, excluded_source, applied_rule_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          ledgerEntryId,
          changes.contactId ?? null,
          changes.categoryId ?? null,
          changes.note ?? null,
          toDbBool(changes.excluded ?? false),
          toDbBool(changes.reimbursable ?? false),
          changes.contactId !== undefined ? source : null,
          changes.categoryId !== undefined ? source : null,
          changes.note !== undefined ? source : null,
          changes.excluded !== undefined ? source : null,
          ruleId,
          now,
          now,
        ],
      );
      return;
    }

    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    const set = (column: string, value: string | number | null) => {
      fields.push(`${column} = ?`);
      params.push(value);
    };

    if (changes.contactId !== undefined) {
      set("contact_id", changes.contactId);
      set("contact_source", source);
    }
    if (changes.categoryId !== undefined) {
      set("category_id", changes.categoryId);
      set("category_source", source);
    }
    if (changes.note !== undefined) {
      set("note", changes.note);
      set("note_source", source);
    }
    if (changes.excluded !== undefined) {
      set("excluded", toDbBool(changes.excluded));
      set("excluded_source", source);
    }
    if (changes.reimbursable !== undefined) {
      set("reimbursable", toDbBool(changes.reimbursable));
    }
    if (ruleId !== null) set("applied_rule_id", ruleId);

    if (fields.length === 0) return;

    set("updated_at", now);
    params.push(ledgerEntryId);

    await this.driver.execute(
      `UPDATE entry_annotations SET ${fields.join(", ")} WHERE ledger_entry_id = ?`,
      params,
    );
  }
}
