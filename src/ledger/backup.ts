/**
 * Portable ledger backup.
 *
 * The file carries the irreplaceable half of the application: contacts,
 * categories, rules, annotations, and which addresses are tracked. It
 * deliberately does NOT carry blockchain history, which any resync can rebuild.
 *
 * The restore cycle is:
 *
 *   import .stellarledger  →  resync Stellar  →  annotations reattach
 *
 * Annotations reference their entry by (network, external_key) — identifiers
 * derived from the chain — rather than by database row id, so they survive a
 * delete/reinstall/resync intact. Anything that cannot be attached yet is
 * parked in pending_annotations rather than dropped.
 *
 * The format is versioned from the first release. Reading a newer version is
 * refused rather than guessed at.
 */
import { z } from "zod";
import type { Repositories } from "../db/repositories";
import type { SqlRow } from "../db/row";
import type { Network } from "../db/schema";
import { newId, nowIso } from "../lib/ids";
import { toDbBool } from "../db/schema";
import type { Statement } from "../db/driver";
import { createLogger } from "../lib/log";
import { BRANDING } from "../branding";

const log = createLogger("backup");

export const BACKUP_FORMAT = "bookee";
export const BACKUP_VERSION = 1;

/**
 * Format names this build still reads.
 *
 * The product was renamed after the format shipped. A file written under the
 * old name is the same document, so it is still accepted — refusing to read
 * someone's backup because the product changed its name would be indefensible.
 */
export const READABLE_FORMATS: readonly string[] = [BACKUP_FORMAT, "stellar-ledger"];

const sourceSchema = z.enum(["manual", "rule"]).nullable().optional();

const backupSchema = z.object({
  format: z.string().refine((value) => READABLE_FORMATS.includes(value)),
  version: z.number().int().positive(),
  exportedAt: z.string().optional(),
  application: z.string().optional(),

  workspace: z.object({
    name: z.string(),
    reportingCurrency: z.string().default("USD"),
  }),

  accounts: z.array(
    z.object({
      publicKey: z.string(),
      network: z.string(),
      label: z.string().nullable().optional(),
    }),
  ),

  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      organization: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  ),

  contactAddresses: z.array(
    z.object({
      contactId: z.string(),
      network: z.string(),
      address: z.string(),
      // Optional so backups written before memo support still restore.
      memo: z.string().nullable().optional(),
      label: z.string().nullable().optional(),
    }),
  ),

  categories: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable().optional(),
      name: z.string(),
      kind: z.enum(["income", "expense", "transfer", "other"]),
    }),
  ),

  rules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      priority: z.number().int(),
      conditions: z.unknown(),
      actions: z.unknown(),
    }),
  ),

  annotations: z.array(
    z.object({
      // The blockchain-derived identity of the entry this belongs to.
      network: z.string(),
      externalKey: z.string(),
      contactId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      excluded: z.boolean().default(false),
      reimbursable: z.boolean().default(false),
      contactSource: sourceSchema,
      categorySource: sourceSchema,
      noteSource: sourceSchema,
      excludedSource: sourceSchema,
    }),
  ),
});

export type LedgerBackup = z.infer<typeof backupSchema>;

export class BackupError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

/** Maps an annotation row — live or still pending — into the file's shape. */
function toAnnotation(row: SqlRow) {
  return {
    network: row["network"] as string,
    externalKey: row["external_key"] as string,
    contactId: (row["contact_id"] as string | null) ?? null,
    categoryId: (row["category_id"] as string | null) ?? null,
    note: (row["note"] as string | null) ?? null,
    excluded: row["excluded"] === 1,
    reimbursable: row["reimbursable"] === 1,
    contactSource: (row["contact_source"] as "manual" | "rule" | null) ?? null,
    categorySource: (row["category_source"] as "manual" | "rule" | null) ?? null,
    noteSource: (row["note_source"] as "manual" | "rule" | null) ?? null,
    excludedSource: (row["excluded_source"] as "manual" | "rule" | null) ?? null,
  };
}

