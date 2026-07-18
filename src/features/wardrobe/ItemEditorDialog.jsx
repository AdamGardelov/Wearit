import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CalendarCheck, Check, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import { CATEGORIES } from "../../domain/slots.js";
import { labelsByKind } from "../../domain/labels.js";
import { LabelPicker } from "../labels/LabelPicker.jsx";
import { ThemeManager } from "../labels/ThemeManager.jsx";
import { OptimizedImage } from "../../OptimizedImage.jsx";
import { ImageLightbox, viewLabel } from "./ImageLightbox.jsx";
import "./wardrobe.css";

function galleryImagesFor(item) {
  const productImages = (item.images ?? []).filter((image) => image.url);
  if (productImages.length) {
    return productImages.map((image) => ({ id: image.id, view: image.view, url: image.url }));
  }
  return item.cutoutUrl ? [{ id: "cutout", view: null, url: item.cutoutUrl }] : [];
}

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

export function ItemEditorDialog({
  item,
  onClose,
  onSave,
  onArchive,
  onMarkWorn,
  onRestoreFocus,
  labels = [],
  labelsLoading = false,
  labelsError = "",
  onCreateTheme,
  onRenameTheme,
  onDeleteTheme,
}) {
  const dialogRef = useRef(null);
  const nameInputRef = useRef(null);
  const [draft, setDraft] = useState(() => initialDraft(item));
  const [colorsText, setColorsText] = useState(() => (item.colors || []).join(", "));
  const [tagsText, setTagsText] = useState(() => (item.tags || []).join(", "));
  const [palette, setPalette] = useState(() => item.colors || []);
  const [selectedLabelIds, setSelectedLabelIds] = useState(() => item.labelIds ?? []);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const themes = useMemo(() => labelsByKind(labels).themes, [labels]);
  const labelsUnavailable = labelsLoading || Boolean(labelsError);

  const galleryImages = useMemo(() => galleryImagesFor(item), [item]);
  const safeIndex = Math.min(activeIndex, Math.max(galleryImages.length - 1, 0));
  const activeImage = galleryImages[safeIndex] ?? null;
  const hasMultiple = galleryImages.length > 1;

  useEffect(() => {
    setDraft(initialDraft(item));
    setColorsText((item.colors || []).join(", "));
    setTagsText((item.tags || []).join(", "));
    setPalette(item.colors || []);
    setSelectedLabelIds(item.labelIds ?? []);
    setError("");
    setActiveIndex(0);
    setLightboxOpen(false);
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

    if (
      !lightboxOpen
      && hasMultiple
      && (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActiveIndex((current) => (current + delta + galleryImages.length) % galleryImages.length);
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

  // Auto-select a freshly created theme; drop a deleted one from the unsaved selection.
  const createTheme = async (name) => {
    const theme = await onCreateTheme?.(name);
    if (theme?.id) setSelectedLabelIds((current) => [...new Set([...current, theme.id])]);
    return theme;
  };

  const deleteTheme = async (labelId) => {
    await onDeleteTheme?.(labelId);
    setSelectedLabelIds((current) => current.filter((id) => id !== labelId));
  };

  const save = async (event) => {
    event.preventDefault();
    if (labelsUnavailable) return;
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
        labelIds: selectedLabelIds,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Kunde inte spara plagget.");
    } finally {
      setBusyAction(null);
    }
  };

  const archive = async () => {
    setError("");
    setBusyAction("archive");
    try {
      await onArchive(item.id);
    } catch {
      setError("Ändringarna sparades inte. Försök igen.");
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
          aria-label={`Redigera ${item.name || "garderobsplagg"}`}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <button
            className="viewer-icon-close"
            type="button"
            onClick={onClose}
            aria-label="Stäng redigering"
            disabled={Boolean(busyAction)}
          >
            <X size={24} weight="light" aria-hidden="true" />
          </button>

          <div className="viewer-heading">
            <h2>{draft.name || "Garderobsplagg"}</h2>
          </div>
          <div className="item-gallery">
            {activeImage ? (
              <button
                type="button"
                className="gallery-active"
                onClick={() => setLightboxOpen(true)}
                aria-label={`Zooma ${item.name || "garderobsplagg"}${
                  activeImage.view ? `, ${viewLabel(activeImage.view)}` : ""
                }`}
              >
                <OptimizedImage
                  src={activeImage.url}
                  alt={item.name || "Garderobsplagg"}
                  sizes="(max-width: 520px) 70vw, 300px"
                  breakpoints={[160, 240, 320, 480, 640]}
                  priority
                  crossOrigin="anonymous"
                  onLoad={handleImageLoad}
                />
                <span className="gallery-zoom-hint" aria-hidden="true">
                  <MagnifyingGlassPlus size={16} weight="bold" />
                </span>
                {activeImage.view && (
                  <span className="gallery-view">{viewLabel(activeImage.view)}</span>
                )}
                {hasMultiple && (
                  <span className="gallery-counter" aria-hidden="true">
                    {safeIndex + 1} / {galleryImages.length}
                  </span>
                )}
              </button>
            ) : (
              <div className="gallery-empty" aria-hidden="true">Ingen bild</div>
            )}
            {hasMultiple && (
              <div className="gallery-thumbs" role="group" aria-label="Produktbilder">
                {galleryImages.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className={`gallery-thumb${index === safeIndex ? " active" : ""}`}
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Visa ${viewLabel(image.view) || "produkt"}bild ${index + 1}`}
                    aria-pressed={index === safeIndex}
                  >
                    <OptimizedImage
                      src={image.url}
                      alt=""
                      sizes="64px"
                      breakpoints={[64, 96, 128]}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <form className="viewer-details editing" onSubmit={save}>
            <p className="item-last-worn">
              Senast buren: {item.last_worn_at
                ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
                  .format(new Date(item.last_worn_at))
                : "Aldrig"}
            </p>
            <div className="item-editor">
              <label className="field">
                <span>Namn</span>
                <input
                  ref={nameInputRef}
                  aria-label="Namn"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Kategori</span>
                <select
                  aria-label="Kategori"
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                >
                  {CATEGORIES.slice(1).map((category) => (
                    <option value={category.id} key={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Märke</span>
                <input
                  aria-label="Märke"
                  value={draft.brand}
                  onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Storlek</span>
                <input
                  aria-label="Storlek"
                  value={draft.size}
                  onChange={(event) => setDraft((current) => ({ ...current, size: event.target.value }))}
                />
              </label>
              <label className="field details-field">
                <span>Anteckningar</span>
                <textarea
                  aria-label="Anteckningar"
                  rows="3"
                  value={draft.notes}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <label className="field details-field">
                <span>Färger</span>
                <input
                  aria-label="Färger"
                  value={colorsText}
                  onChange={(event) => setColorsText(event.target.value)}
                  placeholder="#112233, #445566"
                />
              </label>
              {!!palette.length && (
                <div className="palette details-field" aria-label="Färgförslag från bild">
                  {palette.map((color) => (
                    <button
                      type="button"
                      key={color}
                      style={{ backgroundColor: color }}
                      onClick={() => addPaletteColor(color)}
                      aria-label={`Lägg till ${color} i färger`}
                      title={color}
                    />
                  ))}
                </div>
              )}
              <label className="field details-field">
                <span>Taggar</span>
                <input
                  aria-label="Taggar"
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="ull, vardag"
                />
              </label>
              <div className="field details-field item-labels" role="group" aria-label="Etiketter">
                <span>Etiketter</span>
                {labelsLoading && <p className="label-status">Laddar etiketter…</p>}
                {labelsError && <p className="status error" role="alert">{labelsError}</p>}
                <LabelPicker
                  labels={labels}
                  selectedIds={selectedLabelIds}
                  onChange={setSelectedLabelIds}
                  disabled={Boolean(busyAction) || labelsLoading}
                />
                <ThemeManager
                  themes={themes}
                  onCreate={createTheme}
                  onRename={onRenameTheme}
                  onDelete={deleteTheme}
                  disabled={Boolean(busyAction)}
                />
              </div>
            </div>

            {error && <p className="status error" role="alert">{error}</p>}
            <div className="viewer-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onMarkWorn?.(item)}
                disabled={Boolean(busyAction)}
              >
                <CalendarCheck size={15} weight="regular" aria-hidden="true" />
                Markera buren
              </button>
              <button
                className="delete-button"
                type="button"
                onClick={archive}
                disabled={Boolean(busyAction)}
              >
                <Archive size={15} weight="regular" aria-hidden="true" />
                {busyAction === "archive" ? "Arkiverar…" : "Arkivera"}
              </button>
              <span className="action-spacer" />
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
                disabled={Boolean(busyAction)}
              >
                Avbryt
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={Boolean(busyAction) || labelsUnavailable}
              >
                <Check size={15} weight="bold" aria-hidden="true" />
                {busyAction === "save" ? "Sparar…" : "Spara"}
              </button>
            </div>
          </form>
        </aside>
      </div>
      {lightboxOpen && activeImage && (
        <ImageLightbox
          images={galleryImages}
          index={safeIndex}
          name={item.name || "Garderobsplagg"}
          onIndexChange={setActiveIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
