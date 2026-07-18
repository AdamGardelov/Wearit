import { useEffect, useMemo, useRef, useState } from "react";
import {
  OUTFIT_FILTER_GROUPS,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
} from "../../domain/filters.js";
import { LAST_WORN_SORT, sortByLastWorn } from "../../domain/lastWorn.js";
import { WEEKDAYS } from "../../domain/weeklyPlan.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
import { LastWornSort, LastWornMeta } from "../sorting/LastWornSort.jsx";

function weekdayLabel(weekday) {
  return WEEKDAYS.find((day) => day.value === weekday)?.label ?? "";
}

// A saved outfit cannot be planned while any constituent item is unavailable.
export function outfitNeedsAttention(outfit) {
  return Boolean(outfit.needs_attention)
    || (outfit.items || []).some((item) => item.status === "archived");
}

// Controlled modal that reuses the saved-outfit presentation, the shared Season/Theme filter,
// and the last-worn sort. It selects only valid outfits; Needs-attention outfits stay visible
// but disabled with an explanation rather than disappearing.
export function OutfitPickerDialog({
  weekday,
  repository,
  colors = [],
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  onSelect,
  onClose,
}) {
  const [outfits, setOutfits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState(LAST_WORN_SORT.STANDARD);
  const dialogRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    repository.listOutfits()
      .then((loaded) => { if (mounted) setOutfits(loaded); })
      .catch((failure) => { if (mounted) setError(failure.message || "Kunde inte ladda outfits."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [repository]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const dayLabel = weekdayLabel(weekday);

  const filtered = useMemo(
    () => outfits.filter((outfit) => matchesAdvancedFilter(outfit, advancedFilter, OUTFIT_FILTER_GROUPS)),
    [outfits, advancedFilter],
  );
  const lastWornUnavailable = outfits.some((outfit) => outfit.last_worn_unavailable);
  const chronologicalRequested = sortOrder !== LAST_WORN_SORT.STANDARD;
  const effectiveSortOrder = chronologicalRequested && lastWornUnavailable
    ? LAST_WORN_SORT.STANDARD
    : sortOrder;
  const showLastWornMeta = effectiveSortOrder !== LAST_WORN_SORT.STANDARD;
  const visibleOutfits = useMemo(
    () => sortByLastWorn(filtered, effectiveSortOrder),
    [filtered, effectiveSortOrder],
  );

  const keyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="picker-backdrop"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        className="picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Välj outfit för ${dayLabel}`}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header className="picker-header">
          <div>
            <p>Vecka</p>
            <h2>Välj outfit för {dayLabel}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Stäng">×</button>
        </header>

        <div className="picker-toolbar">
          <LastWornSort value={sortOrder} onChange={setSortOrder} context={dayLabel} />
          <UnifiedFilter
            groups={OUTFIT_FILTER_GROUPS}
            colors={colors}
            labels={labels}
            value={advancedFilter}
            onChange={onAdvancedFilterChange}
            loading={labelsLoading}
            error={labelsError}
            visibleCount={visibleOutfits.length}
            totalCount={outfits.length}
            resultNoun="outfits"
            context={`Vecka ${dayLabel}`}
            align="end"
          />
        </div>
        {chronologicalRequested && lastWornUnavailable && (
          <p className="last-worn-alert" role="alert">Kunde inte ladda senast använd. Försök igen.</p>
        )}

        {error && <p className="picker-status error" role="alert">{error}</p>}
        {!error && loading && <p className="picker-status" role="status">Laddar outfits</p>}
        {!error && !loading && !outfits.length && (
          <p className="picker-status">Inga sparade outfits än. Skapa en under Styla.</p>
        )}
        {!error && !loading && !!outfits.length && !visibleOutfits.length && (
          <p className="picker-status">Inga outfits matchar filtret.</p>
        )}

        {!!visibleOutfits.length && (
          <ul className="picker-grid" aria-label={`Outfits för ${dayLabel}`}>
            {visibleOutfits.map((outfit) => {
              const disabled = outfitNeedsAttention(outfit);
              return (
                <li key={outfit.id} className={`picker-card${disabled ? " needs-attention" : ""}`}>
                  <button
                    type="button"
                    className="picker-choose"
                    onClick={() => onSelect(outfit)}
                    disabled={disabled}
                    aria-label={`Välj ${outfit.name} för ${dayLabel}`}
                  >
                    <span className="picker-thumb">
                      {outfit.thumbnailUrl
                        ? <img src={outfit.thumbnailUrl} alt="" />
                        : <span aria-hidden="true">Ingen förhandsvisning</span>}
                    </span>
                    <span className="picker-name">{outfit.name}</span>
                  </button>
                  {disabled && <p className="picker-attention" role="status">Behöver åtgärdas</p>}
                  {showLastWornMeta && <LastWornMeta value={outfit.last_worn_at} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
