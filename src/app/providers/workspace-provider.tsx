/**
 * Current workspace selection.
 *
 * A workspace is one set of books. Everything else — accounts, contacts,
 * categories, rules, annotations — is scoped to it, so the selected workspace
 * is the root of almost every query.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "./app-context";
import type { Workspace } from "../../db/schema";

const LAST_WORKSPACE_KEY = "stellar-ledger.last-workspace";

interface WorkspaceContextValue {
  workspaces: Workspace[];
  workspace: Workspace | null;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(LAST_WORKSPACE_KEY),
  );

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => repositories.workspaces.list(),
  });

  // Fall back to the first workspace if the remembered one is gone.
  const workspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((candidate) => candidate.id === selectedId) ?? workspaces[0] ?? null;
  }, [workspaces, selectedId]);

  useEffect(() => {
    if (workspace) localStorage.setItem(LAST_WORKSPACE_KEY, workspace.id);
  }, [workspace]);

  const selectWorkspace = useCallback((id: string) => setSelectedId(id), []);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  }, [queryClient]);

  const value = useMemo(
    () => ({ workspaces, workspace, selectWorkspace, refresh, isLoading }),
    [workspaces, workspace, selectWorkspace, refresh, isLoading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaces(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspaces must be used inside WorkspaceProvider");
  return context;
}

/** The selected workspace, for screens that cannot render without one. */
export function useCurrentWorkspace(): Workspace {
  const { workspace } = useWorkspaces();
  if (!workspace) throw new Error("No workspace selected");
  return workspace;
}
