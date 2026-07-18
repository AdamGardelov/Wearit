import { useState } from "react";

// Owner theme CRUD with inline create, single-row rename, and a two-step in-UI delete
// confirmation (matching ImportAdminView rather than window.confirm). Server errors
// stay visible and preserve the attempted text.
export function ThemeManager({ themes = [], onCreate, onRename, onDelete, disabled = false }) {
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (event) => {
    event.preventDefault();
    if (busy) return;
    setCreateError("");
    setBusy(true);
    try {
      await onCreate?.(createName);
      setCreateName("");
    } catch (error) {
      setCreateError(error?.message || "Temat kunde inte skapas.");
    } finally {
      setBusy(false);
    }
  };

  const startRename = (theme) => {
    setRenamingId(theme.id);
    setRenameName(theme.name);
    setRenameError("");
    setConfirmingId(null);
  };

  const submitRename = async (event) => {
    event.preventDefault();
    if (busy) return;
    setRenameError("");
    setBusy(true);
    try {
      await onRename?.(renamingId, renameName);
      setRenamingId(null);
      setRenameName("");
    } catch (error) {
      setRenameError(error?.message || "Temat kunde inte byta namn.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (id) => {
    if (busy) return;
    setDeleteError("");
    setBusy(true);
    try {
      await onDelete?.(id);
      setConfirmingId(null);
    } catch (error) {
      setDeleteError(error?.message || "Temat kunde inte tas bort.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="theme-manager">
      <form className="theme-create" onSubmit={create}>
        <label className="theme-create-field">
          <span>Nytt tema</span>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            disabled={disabled || busy}
            aria-label="Nytt tema"
            placeholder="t.ex. Regn"
          />
        </label>
        <button type="submit" className="theme-create-submit" disabled={disabled || busy || !createName.trim()}>
          Skapa
        </button>
        {createError && <p className="theme-error" role="alert">{createError}</p>}
      </form>

      {themes.length > 0 && (
        <ul className="theme-list">
          {themes.map((theme) => (
            <li key={theme.id} className="theme-row">
              {renamingId === theme.id ? (
                <form className="theme-rename" onSubmit={submitRename}>
                  <input
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    disabled={busy}
                    aria-label={`Nytt namn för ${theme.name}`}
                  />
                  <button type="submit" disabled={busy || !renameName.trim()}>Spara</button>
                  <button type="button" onClick={() => setRenamingId(null)} disabled={busy}>Avbryt</button>
                  {renameError && <p className="theme-error" role="alert">{renameError}</p>}
                </form>
              ) : confirmingId === theme.id ? (
                <div className="theme-confirm" role="group" aria-label={`Bekräfta borttagning av ${theme.name}`}>
                  <p>Ta bort ”{theme.name}”? Kläder och outfits behålls.</p>
                  <div className="theme-confirm-actions">
                    <button type="button" className="theme-danger" onClick={() => confirmDelete(theme.id)} disabled={busy}>
                      Bekräfta borttagning
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)} disabled={busy}>Avbryt</button>
                  </div>
                  {deleteError && <p className="theme-error" role="alert">{deleteError}</p>}
                </div>
              ) : (
                <>
                  <span className="theme-name">{theme.name}</span>
                  <div className="theme-actions">
                    <button
                      type="button"
                      onClick={() => startRename(theme)}
                      disabled={disabled || busy}
                      aria-label={`Byt namn på ${theme.name}`}
                    >
                      Byt namn
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(theme.id);
                        setRenamingId(null);
                        setDeleteError("");
                      }}
                      disabled={disabled || busy}
                      aria-label={`Ta bort ${theme.name}`}
                    >
                      Ta bort
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
