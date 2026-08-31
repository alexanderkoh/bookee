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
import { UserPlus } from "lucide-react";
import { Amount, CopyButton, Drawer, DirectionTag, formatDateTime } from "../../components";
import { ContactForm } from "../contacts/ContactsScreen";
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
