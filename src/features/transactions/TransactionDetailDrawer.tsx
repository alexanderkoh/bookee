/**
 * Transaction detail.
 *
 * The blockchain half is strictly read-only; the human half writes to
 * entry_annotations. The two are visually separated so it is always obvious
 * which facts came from the chain and which are the user's own.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import { ShieldAlert, UserPlus } from "lucide-react";
import { Amount, CopyButton, Drawer, DirectionTag, formatDateTime } from "../../components";
import { ContactForm } from "../contacts/ContactsScreen";
import { markAssetAsSpam, markCounterpartyAsSpam } from "../../ledger/spam-triage";
import { useToast } from "../../components";
import type { LedgerEntryView } from "../../ledger/types";
import type { MemoType } from "../../db/schema";

/**
 * Renders a memo safely.
 *
 * Only text memos are shown as text. Hash and return memos are binary and
 * arrive base64-encoded, so they are labelled and shown as-is rather than
 * being forced through a UTF-8 interpretation.
 */
function MemoValue({ type, value }: { type: MemoType | null; value: string | null }) {
  if (!type || type === "none" || !value) return <span className="muted">None</span>;
  if (type === "text") return <span>{value}</span>;
  if (type === "id") return <span className="mono">{value}</span>;
  return (
    <span>
      <span className="tag">{type}</span> <span className="mono break-anywhere">{value}</span>
    </span>
  );
}

export function TransactionDetailDrawer({
  entry,
  onClose,
}: {
  entry: LedgerEntryView;
  onClose: () => void;
}) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();

  const [note, setNote] = useState(entry.note ?? "");
  const [saving, setSaving] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  useEffect(() => {
    setNote(entry.note ?? "");
  }, [entry.id, entry.note]);

  const categories = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });

  const contacts = useQuery({
    queryKey: ["contacts", workspace.id],
    queryFn: () => repositories.contacts.listWithCounts(workspace.id),
  });

  async function save(changes: Parameters<typeof repositories.annotations.setManual>[1]) {
    setSaving(true);
    try {
      await repositories.annotations.setManual(entry.id, changes);
      await queryClient.invalidateQueries();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Transaction"
      onClose={onClose}
      headerExtra={
        <div className="row row--sm">
          <DirectionTag direction={entry.direction} />
          <span className="text-xs muted">{entry.movementType.replace(/_/g, " ")}</span>
        </div>
      }
    >
      <section className="stack stack--xs">
        <Amount
          amount={entry.amount}
          assetCode={entry.assetCode}
          direction={entry.direction}
          size="lg"
        />
        <p className="text-xs muted">{formatDateTime(entry.timestamp)}</p>
      </section>

      <section>
        <h3 className="section-heading">Your notes</h3>
        <div className="stack stack--md">
          <div className="field">
            <label className="field__label" htmlFor="detail-contact">
              Contact
            </label>
            <div className="row">
              <select
                id="detail-contact"
                className="select grow"
                value={entry.contactId ?? ""}
                disabled={saving}
                onChange={(event) => void save({ contactId: event.target.value || null })}
              >
                <option value="">Unknown</option>
                {contacts.data?.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
              {/* The fast path: name an unknown address without leaving the
                  transaction. Saving claims the address, so every other entry
                  involving it resolves to the new contact immediately. */}
              {entry.counterpartyAddress && !entry.contactId ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setAddingContact(true)}
                  disabled={saving}
                >
                  <UserPlus size={13} aria-hidden="true" />
                  Add contact
                </button>
              ) : null}
            </div>
            {entry.contactId && entry.contactName ? (
              <p className="field__hint">Resolved for every transaction with this address.</p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="detail-category">
              Category
            </label>
            <select
              id="detail-category"
              className="select"
              value={entry.categoryId ?? ""}
              disabled={saving}
              onChange={(event) => void save({ categoryId: event.target.value || null })}
            >
              <option value="">Uncategorized</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji ? `${category.emoji}  ` : ""}
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="detail-note">
              Note
            </label>
            <textarea
              id="detail-note"
              className="textarea"
              value={note}
              disabled={saving}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                if (note !== (entry.note ?? "")) void save({ note: note || null });
              }}
              placeholder="Why this payment happened"
            />
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={entry.excluded}
              disabled={saving}
              onChange={(event) => void save({ excluded: event.target.checked })}
            />
            Exclude from reports
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={entry.reimbursable}
              disabled={saving}
              onChange={(event) => void save({ reimbursable: event.target.checked })}
            />
            Reimbursable
          </label>

          <SpamActions entry={entry} />
        </div>
      </section>

      <section>
        <h3 className="section-heading">On-chain</h3>
        <p className="text-xs muted mb-2">Recorded on the Stellar network and not editable.</p>
        <dl className="detail-grid">
          <dt>From</dt>
          <dd className="copyable">
            <span className="mono">{entry.fromAddress ?? "—"}</span>
            {entry.fromAddress ? (
              <CopyButton value={entry.fromAddress} label="sender address" />
            ) : null}
          </dd>

          <dt>To</dt>
          <dd className="copyable">
            <span className="mono">{entry.toAddress ?? "—"}</span>
            {entry.toAddress ? (
              <CopyButton value={entry.toAddress} label="recipient address" />
            ) : null}
          </dd>

          <dt>Counterparty</dt>
          <dd>
            {entry.contactName ? (
              <span>{entry.contactName}</span>
            ) : (
              <span className="mono">{entry.counterpartyAddress ?? "—"}</span>
            )}
          </dd>

          <dt>Asset</dt>
          <dd>
            {entry.assetCode}
            {entry.assetIssuer ? (
              <div className="mono text-xs muted break-anywhere">{entry.assetIssuer}</div>
            ) : null}
          </dd>

          <dt>Memo</dt>
          <dd>
            <MemoValue type={entry.memoType} value={entry.memoValue} />
          </dd>

          <dt>Transaction</dt>
          <dd className="copyable">
            <span className="mono break-anywhere">{entry.transactionHash ?? "—"}</span>
            {entry.transactionHash ? (
              <CopyButton value={entry.transactionHash} label="transaction hash" />
            ) : null}
          </dd>

          <dt>Operation ID</dt>
          <dd className="mono">{entry.operationId ?? "—"}</dd>

          <dt>Network</dt>
          <dd>{entry.network === "public" ? "Public" : "Testnet"}</dd>
        </dl>
      </section>

      {addingContact && entry.counterpartyAddress ? (
        <ContactForm
          initialAddress={entry.counterpartyAddress}
          onClose={() => setAddingContact(false)}
          onSaved={async () => {
            setAddingContact(false);
            await queryClient.invalidateQueries();
          }}
        />
      ) : null}
    </Drawer>
  );
}

