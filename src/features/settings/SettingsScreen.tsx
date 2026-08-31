/**
 * Settings and diagnostics.
 *
 * Diagnostics exists so unsupported blockchain activity is visible rather than
 * silently missing: anything the importer could not interpret is listed here
 * with its raw record.
 */
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useServices } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { useTheme, type ThemePreference } from "../../app/providers/theme-provider";
import { HORIZON_URL_SETTING } from "../../app/providers/app-context";
import { BRANDING } from "../../branding";
import { CURRENT_VERSION, UPDATE_CHECK_SETTING } from "../updates/useUpdateCheck";
import { DEFAULT_HORIZON_URLS } from "../../stellar/client";
import { DATABASE_FILE } from "../../db/tauri-driver";
import { formatDateTime, relativeTime } from "../../components";
import type { Network } from "../../db/schema";

export function SettingsScreen() {
  const workspace = useCurrentWorkspace();
  const { repositories, schemaVersion, foreignKeysEnabled } = useServices();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => repositories.settings.all(),
  });

  const accounts = useQuery({
    queryKey: ["accounts", workspace.id],
    queryFn: () => repositories.accounts.listByWorkspace(workspace.id),
  });

  const issues = useQuery({
    queryKey: ["sync-issues", workspace.id],
    queryFn: () => repositories.syncIssues.list(workspace.id),
  });

  const pendingAnnotations = useQuery({
    queryKey: ["pending-annotations", workspace.id],
    queryFn: () => repositories.pendingAnnotations.pendingCount(workspace.id),
  });

  return (
    <div className="stack stack--lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Everything here stays on this machine.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Appearance</h2>
        </div>
        <div className="panel__body">
          <ThemeToggle />
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Updates</h2>
        </div>
        <div className="panel__body stack stack--sm">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.data?.[UPDATE_CHECK_SETTING] !== "false"}
              onChange={async (event) => {
                await repositories.settings.set(
                  UPDATE_CHECK_SETTING,
                  event.target.checked ? "true" : "false",
                );
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              }}
            />
            Check for new versions
          </label>
          <p className="field__hint">
            Once a day, {BRANDING.appName} asks GitHub whether a newer release exists. This is the
            only request it makes to any host other than a Horizon endpoint. It sends no identifier
            and nothing about your ledger, and it never downloads or installs anything — you are
            shown a link. Currently running {CURRENT_VERSION}.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Blockchain</h2>
        </div>
        <div className="panel__body stack stack--md">
          <p className="field__hint">
            Defaults work without configuration. Set a custom endpoint only if you run your own
            Horizon instance.
          </p>
          {(["public", "testnet"] as const).map((network) => (
            <HorizonEndpointField
              key={network}
              network={network}
              value={settings.data?.[`${HORIZON_URL_SETTING}.${network}`] ?? ""}
              onSave={async (url) => {
                await repositories.settings.set(`${HORIZON_URL_SETTING}.${network}`, url);
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              }}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Diagnostics</h2>
          <span className="text-xs muted">
            {issues.data?.length ?? 0} unresolved issue{issues.data?.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="panel__body stack stack--md">
          <dl className="detail-grid small">
            <dt>Schema version</dt>
            <dd>{schemaVersion}</dd>
            <dt>Foreign keys</dt>
            <dd>{foreignKeysEnabled ? "Enabled" : "Not enabled"}</dd>
            <dt>Database file</dt>
            <dd className="mono">{DATABASE_FILE}</dd>
            <dt>Restored notes waiting</dt>
            <dd>
              {pendingAnnotations.data ?? 0}
              {(pendingAnnotations.data ?? 0) > 0 ? (
                <span className="muted"> — they attach once their transactions sync</span>
              ) : null}
            </dd>
          </dl>

          <div>
            <h3 className="section-heading">Accounts</h3>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Network</th>
                  <th scope="col">Last sync</th>
                  <th scope="col">Cursor</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data?.map((account) => (
                  <tr key={account.id}>
                    <td className="truncate">{account.label ?? account.publicKey.slice(0, 10)}</td>
                    <td>{account.network}</td>
                    <td>{relativeTime(account.lastSyncedAt)}</td>
                    <td className="mono text-xs truncate">{account.lastPaymentCursor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="section-heading">Sync issues</h3>
            {(issues.data?.length ?? 0) === 0 ? (
              <p className="field__hint">
                Nothing unresolved. Records the importer cannot interpret appear here rather than
                being dropped.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Message</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {issues.data?.map((issue) => (
                    <tr key={issue.id}>
                      <td className="text-xs nowrap">{formatDateTime(issue.createdAt)}</td>
                      <td>
                        <span className="tag tag--warning">{issue.kind.replace(/_/g, " ")}</span>
                      </td>
                      <td className="text-xs">{issue.message}</td>
                      <td>
                        <button
                          type="button"
                          className="button button--subtle"
                          onClick={async () => {
                            await repositories.syncIssues.resolve(issue.id);
                            await queryClient.invalidateQueries({ queryKey: ["sync-issues"] });
                          }}
                        >
                          Dismiss
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">About</h2>
        </div>
        <div className="panel__body">
          <dl className="detail-grid small">
            <dt>Application</dt>
            <dd>
              {BRANDING.fullName} {CURRENT_VERSION}
            </dd>
            <dt>Built by</dt>
            <dd>{BRANDING.studio}</dd>
            <dt>License</dt>
            <dd>{BRANDING.license}</dd>
            <dt>Source</dt>
            <dd>
              <button
                type="button"
                className="button button--subtle"
                onClick={() => void openUrl(BRANDING.repositoryUrl)}
              >
                {BRANDING.repositoryUrl}
              </button>
            </dd>
          </dl>
          <p className="field__hint">
            Read-only by design. This application never asks for, stores or transmits a secret key,
            and never submits a transaction.
          </p>
        </div>
      </section>
    </div>
  );
}

function HorizonEndpointField({
  network,
  value,
  onSave,
}: {
  network: Network;
  value: string;
  onSave: (url: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const placeholder = DEFAULT_HORIZON_URLS[network];

  return (
    <div className="field">
      <label className="field__label" htmlFor={`horizon-${network}`}>
        {network === "public" ? "Public" : "Testnet"} Horizon endpoint
      </label>
      <div className="row">
        <input
          id={`horizon-${network}`}
          className="input mono grow"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="button"
          onClick={async () => {
            setError(null);
            const trimmed = draft.trim();
            if (trimmed !== "") {
              try {
                const url = new URL(trimmed);
                if (url.protocol !== "https:" && url.hostname !== "localhost") {
                  setError("Use an https:// endpoint.");
                  return;
                }
              } catch {
                setError("That is not a valid URL.");
                return;
              }
            }
            await onSave(trimmed);
          }}
        >
          Save
        </button>
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="field__hint">
        Restart the app after changing this. Leave empty to use {placeholder}.
      </p>
    </div>
  );
}

/**
 * Appearance control.
 *
 * Three states, because "follow the system" is a real preference and not the
 * absence of one.
 */
function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div className="field">
      <span className="field__label" id="theme-label">
        Theme
      </span>
      <div className="segmented" role="group" aria-labelledby="theme-label">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={preference === option.value}
            onClick={() => setPreference(option.value)}
          >
            <option.icon size={12} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
