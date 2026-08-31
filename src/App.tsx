import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AppProvider } from "./app/providers/app-context";
import { ThemeProvider } from "./app/providers/theme-provider";
import { WorkspaceProvider, useWorkspaces } from "./app/providers/workspace-provider";
import { SyncProvider } from "./app/providers/sync-provider";
import { OnboardingScreen } from "./features/onboarding/OnboardingScreen";
import { ToastHost, TooltipProvider } from "./components";
import { router } from "./app/router";

/**
 * Queries read from the local database, so they are cheap and always fresh
 * enough; refetching on window focus would only duplicate what the sync
 * provider already does.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Shell() {
  const { workspaces, isLoading } = useWorkspaces();

  if (isLoading) {
    return (
      <div className="app-boot" role="status">
        Loading…
      </div>
    );
  }

  // No workspace yet means first launch.
  if (workspaces.length === 0) return <OnboardingScreen />;

  return (
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastHost>
            <AppProvider>
              <WorkspaceProvider>
                <Shell />
              </WorkspaceProvider>
            </AppProvider>
          </ToastHost>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
