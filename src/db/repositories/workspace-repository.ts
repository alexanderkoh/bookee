import type { SqlDriver, Statement } from "../driver";
import type { SqlRow } from "../row";
import type { Category, CategoryKind, Workspace } from "../schema";
import { mapWorkspace } from "./mappers";
import { newId, nowIso } from "../../lib/ids";

/**
 * Default chart of accounts seeded into every new workspace.
 * Users can rename, add to, or delete these.
 */
const DEFAULT_CATEGORIES: ReadonlyArray<{
  name: string;
  emoji: string;
  kind: CategoryKind;
  children?: ReadonlyArray<{ name: string; emoji: string }>;
}> = [
  {
    name: "Income",
    emoji: "📥",
    kind: "income",
    children: [
      { name: "Sales", emoji: "💰" },
      { name: "Grants", emoji: "🎁" },
      { name: "Contributions", emoji: "🤝" },
      { name: "Other", emoji: "📁" },
    ],
  },
  {
    name: "Expenses",
    emoji: "📤",
    kind: "expense",
    children: [
      { name: "Contractors", emoji: "👷" },
      { name: "Rent", emoji: "🏠" },
      { name: "Events", emoji: "🎉" },
      { name: "Travel", emoji: "✈️" },
      { name: "Software", emoji: "💻" },
      { name: "Marketing", emoji: "📣" },
      { name: "Other", emoji: "📁" },
    ],
  },
  { name: "Transfer", emoji: "🔄", kind: "transfer" },
  {
    name: "Other",
    emoji: "📁",
    kind: "other",
    children: [{ name: "Uncategorized", emoji: "❓" }],
  },
];

export class WorkspaceRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<Workspace[]> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM workspaces ORDER BY created_at ASC",
    );
    return rows.map(mapWorkspace);
  }

  async findById(id: string): Promise<Workspace | undefined> {
    const rows = await this.driver.select<SqlRow>("SELECT * FROM workspaces WHERE id = ?", [id]);
    return rows[0] ? mapWorkspace(rows[0]) : undefined;
  }

  /**
   * Creates a workspace and its default categories in one transaction, so a
   * workspace can never exist without a usable chart of accounts.
   */
  async create(input: { name: string; reportingCurrency?: string }): Promise<Workspace> {
    const now = nowIso();
    const workspace: Workspace = {
      id: newId(),
      name: input.name,
      reportingCurrency: input.reportingCurrency ?? "USD",
      createdAt: now,
      updatedAt: now,
    };

    const statements: Statement[] = [
      {
        sql: `INSERT INTO workspaces (id, name, reporting_currency, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [
          workspace.id,
          workspace.name,
          workspace.reportingCurrency,
          workspace.createdAt,
          workspace.updatedAt,
        ],
      },
      ...buildDefaultCategoryStatements(workspace.id, now),
    ];

    await this.driver.batch(statements);
    return workspace;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.driver.execute("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?", [
      name,
      nowIso(),
      id,
    ]);
  }

  /** Deletes a workspace and everything belonging to it, via ON DELETE CASCADE. */
  async remove(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM workspaces WHERE id = ?", [id]);
  }
}

export function buildDefaultCategoryStatements(workspaceId: string, now: string): Statement[] {
  const statements: Statement[] = [];

  const insert = (category: Omit<Category, "createdAt" | "updatedAt">) => {
    statements.push({
      sql: `INSERT INTO categories (id, workspace_id, parent_id, name, emoji, kind, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        category.id,
        category.workspaceId,
        category.parentId,
        category.name,
        category.emoji,
        category.kind,
        now,
        now,
      ],
    });
  };

  for (const parent of DEFAULT_CATEGORIES) {
    const parentId = newId();
    insert({
      id: parentId,
      workspaceId,
      parentId: null,
      name: parent.name,
      emoji: parent.emoji,
      kind: parent.kind,
    });

    for (const child of parent.children ?? []) {
      insert({
        id: newId(),
        workspaceId,
        parentId,
        name: child.name,
        emoji: child.emoji,
        kind: parent.kind,
      });
    }
  }

  return statements;
}
