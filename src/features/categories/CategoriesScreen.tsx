/**
 * Categories and the monthly summary.
 *
 * Totals are always per asset. "Rent 1,042 USDC" is a fact; "Rent 1,242" across
 * USDC and XLM would be an invention, because this application has no price
 * feed and refuses to pretend otherwise.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { Plus, Tags } from "lucide-react";
import { AssetLabel, CategoryChip, EmojiPicker, EmptyState, useAssetIcons } from "../../components";
import { formatDisplay } from "../../lib/money";
import { categorySummary, monthRange } from "../../ledger/reporting";
import type { CategoryKind } from "../../db/schema";

const KINDS: CategoryKind[] = ["income", "expense", "transfer", "other"];

/** The last twelve months, newest first, plus an all-time option. */
function periodOptions(): Array<{ value: string; label: string }> {
  const options = [{ value: "all", label: "All time" }];
  const now = new Date();
  for (let index = 0; index < 12; index++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    options.push({
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    });
  }
  return options;
}

export function CategoriesScreen() {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();

  const icons = useAssetIcons();
  const [period, setPeriod] = useState("all");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<CategoryKind>("expense");
  const [newParentId, setNewParentId] = useState("");
  const [newEmoji, setNewEmoji] = useState<string | null>("📁");

  const options = useMemo(periodOptions, []);

  const range = useMemo(() => {
    if (period === "all") return {};
    const [year, month] = period.split("-").map(Number);
    return monthRange(new Date(Date.UTC(year!, month! - 1, 15)));
  }, [period]);

  const tree = useQuery({
    queryKey: ["category-tree", workspace.id],
    queryFn: () => repositories.categories.tree(workspace.id),
  });

  const flat = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });

  const summary = useQuery({
    queryKey: ["category-summary", workspace.id, period],
    queryFn: () => categorySummary(repositories, workspace.id, range),
  });

  async function refresh() {
    await queryClient.invalidateQueries();
  }

  const byKind = (kind: CategoryKind) =>
    (summary.data ?? []).filter((row) => row.kind === kind && row.totals.length > 0);

  const uncategorized = (summary.data ?? []).find((row) => row.categoryId === null);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">Totals are always per asset, never combined.</p>
        </div>
        <div className="field">
          <label className="visually-hidden" htmlFor="summary-period">
            Period
          </label>
          <select
            id="summary-period"
            className="select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {KINDS.filter((kind) => byKind(kind).length > 0).map((kind) => (
        <section className="panel" key={kind}>
          <div className="panel__header">
            <h2 className="panel__title capitalize">{kind}</h2>
          </div>
          <table className="table">
            <caption className="visually-hidden">{kind} totals per category and asset</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Asset</th>
                <th scope="col" className="numeric">
                  Total
                </th>
                <th scope="col" className="numeric">
                  Transactions
                </th>
              </tr>
            </thead>
            <tbody>
              {byKind(kind).flatMap((row) =>
                row.totals.map((total, index) => (
                  <tr key={`${row.categoryId}-${total.assetId}`}>
                    {/* The category name is written once per group, not repeated per asset. */}
                    <td>
                      {index === 0 ? (
                        <CategoryChip
                          name={
                            row.parentName
                              ? `${row.parentName} / ${row.categoryName}`
                              : row.categoryName
                          }
                          emoji={row.categoryEmoji}
                        />
                      ) : null}
                    </td>
                    <td>
                      <AssetLabel
                        assetId={total.assetId}
                        code={total.assetCode}
                        iconDataUri={icons.get(total.assetId)}
                        size={16}
                      />
                    </td>
                    <td className="numeric">{formatDisplay(total.amount)}</td>
                    <td className="numeric">{total.count}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      ))}

      {uncategorized ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Uncategorized</h2>
            <span className="tag tag--warning">needs attention</span>
          </div>
          <table className="table">
            <tbody>
              {uncategorized.totals.map((total) => (
                <tr key={total.assetId}>
                  <td>{total.assetCode}</td>
                  <td className="numeric">{formatDisplay(total.amount)}</td>
                  <td className="numeric">{total.count} transactions</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {summary.data?.length === 0 ? (
        <EmptyState
          icon={<Tags size={20} />}
          title="Nothing to summarise yet"
          description="Categorize a few transactions and their totals appear here, split by asset."
        />
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Your categories</h2>
        </div>
        <div className="panel__body stack stack--md">
          <ul className="tree">
            {tree.data?.map((parent) => (
              <li key={parent.id}>
                <CategoryRow
                  id={parent.id}
                  name={parent.name}
                  emoji={parent.emoji}
                  kind={parent.kind}
                  onDone={refresh}
                />
                {parent.children.length > 0 ? (
                  <ul className="tree--nested">
                    {parent.children.map((child) => (
                      <li key={child.id}>
                        <CategoryRow
                          id={child.id}
                          name={child.name}
                          emoji={child.emoji}
                          kind={child.kind}
                          onDone={refresh}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          <form
            className="row row--wrap"
            onSubmit={async (event) => {
              event.preventDefault();
              if (newName.trim() === "") return;
              await repositories.categories.create({
                workspaceId: workspace.id,
                name: newName.trim(),
                kind: newKind,
                emoji: newEmoji,
                parentId: newParentId || null,
              });
              setNewName("");
              await refresh();
            }}
          >
            <div className="field">
              <span className="field__label">Icon</span>
              <EmojiPicker value={newEmoji} onChange={setNewEmoji} variant="field" />
            </div>
            <div className="field field--medium">
              <label className="field__label" htmlFor="new-category">
                New category
              </label>
              <input
                id="new-category"
                className="input"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-kind">
                Kind
              </label>
              <select
                id="new-kind"
                className="select"
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as CategoryKind)}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-parent">
                Parent
              </label>
              <select
                id="new-parent"
                className="select"
                value={newParentId}
                onChange={(event) => setNewParentId(event.target.value)}
              >
                <option value="">None</option>
                {flat.data
                  ?.filter((category) => !category.parentId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </div>
            <button type="submit" className="button button--primary self-end">
              <Plus size={13} aria-hidden="true" />
              Add
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function CategoryRow({
  id,
  name,
  emoji,
  kind,
  onDone,
}: {
  id: string;
  name: string;
  emoji: string | null;
  kind: CategoryKind;
  onDone: () => Promise<void>;
}) {
  const repositories = useRepositories();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);

  if (editing) {
    return (
      <div className="tree__row">
        <input
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={`Rename ${name}`}
          autoFocus
        />
        <button
          type="button"
          className="button"
          onClick={async () => {
            await repositories.categories.rename(id, draft.trim() || name);
            setEditing(false);
            await onDone();
          }}
        >
          Save
        </button>
        <button type="button" className="button button--subtle" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="tree__row">
      <span className="row row--sm">
        <EmojiPicker
          value={emoji}
          label={`Icon for ${name}`}
          onChange={async (next) => {
            await repositories.categories.setEmoji(id, next);
            await onDone();
          }}
        />
        {name} <span className="tag">{kind}</span>
      </span>
      <span className="row">
        <button type="button" className="button button--subtle" onClick={() => setEditing(true)}>
          Rename
        </button>
        {confirmingDelete ? (
          <>
            <span className="text-xs muted">
              {usage === null
                ? "Checking…"
                : usage === 0
                  ? "Not in use."
                  : `Used by ${usage} transaction${usage === 1 ? "" : "s"}, which stay but become uncategorized.`}
            </span>
            <button
              type="button"
              className="button button--danger"
              onClick={async () => {
                await repositories.categories.remove(id);
                setConfirmingDelete(false);
                await onDone();
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="button button--subtle"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--subtle"
            onClick={async () => {
              setConfirmingDelete(true);
              setUsage(await repositories.categories.usageCount(id));
            }}
          >
            Delete
          </button>
        )}
      </span>
    </div>
  );
}