/** Builds the backup document for a workspace. */
export async function exportWorkspace(
  repositories: Repositories,
  workspaceId: string,
): Promise<LedgerBackup> {
  const workspace = await repositories.workspaces.findById(workspaceId);
  if (!workspace) throw new BackupError("That ledger no longer exists.");

  const [accounts, contacts, categories, rules] = await Promise.all([
    repositories.accounts.listByWorkspace(workspaceId),
    repositories.contacts.listWithCounts(workspaceId),
    repositories.categories.list(workspaceId),
    repositories.rules.list(workspaceId),
  ]);

  const addressRows = await repositories.driver.select<SqlRow>(
    `SELECT contact_id, network, address, memo, label
     FROM contact_addresses WHERE workspace_id = ?`,
    [workspaceId],
  );

  // Annotations are exported against the entry's external_key, never its row id.
  const annotationRows = await repositories.driver.select<SqlRow>(
    `SELECT e.network, e.external_key,
            an.contact_id, an.category_id, an.note, an.excluded, an.reimbursable,
            an.contact_source, an.category_source, an.note_source, an.excluded_source
     FROM entry_annotations an
     JOIN ledger_entries e ON e.id = an.ledger_entry_id
     WHERE e.workspace_id = ?`,
    [workspaceId],
  );

  // Annotations still waiting from an earlier restore must survive a re-export.
  const pendingRows = await repositories.driver.select<SqlRow>(
    `SELECT network, external_key, contact_id, category_id, note, excluded, reimbursable,
            contact_source, category_source, note_source, excluded_source
     FROM pending_annotations WHERE workspace_id = ?`,
    [workspaceId],
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    application: BRANDING.fullName,
    workspace: { name: workspace.name, reportingCurrency: workspace.reportingCurrency },
    accounts: accounts.map((account) => ({
      publicKey: account.publicKey,
      network: account.network,
      label: account.label,
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      organization: contact.organization,
      notes: contact.notes,
    })),
    contactAddresses: addressRows.map((row) => ({
      contactId: row["contact_id"] as string,
      network: row["network"] as string,
      address: row["address"] as string,
      memo: (row["memo"] as string | null) ?? null,
      label: (row["label"] as string | null) ?? null,
    })),
    categories: categories.map((category) => ({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      kind: category.kind,
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      conditions: JSON.parse(rule.conditionsJson),
      actions: JSON.parse(rule.actionsJson),
    })),
    annotations: [...annotationRows.map(toAnnotation), ...pendingRows.map(toAnnotation)],
  };
}

export function serializeBackup(backup: LedgerBackup): string {
  return JSON.stringify(backup, null, 2);
}

