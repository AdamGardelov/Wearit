import { useEffect } from "react";
import { labelDisplayName, labelsByKind } from "../../domain/labels.js";

// Controlled multi-select for assigning seasons/themes to an item or outfit. Labels
// are always addressed by id, never by display name, so renames are transparent.
export function LabelPicker({ labels = [], selectedIds = [], onChange, disabled = false }) {
  const { seasons, themes } = labelsByKind(labels);

  // Drop assignments whose label no longer exists (for example after a theme delete).
  useEffect(() => {
    const validIds = new Set(labels.map((label) => label.id));
    const filtered = selectedIds.filter((id) => validIds.has(id));
    if (filtered.length !== selectedIds.length) onChange?.(filtered);
    // Intentionally reacts to label changes only; a stale id is pruned once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  const toggle = (id) => {
    const current = new Set(selectedIds);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    onChange?.([...current]);
  };

  function group(title, groupLabels) {
    if (!groupLabels.length) return null;
    return (
      <fieldset className="label-picker-group">
        <legend>{title}</legend>
        <div className="label-picker-options">
          {groupLabels.map((label) => {
            const checked = selectedIds.includes(label.id);
            return (
              <label key={label.id} className={`label-picker-option${checked ? " checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(label.id)}
                />
                <span>{labelDisplayName(label)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="label-picker">
      {group("Säsong", seasons)}
      {group("Tema", themes)}
    </div>
  );
}
