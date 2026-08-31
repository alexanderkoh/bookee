/**
 * Ledger switcher and creation.
 *
 * A workspace is one organisation's books. They are fully independent —
 * separate accounts, contacts, categories, rules and annotations — so switching
 * is a context change, not a filter.
 *
 * Creating one from here is what makes the multi-organisation data model
 * actually reachable; previously a second ledger could only arrive through a
 * backup import.
 */
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRepositories } from "../../app/providers/app-context";
import { useWorkspaces } from "../../app/providers/workspace-provider";
import { Modal, ModalClose, PopoverPanel, PopoverClose, useToast } from "../../components";

export function WorkspaceSwitcher() {
  const { workspaces, workspace, selectWorkspace } = useWorkspaces();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PopoverPanel
        align="start"
        width={232}
        trigger={
          <button type="button" className="workspace-trigger" aria-label="Switch ledger">
            <span className="truncate grow align-start">{workspace?.name ?? "No ledger"}</span>
            <ChevronsUpDown size={13} aria-hidden="true" />
          </button>
        }
      >
        <div className="menu">
          <p className="menu__label">Ledgers</p>
          {workspaces.map((candidate) => (
            <PopoverClose asChild key={candidate.id}>
              <button
                type="button"
                className="menu__item"
                aria-current={candidate.id === workspace?.id}
                onClick={() => selectWorkspace(candidate.id)}
              >
                <span className="menu__check" aria-hidden="true">
                  {candidate.id === workspace?.id ? <Check size={13} /> : null}
                </span>
                <span className="truncate">{candidate.name}</span>
              </button>
            </PopoverClose>
          ))}

          <div className="menu__separator" />

          <PopoverClose asChild>
            <button type="button" className="menu__item" onClick={() => setCreating(true)}>
              <span className="menu__check" aria-hidden="true">
                <Plus size={13} />
              </span>
              New ledger
            </button>
          </PopoverClose>
        </div>
      </PopoverPanel>

      {creating ? <NewWorkspaceDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const repositories = useRepositories();
  const { refresh, selectWorkspace } = useWorkspaces();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Give the ledger a name.");
      return;
    }

    setSaving(true);
    try {
      // Creating the workspace seeds its own chart of accounts, so it is
      // immediately usable rather than empty.
      const created = await repositories.workspaces.create({ name: name.trim() });
      await refresh();
      selectWorkspace(created.id);
      await queryClient.invalidateQueries();
      toast.success(`${created.name} created`, "Add a Stellar address to start importing.");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the ledger.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New ledger"
      description="A separate set of books, with its own accounts, contacts, categories and rules."
      onClose={onClose}
    >
      <form className="stack stack--md" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="workspace-name">
            Name
          </label>
          <input
            id="workspace-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Hoops Finance"
            autoFocus
            disabled={saving}
          />
          <p className="field__hint">
            Nothing is shared between ledgers — not accounts, not contacts, not categories.
          </p>
        </div>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row row--end">
          <ModalClose asChild>
            <button type="button" className="button button--subtle">
              Cancel
            </button>
          </ModalClose>
          <button type="submit" className="button button--primary" disabled={saving}>
            {saving ? "Creating…" : "Create ledger"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
