import { useEffect, useMemo, useRef, useState } from "react";
import { combinationKey, validateOutfit } from "../../domain/outfits.js";
import { renderOutfitThumbnail as defaultRenderThumbnail } from "./renderOutfitThumbnail.js";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function SaveOutfitDialog({
  items,
  sourceOutfit = null,
  repository,
  renderThumbnail = defaultRenderThumbnail,
  onSaved,
  onClose,
}) {
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const [name, setName] = useState(sourceOutfit?.name ?? "");
  const [outfits, setOutfits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [duplicateCheckError, setDuplicateCheckError] = useState("");
  const [saveError, setSaveError] = useState("");
  const validation = validateOutfit(items);
  const key = combinationKey(items);
  const exactOutfit = useMemo(
    () => outfits.find((outfit) => combinationKey(outfit.items) === key) ?? null,
    [key, outfits],
  );


  useEffect(() => {
    let mounted = true;
    repository.listOutfits()
      .then((loaded) => {
        if (mounted) {
          setOutfits(loaded);
          const exact = loaded.find((outfit) => combinationKey(outfit.items) === key);
          if (exact) {
            setName((current) => current.trim() ? current : exact.name);
          }
        }
      })
      .catch((loadError) => {
        if (mounted) setDuplicateCheckError(loadError.message || "Could not check saved outfits.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [key, repository]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const save = async (mode) => {
    if (!validation.valid || !name.trim() || busy || loading) return;
    setBusy(true);
    setSaveError("");
    try {
      const thumbnailBlob = await renderThumbnail(items, "/mannequin.svg");
      const id = exactOutfit?.id ?? (mode === "update" ? sourceOutfit?.id : undefined);
      const saved = await repository.saveOutfit({
        ...(id ? { id } : {}),
        name: name.trim(),
        items,
        thumbnailBlob,
      });
      onSaved(saved);
      onClose();
    } catch (saveError) {
      setSaveError(saveError.message || "Could not save this outfit.");
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    const focusable = dialog ? [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)] : [];
    if (!focusable.length) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const disabled = busy || loading || Boolean(duplicateCheckError) || !validation.valid || !name.trim();

  return (
    <div className="outfit-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="outfit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-outfit-heading"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <p>Outfit</p>
            <h2 id="save-outfit-heading">Save this combination</h2>
          </div>
          <button type="button" aria-label="Close save outfit dialog" onClick={onClose} disabled={busy}>×</button>
        </header>

        <label className="outfit-name-field">
          <span>Outfit name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Outfit name"
            maxLength="120"
            required
          />
        </label>

        {!validation.valid && <p className="outfit-validation" role="status">{validation.message}</p>}
        {exactOutfit && (
          <p className="outfit-duplicate" role="status">
            This combination is already saved as {exactOutfit.name}.
          </p>
        )}
        {duplicateCheckError && <p className="outfit-error" role="alert">{duplicateCheckError}</p>}
        {saveError && <p className="outfit-error" role="alert">{saveError}</p>}

        <div className="outfit-dialog-actions">
          <button type="button" className="outfit-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {exactOutfit ? (
            <button type="button" className="outfit-primary" onClick={() => save("update")} disabled={disabled}>
              {busy ? "Saving…" : "Update outfit"}
            </button>
          ) : sourceOutfit ? (
            <>
              <button type="button" className="outfit-secondary" onClick={() => save("update")} disabled={disabled}>
                Update outfit
              </button>
              <button type="button" className="outfit-primary" onClick={() => save("variation")} disabled={disabled}>
                {busy ? "Saving…" : "Save as new variation"}
              </button>
            </>
          ) : (
            <button type="button" className="outfit-primary" onClick={() => save("new")} disabled={disabled}>
              {busy ? "Saving…" : "Save outfit"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
