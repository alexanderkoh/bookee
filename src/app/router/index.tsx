/**
 * Routes.
 *
 * Code-based rather than file-based: the route set is small and explicit, and
 * this avoids a codegen step in the build.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  createBrowserHistory,
  createMemoryHistory,
} from "@tanstack/react-router";
import { AppLayout } from "../layout/AppLayout";
import { DashboardScreen } from "../../features/dashboard/DashboardScreen";
import { TransactionsScreen } from "../../features/transactions/TransactionsScreen";
import { AccountsScreen } from "../../features/accounts/AccountsScreen";
import { ContactsScreen } from "../../features/contacts/ContactsScreen";
import { CategoriesScreen } from "../../features/categories/CategoriesScreen";
import { RulesScreen } from "../../features/rules/RulesScreen";
import { DataScreen } from "../../features/export/DataScreen";
import { SettingsScreen } from "../../features/settings/SettingsScreen";

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardScreen,
});

/** Deep-link target for "N transactions need categorization". */
export interface TransactionsSearch {
  status?: "uncategorized" | "categorized";
}

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsScreen,
  validateSearch: (search: Record<string, unknown>): TransactionsSearch => {
    const status = search["status"];
    return status === "uncategorized" || status === "categorized" ? { status } : {};
  },
});

const contactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/contacts",
  component: ContactsScreen,
});

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/categories",
  component: CategoriesScreen,
});

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rules",
  component: RulesScreen,
});

const dataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/data",
  component: DataScreen,
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  transactionsRoute,
  contactsRoute,
  categoriesRoute,
  rulesRoute,
  accountsRoute,
  dataRoute,
  settingsRoute,
]);

/**
 * Memory history in the app: this is a desktop window, not a browser tab, and
 * nothing should write app state into a URL bar the user never sees.
 *
 * The browser preview is the exception — there the address bar is the only way
 * to reach a screen directly, which is what makes the review harness able to
 * visit each one.
 */
const isPreview = import.meta.env.VITE_PREVIEW === "1";

export const router = createRouter({
  routeTree,
  history: isPreview ? createBrowserHistory() : createMemoryHistory({ initialEntries: ["/"] }),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
