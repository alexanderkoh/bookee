import { useQuery } from "@tanstack/react-query";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import type { CategorizationStatus, LedgerFilters } from "../../ledger/types";
import type { Direction } from "../../db/schema";

/**
 * Filter bar.
 *
 * Every filter is pushed into SQL rather than applied to a loaded array, so the
 * table stays responsive on a large ledger and the counts stay honest.
 */
export function TransactionFilters({
  filters,
  onChange,
  onReset,
  resultCount,
}: {
  filters: LedgerFilters;
  onChange: (next: Partial<LedgerFilters>) => void;
  onReset: () => void;
  resultCount: number;
}) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();

  const accounts = useQuery({
    queryKey: ["accounts", workspace.id],
    queryFn: () => repositories.accounts.listByWorkspace(workspace.id),
  });

  const categories = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });

  const contacts = useQuery({
    queryKey: ["contacts", workspace.id],
    queryFn: () => repositories.contacts.listWithCounts(workspace.id),
  });

  const assets = useQuery({
    queryKey: ["assets", workspace.id],
    queryFn: async () =>
      repositories.driver.select<{ id: string; display_code: string }>(
        `SELECT DISTINCT a.id, a.display_code
         FROM assets a
         JOIN ledger_entries e ON e.asset_id = a.id
         WHERE e.workspace_id = ?
         ORDER BY a.display_code`,
        [workspace.id],
      ),
  });

  return (
    <div className="filters">
      <div className="field filters__search">
        <label className="field__label" htmlFor="filter-search">
          Search
        </label>
        <input
          id="filter-search"
          className="input"
          type="search"
          value={filters.search ?? ""}
          placeholder="Contact, address, memo, hash or note"
          onChange={(event) => onChange({ search: event.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-from">
          From
        </label>
        <input
          id="filter-from"
          className="input"
          type="date"
          value={filters.from?.slice(0, 10) ?? ""}
          onChange={(event) =>
            onChange({
              from: event.target.value ? `${event.target.value}T00:00:00Z` : undefined,
            })
          }
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-to">
          To
        </label>
        <input
          id="filter-to"
          className="input"
          type="date"
          value={filters.to?.slice(0, 10) ?? ""}
          onChange={(event) =>
            onChange({ to: event.target.value ? `${event.target.value}T23:59:59Z` : undefined })
          }
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-account">
          Account
        </label>
        <select
          id="filter-account"
          className="select"
          value={filters.accountId ?? ""}
          onChange={(event) => onChange({ accountId: event.target.value || undefined })}
        >
          <option value="">All accounts</option>
          {accounts.data?.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label ?? `${account.publicKey.slice(0, 8)}…`}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-direction">
          Direction
        </label>
        <select
          id="filter-direction"
          className="select"
          value={filters.direction ?? ""}
          onChange={(event) =>
            onChange({ direction: (event.target.value || undefined) as Direction | undefined })
          }
        >
          <option value="">Any</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
          <option value="internal">Transfer</option>
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-asset">
          Asset
        </label>
        <select
          id="filter-asset"
          className="select"
          value={filters.assetId ?? ""}
          onChange={(event) => onChange({ assetId: event.target.value || undefined })}
        >
          <option value="">All assets</option>
          {assets.data?.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.display_code}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-category">
          Category
        </label>
        <select
          id="filter-category"
          className="select"
          value={filters.categoryId ?? ""}
          onChange={(event) => onChange({ categoryId: event.target.value || undefined })}
        >
          <option value="">All categories</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.emoji ? `${category.emoji}  ` : ""}
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-contact">
          Contact
        </label>
        <select
          id="filter-contact"
          className="select"
          value={filters.contactId ?? ""}
          onChange={(event) => onChange({ contactId: event.target.value || undefined })}
        >
          <option value="">All contacts</option>
          {contacts.data?.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-status">
          Status
        </label>
        <select
          id="filter-status"
          className="select"
          value={filters.status ?? "all"}
          onChange={(event) => onChange({ status: event.target.value as CategorizationStatus })}
        >
          <option value="all">All</option>
          <option value="uncategorized">Uncategorized</option>
          <option value="categorized">Categorized</option>
        </select>
      </div>

      <button type="button" className="button" onClick={onReset}>
        Reset
      </button>

      <span className="text-xs muted push" role="status" aria-live="polite">
        {resultCount.toLocaleString()} transaction{resultCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
