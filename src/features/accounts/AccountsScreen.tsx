/**
 * Tracked accounts.
 *
 * Removing an account offers an explicit choice, because the two outcomes are
 * very different: forgetting the address, or also discarding the cached
 * blockchain entries that belong only to it. Neither touches the blockchain.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { useSync } from "../../app/providers/sync-provider";
import { Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import {
  CopyButton,
  EmptyState,
  Modal,
  ModalClose,
  relativeTime,
  useToast,
} from "../../components";
import { validateTrackableAddress } from "../../stellar/validation";
import { StellarError } from "../../stellar/errors";
import { DuplicateAccountError } from "../../db/repositories";
import type { Network, TrackedAccount } from "../../db/schema";

export function AccountsScreen() {
  const workspace = useCurrentWorkspace();
  const { repositories, dataSourceFor } = useServices();
  const { syncNow, isSyncing } = useSync();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [network, setNetwork] = useState<Network>("public");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TrackedAccount | null>(null);

  const accounts = useQuery({
    queryKey: ["accounts", workspace.id],
    queryFn: () => repositories.accounts.listByWorkspace(workspace.id),
  });

  const counts = useQuery({
    queryKey: ["account-counts", workspace.id, accounts.data?.length],
    enabled: (accounts.data?.length ?? 0) > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        (accounts.data ?? []).map(
          async (account) => [account.id, await repositories.accounts.entryCount(account)] as const,
        ),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
  });

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const validation = validateTrackableAddress(address);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setAdding(true);
    try {
      await dataSourceFor(network).getAccount(validation.address);
      await repositories.accounts.create({
        workspaceId: workspace.id,
        publicKey: validation.address,
        network,
        label: label.trim() || null,
      });

      // A new owned account can turn existing history into internal transfers.
      const owned = await repositories.accounts.ownedAddresses(workspace.id, network);
      await repositories.entries.reresolveDirections(workspace.id, network, owned);

      setAddress("");
      setLabel("");
      await queryClient.invalidateQueries();
      toast.success(
        "Account added",
        "Importing its history now — existing transfers between your accounts have been reclassified.",
      );
      void syncNow();
    } catch (caught) {
      setError(
        caught instanceof DuplicateAccountError
          ? caught.message
          : caught instanceof StellarError
            ? caught.userMessage
            : caught instanceof Error
              ? caught.message
              : "Could not add this account.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function remove(account: TrackedAccount, withEntries: boolean) {
    if (withEntries) {
      await repositories.accounts.removeWithEntries(account);
    } else {
      await repositories.accounts.remove(account.id);
    }
    const owned = await repositories.accounts.ownedAddresses(workspace.id, account.network);
    await repositories.entries.reresolveDirections(workspace.id, account.network, owned);
    setRemoving(null);
    await queryClient.invalidateQueries();
    toast.success(
      "Account removed",
      withEntries
        ? "Tracking stopped and its cached entries were deleted. Nothing on the Stellar network changed."
        : "Tracking stopped. Imported entries were kept.",
    );
  }

  return (
    <div className="stack stack--lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">Public Stellar addresses this ledger watches.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Add a tracked account</h2>
          <span className="text-xs muted">Public addresses only</span>
        </div>
        <form className="panel__body row row--wrap" onSubmit={handleAdd}>
          <div className="field field--wide">
            <label className="field__label" htmlFor="new-address">
              Stellar public address
            </label>
            <input
              id="new-address"
              className="input mono"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="GABC…"
              spellCheck={false}
              autoComplete="off"
              disabled={adding}
            />
          </div>
          <div className="field field--medium">
            <label className="field__label" htmlFor="new-label">
              Label
            </label>
            <input
              id="new-label"
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Operations"
              disabled={adding}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="new-network">
              Network
            </label>
            <select
              id="new-network"
              className="select"
              value={network}
              onChange={(event) => setNetwork(event.target.value as Network)}
              disabled={adding}
            >
              <option value="public">Public</option>
              <option value="testnet">Testnet</option>
            </select>
          </div>
          <button type="submit" className="button button--primary self-end" disabled={adding}>
            <Plus size={13} aria-hidden="true" />
            {adding ? "Checking…" : "Add account"}
          </button>
          {error ? (
            <p className="field__error field--break" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </section>

      {(accounts.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Wallet size={20} />}
          title="No accounts tracked yet"
          description="Paste a public address above to start building this ledger."
        />
      ) : (
        <div className="grid-2">
          {accounts.data?.map((account) => (
            <section className="panel" key={account.id}>
              <div className="panel__header">
                <h2 className="panel__title">{account.label ?? "Untitled account"}</h2>
                <span className="tag">{account.network === "public" ? "Public" : "Testnet"}</span>
              </div>
              <div className="panel__body stack stack--sm">
                <div className="copyable">
                  <span className="mono text-xs break-anywhere">{account.publicKey}</span>
                  <CopyButton value={account.publicKey} label="account address" />
                </div>
                <dl className="detail-grid small">
                  <dt>Last synced</dt>
                  <dd>{relativeTime(account.lastSyncedAt)}</dd>
                  <dt>Ledger entries</dt>
                  <dd className="numeric align-start">
                    {(counts.data?.[account.id] ?? 0).toLocaleString()}
                  </dd>
                </dl>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void syncNow()}
                    disabled={isSyncing}
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {isSyncing ? "Syncing…" : "Sync"}
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => setRemoving(account)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {removing ? (
        <RemoveAccountDialog
          account={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

function RemoveAccountDialog({
  account,
  onCancel,
  onConfirm,
}: {
  account: TrackedAccount;
  onCancel: () => void;
  onConfirm: (account: TrackedAccount, withEntries: boolean) => Promise<void>;
}) {
  return (
    <Modal
      title={`Remove ${account.label ?? "this account"}?`}
      description="This only affects your local ledger. Nothing on the Stellar network changes."
      onClose={onCancel}
    >
      {/* Two genuinely different outcomes, so each is its own labelled choice
          rather than a single confirm with a checkbox. */}
      <button type="button" className="button" onClick={() => void onConfirm(account, false)}>
        <span className="grow align-start">
          Remove tracking only
          <span className="muted"> — keep imported entries</span>
        </span>
      </button>
      <button
        type="button"
        className="button button--danger"
        onClick={() => void onConfirm(account, true)}
      >
        <span className="grow align-start">
          Remove tracking and cached entries
          <span className="muted"> — only those belonging solely to this account</span>
        </span>
      </button>
      <ModalClose asChild>
        <button type="button" className="button button--subtle">
          Cancel
        </button>
      </ModalClose>
    </Modal>
  );
}
