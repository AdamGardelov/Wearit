import { useEffect, useRef, useState } from "react";
import { Archive, Check, X } from "@phosphor-icons/react";
import { CATEGORIES } from "../../domain/slots.js";
import { OptimizedImage } from "../../OptimizedImage.jsx";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 72) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((first, second) => second.count - first.count);
  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) {
      selected.push(color);
    }
    if (selected.length === 5) break;
  }
  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function splitValues(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function initialDraft(item) {
  return {
    ...item,
    name: item.name || "",
    category: item.category || "top",
    brand: item.brand || "",
    size: item.size || "",
    notes: item.notes || "",
  };
}

export function ItemEditorDialog({ item, onClose, onSave, onArchive, onRestoreFocus }) {
  const dialogRef = useRef(null);
  const nameInputRef = useRef(null);
  const [draft, setDraft] = useState(() => initialDraft(item));
  const [colorsText, setColorsText] = useState(() => (item.colors || []).join(", "));
  const [tagsText, setTagsText] = useState(() => (item.tags || []).join(", "));
  const [palette, setPalette] = useState(() => item.colors || []);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(initialDraft(item));
    setColorsText((item.colors || []).join(", "));
    setTagsText((item.tags || []).join(", "));
    setPalette(item.colors || []);
    setError("");
  }, [item]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    nameInputRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (onRestoreFocus) {
        onRestoreFocus(previouslyFocused);
      } else if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      if (!busyAction) {
        event.preventDefault();
        onClose();
      }
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

  const handleImageLoad = (event) => {
    try {
      const extracted = extractPalette(event.currentTarget);
      setPalette((current) => [...new Set([...current, ...extracted])].slice(0, 5));
    } catch {
      // Cross-origin storage policies can prevent canvas sampling; editing still works.
    }
  };

  const addPaletteColor = (color) => {
    const colors = splitValues(colorsText);
    if (colors.some((existing) => existing.toLowerCase() === color.toLowerCase())) return;
    setColorsText([...colors, color].join(", "));
  };

  const save = async (event) => {
    event.preventDefault();
    setError("");
    setBusyAction("save");
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        brand: draft.brand.trim(),
        size: draft.size.trim(),
        notes: draft.notes.trim(),
        colors: splitValues(colorsText),
        tags: splitValues(tagsText),
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Could not save this item.");
    } finally {
      setBusyAction(null);
    }
  };

  const archive = async () => {
    setError("");
    setBusyAction("archive");
    try {
      await onArchive(item.id);
    } catch (archiveError) {
      setError(archiveError.message || "Could not archive this item.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="viewer-overlay" role="presentation">
      <div className="viewer-entry">
        <aside
          ref={dialogRef}
          className="viewer editing"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${item.name || "wardrobe item"}`}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <button
            className="viewer-icon-close"
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            disabled={Boolean(busyAction)}
          >
            <X size={24} weight="light" aria-hidden="true" />
          </button>

          <div className="viewer-heading">
            <h2>{draft.name || "Wardrobe item"}</h2>
          </div>
          <div className="viewer-art">
            <OptimizedImage
              src={item.cutoutUrl}
              alt={item.name || "Wardrobe item"}
              sizes="(max-width: 520px) 70vw, 300px"
              breakpoints={[160, 240, 320, 480, 640]}
              priority
              crossOrigin="anonymous"
              onLoad={handleImageLoad}
            />
          </div>

          <form className="viewer-details editing" onSubmit={save}>
            <div className="item-editor">
              <label className="field">
                <span>Name</span>
                <input
                  ref={nameInputRef}
                  aria-label="Name"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  aria-label="Category"
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                >
                  {CATEGORIES.slice(1).map((category) => (
                    <option value={category.id} key={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Brand</span>
                <input
                  aria-label="Brand"
                  value={draft.brand}
                  onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Size</span>
                <input
                  aria-label="Size"
                  value={draft.size}
                  onChange={(event) => setDraft((current) => ({ ...current, size: event.target.value }))}
                />
              </label>
              <label className="field details-field">
                <span>Notes</span>
                <textarea
                  aria-label="Notes"
                  rows="3"
                  value={draft.notes}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <label className="field details-field">
                <span>Colors</span>
                <input
                  aria-label="Colors"
                  value={colorsText}
                  onChange={(event) => setColorsText(event.target.value)}
                  placeholder="#112233, #445566"
                />
              </label>
              {!!palette.length && (
                <div className="palette details-field" aria-label="Color suggestions from image">
                  {palette.map((color) => (
                    <button
                      type="button"
                      key={color}
                      style={{ backgroundColor: color }}
                      onClick={() => addPaletteColor(color)}
                      aria-label={`Add ${color} to colors`}
                      title={color}
                    />
                  ))}
                </div>
              )}
              <label className="field details-field">
                <span>Tags</span>
                <input
                  aria-label="Tags"
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="wool, casual"
                />
              </label>
            </div>

            {error && <p className="status error" role="alert">{error}</p>}
            <div className="viewer-actions">
              <button
                className="delete-button"
                type="button"
                onClick={archive}
                disabled={Boolean(busyAction)}
              >
                <Archive size={15} weight="regular" aria-hidden="true" />
                {busyAction === "archive" ? "Archiving…" : "Archive"}
              </button>
              <span className="action-spacer" />
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
                disabled={Boolean(busyAction)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={Boolean(busyAction)}>
                <Check size={15} weight="bold" aria-hidden="true" />
                {busyAction === "save" ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
