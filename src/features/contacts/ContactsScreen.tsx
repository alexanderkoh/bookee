/**
 * Contacts.
 *
 * A contact is a person or organisation with one or more Stellar addresses.
 * Assigning an address here makes every historical transaction involving it
 * display the name — resolved through a join at read time, so nothing is
 * rewritten and a rename propagates instantly.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "../../app/providers/app-context";
import { useCurrentWorkspace } from "../../app/providers/workspace-provider";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { CopyButton, EmptyState, Drawer, formatDate, shortAddress } from "../../components";
import { formatDisplay } from "../../lib/money";
import {
  AddressAlreadyAssignedError,
  type ContactSummary,
  type UnnamedCounterparty,
} from "../../db/repositories";
import { validateTrackableAddress } from "../../stellar/validation";
import { applyRules } from "../../ledger/apply-rules";

const UNNAMED_OPEN_SETTING = "bookee.unnamed-parties-open";

export function ContactsScreen() {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Address being named from the unknown-parties list. */
  const [naming, setNaming] = useState<{ address: string; memo: string | null } | null>(null);
  // Remembered, because a long worklist you have decided to ignore should stay
  // out of the way on the next visit too.
  const [showUnnamed, setShowUnnamed] = useState(
    () => localStorage.getItem(UNNAMED_OPEN_SETTING) !== "false",
  );

  useEffect(() => {
    localStorage.setItem(UNNAMED_OPEN_SETTING, String(showUnnamed));
  }, [showUnnamed]);

  const contacts = useQuery({
    queryKey: ["contacts", workspace.id],
    queryFn: () => repositories.contacts.listWithCounts(workspace.id),
  });

  const unnamed = useQuery({
    queryKey: ["unnamed-counterparties", workspace.id],
    queryFn: () => repositories.contacts.unnamedCounterparties(workspace.id),
  });

  const selected = contacts.data?.find((contact) => contact.id === selectedId) ?? null;

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">
            Naming an address makes it readable everywhere in your history.
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" />
          New contact
        </button>
      </div>

      {(contacts.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title="No contacts yet"
          description="Give an address a name and it will appear throughout your history — past and future."
          action={
            <button
              type="button"
              className="button button--primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} aria-hidden="true" />
              New contact
            </button>
          }
        />
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table className="table table--rows">
              <caption className="visually-hidden">Contacts in this ledger</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Organization</th>
                  <th scope="col" className="numeric">
                    Addresses
                  </th>
                  <th scope="col" className="numeric">
                    Transactions
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.data?.map((contact) => (
                  <tr
                    key={contact.id}
                    tabIndex={0}
                    aria-selected={selectedId === contact.id}
                    onClick={() => setSelectedId(contact.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(contact.id);
                      }
                    }}
                  >
                    <td>{contact.name}</td>
                    <td className="muted">{contact.organization ?? "—"}</td>
                    <td className="numeric">{contact.addressCount}</td>
                    <td className="numeric">{contact.entryCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(unnamed.data?.length ?? 0) > 0 ? (
        <section className="panel">
          <button
            type="button"
            className="panel__header panel__header--button"
            onClick={() => setShowUnnamed((open) => !open)}
            aria-expanded={showUnnamed}
            aria-controls="unnamed-parties"
          >
            <h2 className="panel__title">
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={showUnnamed ? "disclosure disclosure--open" : "disclosure"}
              />
              <UserPlus size={14} aria-hidden="true" />
              Unnamed parties
              <span className="tag tag--warning">{unnamed.data?.length}</span>
            </h2>
            <span className="text-xs muted">{showUnnamed ? "Hide" : "Show"}</span>
          </button>
          <div
            className="panel__body panel__body--flush"
            id="unnamed-parties"
            hidden={!showUnnamed}
          >
            <p className="field__hint unnamed-hint">
              Addresses your ledger has transacted with that nobody has named yet, busiest first.
              Naming one applies to every transaction with that address, past and future.
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Counterparties without a contact</caption>
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Activity</th>
                    <th scope="col">Assets</th>
                    <th scope="col">Last seen</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {unnamed.data?.map((party) => (
                    <UnnamedRow
                      key={`${party.address}:${party.memo ?? ""}`}
                      party={party}
                      onName={() => setNaming({ address: party.address, memo: party.memo })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {creating ? (
        <ContactForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await queryClient.invalidateQueries();
          }}
        />
      ) : null}

      {naming ? (
        <ContactForm
          initialAddress={naming.address}
          initialMemo={naming.memo}
          onClose={() => setNaming(null)}
          onSaved={async () => {
            setNaming(null);
            // The worklist shrinks by one; every entry with that address now
            // resolves to the new contact.
            await queryClient.invalidateQueries();
          }}
        />
      ) : null}

      {selected ? (
        <ContactDetail
          contact={selected}
          onClose={() => setSelectedId(null)}
          contacts={contacts.data ?? []}
        />
      ) : null}
    </div>
  );
}

function UnnamedRow({ party, onName }: { party: UnnamedCounterparty; onName: () => void }) {
  return (
    <tr>
      <td>
        <span className="stack stack--xs">
          <span className="row row--xs">
            <span className="mono" title={party.address}>
              {shortAddress(party.address, 8)}
            </span>
            <CopyButton value={party.address} label="counterparty address" />
          </span>
          {/* On a shared custodial address the memo is the only thing that
              says who was actually paid, so it sits with the address. */}
          {party.memo ? (
            <span className="text-2xs muted row row--xs">
              <span className="tag">memo</span>
              <span className="mono truncate" title={party.memo}>
                {party.memo}
              </span>
            </span>
          ) : null}
        </span>
      </td>
      <td className="nowrap">
        <span className="row row--sm text-xs">
          <span className="row row--xs">
            <ArrowDownLeft size={12} aria-hidden="true" className="amount--incoming" />
            {party.incomingCount}
          </span>
          <span className="row row--xs">
            <ArrowUpRight size={12} aria-hidden="true" className="amount--outgoing" />
            {party.outgoingCount}
          </span>
          <span className="muted">{party.entryCount} total</span>
        </span>
      </td>
      <td>
        <span className="row row--xs">
          {party.assetCodes.map((code) => (
            <span className="asset-chip" key={code}>
              {code}
            </span>
          ))}
        </span>
      </td>
      <td className="text-xs muted nowrap">{formatDate(party.lastSeen)}</td>
      <td className="numeric">
        <button type="button" className="button button--sm" onClick={onName}>
          Name this
        </button>
      </td>
    </tr>
  );
}

/** Create form, also used by the "Add contact" shortcut on a transaction. */
export function ContactForm({
  onClose,
  onSaved,
  initialAddress,
  initialMemo,
}: {
  onClose: () => void;
  onSaved: (contactId: string) => void | Promise<void>;
  initialAddress?: string;
  /** Prefilled when naming a party identified by memo on a shared address. */
  initialMemo?: string | null;
}) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();

  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [memo, setMemo] = useState(initialMemo ?? "");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = useQuery({
    queryKey: ["categories", workspace.id],
    queryFn: () => repositories.categories.list(workspace.id),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim() === "") {
      setError("Give the contact a name.");
      return;
    }

    const trimmed = address.trim();
    if (trimmed !== "") {
      const validation = validateTrackableAddress(trimmed);
      if (!validation.ok) {
        setError(validation.message);
        return;
      }
    }

    setSaving(true);
    try {
      const contact = await repositories.contacts.create({
        workspaceId: workspace.id,
        name: name.trim(),
        organization: organization.trim() || null,
        notes: notes.trim() || null,
        addresses: trimmed
          ? [{ network: "public", address: trimmed, memo: memo.trim() || null }]
          : [],
      });

      // A default category is expressed as a rule, so it keeps applying to
      // future transactions instead of being a one-off assignment.
      if (defaultCategoryId) {
        await repositories.rules.create({
          workspaceId: workspace.id,
          name: `${contact.name} → default category`,
          conditions: [{ field: "contact", operator: "equals", value: contact.id }],
          actions: [{ type: "set_category", value: defaultCategoryId }],
        });
        await applyRules(repositories, workspace.id);
      }

      await onSaved(contact.id);
    } catch (caught) {
      setError(
        caught instanceof AddressAlreadyAssignedError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Could not save the contact.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="New contact" onClose={onClose}>
      <form className="stack stack--md" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="contact-name">
            Name
          </label>
          <input
            id="contact-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            disabled={saving}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contact-org">
            Organization
          </label>
          <input
            id="contact-org"
            className="input"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            disabled={saving}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contact-address">
            Stellar address
          </label>
          <input
            id="contact-address"
            className="input mono"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="GABC…"
            spellCheck={false}
            disabled={saving}
          />
          <p className="field__hint">
            {memo.trim()
              ? "Only transactions carrying the memo below will show this contact."
              : "Every past and future transaction with this address will show this contact."}
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contact-memo">
            Memo <span className="subtle">(optional)</span>
          </label>
          <input
            id="contact-memo"
            className="input mono"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="Leave empty to match any memo"
            disabled={saving}
          />
          <p className="field__hint">
            Exchanges and custodians share one deposit address and tell customers apart by memo. Set
            it and this contact claims only that memo, so the same address can hold several
            different people.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contact-category">
            Default category
          </label>
          <select
            id="contact-category"
            className="select"
            value={defaultCategoryId}
            onChange={(event) => setDefaultCategoryId(event.target.value)}
            disabled={saving}
          >
            <option value="">None</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <p className="field__hint">
            Saved as a rule, so it also applies to transactions imported later.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contact-notes">
            Notes
          </label>
          <textarea
            id="contact-notes"
            className="textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={saving}
          />
        </div>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row">
          <button type="submit" className="button button--primary" disabled={saving}>
            {saving ? "Saving…" : "Save contact"}
          </button>
          <button type="button" className="button button--subtle" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function ContactDetail({
  contact,
  onClose,
  contacts,
}: {
  contact: ContactSummary;
  onClose: () => void;
  contacts: ContactSummary[];
}) {
  const workspace = useCurrentWorkspace();
  const repositories = useRepositories();
  const queryClient = useQueryClient();

  const [newAddress, setNewAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const addresses = useQuery({
    queryKey: ["contact-addresses", contact.id],
    queryFn: () => repositories.contacts.addresses(contact.id),
  });

  const activity = useQuery({
    queryKey: ["contact-activity", contact.id],
    queryFn: () => repositories.contacts.activity(workspace.id, contact.id),
  });

  async function refresh() {
    await queryClient.invalidateQueries();
  }

  async function addAddress() {
    setError(null);
    const validation = validateTrackableAddress(newAddress);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    try {
      await repositories.contacts.addAddress({
        contactId: contact.id,
        workspaceId: workspace.id,
        network: "public",
        address: validation.address,
      });
      setNewAddress("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the address.");
    }
  }

  return (
    <Drawer title={contact.name} onClose={onClose}>
      <section>
        <dl className="detail-grid">
          <dt>Organization</dt>
          <dd>{contact.organization ?? "—"}</dd>
          <dt>Notes</dt>
          <dd>{contact.notes ?? "—"}</dd>
        </dl>
      </section>

      <section>
        <h3 className="section-heading">Addresses</h3>
        {(addresses.data?.length ?? 0) === 0 ? (
          <p className="text-sm muted">No addresses yet.</p>
        ) : (
          <ul className="address-list mt-2">
            {addresses.data?.map((entry) => (
              <li key={entry.id}>
                <span className="stack stack--xs">
                  <span className="mono text-xs" title={entry.address}>
                    {shortAddress(entry.address, 8)}
                  </span>
                  {entry.memo ? (
                    <span className="text-2xs muted">
                      memo <span className="mono">{entry.memo}</span>
                    </span>
                  ) : null}
                </span>
                <span className="row row--xs">
                  <CopyButton value={entry.address} label="contact address" />
                  <button
                    type="button"
                    className="button button--subtle button--icon button--sm"
                    aria-label={`Remove ${entry.address}`}
                    onClick={async () => {
                      await repositories.contacts.removeAddress(entry.id);
                      await refresh();
                    }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          <input
            className="input mono grow"
            value={newAddress}
            onChange={(event) => setNewAddress(event.target.value)}
            placeholder="Add another address"
            spellCheck={false}
            aria-label="New address for this contact"
          />
          <button type="button" className="button" onClick={() => void addAddress()}>
            Add
          </button>
        </div>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="section-heading">Activity</h3>
        {(activity.data?.length ?? 0) === 0 ? (
          <p className="text-sm muted">No transactions with this contact yet.</p>
        ) : (
          <table className="table">
            <caption className="visually-hidden">Activity per asset</caption>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col" className="numeric">
                  In
                </th>
                <th scope="col" className="numeric">
                  Out
                </th>
                <th scope="col" className="numeric">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {activity.data?.map((row) => (
                <tr key={row.assetCode}>
                  <td>{row.assetCode}</td>
                  <td className="numeric">{formatDisplay(row.incoming)}</td>
                  <td className="numeric">{formatDisplay(row.outgoing)}</td>
                  <td className="numeric">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="field__hint mt-1">
          Shown per asset. Different assets are never added together.
        </p>
      </section>

      <section>
        <h3 className="section-heading">Merge</h3>
        <p className="field__hint mb-2">
          Moves another contact&apos;s addresses and transactions onto this one, then deletes it.
        </p>
        <div className="row">
          <select
            className="select grow"
            value={mergeTarget}
            onChange={(event) => setMergeTarget(event.target.value)}
            aria-label="Contact to merge into this one"
          >
            <option value="">Choose a contact…</option>
            {contacts
              .filter((candidate) => candidate.id !== contact.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="button"
            disabled={mergeTarget === ""}
            onClick={async () => {
              await repositories.contacts.merge(mergeTarget, contact.id);
              setMergeTarget("");
              await refresh();
            }}
          >
            Merge into {contact.name}
          </button>
        </div>
      </section>

      <section>
        <button
          type="button"
          className="button button--danger"
          onClick={async () => {
            await repositories.contacts.remove(contact.id);
            onClose();
            await refresh();
          }}
        >
          Delete contact
        </button>
        <p className="field__hint mt-1">
          Transactions are never deleted; they simply lose the name.
        </p>
      </section>
    </Drawer>
  );
}
