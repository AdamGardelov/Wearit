import { useEffect, useMemo, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { SLOT_LABELS } from "../../domain/slots.js";
import {
  OUTFIT_FILTER_GROUPS,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
} from "../../domain/filters.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
import { LastWornSort, LastWornMeta } from "../sorting/LastWornSort.jsx";
import { LAST_WORN_SORT, sortByLastWorn } from "../../domain/lastWorn.js";
import "./outfits.css";

function archivedItems(outfit) {
  return outfit.items.filter((item) => item.status === "archived");
}

export function OutfitsView({
  repository,
  active = true,
  refreshKey = 0,
  onLoad,
  onWear,
  onDeleted,
  colors = [],
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  context = "",
}) {
  const [outfits, setOutfits] = useState([]);
  const [sortOrder, setSortOrder] = useState(LAST_WORN_SORT.STANDARD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const canDelete = typeof repository.deleteOutfit === "function";

  const handleDelete = async (outfit) => {
    setDeletingId(outfit.id);
    setDeleteError("");
    try {
      await repository.deleteOutfit(outfit.id);
      setOutfits((current) => current.filter((entry) => entry.id !== outfit.id));
      setConfirmDeleteId(null);
      onDeleted?.(outfit.id);
    } catch (deleteFailure) {
      setDeleteError(deleteFailure.message || "Kunde inte ta bort outfiten.");
    } finally {
      setDeletingId(null);
    }
  };

  // Saved outfits filter by their own saved labels, never by recomputing item labels or
  // colours. OUTFIT_FILTER_GROUPS restricts matching to Season and Theme, so a retained
  // Colour selection is ignored here even though it stays in the shared state.
  const filteredOutfits = useMemo(
    () => outfits.filter((outfit) => matchesAdvancedFilter(outfit, advancedFilter, OUTFIT_FILTER_GROUPS)),
    [outfits, advancedFilter],
  );
  // A chronological order needs last-worn data; if it failed to load, keep Standard order and
  // show a non-destructive alert instead of a misleading order.
  const lastWornUnavailable = outfits.some((outfit) => outfit.last_worn_unavailable);
  const chronologicalRequested = sortOrder !== LAST_WORN_SORT.STANDARD;
  const effectiveSortOrder = chronologicalRequested && lastWornUnavailable
    ? LAST_WORN_SORT.STANDARD
    : sortOrder;
  const showLastWornMeta = effectiveSortOrder !== LAST_WORN_SORT.STANDARD;
  const visibleOutfits = useMemo(
    () => sortByLastWorn(filteredOutfits, effectiveSortOrder),
    [filteredOutfits, effectiveSortOrder],
  );

  useEffect(() => {
    if (!active) return undefined;
    let mounted = true;
    setLoading(true);
    setError("");
    repository.listOutfits()
      .then((loaded) => {
        if (mounted) setOutfits(loaded);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || "Kunde inte ladda sparade outfits.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [active, refreshKey, repository]);

  return (
    <main className="outfits-view" aria-busy={loading}>
      <header className="outfits-header">
        <p>Outfits</p>
        <h1>Sparade outfits</h1>
        <div className="outfits-toolbar">
          <span className="outfits-count">{outfits.length} {outfits.length === 1 ? "outfit" : "outfits"}</span>
          <div className="outfits-controls">
            <LastWornSort
              value={sortOrder}
              onChange={setSortOrder}
              context="outfits"
            />
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
              context={context}
              align="end"
            />
          </div>
        </div>
        {chronologicalRequested && lastWornUnavailable && (
          <p className="last-worn-alert" role="alert">
            Kunde inte ladda senast använd. Försök igen.
          </p>
        )}
      </header>

      {error && <p className="outfits-status error" role="alert">{error}</p>}
      {!error && loading && <p className="outfits-status">Laddar outfits</p>}
      {!error && !loading && !outfits.length && (
        <p className="outfits-status">Inga sparade outfits än. Skapa en under Styla.</p>
      )}
      {!error && !loading && !!outfits.length && !visibleOutfits.length && (
        <p className="outfits-status">Inga outfits matchar filtret.</p>
      )}

      {!!visibleOutfits.length && (
        <section className="outfits-grid" aria-label="Sparade outfits">
          {visibleOutfits.map((outfit) => {
            const archived = archivedItems(outfit);
            const unavailable = outfit.needs_attention || archived.length > 0;
            return (
              <article className={`outfit-card${unavailable ? " needs-attention" : ""}`} key={outfit.id}>
                {canDelete && confirmDeleteId !== outfit.id && (
                  <button
                    type="button"
                    className="outfit-delete-trigger"
                    onClick={() => { setDeleteError(""); setConfirmDeleteId(outfit.id); }}
                    aria-label={`Ta bort ${outfit.name}`}
                  >
                    <Trash size={15} weight="regular" aria-hidden="true" />
                  </button>
                )}
                <div className="outfit-thumbnail">
                  {outfit.thumbnailUrl ? (
                    <img src={outfit.thumbnailUrl} alt={outfit.name} />
                  ) : (
                    <span aria-hidden="true">Ingen förhandsvisning</span>
                  )}
                </div>
                <div className="outfit-card-copy">
                  <h2>{outfit.name}</h2>
                  <p>{outfit.items.length} plagg</p>
                  {showLastWornMeta && <LastWornMeta value={outfit.last_worn_at} />}
                  {archived.map((item) => {
                    const slot = item.saved_slot || item.slot;
                    return (
                      <div className="outfit-attention" role="status" key={item.id}>
                        <span>Arkiverat plagg: {item.name || "Namnlöst plagg"}</span>
                        <strong>Saknar {SLOT_LABELS[slot] || slot}</strong>
                      </div>
                    );
                  })}
                  {confirmDeleteId === outfit.id ? (
                    <div className="outfit-delete-confirm" role="group" aria-label={`Ta bort ${outfit.name}`}>
                      <p>Ta bort den här outfiten?</p>
                      {deleteError && <p className="outfit-error" role="alert">{deleteError}</p>}
                      <div className="outfit-delete-confirm-actions">
                        <button
                          type="button"
                          className="outfit-delete-confirm-yes"
                          onClick={() => handleDelete(outfit)}
                          disabled={deletingId === outfit.id}
                          aria-label={`Bekräfta borttagning av ${outfit.name}`}
                        >
                          {deletingId === outfit.id ? "Tar bort…" : "Ta bort"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setConfirmDeleteId(null); setDeleteError(""); }}
                          disabled={deletingId === outfit.id}
                        >
                          Avbryt
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="outfit-card-actions">
                      <button
                        type="button"
                        onClick={() => onLoad(outfit.items, outfit)}
                        disabled={unavailable}
                        aria-label={`Ladda ${outfit.name}`}
                      >
                        Ladda outfit
                      </button>
                      {onWear && (
                        <button
                          type="button"
                          className="outfit-wear-action"
                          onClick={() => onWear(outfit.items, outfit)}
                          disabled={unavailable}
                          aria-label={`Bär ${outfit.name}`}
                        >
                          Bär outfit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
