import { useCallback, useEffect, useState } from "react";
import { WEEKDAYS, currentWeekday, emptyWeek } from "../../domain/weeklyPlan.js";
import { OutfitPickerDialog, outfitNeedsAttention } from "./OutfitPickerDialog.jsx";
import "./planner.css";

function weekdayLabel(weekday) {
  return WEEKDAYS.find((day) => day.value === weekday)?.label ?? "";
}

function WeekdayCard({ slot, isToday, busy, onChoose, onOpen, onWear, onRemove }) {
  const dayLabel = weekdayLabel(slot.weekday);
  const outfit = slot.outfit;
  const needsAttention = outfit ? outfitNeedsAttention(outfit) : false;

  return (
    <li className={`weekday-card${isToday ? " is-today" : ""}${needsAttention ? " needs-attention" : ""}`}>
      <div className="weekday-head">
        <h2>{dayLabel}</h2>
        {isToday && <span className="weekday-today">Idag</span>}
      </div>

      {!outfit ? (
        <button
          type="button"
          className="weekday-choose"
          onClick={onChoose}
          disabled={busy}
          aria-label={`Välj outfit för ${dayLabel}`}
        >
          Välj outfit
        </button>
      ) : (
        <div className="weekday-planned">
          <div className="weekday-thumb">
            {outfit.thumbnailUrl
              ? <img src={outfit.thumbnailUrl} alt="" />
              : <span aria-hidden="true">Ingen förhandsvisning</span>}
          </div>
          <p className="weekday-outfit-name">{outfit.name}</p>
          {needsAttention && <p className="weekday-attention" role="status">Behöver åtgärdas</p>}
          <div className="weekday-actions">
            <button
              type="button"
              onClick={() => onOpen(outfit.items, outfit)}
              disabled={busy}
              aria-label={`Öppna ${outfit.name}`}
            >
              Öppna
            </button>
            <button
              type="button"
              onClick={onChoose}
              disabled={busy}
              aria-label={`Byt outfit för ${dayLabel}`}
            >
              Byt outfit
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              aria-label={`Ta bort outfit från ${dayLabel}`}
            >
              Ta bort
            </button>
            {isToday && !needsAttention && (
              <button
                type="button"
                className="weekday-wear"
                onClick={() => onWear(outfit.items, outfit)}
                disabled={busy}
                aria-label={`Bär ${outfit.name} idag`}
              >
                Bär idag
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// Owns the undated Monday-to-Friday plan: loading, slot mutations, current-day presentation,
// and the outfit picker. App owns only section navigation and the wear-confirmation bridge.
export function WeekPlanner({
  repository,
  active = true,
  onLoad,
  onWear,
  colors = [],
  labels = [],
  advancedFilter,
  onAdvancedFilterChange,
  labelsLoading = false,
  labelsError = "",
  context = "Vecka",
  today = new Date(),
}) {
  const [slots, setSlots] = useState(() => emptyWeek());
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingDay, setEditingDay] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const todayWeekday = currentWeekday(today);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const plan = await repository.listWeeklyPlan();
      setSlots(plan);
      setLoaded(true);
    } catch (failure) {
      setError(failure.message || "Kunde inte ladda veckan.");
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    if (!active) return;
    reload();
  }, [active, reload]);

  // Mutations preserve the confirmed plan until the repository succeeds: state is only replaced
  // through a reload after a successful write, so a failed write leaves the plan untouched.
  const assignOutfit = async (outfit) => {
    setActionError("");
    setBusy(true);
    try {
      await repository.setWeeklyPlanSlot({ weekday: editingDay, outfitId: outfit.id });
      setEditingDay(null);
      await reload();
    } catch (failure) {
      setEditingDay(null);
      setActionError(failure.message || "Kunde inte spara outfiten. Försök igen.");
    } finally {
      setBusy(false);
    }
  };

  const removeOutfit = async (weekday) => {
    setActionError("");
    setBusy(true);
    try {
      await repository.clearWeeklyPlanSlot(weekday);
      await reload();
    } catch (failure) {
      setActionError(failure.message || "Kunde inte ta bort outfiten. Försök igen.");
    } finally {
      setBusy(false);
    }
  };

  const clearWeek = async () => {
    setActionError("");
    setBusy(true);
    try {
      await repository.clearWeeklyPlan();
      setConfirmingClear(false);
      await reload();
    } catch (failure) {
      setActionError(failure.message || "Kunde inte tömma veckan. Försök igen.");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = (weekday) => {
    setActionError("");
    setEditingDay(weekday);
  };

  return (
    <main className="week-planner" aria-busy={loading}>
      <header className="week-planner-header">
        <p>{context}</p>
        <h1>Min vecka</h1>
        <p className="week-planner-lead">
          Planen ligger kvar tills du ändrar den eller tömmer veckan.
        </p>
      </header>

      {error && (
        <div className="week-planner-status error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={reload}>Försök igen</button>
        </div>
      )}
      {actionError && <p className="week-planner-status error" role="alert">{actionError}</p>}
      {!error && loading && !loaded && (
        <p className="week-planner-status" role="status">Laddar veckan</p>
      )}

      {!error && loaded && (
        <>
          <ol className="week-planner-days">
            {slots.map((slot) => (
              <WeekdayCard
                key={slot.weekday}
                slot={slot}
                isToday={slot.weekday === todayWeekday}
                busy={busy}
                onChoose={() => openPicker(slot.weekday)}
                onOpen={onLoad}
                onWear={onWear}
                onRemove={() => removeOutfit(slot.weekday)}
              />
            ))}
          </ol>

          <div className="week-planner-clear">
            {confirmingClear ? (
              <div className="week-planner-clear-confirm" role="group" aria-label="Töm veckan">
                <p>Töm hela veckan? Sparade outfits och historik påverkas inte.</p>
                <div className="week-planner-clear-actions">
                  <button
                    type="button"
                    className="week-planner-clear-yes"
                    onClick={clearWeek}
                    disabled={busy}
                  >
                    {busy ? "Tömmer…" : "Töm veckan"}
                  </button>
                  <button type="button" onClick={() => setConfirmingClear(false)} disabled={busy}>
                    Avbryt
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="week-planner-clear-trigger"
                onClick={() => { setActionError(""); setConfirmingClear(true); }}
              >
                Töm veckan
              </button>
            )}
          </div>
        </>
      )}

      {editingDay !== null && (
        <OutfitPickerDialog
          weekday={editingDay}
          repository={repository}
          colors={colors}
          labels={labels}
          advancedFilter={advancedFilter}
          onAdvancedFilterChange={onAdvancedFilterChange}
          labelsLoading={labelsLoading}
          labelsError={labelsError}
          onSelect={assignOutfit}
          onClose={() => setEditingDay(null)}
        />
      )}
    </main>
  );
}
