/**
 * Downloading and installing an update in place.
 *
 * The companion to useUpdateCheck, which only ever *notices* a new release.
 * This is what replaces the installed binary, and it stays deliberately
 * unautomatic: nothing is fetched until the person presses the button, and
 * nothing is installed that Tauri cannot verify against the public key baked
 * into tauri.conf.json. A tampered or unsigned artifact fails the signature
 * check and is discarded rather than run.
 *
 * Not every install can update itself. A .deb or .rpm is owned by the system
 * package manager, and the browser preview has no binary at all, so those
 * report `unsupported` and the caller falls back to the release page.
 */
import { useCallback, useState } from "react";
import { createLogger } from "../../lib/log";

const log = createLogger("updates");

/** Mirrors the shape of the plugin's Update, without importing it eagerly. */
interface TauriUpdate {
  version: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
}

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type InstallState =
  | { status: "idle" }
  | { status: "checking" }
  /** No updater artifact applies to this install; use the release page. */
  | { status: "unsupported" }
  | { status: "ready"; version: string }
  | { status: "downloading"; received: number; total: number | null }
  | { status: "installing" }
  /** Written to disk; the new version is live only after a restart. */
  | { status: "installed" }
  | { status: "failed"; message: string };

/**
 * The updater APIs only exist inside the desktop shell. Importing them at
 * module scope would break the browser preview, so they are pulled in lazily
 * and a missing shell is treated as "cannot self-update" rather than an error.
 */
async function loadUpdater(): Promise<{ check: () => Promise<TauriUpdate | null> } | null> {
  if (import.meta.env.VITE_PREVIEW === "1") return null;
  try {
    return (await import("@tauri-apps/plugin-updater")) as unknown as {
      check: () => Promise<TauriUpdate | null>;
    };
  } catch {
    return null;
  }
}

export function useUpdateInstall(): {
  state: InstallState;
  /** Asks the updater whether this install can take the new version. */
  prepare: () => Promise<void>;
  /** Downloads, verifies and installs. Only call once prepare() said ready. */
  install: () => Promise<void>;
  /** Relaunches into the version just installed. */
  restart: () => Promise<void>;
} {
  const [state, setState] = useState<InstallState>({ status: "idle" });
  const [pending, setPending] = useState<TauriUpdate | null>(null);

  const prepare = useCallback(async () => {
    setState({ status: "checking" });
    const updater = await loadUpdater();
    if (!updater) {
      setState({ status: "unsupported" });
      return;
    }

    try {
      const update = await updater.check();
      if (!update) {
        // The notice is driven by the releases API, which can know about a
        // version before its updater manifest is reachable.
        setState({ status: "unsupported" });
        return;
      }
      setPending(update);
      setState({ status: "ready", version: update.version });
    } catch (error) {
      log.debug("updater check failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      setState({ status: "unsupported" });
    }
  }, []);

  const install = useCallback(async () => {
    if (!pending) return;

    let received = 0;
    let total: number | null = null;

    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setState({ status: "downloading", received: 0, total });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState({ status: "downloading", received, total });
        } else {
          setState({ status: "installing" });
        }
      });
      setState({ status: "installed" });
    } catch (error) {
      // A failed signature lands here too, which is the point: the old binary
      // is still the one on disk.
      const message = error instanceof Error ? error.message : "The update could not be installed.";
      log.debug("update install failed", { reason: message });
      setState({ status: "failed", message });
    }
  }, [pending]);

  const restart = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      log.debug("relaunch failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }, []);

  return { state, prepare, install, restart };
}
