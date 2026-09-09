/**
 * The "new version available" notice in the sidebar.
 *
 * Quiet by design: it appears only when a newer release exists, and it never
 * interrupts. Opening it explains what is available and, where the install can
 * take it, downloads and installs the signed build in place. Nothing is
 * fetched or written until the button is pressed.
 */
import { useEffect, useState } from "react";
import { ArrowUpCircle, Check, Download, ExternalLink, RotateCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal, ModalClose } from "../../components";
import { useUpdateCheck } from "./useUpdateCheck";
import { useUpdateInstall } from "./useUpdateInstall";
import { BRANDING } from "../../branding";

/** Whole percent downloaded, or null while the size is still unknown. */
function percent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((received / total) * 100));
}

export function UpdateNotice() {
  const { update, currentVersion } = useUpdateCheck();
  const [open, setOpen] = useState(false);
  const { state, prepare, install, restart } = useUpdateInstall();

  // Ask the updater what this install can actually do, but only once the
  // modal is open: an unopened notice should cost nothing.
  useEffect(() => {
    if (open && state.status === "idle") void prepare();
  }, [open, state.status, prepare]);

  if (!update) return null;

  const downloading = state.status === "downloading";
  const busy = downloading || state.status === "installing" || state.status === "checking";
  const done = state.status === "installed";
  const pct = downloading ? percent(state.received, state.total) : null;

  return (
    <>
      <button type="button" className="update-notice" onClick={() => setOpen(true)}>
        <ArrowUpCircle size={14} aria-hidden="true" />
        <span className="grow align-start">Version {update.version} available</span>
      </button>

      {open ? (
        <Modal
          title={`${BRANDING.appName} ${update.version} is available`}
          description={`You are running ${currentVersion}.`}
          // Closing mid-download would leave the install half-applied.
          onClose={busy ? () => undefined : () => setOpen(false)}
        >
          {update.notes && !done ? (
            <div className="panel panel--flat">
              <div className="panel__body">
                <p className="text-xs muted release-notes">{update.notes}</p>
              </div>
            </div>
          ) : null}

          {state.status === "failed" ? (
            <p className="field__error" role="alert">
              {state.message} Nothing was changed — the installed version is untouched.
            </p>
          ) : null}

          {downloading ? (
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={pct ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Downloading update"
            >
              <div
                className={
                  pct === null ? "progress__bar progress__bar--indeterminate" : "progress__bar"
                }
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
          ) : null}

          <p className="field__hint">
            {done
              ? `${update.version} is installed. It takes effect when ${BRANDING.appName} restarts — your ledger, contacts and rules stay where they are.`
              : state.status === "unsupported" || state.status === "failed"
                ? `This installation cannot replace itself — a system package manager owns it. Download the new version and install it the way you installed this one; your ledger, contacts and rules stay where they are.`
                : `The download is verified against ${BRANDING.appName}'s signing key before anything is replaced. Your ledger, contacts and rules stay where they are.`}
          </p>

          <div className="row row--end">
            {done ? (
              <>
                <ModalClose asChild>
                  <button type="button" className="button button--subtle">
                    Later
                  </button>
                </ModalClose>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void restart()}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Restart now
                </button>
              </>
            ) : (
              <>
                {busy ? null : (
                  <ModalClose asChild>
                    <button type="button" className="button button--subtle">
                      Not now
                    </button>
                  </ModalClose>
                )}

                {state.status === "ready" ? (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void install()}
                  >
                    <Download size={13} aria-hidden="true" />
                    Download and install
                  </button>
                ) : busy ? (
                  <button type="button" className="button button--primary" disabled>
                    {state.status === "checking"
                      ? "Checking…"
                      : state.status === "installing"
                        ? "Installing…"
                        : pct === null
                          ? "Downloading…"
                          : `Downloading ${pct}%`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void openUrl(update.url)}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    Open release page
                  </button>
                )}
              </>
            )}
          </div>

          {done ? (
            <p className="text-xs muted row">
              <Check size={12} aria-hidden="true" />
              Signature verified
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
