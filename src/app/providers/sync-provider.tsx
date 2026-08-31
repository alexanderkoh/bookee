/**
 * Sync orchestration and status.
 *
 * Runs the importer for the current workspace and exposes progress. Rules the
 * UI depends on:
 *
 *  - a failed sync never removes data that was already imported
 *  - only one sync runs at a time
 *  - errors surface as sentences, not stack traces
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServices } from "./app-context";
import { useWorkspaces } from "./workspace-provider";
import { syncWorkspace, type SyncProgress } from "../../ledger/sync";
import { StellarError } from "../../stellar/errors";
import { createLogger } from "../../lib/log";

const log = createLogger("sync-ui");

/** How stale a sync must be before regaining focus triggers another one. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export type SyncState =
  | { status: "idle"; lastSyncedAt: string | null }
  | { status: "syncing"; progress: SyncProgress | null }
  | { status: "error"; message: string; lastSyncedAt: string | null };

interface SyncContextValue {
  state: SyncState;
  syncNow: () => Promise<void>;
  isSyncing: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { repositories, dataSourceFor } = useServices();
  const { workspace } = useWorkspaces();
  const queryClient = useQueryClient();

  const [state, setState] = useState<SyncState>({ status: "idle", lastSyncedAt: null });
  const running = useRef(false);
  const lastRunAt = useRef<number>(0);

  const syncNow = useCallback(async () => {
    if (!workspace || running.current) return;
    running.current = true;
    lastRunAt.current = Date.now();
    setState({ status: "syncing", progress: null });

    try {
      await syncWorkspace({ repositories, dataSourceFor }, workspace.id, {
        onProgress: (progress) => setState({ status: "syncing", progress }),
      });

      setState({ status: "idle", lastSyncedAt: new Date().toISOString() });
      // Everything on screen derives from the database, so refresh all of it.
      await queryClient.invalidateQueries();
    } catch (error) {
      const message =
        error instanceof StellarError
          ? error.userMessage
          : error instanceof Error
            ? error.message
            : "Sync failed for an unknown reason.";
      log.error("sync failed", { message });
      setState((previous) => ({
        status: "error",
        message,
        lastSyncedAt: previous.status === "idle" ? previous.lastSyncedAt : null,
      }));
      // Partial progress is still valid data; show whatever was committed.
      await queryClient.invalidateQueries();
    } finally {
      running.current = false;
    }
  }, [workspace, repositories, dataSourceFor, queryClient]);

  // Sync on launch and whenever the workspace changes.
  useEffect(() => {
    if (!workspace) return;
    void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  // Sync when the window regains focus, but only if the data is stale.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRunAt.current > STALE_AFTER_MS) void syncNow();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [syncNow]);

  const value = useMemo(
    () => ({ state, syncNow, isSyncing: state.status === "syncing" }),
    [state, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync must be used inside SyncProvider");
  return context;
}
