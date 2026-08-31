import { useEffect, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenText,
  Database,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import { useRepositories } from "../providers/app-context";
import { useWorkspaces } from "../providers/workspace-provider";
import { RefreshButton, SyncStatus } from "./SyncStatus";
import { MarketRateTicker } from "../../features/prices/MarketRate";
import { WorkspaceSwitcher } from "../../features/workspaces/WorkspaceSwitcher";
import { UpdateNotice } from "../../features/updates/UpdateNotice";
import { CURRENT_VERSION } from "../../features/updates/useUpdateCheck";
import { BRANDING } from "../../branding";
import { BrandMark } from "../../assets/BrandMark";

const PRIMARY = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/transactions", label: "Ledger", icon: BookOpenText },
] as const;

const ORGANISE = [
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/rules", label: "Rules", icon: SlidersHorizontal },
] as const;

const MANAGE = [
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/data", label: "Data", icon: Database },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const SIDEBAR_SETTING = "bookee.sidebar-collapsed";

export function AppLayout() {
  const { workspace } = useWorkspaces();
  // Collapsed state is a workspace-independent preference, so it lives in
  // localStorage rather than the database.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_SETTING) === "true",
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_SETTING, String(collapsed));
  }, [collapsed]);
  const repositories = useRepositories();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // The ledger manages its own scrolling and fills the pane; every other screen
  // wants ordinary page padding.
  const isFlush = pathname.startsWith("/transactions");

  const unnamed = useQuery({
    queryKey: ["unnamed-count", workspace?.id],
    enabled: workspace !== null,
    queryFn: async () =>
      (await repositories.contacts.unnamedCounterparties(workspace!.id, 500)).length,
  });

  const uncategorized = useQuery({
    queryKey: ["uncategorized", workspace?.id],
    enabled: workspace !== null,
    queryFn: () => repositories.entries.uncategorizedCount(workspace!.id),
  });

  const badgeFor = (to: string) => {
    if (to === "/transactions" && (uncategorized.data ?? 0) > 0) return uncategorized.data;
    if (to === "/contacts" && (unnamed.data ?? 0) > 0) return unnamed.data;
    return null;
  };

  const renderLink = (item: { to: string; label: string; icon: typeof Wallet }) => {
    const badge = badgeFor(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        className="sidebar__link"
        activeOptions={{ exact: item.to === "/" }}
        activeProps={{ "data-status": "active" }}
        // Collapsed, the icon is all there is, so the name becomes the tooltip.
        title={collapsed ? item.label : undefined}
      >
        <item.icon size={15} aria-hidden="true" />
        {collapsed ? (
          <>
            <span className="visually-hidden">{item.label}</span>
            {badge !== null ? <span className="sidebar__dot" aria-hidden="true" /> : null}
          </>
        ) : (
          <>
            <span className="grow">{item.label}</span>
            {badge !== null ? <span className="tag tag--warning">{badge}</span> : null}
          </>
        )}
      </Link>
    );
  };

  return (
    <div className={collapsed ? "layout layout--collapsed" : "layout"}>
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <BrandMark size={22} />
          {collapsed ? null : <span className="grow truncate">{BRANDING.appName}</span>}
          <button
            type="button"
            className="button button--subtle button--icon button--sm sidebar__toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        {collapsed ? null : <WorkspaceSwitcher />}

        <div className="sidebar__nav mt-2">{PRIMARY.map(renderLink)}</div>

        {collapsed ? null : <div className="sidebar__section">Organise</div>}
        <div className="sidebar__nav">{ORGANISE.map(renderLink)}</div>

        {collapsed ? null : <div className="sidebar__section">Manage</div>}
        <div className="sidebar__nav">{MANAGE.map(renderLink)}</div>

        <div className="sidebar__footer">
          {collapsed ? (
            <p className="sidebar__meta sidebar__version">v{CURRENT_VERSION}</p>
          ) : (
            <>
              <UpdateNotice />
              <p className="sidebar__meta">Read-only · Local-first</p>
              <p className="sidebar__meta">
                <span className="sidebar__version">v{CURRENT_VERSION}</span>
              </p>
              <p className="sidebar__credit">Built by {BRANDING.studio}</p>
            </>
          )}
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1 className="topbar__title">{workspace?.name ?? BRANDING.appName}</h1>
          <div className="row row--sm">
            <MarketRateTicker />
            <SyncStatus />
            <RefreshButton />
          </div>
        </header>
        <div className={isFlush ? "content content--flush" : "content"}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
