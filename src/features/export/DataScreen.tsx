/**
 * Data: what leaves this application, and what it means.
 *
 * The screen is organised around the distinction the whole product rests on —
 * blockchain data that any resync can rebuild, versus the human layer that
 * exists nowhere else. People lose the second by assuming a CSV of transactions
 * was a backup, so the two are separated visually and named plainly.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Download,
  FileSpreadsheet,
  Landmark,
  Link2,
  NotebookPen,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useServices, useRepositories } from "../../app/providers/app-context";
import { useWorkspaces, useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { BRANDING } from "../../branding";
import { openTextFile, saveTextFile } from "../../lib/files";
import { toCsv } from "../../ledger/csv";
import { toQuickBooksCsv, type QuickBooksFormat } from "../../ledger/quickbooks";
import { buildMonthlyReport, reportToCsv } from "../../ledger/report";
import {
  BackupError,
  backupFilename,
  exportWorkspace,
  importBackup,
  parseBackup,
  serializeBackup,
} from "../../ledger/backup";
import { syncWorkspace } from "../../ledger/sync";
import { DATABASE_FILE } from "../../db/tauri-driver";
import { AssetLabel, Modal, ModalClose, useAssetIcons, useToast } from "../../components";

type Busy = { message: string } | null;

/** Month options for the report, newest first. */
function reportMonths(count = 12): Array<{ value: string; label: string }> {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return {
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    };
  });
}

