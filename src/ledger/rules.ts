/**
 * The rules engine.
 *
 * Deliberately small: a rule is a list of conditions that must all match (AND)
 * and a list of actions to apply. There is no nesting, no OR, no scripting.
 *
 * Two behaviours matter more than expressiveness:
 *
 *  - A manual edit always wins. Rules may only write to a field the user has
 *    not set by hand; that check lives in AnnotationRepository.applyRule.
 *  - Rules run in priority order, lowest number first, and the first rule to
 *    set a given field wins. A later rule cannot overwrite an earlier one in
 *    the same pass, so "priority 1" genuinely means highest priority.
 */
import { z } from "zod";
import { compare } from "../lib/money";
import type { Direction } from "../db/schema";

export const CONDITION_FIELDS = [
  "counterparty_address",
  "contact",
  "direction",
  "asset",
  "memo",
  "amount",
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = ["equals", "contains", "greater_than", "less_than"] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/**
 * Which operators make sense for which field.
 *
 * The editor uses this to offer only valid combinations, and validation uses it
 * to reject a stored rule that could never match anything.
 */
export const OPERATORS_BY_FIELD: Record<ConditionField, readonly ConditionOperator[]> = {
  counterparty_address: ["equals"],
  contact: ["equals"],
  direction: ["equals"],
  asset: ["equals"],
  memo: ["equals", "contains"],
  amount: ["greater_than", "less_than"],
};

export const ACTION_TYPES = ["set_contact", "set_category", "set_note", "set_excluded"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const conditionSchema = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.string(),
  })
  .refine((condition) => OPERATORS_BY_FIELD[condition.field].includes(condition.operator), {
    message: "That operator cannot be used with that field",
  });

export const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  value: z.string(),
});

export const conditionsSchema = z.array(conditionSchema);
export const actionsSchema = z.array(actionSchema);

export type RuleCondition = z.infer<typeof conditionSchema>;
export type RuleAction = z.infer<typeof actionSchema>;

/** The fields of an entry a rule can inspect. */
export interface RuleTarget {
  id: string;
  counterpartyAddress: string | null;
  contactId: string | null;
  direction: Direction;
  assetId: string;
  memoValue: string | null;
  amount: string;
}

export interface ParsedRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** Parses the JSON columns, returning null for a rule that cannot be read. */
export function parseRule(rule: {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditionsJson: string;
  actionsJson: string;
}): ParsedRule | null {
  try {
    const conditions = conditionsSchema.safeParse(JSON.parse(rule.conditionsJson));
    const actions = actionsSchema.safeParse(JSON.parse(rule.actionsJson));
    if (!conditions.success || !actions.success) return null;
    return {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      conditions: conditions.data,
      actions: actions.data,
    };
  } catch {
    return null;
  }
}

function fieldValue(target: RuleTarget, field: ConditionField): string | null {
  switch (field) {
    case "counterparty_address":
      return target.counterpartyAddress;
    case "contact":
      return target.contactId;
    case "direction":
      return target.direction;
    case "asset":
      return target.assetId;
    case "memo":
      return target.memoValue;
    case "amount":
      return target.amount;
  }
}

export function matchesCondition(target: RuleTarget, condition: RuleCondition): boolean {
  const actual = fieldValue(target, condition.field);
  if (actual === null) return false;

  switch (condition.operator) {
    case "equals":
      // Addresses and ids are case-sensitive; memo text is not.
      return condition.field === "memo"
        ? actual.toLowerCase() === condition.value.toLowerCase()
        : actual === condition.value;
    case "contains":
      return actual.toLowerCase().includes(condition.value.toLowerCase());
    // Amounts are decimal strings, so they are compared exactly rather than
    // through Number(), which would misjudge large or tiny values.
    case "greater_than":
      return compare(actual, condition.value) > 0;
    case "less_than":
      return compare(actual, condition.value) < 0;
  }
}

/** A rule matches when every one of its conditions matches. */
export function matchesRule(target: RuleTarget, rule: ParsedRule): boolean {
  // A rule with no conditions would match everything; treat it as inert.
  if (rule.conditions.length === 0) return false;
  return rule.conditions.every((condition) => matchesCondition(target, condition));
}

export interface RuleOutcome {
  contactId?: string;
  categoryId?: string;
  note?: string;
  excluded?: boolean;
  /** The rule that set the first field, recorded for traceability. */
  ruleId?: string;
}

/**
 * Evaluates every enabled rule against one entry.
 *
 * Rules are applied in priority order and the first rule to set a field wins,
 * so adding a lower-priority rule can never silently change what a
 * higher-priority one already decided.
 */
export function evaluateRules(target: RuleTarget, rules: readonly ParsedRule[]): RuleOutcome {
  const outcome: RuleOutcome = {};

  const ordered = rules
    .filter((rule) => rule.enabled)
    .toSorted((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  for (const rule of ordered) {
    if (!matchesRule(target, rule)) continue;

    for (const action of rule.actions) {
      switch (action.type) {
        case "set_contact":
          if (outcome.contactId === undefined) {
            outcome.contactId = action.value;
            outcome.ruleId ??= rule.id;
          }
          break;
        case "set_category":
          if (outcome.categoryId === undefined) {
            outcome.categoryId = action.value;
            outcome.ruleId ??= rule.id;
          }
          break;
        case "set_note":
          if (outcome.note === undefined) {
            outcome.note = action.value;
            outcome.ruleId ??= rule.id;
          }
          break;
        case "set_excluded":
          if (outcome.excluded === undefined) {
            outcome.excluded = action.value === "true" || action.value === "1";
            outcome.ruleId ??= rule.id;
          }
          break;
      }
    }
  }

  return outcome;
}

/** Entries a rule would match, used by the editor's "preview matches". */
export function countMatches(targets: readonly RuleTarget[], rule: ParsedRule): number {
  return targets.filter((target) => matchesRule(target, rule)).length;
}

/** Human description of a condition, for the rules list. */
export function describeCondition(
  condition: RuleCondition,
  labels: { contacts?: Record<string, string>; assets?: Record<string, string> } = {},
): string {
  const operator = condition.operator.replace(/_/g, " ");
  let value = condition.value;

  if (condition.field === "contact") value = labels.contacts?.[value] ?? value;
  if (condition.field === "asset") value = labels.assets?.[value] ?? value;
  if (condition.field === "counterparty_address" && value.length > 12) {
    value = `${value.slice(0, 4)}…${value.slice(-4)}`;
  }

  return `${condition.field.replace(/_/g, " ")} ${operator} ${value}`;
}
