import { useEffect, useMemo, useState } from "react";
import { SLOT_LABELS } from "../../domain/slots.js";
import {
  OUTFIT_FILTER_GROUPS,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
} from "../../domain/filters.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
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
  colors = [],
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  context = "",
}) {
  const [outfits, setOutfits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Saved outfits filter by their own saved labels, never by recomputing item labels or
  // colours. OUTFIT_FILTER_GROUPS restricts matching to Season and Theme, so a retained
  // Colour selection is ignored here even though it stays in the shared state.
  const visibleOutfits = useMemo(
    () => outfits.filter((outfit) => matchesAdvancedFilter(outfit, advancedFilter, OUTFIT_FILTER_GROUPS)),
    [outfits, advancedFilter],
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
          <span className="outfits-count">{outfits.length} {outfits.length === 1 ? "look" : "looker"}</span>
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
                  {archived.map((item) => {
                    const slot = item.saved_slot || item.slot;
                    return (
                      <div className="outfit-attention" role="status" key={item.id}>
                        <span>Arkiverat plagg: {item.name || "Namnlöst plagg"}</span>
                        <strong>Saknar {SLOT_LABELS[slot] || slot}</strong>
                      </div>
                    );
                  })}
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
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
