import { useEffect, useRef, useState } from "react";
import { Funnel, X } from "@phosphor-icons/react";
import { labelDisplayName, labelsByKind } from "../../domain/labels.js";
import {
  FILTER_GROUPS,
  ITEM_FILTER_GROUPS,
  activeAdvancedFilterCount,
  clearAdvancedFilterGroups,
  emptyAdvancedFilter,
  isAdvancedFilterActive,
  selectionKeyForGroup,
} from "../../domain/filters.js";

function ColorSwatch({ family }) {
  return (
    <span
      className="unified-filter-swatch"
      style={{ backgroundColor: family.swatch }}
      aria-hidden="true"
    />
  );
}

// One controlled advanced filter for Colour, Season, and Theme. `groups` scopes which
// sections, chips, badge count, and Clear all apply, so Outfits can retain a shared
// Colour selection without showing or applying it. Panel open/close is the only local
// state; the component never fetches, classifies, mutates, or persists.
export function UnifiedFilter({
  groups = ITEM_FILTER_GROUPS,
  colors = [],
  labels = [],
  value = emptyAdvancedFilter(),
  onChange,
  loading = false,
  error = "",
  visibleCount,
  totalCount,
  resultNoun = "plagg",
  context = "",
  align = "start",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  const usesColor = groups.includes(FILTER_GROUPS.COLOR);
  const usesSeason = groups.includes(FILTER_GROUPS.SEASON);
  const usesTheme = groups.includes(FILTER_GROUPS.THEME);
  const usesLabels = usesSeason || usesTheme;
  const { seasons, themes } = labelsByKind(labels);
  const selectedCount = activeAdvancedFilterCount(value, groups);
  const active = isAdvancedFilterActive(value, groups);
  const suffix = context ? ` – ${context}` : "";
  const showColor = usesColor && (colors.length >= 2 || value.selectedColorIds.length > 0);

  const colorById = new Map(colors.map((color) => [color.id, color]));
  const labelById = new Map(labels.map((label) => [label.id, label]));

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggle = (group, id) => {
    const key = selectionKeyForGroup(group);
    const selected = new Set(value[key]);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange?.({ ...value, [key]: [...selected] });
  };

  const remove = (group, id) => {
    const key = selectionKeyForGroup(group);
    onChange?.({ ...value, [key]: value[key].filter((entry) => entry !== id) });
  };

  const clearApplicable = () => onChange?.(clearAdvancedFilterGroups(value, groups));

  const handleKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeToTrigger();
    }
  };

  // Chips render in group order: Colour, Season, Theme, and only for applicable groups.
  const chips = [];
  if (usesColor) {
    for (const id of value.selectedColorIds) {
      const color = colorById.get(id);
      if (color) chips.push({ key: `c-${id}`, group: FILTER_GROUPS.COLOR, id, label: color.label, swatch: color.swatch });
    }
  }
  if (usesSeason) {
    for (const id of value.selectedSeasonIds) {
      const label = labelById.get(id);
      if (label) chips.push({ key: `s-${id}`, group: FILTER_GROUPS.SEASON, id, label: labelDisplayName(label) });
    }
  }
  if (usesTheme) {
    for (const id of value.selectedThemeIds) {
      const label = labelById.get(id);
      if (label) chips.push({ key: `t-${id}`, group: FILTER_GROUPS.THEME, id, label: labelDisplayName(label) });
    }
  }

  function labelFieldset(title, group, groupLabels) {
    if (!groupLabels.length) return null;
    const key = selectionKeyForGroup(group);
    return (
      <fieldset className="unified-filter-group">
        <legend>{title}</legend>
        {groupLabels.map((label) => {
          const checked = value[key].includes(label.id);
          return (
            <label key={label.id} className={`unified-filter-option${checked ? " checked" : ""}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(group, label.id)} />
              <span>{labelDisplayName(label)}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <div
      className={`unified-filter${align === "end" ? " unified-filter--end" : ""}`}
      ref={rootRef}
      onKeyDown={handleKeyDown}
    >
      <div className="unified-filter-bar">
        <button
          ref={triggerRef}
          type="button"
          className={`unified-filter-trigger${active ? " active" : ""}`}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`Filter${suffix}`}
        >
          <Funnel size={16} weight={active ? "fill" : "regular"} aria-hidden="true" />
          <span>Filter</span>
          {selectedCount > 0 && <span className="unified-filter-count" aria-hidden="true">{selectedCount}</span>}
        </button>
        {active && Number.isFinite(visibleCount) && Number.isFinite(totalCount) && (
          <span className="unified-filter-summary" role="status">{visibleCount} av {totalCount}</span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="unified-filter-chips">
          {chips.map((chip) => (
            <span key={chip.key} className="unified-filter-chip">
              {chip.swatch && <ColorSwatch family={{ swatch: chip.swatch }} />}
              {chip.label}
              <button
                type="button"
                onClick={() => remove(chip.group, chip.id)}
                aria-label={`Ta bort ${chip.label}`}
              >
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="unified-filter-clear" onClick={clearApplicable}>
            Rensa alla
          </button>
        </div>
      )}

      {open && (
        <div className="unified-filter-panel" role="group" aria-label={`Filter${suffix}`}>
          <div className="unified-filter-panel-header">
            <span>Filter</span>
            <button
              type="button"
              className="unified-filter-close"
              onClick={closeToTrigger}
              aria-label="Stäng filter"
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {showColor && (
            <fieldset className="unified-filter-group">
              <legend>Färg</legend>
              {colors.map((family) => {
                const checked = value.selectedColorIds.includes(family.id);
                return (
                  <label key={family.id} className={`unified-filter-option${checked ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(FILTER_GROUPS.COLOR, family.id)}
                    />
                    <ColorSwatch family={family} />
                    <span>{family.label}</span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {usesLabels && loading && <p className="unified-filter-status">Laddar etiketter…</p>}
          {usesLabels && error && <p className="unified-filter-status error" role="alert">{error}</p>}
          {usesLabels && !loading && !error && (
            <>
              {usesSeason && labelFieldset("Säsong", FILTER_GROUPS.SEASON, seasons)}
              {usesTheme && labelFieldset("Tema", FILTER_GROUPS.THEME, themes)}
            </>
          )}

          <button type="button" className="unified-filter-mobile-action" onClick={closeToTrigger}>
            Visa {Number.isFinite(visibleCount) ? visibleCount : totalCount} {resultNoun}
          </button>
        </div>
      )}
    </div>
  );
}
