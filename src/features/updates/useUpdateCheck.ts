/**
 * "A new version is available."
 *
 * Deliberately a *check*, not an auto-updater. Bookee never downloads or
 * installs anything by itself; it tells you a release exists and opens the page
 * so you decide. An application that silently replaces its own binary is a
 * different trust proposition to a read-only local ledger.
 *
 * This is the only request the application makes to a host other than Horizon,
 * so it is disclosed in Settings and can be switched off. It is a plain
 * unauthenticated GET to the public releases API: no identifier is sent, and
 * nothing about the ledger leaves the machine.
 */
import { useQuery } from "@tanstack/react-query";
import { useRepositories } from "../../app/providers/app-context";
import { isNewer } from "../../lib/version";
import { BRANDING } from "../../branding";
import { createLogger } from "../../lib/log";

const log = createLogger("updates");

export const UPDATE_CHECK_SETTING = "updates.check-enabled";
const LAST_SEEN_SETTING = "updates.last-seen-version";
/** Once a day is plenty for a desktop tool with no auto-install. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECKED_SETTING = "updates.last-checked-at";

export const CURRENT_VERSION = __APP_VERSION__;

export interface AvailableUpdate {
  version: string;
  url: string;
  notes: string;
  publishedAt: string | null;
}

/** Derives the releases API URL from the repository in branding. */
function releasesApiUrl(): string | null {
  const match = /github\.com\/([^/]+)\/([^/]+)/.exec(BRANDING.repositoryUrl);
  if (!match) return null;
  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export function useUpdateCheck(): {
  update: AvailableUpdate | null;
  enabled: boolean;
  currentVersion: string;
} {
  const repositories = useRepositories();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => repositories.settings.all(),
  });

  // Opt-out, not opt-in: people expect to be told a fix exists. The request is
  // disclosed in Settings and goes nowhere near the ledger.
  //
  // Never in the browser preview: there is no installed build to update, so the
  // request would be pure noise.
  const isPreview = import.meta.env.VITE_PREVIEW === "1";
  const enabled = !isPreview && settings.data?.[UPDATE_CHECK_SETTING] !== "false";

  const check = useQuery({
    queryKey: ["update-check"],
    enabled: settings.isFetched && enabled,
    staleTime: CHECK_INTERVAL_MS,
    gcTime: CHECK_INTERVAL_MS,
    retry: false,
    queryFn: async (): Promise<AvailableUpdate | null> => {
      const lastChecked = Number(settings.data?.[LAST_CHECKED_SETTING] ?? 0);
      const cachedVersion = settings.data?.[LAST_SEEN_SETTING];

      // Respect the interval across restarts, not just within a session.
      if (Date.now() - lastChecked < CHECK_INTERVAL_MS && cachedVersion) {
        return isNewer(cachedVersion, CURRENT_VERSION)
          ? {
              version: cachedVersion,
              url: `${BRANDING.repositoryUrl}/releases/latest`,
              notes: "",
              publishedAt: null,
            }
          : null;
      }

      const url = releasesApiUrl();
      if (!url) return null;

      try {
        const response = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
        // A repository with no releases yet answers 404; that is not an error.
        if (!response.ok) return null;

        const release = (await response.json()) as GitHubRelease;
        if (release.draft) return null;

        const tag = release.tag_name;
        if (!tag) return null;

        await repositories.settings.set(LAST_CHECKED_SETTING, String(Date.now()));
        await repositories.settings.set(LAST_SEEN_SETTING, tag);

        if (!isNewer(tag, CURRENT_VERSION)) return null;

        return {
          version: tag.replace(/^v/, ""),
          url: release.html_url ?? `${BRANDING.repositoryUrl}/releases/latest`,
          notes: (release.body ?? "").slice(0, 600),
          publishedAt: release.published_at ?? null,
        };
      } catch (error) {
        // Never let an update check interrupt anything.
        log.debug("update check failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        return null;
      }
    },
  });

  return {
    update: check.data ?? null,
    enabled,
    currentVersion: CURRENT_VERSION,
  };
}
