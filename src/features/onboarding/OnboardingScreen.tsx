/**
 * First launch.
 *
 * Creates a workspace and its first tracked account, then imports history.
 * The address is validated locally before any request, and the account is
 * checked against Horizon so a wrong network or a typo fails with a clear
 * message instead of an empty ledger.
 */
import { useState, type FormEvent } from "react";
import { useServices } from "../../app/providers/app-context";
import { useWorkspaces } from "../../app/providers/workspace-provider";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "../../assets/BrandMark";
import { BRANDING } from "../../branding";
import { validateTrackableAddress } from "../../stellar/validation";
import { StellarError } from "../../stellar/errors";
import { syncAccount, type SyncProgress } from "../../ledger/sync";
import type { Network } from "../../db/schema";

type Phase =
  | { step: "form" }
  | { step: "checking" }
  | { step: "importing"; progress: SyncProgress | null }
  | { step: "failed"; message: string };

export function OnboardingScreen() {
  const { repositories, dataSourceFor } = useServices();
  const { refresh, selectWorkspace } = useWorkspaces();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<Network>("public");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "form" });

  const busy = phase.step === "checking" || phase.step === "importing";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setAddressError(null);

    const validation = validateTrackableAddress(address);
    if (!validation.ok) {
      setAddressError(validation.message);
      return;
    }

    const ledgerName = name.trim() || "My Ledger";
    setPhase({ step: "checking" });

    try {
      const dataSource = dataSourceFor(network);
      // Verify the account exists before creating anything locally.
      await dataSource.getAccount(validation.address);

      const workspace = await repositories.workspaces.create({ name: ledgerName });
      const account = await repositories.accounts.create({
        workspaceId: workspace.id,
        publicKey: validation.address,
        network,
      });

      setPhase({ step: "importing", progress: null });
      await syncAccount({ repositories, dataSource }, account, {
        onProgress: (progress) => setPhase({ step: "importing", progress }),
      });

      await refresh();
      selectWorkspace(workspace.id);
    } catch (error) {
      const message =
        error instanceof StellarError
          ? error.userMessage
          : error instanceof Error
            ? error.message
            : "Something went wrong.";
      setPhase({ step: "failed", message });
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <BrandMark size={56} />
        <h1 className="onboarding__title mt-2">{BRANDING.appName}</h1>
        <p className="onboarding__tagline">{BRANDING.tagline}</p>

        <div className="onboarding__points">
          <span className="tag">
            <ShieldCheck size={11} aria-hidden="true" />
            Read-only
          </span>
          <span className="tag">Local-first</span>
          <span className="tag">No wallet connection</span>
        </div>

        {phase.step === "importing" ? (
          <ImportProgress progress={phase.progress} />
        ) : (
          <form onSubmit={handleSubmit} className="stack stack--md">
            <div className="field">
              <label className="field__label" htmlFor="ledger-name">
                Ledger name
              </label>
              <input
                id="ledger-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Tellus Cooperative"
                disabled={busy}
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="stellar-address">
                Stellar public address
              </label>
              <input
                id="stellar-address"
                className="input mono"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="GABC…"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                aria-invalid={addressError !== null}
                aria-describedby={addressError ? "address-error" : undefined}
              />
              {addressError ? (
                <p className="field__error" id="address-error" role="alert">
                  {addressError}
                </p>
              ) : null}
            </div>

            <fieldset className="field fieldset-reset">
              <legend className="field__label">Network</legend>
              <div className="radio-group">
                {(["public", "testnet"] as const).map((option) => (
                  <label key={option} className="checkbox">
                    <input
                      type="radio"
                      name="network"
                      value={option}
                      checked={network === option}
                      onChange={() => setNetwork(option)}
                      disabled={busy}
                    />
                    {option === "public" ? "Public" : "Testnet"}
                  </label>
                ))}
              </div>
            </fieldset>

            {phase.step === "failed" ? (
              <p className="field__error" role="alert">
                {phase.message}
              </p>
            ) : null}

            <button type="submit" className="button button--primary" disabled={busy}>
              {phase.step === "checking" ? "Checking account…" : "Create Ledger"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Import progress.
 *
 * Horizon does not report a total record count, so no percentage is shown —
 * an invented one would be a lie. The running count is the honest signal.
 */
function ImportProgress({ progress }: { progress: SyncProgress | null }) {
  return (
    <div className="stack stack--md" role="status" aria-live="polite">
      <h2 className="onboarding__title text-lg">Importing Stellar history</h2>
      <p className="muted">
        {progress ? `${progress.entriesImported} transactions imported…` : "Contacting Horizon…"}
      </p>
      <div className="progress">
        <div className="progress__bar progress__bar--indeterminate" />
      </div>
      {progress && progress.issues > 0 ? (
        <p className="text-sm muted">
          {progress.issues} record{progress.issues === 1 ? "" : "s"} need review — see Diagnostics.
        </p>
      ) : null}
    </div>
  );
}
