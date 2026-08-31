/**
 * Sync status.
 *
 * A Radix popover rather than a hand-rolled panel: it now closes on Escape and
 * on click outside, and is positioned with collision handling. The wording
 * always says plainly that synced data is untouched, because a failed request
 * never removes anything.
 */
import { RefreshCw } from "lucide-react";
import { useSync } from "../providers/sync-provider";
import { PopoverPanel, relativeTime } from "../../components";

/**
 * Refresh.
 *
 * Separated from the status readout so the common action — "fetch now" — is one
 * click rather than opening a panel first. The icon spins while a sync is in
 * flight, which is the same signal the status dot gives, in the place the
 * pointer already is.
 */
export function RefreshButton() {
  const { syncNow, isSyncing } = useSync();

  return (
    <button
      type="button"
      className="button button--subtle button--icon"
      onClick={() => void syncNow()}
      disabled={isSyncing}
      aria-label={isSyncing ? "Syncing" : "Sync now"}
      title={isSyncing ? "Syncing…" : "Sync now"}
    >
      <RefreshCw size={14} aria-hidden="true" className={isSyncing ? "spinning" : undefined} />
    </button>
  );
}

export function SyncStatus() {
  const { state, syncNow, isSyncing } = useSync();

  const { label, dotClass } =
    state.status === "syncing"
      ? {
          label: state.progress ? `Syncing… ${state.progress.entriesImported}` : "Syncing…",
          dotClass: "sync-dot--busy",
        }
      : state.status === "error"
        ? { label: "Sync failed", dotClass: "sync-dot--error" }
        : {
            label: state.lastSyncedAt ? `Synced ${relativeTime(state.lastSyncedAt)}` : "Not synced",
            dotClass: "sync-dot--ok",
          };

  return (
    <PopoverPanel
      trigger={
        <button type="button" className="sync-status">
          <span className={`sync-dot ${dotClass}`} aria-hidden="true" />
          {label}
        </button>
      }
    >
      <div className="panel__body stack stack--md">
        {state.status === "error" ? (
          <>
            <p className="text-sm" role="alert">
              {state.message}
            </p>
            <p className="text-xs muted">
              Everything already imported is still here. Retrying continues from the last saved
              position.
            </p>
          </>
        ) : state.status === "syncing" ? (
          <>
            <p className="text-sm">
              {state.progress
                ? `${state.progress.entriesImported} transactions imported from ${state.progress.pagesFetched} page${state.progress.pagesFetched === 1 ? "" : "s"}.`
                : "Contacting Horizon…"}
            </p>
            <div className="progress">
              <div className="progress__bar progress__bar--indeterminate" />
            </div>
          </>
        ) : (
          <p className="text-sm">Last synced {relativeTime(state.lastSyncedAt)}.</p>
        )}

        <button
          type="button"
          className="button"
          onClick={() => void syncNow()}
          disabled={isSyncing}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Sync now
        </button>
      </div>
    </PopoverPanel>
  );
}
