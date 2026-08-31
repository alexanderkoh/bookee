/**
 * Rules.
 *
 * The editor uses structured controls rather than raw JSON, and only offers
 * operators that make sense for the chosen field. Before saving it reports how
 * many existing transactions the rule would match, so a rule is never a guess.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Drawer, EmptyState, useToast } from "../../components";
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  OPERATORS_BY_FIELD,
  describeCondition,
  type ActionType,
  type ConditionField,
  type ParsedRule,
  type RuleAction,
  type RuleCondition,
} from "../../ledger/rules";
import { previewMatches, reapplyRules } from "../../ledger/apply-rules";
import type { Rule } from "../../db/schema";

const FIELD_LABELS: Record<ConditionField, string> = {
  counterparty_address: "Counterparty address",
  contact: "Contact",
  direction: "Direction",
  asset: "Asset",
  memo: "Memo",
  amount: "Amount",
};

const ACTION_LABELS: Record<ActionType, string> = {
  set_contact: "Set contact",
  set_category: "Set category",
  set_note: "Set note",
  set_excluded: "Exclude from reports",
};

export function RulesScreen() {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);

  const rules = useQuery({
    queryKey: ["rules", workspace.id],
    queryFn: () => repositories.rules.list(workspace.id),
  });

  const contacts = useQuery({
    queryKey: ["contacts", workspace.id],
    queryFn: () => repositories.contacts.listWithCounts(workspace.id),
  });

  const categories = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });

  const contactLabels = Object.fromEntries(
    (contacts.data ?? []).map((contact) => [contact.id, contact.name]),
  );
  const categoryLabels = Object.fromEntries(
    (categories.data ?? []).map((category) => [category.id, category.name]),
  );

  async function refresh() {
    await queryClient.invalidateQueries();
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rules</h1>
          <p className="page-subtitle">
            Rules run in priority order, lowest number first, and never overwrite a category or
            contact you set by hand.
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setEditing("new")}>
          <Plus size={13} aria-hidden="true" />
          New rule
        </button>
      </div>

      {(rules.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={20} />}
          title="No rules yet"
          description="A rule classifies matching transactions automatically — the ones you already have, and the ones you import later."
          action={
            <button
              type="button"
              className="button button--primary"
              onClick={() => setEditing("new")}
            >
              <Plus size={13} aria-hidden="true" />
              New rule
            </button>
          }
        />
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table className="table table--rows">
              <caption className="visually-hidden">Classification rules</caption>
              <thead>
                <tr>
                  <th scope="col" className="numeric">
                    #
                  </th>
                  <th scope="col">Rule</th>
                  <th scope="col">When</th>
                  <th scope="col">Then</th>
                  <th scope="col">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {rules.data?.map((rule) => {
                  const conditions = safeParse<RuleCondition[]>(rule.conditionsJson) ?? [];
                  const actions = safeParse<RuleAction[]>(rule.actionsJson) ?? [];
                  return (
                    <tr
                      key={rule.id}
                      tabIndex={0}
                      onClick={() => setEditing(rule)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setEditing(rule);
                      }}
                    >
                      <td className="numeric">{rule.priority}</td>
                      <td>{rule.name}</td>
                      <td className="text-xs muted">
                        {conditions
                          .map((condition) =>
                            describeCondition(condition, { contacts: contactLabels }),
                          )
                          .join(" and ") || "—"}
                      </td>
                      <td className="text-xs">
                        {actions
                          .map((action) => describeAction(action, contactLabels, categoryLabels))
                          .join(", ") || "—"}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          aria-label={`Enable ${rule.name}`}
                          onClick={(event) => event.stopPropagation()}
                          onChange={async (event) => {
                            const enabled = event.target.checked;
                            await repositories.rules.update(rule.id, { enabled });
                            // Disabling a rule must also undo what it applied.
                            const result = await reapplyRules(repositories, workspace.id);
                            await refresh();
                            toast.success(
                              enabled ? `${rule.name} enabled` : `${rule.name} disabled`,
                              `${result.changed} transaction${result.changed === 1 ? "" : "s"} reclassified.`,
                            );
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing ? (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            await refresh();
            if (message) toast.success(message);
          }}
        />
      ) : null}
    </div>
  );
}

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function describeAction(
  action: RuleAction,
  contacts: Record<string, string>,
  categories: Record<string, string>,
): string {
  switch (action.type) {
    case "set_contact":
      return `contact = ${contacts[action.value] ?? action.value}`;
    case "set_category":
      return `category = ${categories[action.value] ?? action.value}`;
    case "set_note":
      return `note = "${action.value}"`;
    case "set_excluded":
      return action.value === "true" ? "excluded" : "not excluded";
  }
}

function RuleEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  onClose: () => void;
  onSaved: (message?: string) => void | Promise<void>;
}) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();

  const [name, setName] = useState(rule?.name ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [conditions, setConditions] = useState<RuleCondition[]>(
    () =>
      (rule ? safeParse<RuleCondition[]>(rule.conditionsJson) : null) ?? [
        { field: "counterparty_address", operator: "equals", value: "" },
      ],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    () =>
      (rule ? safeParse<RuleAction[]>(rule.actionsJson) : null) ?? [
        { type: "set_category", value: "" },
      ],
  );
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const contacts = useQuery({
    queryKey: ["contacts", workspace.id],
    queryFn: () => repositories.contacts.listWithCounts(workspace.id),
  });
  const categories = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });
  const assets = useQuery({
    queryKey: ["assets", workspace.id],
    queryFn: () =>
      repositories.driver.select<{ id: string; display_code: string }>(
        `SELECT DISTINCT a.id, a.display_code FROM assets a
         JOIN ledger_entries e ON e.asset_id = a.id
         WHERE e.workspace_id = ? ORDER BY a.display_code`,
        [workspace.id],
      ),
  });

  const draft: ParsedRule = {
    id: rule?.id ?? "draft",
    name,
    enabled,
    priority,
    conditions: conditions.filter((condition) => condition.value !== ""),
    actions: actions.filter((action) => action.value !== ""),
  };

  async function preview() {
    setMatchCount(await previewMatches(repositories, workspace.id, draft));
  }

  async function save() {
    setError(null);
    if (name.trim() === "") {
      setError("Give the rule a name.");
      return;
    }
    if (draft.conditions.length === 0) {
      setError("Add at least one condition, otherwise the rule would match nothing.");
      return;
    }
    if (draft.actions.length === 0) {
      setError("Add at least one action.");
      return;
    }

    setSaving(true);
    try {
      if (rule) {
        await repositories.rules.update(rule.id, {
          name: name.trim(),
          priority,
          enabled,
          conditions: draft.conditions,
          actions: draft.actions,
        });
      } else {
        await repositories.rules.create({
          workspaceId: workspace.id,
          name: name.trim(),
          priority,
          enabled,
          conditions: draft.conditions,
          actions: draft.actions,
        });
      }

      // Editing a rule can invalidate what a previous version applied, so a
      // full re-evaluation is the only way to keep results consistent.
      const result = applyToExisting ? await reapplyRules(repositories, workspace.id) : null;
      await onSaved(
        result
          ? `${rule ? "Rule updated" : "Rule created"} — ${result.changed} transaction${result.changed === 1 ? "" : "s"} classified`
          : rule
            ? "Rule updated"
            : "Rule created",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the rule.");
    } finally {
      setSaving(false);
    }
  }

  const valueControl = (condition: RuleCondition, index: number) => {
    const update = (value: string) =>
      setConditions((current) =>
        current.map((item, position) => (position === index ? { ...item, value } : item)),
      );

    if (condition.field === "direction") {
      return (
        <select className="select" value={condition.value} onChange={(e) => update(e.target.value)}>
          <option value="">Choose…</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
          <option value="internal">Transfer</option>
        </select>
      );
    }
    if (condition.field === "contact") {
      return (
        <select className="select" value={condition.value} onChange={(e) => update(e.target.value)}>
          <option value="">Choose…</option>
          {contacts.data?.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      );
    }
    if (condition.field === "asset") {
      return (
        <select className="select" value={condition.value} onChange={(e) => update(e.target.value)}>
          <option value="">Choose…</option>
          {assets.data?.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.display_code}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className={condition.field === "counterparty_address" ? "input mono" : "input"}
        value={condition.value}
        onChange={(e) => update(e.target.value)}
        placeholder={condition.field === "amount" ? "0.00" : ""}
        inputMode={condition.field === "amount" ? "decimal" : undefined}
      />
    );
  };

  return (
    <Drawer title={rule ? "Edit rule" : "New rule"} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label className="field__label" htmlFor="rule-name">
            Name
          </label>
          <input
            id="rule-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Leñería → Rent"
            autoFocus
          />
        </div>

        <section>
          <h3 className="section-heading">When</h3>
          <div className="stack stack--sm mt-2">
            {conditions.map((condition, index) => (
              <div key={index} className="row row--wrap">
                <select
                  className="select"
                  value={condition.field}
                  aria-label="Field"
                  onChange={(event) => {
                    const field = event.target.value as ConditionField;
                    setConditions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { field, operator: OPERATORS_BY_FIELD[field][0]!, value: "" }
                          : item,
                      ),
                    );
                  }}
                >
                  {CONDITION_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {FIELD_LABELS[field]}
                    </option>
                  ))}
                </select>

                <select
                  className="select"
                  value={condition.operator}
                  aria-label="Operator"
                  onChange={(event) =>
                    setConditions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, operator: event.target.value as RuleCondition["operator"] }
                          : item,
                      ),
                    )
                  }
                >
                  {/* Only operators that are valid for the chosen field. */}
                  {OPERATORS_BY_FIELD[condition.field].map((operator) => (
                    <option key={operator} value={operator}>
                      {operator.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>

                {valueControl(condition, index)}

                <button
                  type="button"
                  className="button button--subtle"
                  aria-label="Remove condition"
                  onClick={() =>
                    setConditions((current) => current.filter((_, position) => position !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button"
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  { field: "direction", operator: "equals", value: "" },
                ])
              }
            >
              Add condition
            </button>
          </div>
        </section>

        <section>
          <h3 className="section-heading">Then</h3>
          <div className="stack stack--sm mt-2">
            {actions.map((action, index) => (
              <div key={index} className="row row--wrap">
                <select
                  className="select"
                  value={action.type}
                  aria-label="Action"
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { type: event.target.value as ActionType, value: "" }
                          : item,
                      ),
                    )
                  }
                >
                  {ACTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ACTION_LABELS[type]}
                    </option>
                  ))}
                </select>

                {action.type === "set_category" ? (
                  <select
                    className="select"
                    value={action.value}
                    aria-label="Category"
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    {categories.data?.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                ) : action.type === "set_contact" ? (
                  <select
                    className="select"
                    value={action.value}
                    aria-label="Contact"
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    {contacts.data?.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                      </option>
                    ))}
                  </select>
                ) : action.type === "set_excluded" ? (
                  <select
                    className="select"
                    value={action.value}
                    aria-label="Excluded"
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    aria-label="Note"
                    value={action.value}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                )}

                <button
                  type="button"
                  className="button button--subtle"
                  aria-label="Remove action"
                  onClick={() =>
                    setActions((current) => current.filter((_, position) => position !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button"
              onClick={() =>
                setActions((current) => [...current, { type: "set_category", value: "" }])
              }
            >
              Add action
            </button>
          </div>
        </section>

        <section className="row row--wrap">
          <div className="field field--narrow">
            <label className="field__label" htmlFor="rule-priority">
              Priority
            </label>
            <input
              id="rule-priority"
              className="input"
              type="number"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            />
          </div>
          <label className="checkbox self-end">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </section>

        <section className="stack stack--sm">
          <div className="row">
            <button type="button" className="button" onClick={() => void preview()}>
              Preview matches
            </button>
            {matchCount !== null ? (
              <span role="status" aria-live="polite">
                This rule matches <strong>{matchCount}</strong> existing transaction
                {matchCount === 1 ? "" : "s"}.
              </span>
            ) : null}
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={applyToExisting}
              onChange={(event) => setApplyToExisting(event.target.checked)}
            />
            Apply to existing matching transactions
          </label>
        </section>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save rule"}
          </button>
          {rule ? (
            <button
              type="button"
              className="button button--danger"
              onClick={async () => {
                await repositories.rules.remove(rule.id);
                await reapplyRules(repositories, workspace.id);
                await onSaved("Rule deleted");
              }}
            >
              Delete
            </button>
          ) : null}
          <button type="button" className="button button--subtle" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}