export function DataScreen() {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const { dataSourceFor } = useServices();
  const { refresh, selectWorkspace } = useWorkspaces();
  const queryClient = useQueryClient();
  const toast = useToast();
  const icons = useAssetIcons();

  const [busy, setBusy] = useState<Busy>(null);
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [qbAsset, setQbAsset] = useState<string>("");
  const [qbFormat, setQbFormat] = useState<QuickBooksFormat>("three-column");
  const months = useMemo(() => reportMonths(), []);
  const [reportMonth, setReportMonth] = useState(months[0]!.value);

  const pending = useQuery({
    queryKey: ["pending-annotations", workspace.id],
    queryFn: () => repositories.pendingAnnotations.pendingCount(workspace.id),
  });

  const entryCount = useQuery({
    queryKey: ["entries-count-all", workspace.id],
    queryFn: () => repositories.entries.count({ workspaceId: workspace.id }),
  });

  const counts = useQuery({
    queryKey: ["metadata-counts", workspace.id],
    queryFn: async () => ({
      contacts: (await repositories.contacts.listWithCounts(workspace.id)).length,
      categories: (await repositories.categories.list(workspace.id)).length,
      rules: (await repositories.rules.list(workspace.id)).length,
      annotations:
        (
          await repositories.driver.select<{ count: number }>(
            `SELECT COUNT(*) AS count FROM entry_annotations an
             JOIN ledger_entries e ON e.id = an.ledger_entry_id
             WHERE e.workspace_id = ?`,
            [workspace.id],
          )
        )[0]?.count ?? 0,
    }),
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

  const selectedAsset = qbAsset || assets.data?.[0]?.id || "";

  async function allEntries() {
    return repositories.entries.query(
      { workspaceId: workspace.id, includeExcluded: true },
      { limit: 100_000, offset: 0 },
    );
  }

  async function run(message: string, work: () => Promise<void>) {
    setBusy({ message });
    try {
      await work();
    } catch (caught) {
      toast.error(
        caught instanceof BackupError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Something went wrong.",
        caught instanceof BackupError ? caught.detail : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  const exportCsv = (scope: "all" | "uncategorized") =>
    run("Preparing CSV…", async () => {
      const entries = await repositories.entries.query(
        {
          workspaceId: workspace.id,
          includeExcluded: true,
          ...(scope === "uncategorized" ? { status: "uncategorized" as const } : {}),
        },
        { limit: 100_000, offset: 0 },
      );
      const path = await saveTextFile(toCsv(entries), {
        defaultPath: backupFilename(workspace.name, "csv"),
        filters: [{ name: "CSV", extensions: ["csv"] }],
        title: "Export transactions as CSV",
      });
      if (path) toast.success(`Exported ${entries.length} transactions`, path);
    });

  const exportQuickBooks = () =>
    run("Preparing QuickBooks file…", async () => {
      const asset = assets.data?.find((candidate) => candidate.id === selectedAsset);
      if (!asset) return;

      const result = toQuickBooksCsv(await allEntries(), asset.id, { format: qbFormat });
      const path = await saveTextFile(result.csv, {
        defaultPath: `${backupFilename(workspace.name, "").replace(/\.$/, "")}-${asset.display_code}-quickbooks.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
        title: `Export ${asset.display_code} for QuickBooks`,
      });

      if (path) {
        toast.success(
          `Exported ${result.rows} ${asset.display_code} transactions`,
          result.skippedInternal > 0
            ? `${result.skippedInternal} internal transfer${result.skippedInternal === 1 ? "" : "s"} left out — moving money between your own accounts is not income or expenditure.`
            : "Ready to import as bank transactions.",
        );
      }
    });

  const exportReport = () =>
    run("Building report…", async () => {
      const [year, month] = reportMonth.split("-").map(Number);
      const report = await buildMonthlyReport(
        repositories,
        workspace.id,
        year!,
        month!,
        new Date().toISOString(),
      );
      const path = await saveTextFile(reportToCsv(report), {
        defaultPath: `${workspace.name} ${reportMonth} report.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
        title: "Export monthly report",
      });
      if (path) toast.success(`${report.periodLabel} report exported`, path);
    });

  const exportBackup = () => {
    setConfirmingExport(false);
    return run("Preparing backup…", async () => {
      const backup = await exportWorkspace(repositories, workspace.id);
      const path = await saveTextFile(serializeBackup(backup), {
        defaultPath: backupFilename(workspace.name, BRANDING.fileExtension),
        filters: [{ name: "Bookee ledger", extensions: [BRANDING.fileExtension] }],
        title: "Export ledger",
      });
      if (path) {
        toast.success(
          "Ledger exported",
          `${backup.contacts.length} contacts, ${backup.categories.length} categories, ${backup.rules.length} rules and ${backup.annotations.length} annotations.`,
        );
      }
    });
  };

  const importLedger = () =>
    run("Reading file…", async () => {
      const file = await openTextFile({
        // The previous extension is still offered: a rename must not orphan
        // backups people already made.
        filters: [
          { name: "Bookee ledger", extensions: [BRANDING.fileExtension, "stellarledger", "json"] },
        ],
        title: "Import ledger",
      });
      if (!file) return;

      // Validated before anything is written; a bad file changes nothing.
      const backup = parseBackup(file.contents);
      const result = await importBackup(repositories, backup);

      setBusy({ message: "Resyncing Stellar to reattach your notes…" });
      await syncWorkspace({ repositories, dataSourceFor }, result.workspaceId);

      const stillPending = await repositories.pendingAnnotations.pendingCount(result.workspaceId);
      await refresh();
      selectWorkspace(result.workspaceId);
      await queryClient.invalidateQueries();

      toast.success(
        `Imported ${result.contacts} contacts, ${result.categories} categories and ${result.rules} rules`,
        stillPending > 0
          ? `${stillPending} note${stillPending === 1 ? "" : "s"} are waiting for transactions that have not synced yet.`
          : "All notes reattached to their transactions.",
      );
    });

  return (
    <div className="stack stack--lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Data</h1>
          <p className="page-subtitle">
            Everything here stays on your machine until you choose a file location.
          </p>
        </div>
      </div>

      {busy ? (
        <div className="panel panel--flat" role="status" aria-live="polite">
          <div className="panel__body stack stack--sm">
            <p className="text-sm">{busy.message}</p>
            <div className="progress">
              <div className="progress__bar progress__bar--indeterminate" />
            </div>
          </div>
        </div>
      ) : null}

      {/* The distinction the whole product rests on, stated once, up front. */}
      <div className="grid grid--halves">
        <div className="data-kind">
          <div className="data-kind__head">
            <Link2 size={15} aria-hidden="true" />
            <h2 className="data-kind__title">Blockchain data</h2>
            <span className="tag">rebuildable</span>
          </div>
          <p className="data-kind__body">
            The {(entryCount.data ?? 0).toLocaleString()} transactions imported from Stellar —
            amounts, addresses, memos, hashes. Public, permanent, and identical for anyone who
            looks. Delete it and a resync brings it all back.
          </p>
        </div>

        <div className="data-kind data-kind--precious">
          <div className="data-kind__head">
            <NotebookPen size={15} aria-hidden="true" />
            <h2 className="data-kind__title">Your ledger</h2>
            <span className="tag tag--warning">irreplaceable</span>
          </div>
          <p className="data-kind__body">
            {counts.data?.contacts ?? 0} contacts, {counts.data?.categories ?? 0} categories,{" "}
            {counts.data?.rules ?? 0} rules and {counts.data?.annotations ?? 0} annotated
            transactions. What you decided each payment <em>meant</em>. It exists nowhere else and
            no resync can rebuild it.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            <Download size={14} aria-hidden="true" />
            Back up your ledger
          </h2>
          <span className="tag">.{BRANDING.fileExtension}</span>
        </div>
        <div className="panel__body stack stack--md">
          <p className="text-sm muted">
            Saves the irreplaceable half. Blockchain history is deliberately left out — it is
            restored by syncing again, which keeps the file small and portable between machines.
          </p>
          <div className="row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => setConfirmingExport(true)}
            >
              <Download size={13} aria-hidden="true" />
              Export ledger
            </button>
            <button type="button" className="button" onClick={() => void importLedger()}>
              <Upload size={13} aria-hidden="true" />
              Import ledger
            </button>
          </div>
          {(pending.data ?? 0) > 0 ? (
            <p className="text-sm">
              <span className="tag tag--warning">{pending.data} waiting</span> Restored notes whose
              transactions have not synced yet. They attach automatically.
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            <Landmark size={14} aria-hidden="true" />
            For your accountant
          </h2>
        </div>
        <div className="panel__body stack stack--lg">
          <div className="stack stack--md">
            <div>
              <h3 className="section-heading">QuickBooks</h3>
              <p className="field__hint">
                Bank-transaction CSV in QuickBooks Online&apos;s own format. One asset per file,
                because a bank feed holds a single currency — mixing assets would import cleanly and
                mean nothing. Internal transfers are left out.
              </p>
            </div>
            <div className="row row--wrap">
              <div className="field">
                <label className="field__label" htmlFor="qb-asset">
                  Asset
                </label>
                <select
                  id="qb-asset"
                  className="select"
                  value={selectedAsset}
                  onChange={(event) => setQbAsset(event.target.value)}
                >
                  {assets.data?.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.display_code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="qb-format">
                  Format
                </label>
                <select
                  id="qb-format"
                  className="select"
                  value={qbFormat}
                  onChange={(event) => setQbFormat(event.target.value as QuickBooksFormat)}
                >
                  <option value="three-column">3 columns — Date, Description, Amount</option>
                  <option value="four-column">4 columns — Date, Description, Credit, Debit</option>
                </select>
              </div>
              <button
                type="button"
                className="button self-end"
                onClick={() => void exportQuickBooks()}
                disabled={!selectedAsset}
              >
                <FileSpreadsheet size={13} aria-hidden="true" />
                Export for QuickBooks
              </button>
            </div>
            {assets.data && assets.data.length > 1 ? (
              <p className="field__hint row row--xs">
                You hold{" "}
                {assets.data.map((asset) => (
                  <AssetLabel
                    key={asset.id}
                    assetId={asset.id}
                    code={asset.display_code}
                    iconDataUri={icons.get(asset.id)}
                    size={14}
                  />
                ))}
                — each needs its own file.
              </p>
            ) : null}
          </div>

          <div className="stack stack--md">
            <div>
              <h3 className="section-heading">Monthly report</h3>
              <p className="field__hint">
                One period summarised per asset, with the category breakdown. Amounts are never
                combined across assets.
              </p>
            </div>
            <div className="row row--wrap">
              <div className="field">
                <label className="field__label" htmlFor="report-month">
                  Month
                </label>
                <select
                  id="report-month"
                  className="select"
                  value={reportMonth}
                  onChange={(event) => setReportMonth(event.target.value)}
                >
                  {months.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="button self-end" onClick={() => void exportReport()}>
                <FileSpreadsheet size={13} aria-hidden="true" />
                Export report
              </button>
            </div>
          </div>

          <div className="stack stack--md">
            <div>
              <h3 className="section-heading">Raw transactions</h3>
              <p className="field__hint">
                Every field the ledger holds, with exact unrounded amounts. For a spreadsheet or
                your own tooling — not a backup: it contains no contacts, categories or rules.
              </p>
            </div>
            <div className="row">
              <button type="button" className="button" onClick={() => void exportCsv("all")}>
                Export all transactions
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void exportCsv("uncategorized")}
              >
                Uncategorized only
              </button>
            </div>
          </div>
        </div>
      </section>

      {confirmingExport ? (
        <Modal
          title="This file may contain private information"
          description="Blockchain data is public. What you have written about it is not."
          onClose={() => setConfirmingExport(false)}
        >
          <div className="callout callout--warning">
            <ShieldAlert size={15} aria-hidden="true" />
            <span className="callout__body">
              The backup includes your notes, contact names, organizations, categories, and the
              mapping between people and Stellar addresses. Share it only with people you trust.
            </span>
          </div>
          <div className="row row--end">
            <ModalClose asChild>
              <button type="button" className="button button--subtle">
                Cancel
              </button>
            </ModalClose>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void exportBackup()}
            >
              I understand, export
            </button>
          </div>
        </Modal>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            <Database size={14} aria-hidden="true" />
            Database
          </h2>
        </div>
        <div className="panel__body">
          <dl className="detail-grid text-sm">
            <dt>File</dt>
            <dd className="mono">{DATABASE_FILE}</dd>
            <dt>Location</dt>
            <dd className="muted">
              Application data directory for {BRANDING.appName}. Nothing is uploaded anywhere.
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
