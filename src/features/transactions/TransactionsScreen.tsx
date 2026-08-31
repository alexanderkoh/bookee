/**
 * The ledger table.
 *
 * Dense, keyboard-navigable, and virtualized: only the visible rows exist in
 * the DOM, so a ledger with tens of thousands of entries scrolls at the same
 * speed as one with fifty. Rows are fetched a window at a time rather than all
 * at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { SearchX } from "lucide-react";
import {
  Amount,
  AssetIcon,
  CategoryChip,
  EmptyState,
  formatDate,
  shortAddress,
  useAssetIcons,
} from "../../components";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionDetailDrawer } from "./TransactionDetailDrawer";
import type { LedgerFilters } from "../../ledger/types";

const ROW_HEIGHT = 34;
/** Rows are loaded in windows; large enough that scrolling rarely waits. */
const PAGE_SIZE = 500;

export function TransactionsScreen() {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const search = useSearch({ strict: false }) as { status?: string };
  const icons = useAssetIcons();
  const navigate = useNavigate();

  const [filters, setFilters] = useState<LedgerFilters>(() => ({
    workspaceId: workspace.id,
    ...(search.status === "uncategorized" ? { status: "uncategorized" as const } : {}),
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState<string | undefined>(undefined);

  useEffect(() => {
    setFilters((current) => ({ ...current, workspaceId: workspace.id }));
  }, [workspace.id]);

  // Typing should not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 200);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const countQuery = useQuery({
    queryKey: ["entries-count", effectiveFilters],
    queryFn: () => repositories.entries.count(effectiveFilters),
    placeholderData: keepPreviousData,
  });

  const [window, setWindow] = useState({ offset: 0, limit: PAGE_SIZE });

  const rowsQuery = useQuery({
    queryKey: ["entries", effectiveFilters, window.offset, window.limit],
    queryFn: () => repositories.entries.query(effectiveFilters, window),
    placeholderData: keepPreviousData,
  });

  const total = countQuery.data ?? 0;
  const rows = rowsQuery.data ?? [];

  // Re-read the selected entry rather than holding on to the row object: after
  // an annotation is saved the drawer must show the new value, not a stale row.
  const selectedQuery = useQuery({
    queryKey: ["entry", selectedId],
    enabled: selectedId !== null,
    queryFn: () => repositories.entries.findById(selectedId!),
  });
  const selected = selectedQuery.data ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Slide the loaded window when the viewport moves outside it.
  useEffect(() => {
    const first = virtualItems[0]?.index ?? 0;
    const last = virtualItems[virtualItems.length - 1]?.index ?? 0;
    if (first < window.offset || last >= window.offset + window.limit) {
      const nextOffset = Math.max(0, first - PAGE_SIZE / 4);
      setWindow({ offset: Math.floor(nextOffset), limit: PAGE_SIZE });
    }
  }, [virtualItems, window.offset, window.limit]);

  const updateFilters = useCallback((next: Partial<LedgerFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ workspaceId: workspace.id });
    void navigate({ to: "/transactions", search: {} });
  }, [workspace.id, navigate]);

  return (
    <>
      <TransactionFilters
        filters={filters}
        onChange={updateFilters}
        onReset={resetFilters}
        resultCount={total}
      />

      {total === 0 && !rowsQuery.isFetching ? (
        <EmptyState
          icon={<SearchX size={20} />}
          title="No matching transactions"
          description="Adjust the filters, or sync to import more history."
        />
      ) : (
        <div className="table__scroll" ref={scrollRef} tabIndex={0}>
          <table className="table table--rows table--fixed">
            <caption className="visually-hidden">
              Ledger entries, most recent first. {total} rows.
            </caption>
            <colgroup>
              <col className="col-date" />
              <col className="col-counterparty" />
              <col />
              <col className="col-category" />
              <col className="col-direction" />
              <col className="col-amount" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Counterparty</th>
                <th scope="col">Memo</th>
                <th scope="col">Category</th>
                <th scope="col">Direction</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Spacer rows keep the scrollbar proportional to the full result set. */}
              <tr style={{ height: virtualItems[0]?.start ?? 0 }} aria-hidden="true" />
              {virtualItems.map((virtualRow) => {
                const entry = rows[virtualRow.index - window.offset];
                if (!entry) {
                  return (
                    <tr key={virtualRow.key} style={{ height: ROW_HEIGHT }} aria-hidden="true">
                      <td colSpan={6} className="muted text-xs">
                        …
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={entry.id}
                    aria-selected={selectedId === entry.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                  >
                    <td className="text-xs muted nowrap">{formatDate(entry.timestamp)}</td>
                    <td className="truncate">
                      {entry.contactName ?? (
                        <span className="mono">{shortAddress(entry.counterpartyAddress, 6)}</span>
                      )}
                    </td>
                    <td className="truncate muted text-xs">
                      {entry.memoType === "text" ? entry.memoValue : ""}
                    </td>
                    <td className="truncate">
                      {entry.categoryName ? (
                        <CategoryChip name={entry.categoryName} emoji={entry.categoryEmoji} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag tag--${entry.direction}`}>
                        {entry.direction === "internal"
                          ? "Transfer"
                          : entry.direction === "incoming"
                            ? "Incoming"
                            : "Outgoing"}
                      </span>
                    </td>
                    <td>
                      <span className="row row--xs row--end">
                        <AssetIcon
                          assetId={entry.assetId}
                          code={entry.assetCode}
                          iconDataUri={icons.get(entry.assetId)}
                          size={15}
                        />
                        <Amount
                          amount={entry.amount}
                          assetCode={entry.assetCode}
                          direction={entry.direction}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr
                style={{
                  height:
                    virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0),
                }}
                aria-hidden="true"
              />
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <TransactionDetailDrawer entry={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </>
  );
}
