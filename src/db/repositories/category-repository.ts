import type { SqlDriver } from "../driver";
import type { SqlRow } from "../row";
import type { Category, CategoryKind } from "../schema";
import { mapCategory } from "./mappers";
import { newId, nowIso } from "../../lib/ids";

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export class CategoryRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(workspaceId: string): Promise<Category[]> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM categories WHERE workspace_id = ? ORDER BY name COLLATE NOCASE ASC",
      [workspaceId],
    );
    return rows.map(mapCategory);
  }

  /** Categories as a two-level tree, the shape the pickers and filters use. */
  async tree(workspaceId: string): Promise<CategoryNode[]> {
    const all = await this.list(workspaceId);
    const nodes = new Map<string, CategoryNode>(
      all.map((category) => [category.id, { ...category, children: [] }]),
    );
    const roots: CategoryNode[] = [];

    for (const node of nodes.values()) {
      if (node.parentId) {
        nodes.get(node.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async create(input: {
    workspaceId: string;
    name: string;
    kind: CategoryKind;
    emoji?: string | null;
    parentId?: string | null;
  }): Promise<Category> {
    const now = nowIso();
    const category: Category = {
      id: newId(),
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      name: input.name,
      emoji: input.emoji ?? null,
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.execute(
      `INSERT INTO categories (id, workspace_id, parent_id, name, emoji, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category.id,
        category.workspaceId,
        category.parentId,
        category.name,
        category.emoji,
        category.kind,
        now,
        now,
      ],
    );
    return category;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.driver.execute("UPDATE categories SET name = ?, updated_at = ? WHERE id = ?", [
      name,
      nowIso(),
      id,
    ]);
  }

  async setEmoji(id: string, emoji: string | null): Promise<void> {
    await this.driver.execute("UPDATE categories SET emoji = ?, updated_at = ? WHERE id = ?", [
      emoji,
      nowIso(),
      id,
    ]);
  }

  /**
   * Deleting a category never deletes transactions.
   *
   * The schema's ON DELETE SET NULL clears the reference from annotations, so
   * affected entries simply become uncategorized again.
   */
  async remove(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM categories WHERE id = ?", [id]);
  }

  async usageCount(id: string): Promise<number> {
    const rows = await this.driver.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM entry_annotations WHERE category_id = ?",
      [id],
    );
    return rows[0]?.count ?? 0;
  }
}