/**
 * Marking spam from a transaction you are already looking at.
 *
 * Two scopes, because Stellar spam arrives in two shapes. A dust sender is one
 * address repeating itself; an airdropped token is hundreds of addresses
 * pushing the same worthless asset, and no per-sender marking would ever catch
 * up with it. Both write a rule, so both cover what arrives next month too.
 */
function SpamActions({ entry }: { entry: LedgerEntryView }) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [working, setWorking] = useState<"asset" | "sender" | null>(null);

  async function run(scope: "asset" | "sender") {
    setWorking(scope);
    try {
      const changed =
        scope === "asset"
          ? await markAssetAsSpam(repositories, workspace.id, {
              assetId: entry.assetId,
              assetCode: entry.assetCode,
            })
          : await markCounterpartyAsSpam(repositories, workspace.id, {
              address: entry.counterpartyAddress!,
              memo: entry.memoValue,
            });
      await queryClient.invalidateQueries();
      toast.success(
        "Marked as spam",
        `${changed} ${changed === 1 ? "entry" : "entries"} excluded. A rule now covers it — undo on the Rules screen.`,
      );
    } finally {
      setWorking(null);
    }
  }

  if (entry.exclusionReason === "spam") {
    return (
      <p className="field__hint">
        <ShieldAlert size={12} aria-hidden="true" /> Marked as spam by a rule. Delete that rule on
        the Rules screen to bring it back.
      </p>
    );
  }

  return (
    <div className="stack stack--sm">
      <p className="field__hint">
        Unsolicited dust? Marking writes a rule, so the next one is handled too.
      </p>
      <div className="row row--wrap row--sm">
        <button
          type="button"
          className="button button--danger"
          disabled={working !== null}
          onClick={() => void run("asset")}
        >
          {working === "asset" ? "Marking…" : `Spam: all ${entry.assetCode}`}
        </button>
        {entry.counterpartyAddress ? (
          <button
            type="button"
            className="button button--danger"
            disabled={working !== null}
            onClick={() => void run("sender")}
          >
            {working === "sender" ? "Marking…" : "Spam: this sender"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
