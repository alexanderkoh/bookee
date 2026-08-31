/**
 * Overview.
 *
 * The one screen that is allowed room. Balances and monthly movement are the
 * numbers people open the app to see, so they are given real size rather than
 * being squeezed into table rows.
 *
 * Every aggregate is per asset. There is deliberately no portfolio total: the
 * application has no price feed, and adding XLM to USDC would be a fabrication.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Inbox, Tag, Wallet } from "lucide-react";
import { useServices } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import {
  Amount,
  AssetLabel,
  CategoryBarChart,
  EmptyState,
  MonthlyFlowChart,
  Skeleton,
  formatDate,
  shortAddress,
  useAssetIcons,
} from "../../components";
import { monthlyActivity } from "../../ledger/monthly";
import { useMarketRates } from "../prices/useMarketRates";
import { valueHolding } from "../../ledger/valuation";
import { relativeTime } from "../../components";
import { categorySummary, monthRange } from "../../ledger/reporting";
import { add, formatDisplay } from "../../lib/money";
import type { AssetBalance } from "../../ledger/types";

/** First day of the current month, as an ISO timestamp. */
function startOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function DashboardScreen() {
  const workspace = useCurrentWorkspace();
  const { repositories, dataSourceFor } = useServices();
  const icons = useAssetIcons();
  const [chartAssetId, setChartAssetId] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["accounts", workspace.id],
    queryFn: () => repositories.accounts.listByWorkspace(workspace.id),
  });

  const balances = useQuery({
    queryKey: ["balances", workspace.id, accounts.data?.map((a) => a.id).join(",")],
    enabled: (accounts.data?.length ?? 0) > 0,
    queryFn: async (): Promise<AssetBalance[]> => {
      const byAsset = new Map<string, AssetBalance>();

      for (const account of accounts.data ?? []) {
        const source = dataSourceFor(account.network);
        const details = await source.getAccount(account.publicKey);

        for (const balance of details.balances) {
          if (balance.asset_type === "liquidity_pool_shares") continue;
          const code = balance.asset_type === "native" ? "XLM" : (balance.asset_code ?? "?");
          const issuer = balance.asset_type === "native" ? null : (balance.asset_issuer ?? null);
          const id =
            balance.asset_type === "native"
              ? `${account.network}:native`
              : `${account.network}:${code}:${issuer}`;

          const existing = byAsset.get(id);
          byAsset.set(id, {
            assetId: id,
            assetCode: code,
            assetIssuer: issuer,
            // Balances of the same asset across tracked accounts add up, using
            // exact decimal arithmetic like every other amount.
            balance: existing ? add(existing.balance, balance.balance) : balance.balance,
          });
        }
      }
      return [...byAsset.values()].toSorted((a, b) => a.assetCode.localeCompare(b.assetCode));
    },
  });

  // Rates for whatever is actually held, so a balance can be read in a familiar
  // unit. Per asset only — see ledger/valuation.ts for why there is no total.
  const heldAssets = useMemo(
    () =>
      (balances.data ?? []).map((balance) => ({
        id: balance.assetId,
        network: "public" as const,
        assetType: balance.assetIssuer ? "credit_alphanum4" : "native",
        code: balance.assetIssuer ? balance.assetCode : null,
        issuer: balance.assetIssuer,
        contractId: null,
        displayCode: balance.assetCode,
      })),
    [balances.data],
  );
  const { rates, quote } = useMarketRates(heldAssets);

  const monthTotals = useQuery({
    queryKey: ["totals", workspace.id, "month"],
    queryFn: () =>
      repositories.entries.totalsByAsset({ workspaceId: workspace.id, from: startOfMonth() }),
  });

  const uncategorized = useQuery({
    queryKey: ["uncategorized", workspace.id],
    queryFn: () => repositories.entries.uncategorizedCount(workspace.id),
  });

  const activity = useQuery({
    queryKey: ["monthly-activity", workspace.id],
    queryFn: () => monthlyActivity(repositories, workspace.id, { months: 12 }),
  });

  const categories = useQuery({
    queryKey: ["category-summary", workspace.id, "month"],
    queryFn: () => categorySummary(repositories, workspace.id, monthRange()),
  });

  const recent = useQuery({
    queryKey: ["recent", workspace.id],
    queryFn: () =>
      // Five rows keeps the overview inside a laptop viewport. "View all" is
      // one click away, and a dashboard that scrolls for its last few pixels
      // reads as broken rather than as having more to show.
      repositories.entries.query({ workspaceId: workspace.id }, { limit: 5, offset: 0 }),
  });

  if (accounts.data && accounts.data.length === 0) {
    return (
      <EmptyState
        icon={<Wallet size={20} />}
        title="No accounts tracked yet"
        description="Add a Stellar public address and its history becomes your ledger."
        action={
          <Link to="/accounts" className="button button--primary">
            Add an account
          </Link>
        }
      />
    );
  }

  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });

  // Default to the busiest asset; the selector only appears when there is a
  // real choice, because a single-option toggle is just noise.
  const series = activity.data ?? [];
  const selected = series.find((s) => s.assetId === chartAssetId) ?? series[0] ?? null;

  const expenseBars = useMemo(() => {
    if (!selected) return [];
    return (categories.data ?? [])
      .filter((row) => row.kind === "expense" && row.categoryId !== null)
      .map((row) => ({
        id: row.categoryId!,
        label: row.categoryEmoji ? `${row.categoryEmoji}  ${row.categoryName}` : row.categoryName,
        amount: row.totals.find((t) => t.assetId === selected.assetId)?.amount ?? "0",
      }))
      .filter((bar) => Number(bar.amount) > 0);
  }, [categories.data, selected]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">{workspace.name}</h1>
          <p className="page-subtitle">
            {accounts.data?.length ?? 0} tracked account
            {accounts.data?.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {(uncategorized.data ?? 0) > 0 ? (
        <Link
          to="/transactions"
          search={{ status: "uncategorized" }}
          className="panel panel--accent"
        >
          <div className="callout callout--accent">
            <Tag size={15} aria-hidden="true" />
            <span className="callout__body">
              <strong>{uncategorized.data}</strong> transaction
              {uncategorized.data === 1 ? "" : "s"} need categorization
            </span>
          </div>
        </Link>
      ) : null}

      <div className="grid grid--halves">
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">
              <Wallet size={14} aria-hidden="true" />
              Balances
            </h2>
            <span className="text-xs subtle">current</span>
          </div>

          {balances.isLoading ? (
            <div className="panel__body">
              <Skeleton rows={2} />
            </div>
          ) : balances.isError ? (
            <div className="panel__body">
              <p className="text-sm muted">Balances are unavailable while offline.</p>
            </div>
          ) : (balances.data?.length ?? 0) === 0 ? (
            <div className="panel__body">
              <p className="text-sm muted">No balances.</p>
            </div>
          ) : (
            <div className="balance-list">
              {balances.data?.map((balance) => {
                const valuation = valueHolding(
                  balance.balance,
                  rates.get(balance.assetId) ?? null,
                  quote.displayCode,
                );
                return (
                  <div className="balance-row" key={balance.assetId}>
                    <AssetLabel
                      assetId={balance.assetId}
                      code={balance.assetCode}
                      iconDataUri={icons.get(balance.assetId)}
                      size={22}
                    />
                    <span className="balance-row__figures">
                      <span className="balance-row__amount">{formatDisplay(balance.balance)}</span>
                      {valuation ? (
                        <span
                          className="balance-row__valuation"
                          title={`1 ${balance.assetCode} = ${valuation.rate} ${valuation.quoteCode}, from the Stellar DEX ${relativeTime(valuation.asOf)}`}
                        >
                          ≈ {formatDisplay(valuation.value)} {valuation.quoteCode}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{monthName}</h2>
            <span className="text-xs subtle">per asset</span>
          </div>

          {(monthTotals.data?.length ?? 0) === 0 ? (
            <div className="panel__body">
              <p className="text-sm muted">No activity this month.</p>
            </div>
          ) : (
            <div className="balance-list">
              {monthTotals.data?.map((total) => (
                <div className="balance-row" key={total.assetId}>
                  <AssetLabel
                    assetId={total.assetId}
                    code={total.assetCode}
                    iconDataUri={icons.get(total.assetId)}
                    size={22}
                  />
                  <span className="row row--lg">
                    <span className="stack stack--xs">
                      <span className="text-2xs subtle row row--xs">
                        <ArrowDownLeft size={11} aria-hidden="true" /> in
                      </span>
                      <span className="numeric text-sm amount--incoming">
                        {formatDisplay(total.incoming)}
                      </span>
                    </span>
                    <span className="stack stack--xs">
                      <span className="text-2xs subtle row row--xs">
                        <ArrowUpRight size={11} aria-hidden="true" /> out
                      </span>
                      <span className="numeric text-sm amount--outgoing">
                        {formatDisplay(total.outgoing)}
                      </span>
                    </span>
                    <span className="stack stack--xs">
                      <span className="text-2xs subtle">net</span>
                      <span className="numeric text-sm medium">
                        {formatDisplay(total.net, { signed: true })}
                      </span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {selected ? (
        <div className="grid grid--halves">
          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">Money in and out</h2>
              {series.length > 1 ? (
                <div className="segmented" role="group" aria-label="Asset">
                  {series.map((option) => (
                    <button
                      key={option.assetId}
                      type="button"
                      aria-pressed={option.assetId === selected.assetId}
                      onClick={() => setChartAssetId(option.assetId)}
                    >
                      {option.assetCode}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-xs subtle">last 12 months</span>
              )}
            </div>
            <div className="panel__body">
              <MonthlyFlowChart months={selected.months} assetCode={selected.assetCode} />
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">Where it went</h2>
              <span className="text-xs subtle">{monthName}</span>
            </div>
            <div className="panel__body">
              <CategoryBarChart bars={expenseBars} assetCode={selected.assetCode} />
            </div>
          </section>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Recent activity</h2>
          <Link to="/transactions" className="text-xs">
            View all
          </Link>
        </div>

        {(recent.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title="Nothing imported yet"
            description="Once a sync completes, your most recent movements appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Most recent ledger entries</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Counterparty</th>
                  <th scope="col">Direction</th>
                  <th scope="col" className="numeric">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-xs muted nowrap">{formatDate(entry.timestamp)}</td>
                    <td className="truncate">
                      {entry.contactName ?? (
                        <span className="mono">{shortAddress(entry.counterpartyAddress, 6)}</span>
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
                      <Amount
                        amount={entry.amount}
                        assetCode={entry.assetCode}
                        direction={entry.direction}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
