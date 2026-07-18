import { useEffect, useRef, useState } from "react";
import { Funnel, X } from "@phosphor-icons/react";
import {
  emptyLabelFilter,
  isLabelFilterActive,
  labelDisplayName,
  labelsByKind,
} from "../../domain/labels.js";

// Shared season/theme filter control. Controlled by `value` + `onChange`; the open
// panel and outside-click handling are local. `context` disambiguates the accessible
// names when Wardrobe, Dress, and Outfits each keep a mounted copy.
export function LabelFilter({
  labels = [],
  value = emptyLabelFilter(),
  onChange,
  loading = false,
  error = "",
  visibleCount,
  totalCount,
  context = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const { seasons, themes } = labelsByKind(labels);
  const active = isLabelFilterActive(value);
  const selectedCount = value.selectedSeasonIds.length + value.selectedThemeIds.length;
  const suffix = context ? ` – ${context}` : "";

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const toggle = (group, id) => {
    const current = new Set(value[group]);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    onChange?.({ ...value, [group]: [...current] });
  };

  const remove = (group, id) => {
    onChange?.({ ...value, [group]: value[group].filter((entry) => entry !== id) });
  };

  const labelById = new Map(labels.map((label) => [label.id, label]));
  const selectedChips = [
    ...value.selectedSeasonIds.map((id) => ({ group: "selectedSeasonIds", label: labelById.get(id) })),
    ...value.selectedThemeIds.map((id) => ({ group: "selectedThemeIds", label: labelById.get(id) })),
  ].filter((chip) => chip.label);

  const handleKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  function group(title, groupKey, groupLabels) {
    if (!groupLabels.length) return null;
    return (
      <fieldset className="label-filter-group">
        <legend>{title}</legend>
        {groupLabels.map((label) => {
          const checked = value[groupKey].includes(label.id);
          return (
            <label key={label.id} className={`label-filter-option${checked ? " checked" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(groupKey, label.id)}
              />
              <span>{labelDisplayName(label)}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <div className="label-filter" ref={rootRef} onKeyDown={handleKeyDown}>
      <div className="label-filter-bar">
        <button
          type="button"
          className={`label-filter-trigger${active ? " active" : ""}`}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`Filter${suffix}`}
        >
          <Funnel size={16} weight={active ? "fill" : "regular"} aria-hidden="true" />
          <span>Filter</span>
          {selectedCount > 0 && <span className="label-filter-count" aria-hidden="true">{selectedCount}</span>}
        </button>
        {active && Number.isFinite(visibleCount) && Number.isFinite(totalCount) && (
          <span className="label-filter-summary" role="status">{visibleCount} av {totalCount}</span>
        )}
      </div>

      {selectedChips.length > 0 && (
        <div className="label-filter-chips">
          {selectedChips.map(({ group: groupKey, label }) => (
            <span key={label.id} className="label-chip">
              {labelDisplayName(label)}
              <button
                type="button"
                onClick={() => remove(groupKey, label.id)}
                aria-label={`Ta bort ${labelDisplayName(label)}`}
              >
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="label-filter-clear" onClick={() => onChange?.(emptyLabelFilter())}>
            Rensa alla
          </button>
        </div>
      )}

      {open && (
        <div className="label-filter-panel" role="group" aria-label={`Etikettfilter${suffix}`}>
          {loading && <p className="label-filter-status">Laddar etiketter…</p>}
          {error && <p className="label-filter-status error" role="alert">{error}</p>}
          {!loading && !error && (
            <>
              {group("Säsong", "selectedSeasonIds", seasons)}
              {group("Tema", "selectedThemeIds", themes)}
              {!seasons.length && !themes.length && (
                <p className="label-filter-status">Inga etiketter ännu.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
