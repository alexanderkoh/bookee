import type { SqlDriver } from "../driver";
import type { SqlRow } from "../row";
import type { Rule } from "../schema";
import { mapRule } from "./mappers";
import { newId, nowIso } from "../../lib/ids";
import { toDbBool } from "../schema";
import {
  parseRule,
  type ParsedRule,
  type RuleAction,
  type RuleCondition,
} from "../../ledger/rules";

export class RuleRepository {
  constructor(private readonly driver: SqlDriver) {}

  async list(workspaceId: string): Promise<Rule[]> {
    const rows = await this.driver.select<SqlRow>(
      "SELECT * FROM rules WHERE workspace_id = ? ORDER BY priority ASC, name COLLATE NOCASE ASC",
      [workspaceId],
    );
    return rows.map(mapRule);
  }

  /**
   * Rules ready to evaluate.
   *
   * A rule whose stored JSON cannot be parsed is skipped rather than crashing
   * the sync; it still appears in the rules list so the user can fix it.
   */
  async listParsed(workspaceId: string): Promise<ParsedRule[]> {
    const rules = await this.list(workspaceId);
    return rules.map(parseRule).filter((rule): rule is ParsedRule => rule !== null);
  }

  async findById(id: string): Promise<Rule | undefined> {
    const rows = await this.driver.select<SqlRow>("SELECT * FROM rules WHERE id = ?", [id]);
    return rows[0] ? mapRule(rows[0]) : undefined;
  }

  async create(input: {
    workspaceId: string;
    name: string;
    conditions: RuleCondition[];
    actions: RuleAction[];
    priority?: number;
    enabled?: boolean;
  }): Promise<Rule> {
    const now = nowIso();
    const rule: Rule = {
      id: newId(),
      workspaceId: input.workspaceId,
      name: input.name,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
      conditionsJson: JSON.stringify(input.conditions),
      actionsJson: JSON.stringify(input.actions),
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.execute(
      `INSERT INTO rules
         (id, workspace_id, name, enabled, priority, conditions_json, actions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.id,
        rule.workspaceId,
        rule.name,
        toDbBool(rule.enabled),
        rule.priority,
        rule.conditionsJson,
        rule.actionsJson,
        now,
        now,
      ],
    );
    return rule;
  }

  async update(
    id: string,
    changes: {
      name?: string;
      enabled?: boolean;
      priority?: number;
      conditions?: RuleCondition[];
      actions?: RuleAction[];
    },
  ): Promise<void> {
    const fields: string[] = [];
    const params: (string | number)[] = [];

    if (changes.name !== undefined) {
      fields.push("name = ?");
      params.push(changes.name);
    }
    if (changes.enabled !== undefined) {
      fields.push("enabled = ?");
      params.push(toDbBool(changes.enabled));
    }
    if (changes.priority !== undefined) {
      fields.push("priority = ?");
      params.push(changes.priority);
    }
    if (changes.conditions !== undefined) {
      fields.push("conditions_json = ?");
      params.push(JSON.stringify(changes.conditions));
    }
    if (changes.actions !== undefined) {
      fields.push("actions_json = ?");
      params.push(JSON.stringify(changes.actions));
    }
    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    params.push(nowIso(), id);
    await this.driver.execute(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`, params);
  }

  async remove(id: string): Promise<void> {
    await this.driver.execute("DELETE FROM rules WHERE id = ?", [id]);
  }
}
