/**
 * Running the rules engine against stored entries.
 *
 * Kept separate from rules.ts so the matching logic stays pure and directly
 * testable, while this module owns the database side.
 */
import type { Repositories } from "../db/repositories";
import { evaluateRules, matchesRule, type ParsedRule } from "./rules";
import { createLogger } from "../lib/log";

const log = createLogger("rules");

export interface ApplyRulesResult {
  evaluated: number;
  changed: number;
}

/**
 * Applies every enabled rule to every entry in the workspace.
 *
 * Safe to run repeatedly: AnnotationRepository.applyRule refuses to touch a
 * field the user set by hand, and writing the same rule result twice is a
 * no-op. This runs after each sync so imported entries are classified, and on
 * demand when a rule is created or edited.
 */
export async function applyRules(
  repositories: Repositories,
  workspaceId: string,
  options: { rules?: ParsedRule[] } = {},
): Promise<ApplyRulesResult> {
  const rules = options.rules ?? (await repositories.rules.listParsed(workspaceId));
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length === 0) return { evaluated: 0, changed: 0 };

  const targets = await repositories.entries.projectForRules(workspaceId);
  let changed = 0;

  for (const target of targets) {
    const outcome = evaluateRules(target, enabled);
    if (outcome.ruleId === undefined) continue;

    const applied = await repositories.annotations.applyRule(
      target.id,
      {
        ...(outcome.contactId !== undefined ? { contactId: outcome.contactId } : {}),
        ...(outcome.categoryId !== undefined ? { categoryId: outcome.categoryId } : {}),
        ...(outcome.note !== undefined ? { note: outcome.note } : {}),
        ...(outcome.excluded !== undefined ? { excluded: outcome.excluded } : {}),
      },
      outcome.ruleId,
    );
    if (applied) changed += 1;
  }

  log.info("rules applied", { rules: enabled.length, evaluated: targets.length, changed });
  return { evaluated: targets.length, changed };
}

/**
 * How many existing entries a rule would match.
 *
 * Used by the editor before saving, so "this rule matches 14 transactions" is a
 * real count rather than a guess.
 */
export async function previewMatches(
  repositories: Repositories,
  workspaceId: string,
  rule: ParsedRule,
): Promise<number> {
  const targets = await repositories.entries.projectForRules(workspaceId);
  return targets.filter((target) => matchesRule(target, rule)).length;
}

/**
 * Clears rule-applied values and re-evaluates from scratch.
 *
 * Needed after deleting or disabling a rule, whose effects would otherwise
 * linger. Manual edits survive because clearRuleApplied only resets fields
 * whose source is "rule".
 */
export async function reapplyRules(
  repositories: Repositories,
  workspaceId: string,
): Promise<ApplyRulesResult> {
  await repositories.annotations.clearRuleApplied(workspaceId);
  return applyRules(repositories, workspaceId);
}