/** Validates a candidate backup, refusing anything it cannot read faithfully. */
export function parseBackup(text: string): LedgerBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError("That file is not valid JSON and could not be read.");
  }

  const shape = json as { format?: unknown; version?: unknown };
  if (typeof shape?.format !== "string" || !READABLE_FORMATS.includes(shape.format)) {
    throw new BackupError("That file is not a Bookee backup.");
  }
  if (typeof shape.version === "number" && shape.version > BACKUP_VERSION) {
    throw new BackupError(
      `That backup was written by a newer version of the application (format ${shape.version}, this build reads ${BACKUP_VERSION}).`,
      "Update Stellar Ledger and try again.",
    );
  }

  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    throw new BackupError(
      "That backup file is incomplete or corrupted, so nothing was imported.",
      parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

export interface ImportResult {
  workspaceId: string;
  contacts: number;
  categories: number;
  rules: number;
  accounts: number;
  annotationsPending: number;
}

/**
 * Restores a backup into a brand-new workspace.
 *
 * Always a new workspace with fresh ids, and every internal reference is
 * remapped through an old-id → new-id table. That means the same file can be
 * imported twice without colliding, and — more importantly — a failed import
 * cannot damage an existing workspace, because it never writes to one.
 *
 * The whole restore is a single transaction.
 */
export async function importBackup(
  repositories: Repositories,
  backup: LedgerBackup,
  options: { name?: string } = {},
): Promise<ImportResult> {
  const now = nowIso();
  const workspaceId = newId();

  const contactIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  for (const contact of backup.contacts) contactIds.set(contact.id, newId());
  for (const category of backup.categories) categoryIds.set(category.id, newId());

  const statements: Statement[] = [
    {
      sql: `INSERT INTO workspaces (id, name, reporting_currency, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      params: [
        workspaceId,
        options.name ?? backup.workspace.name,
        backup.workspace.reportingCurrency,
        now,
        now,
      ],
    },
  ];

  for (const account of backup.accounts) {
    statements.push({
      sql: `INSERT INTO tracked_accounts
              (id, workspace_id, public_key, label, network, last_payment_cursor, last_synced_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      params: [
        newId(),
        workspaceId,
        account.publicKey,
        account.label ?? null,
        account.network,
        now,
        now,
      ],
    });
  }

  for (const contact of backup.contacts) {
    statements.push({
      sql: `INSERT INTO contacts (id, workspace_id, name, organization, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        contactIds.get(contact.id)!,
        workspaceId,
        contact.name,
        contact.organization ?? null,
        contact.notes ?? null,
        now,
        now,
      ],
    });
  }

  for (const address of backup.contactAddresses) {
    const contactId = contactIds.get(address.contactId);
    // An address whose contact is missing from the file is skipped rather than
    // failing the whole restore.
    if (!contactId) continue;
    statements.push({
      sql: `INSERT INTO contact_addresses (id, contact_id, workspace_id, network, address, memo, label, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        newId(),
        contactId,
        workspaceId,
        address.network,
        address.address,
        address.memo ?? null,
        address.label ?? null,
        now,
      ],
    });
  }

  // Parents first, so a child's parent_id always resolves.
  const orderedCategories = [
    ...backup.categories.filter((category) => !category.parentId),
    ...backup.categories.filter((category) => category.parentId),
  ];

  for (const category of orderedCategories) {
    statements.push({
      sql: `INSERT INTO categories (id, workspace_id, parent_id, name, kind, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        categoryIds.get(category.id)!,
        workspaceId,
        category.parentId ? (categoryIds.get(category.parentId) ?? null) : null,
        category.name,
        category.kind,
        now,
        now,
      ],
    });
  }

  for (const rule of backup.rules) {
    statements.push({
      sql: `INSERT INTO rules
              (id, workspace_id, name, enabled, priority, conditions_json, actions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        newId(),
        workspaceId,
        rule.name,
        toDbBool(rule.enabled),
        rule.priority,
        JSON.stringify(remapRuleValues(rule.conditions, contactIds, categoryIds)),
        JSON.stringify(remapRuleValues(rule.actions, contactIds, categoryIds)),
        now,
        now,
      ],
    });
  }

  for (const annotation of backup.annotations) {
    statements.push({
      sql: `INSERT INTO pending_annotations (
              id, workspace_id, network, external_key,
              contact_id, category_id, note, excluded, reimbursable,
              contact_source, category_source, note_source, excluded_source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, network, external_key) DO NOTHING`,
      params: [
        newId(),
        workspaceId,
        annotation.network,
        annotation.externalKey,
        annotation.contactId ? (contactIds.get(annotation.contactId) ?? null) : null,
        annotation.categoryId ? (categoryIds.get(annotation.categoryId) ?? null) : null,
        annotation.note ?? null,
        toDbBool(annotation.excluded),
        toDbBool(annotation.reimbursable),
        annotation.contactSource ?? null,
        annotation.categorySource ?? null,
        annotation.noteSource ?? null,
        annotation.excludedSource ?? null,
        now,
      ],
    });
  }

  await repositories.driver.batch(statements);

  log.info("backup imported", {
    workspaceId,
    contacts: backup.contacts.length,
    categories: backup.categories.length,
    rules: backup.rules.length,
    annotations: backup.annotations.length,
  });

  return {
    workspaceId,
    contacts: backup.contacts.length,
    categories: backup.categories.length,
    rules: backup.rules.length,
    accounts: backup.accounts.length,
    annotationsPending: backup.annotations.length,
  };
}

/**
 * Rewrites contact and category ids inside rule conditions and actions.
 *
 * Rules reference contacts and categories by id, so a restore that renumbered
 * them would leave rules pointing at nothing.
 */
function remapRuleValues(
  raw: unknown,
  contactIds: Map<string, string>,
  categoryIds: Map<string, string>,
): unknown {
  if (!Array.isArray(raw)) return raw;

  return raw.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const entry = item as Record<string, unknown>;
    const value = entry["value"];
    if (typeof value !== "string") return entry;

    if (entry["field"] === "contact" || entry["type"] === "set_contact") {
      return { ...entry, value: contactIds.get(value) ?? value };
    }
    if (entry["type"] === "set_category") {
      return { ...entry, value: categoryIds.get(value) ?? value };
    }
    return entry;
  });
}

/** Suggested filename, e.g. "Tellus Cooperative.stellarledger". */
export function backupFilename(workspaceName: string, extension: string): string {
  const safe = workspaceName.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "ledger";
  return `${safe}.${extension}`;
}

export type { Network };
