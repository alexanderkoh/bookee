/**
 * The "new version available" notice in the sidebar.
 *
 * Quiet by design: it appears only when a newer release exists, and it never
 * interrupts. Opening it explains what is available and sends you to the
 * release page — Bookee does not update itself.
 */
import { useState } from "react";
import { ArrowUpCircle, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal, ModalClose } from "../../components";
import { useUpdateCheck } from "./useUpdateCheck";
import { BRANDING } from "../../branding";

export function UpdateNotice() {
  const { update, currentVersion } = useUpdateCheck();
  const [open, setOpen] = useState(false);

  if (!update) return null;

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
          onClose={() => setOpen(false)}
        >
          {update.notes ? (
            <div className="panel panel--flat">
              <div className="panel__body">
                <p className="text-xs muted release-notes">{update.notes}</p>
              </div>
            </div>
          ) : null}

          <p className="field__hint">
            {BRANDING.appName} does not update itself. Download the new version and replace the
            installed app — your ledger, contacts and rules stay where they are.
          </p>

          <div className="row row--end">
            <ModalClose asChild>
              <button type="button" className="button button--subtle">
                Not now
              </button>
            </ModalClose>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void openUrl(update.url)}
            >
              <ExternalLink size={13} aria-hidden="true" />
              Open release page
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
