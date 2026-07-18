import { useEffect, useRef, useState } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function currentLocalDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function WearDialog({
  items,
  outfitId = null,
  onRecord,
  onClose,
}) {
  const dialogRef = useRef(null);
  const dateRef = useRef(null);
  const [dateValue, setDateValue] = useState(currentLocalDate);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dateRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onRecord({
        itemIds: items.map((item) => item.id),
        wornAt: new Date(dateValue + "T12:00:00").toISOString(),
        outfitId,
        notes: notes.trim() || null,
      });
      onClose();
    } catch {
      setError("Ändringarna sparades inte. Försök igen.");
    } finally {
      setSaving(false);
    }
  };

  const keyDown = (event) => {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current
      ? [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
      : [];
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (
      document.activeElement === first
      || !dialogRef.current.contains(document.activeElement)
    )) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (
      document.activeElement === last
      || !dialogRef.current.contains(document.activeElement)
    )) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="wear-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="wear-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Registrera användning"
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header>
          <div>
            <p>Historik</p>
            <h2>Registrera användning</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Stäng">
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label className="wear-field">
            <span>Buren den</span>
            <input
              ref={dateRef}
              type="date"
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              required
              disabled={saving}
            />
          </label>
          <div className="wear-selection">
            <span>Plagg</span>
            <ul>
              {items.map((item) => <li key={item.id}>{item.name || "Namnlöst plagg"}</li>)}
            </ul>
          </div>
          <label className="wear-field">
            <span>Anteckningar (valfritt)</span>
            <textarea
              rows="3"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={saving}
            />
          </label>
          {error && <p className="wear-error" role="alert">{error}</p>}
          <div className="wear-dialog-actions">
            <button type="button" onClick={onClose} disabled={saving}>Avbryt</button>
            <button className="wear-primary" type="submit" disabled={saving || !dateValue}>
              {saving ? "Registrerar…" : "Registrera"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
