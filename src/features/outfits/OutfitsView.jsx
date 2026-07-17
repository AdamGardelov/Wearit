import { useEffect, useState } from "react";
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
}) {
  const [outfits, setOutfits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        if (mounted) setError(loadError.message || "Could not load saved outfits.");
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
        <h1>Saved combinations</h1>
        <span>{outfits.length} {outfits.length === 1 ? "look" : "looks"}</span>
      </header>

      {error && <p className="outfits-status error" role="alert">{error}</p>}
      {!error && loading && <p className="outfits-status">Loading outfits</p>}
      {!error && !loading && !outfits.length && (
        <p className="outfits-status">No saved outfits yet. Build one in Dress.</p>
      )}

      {!!outfits.length && (
        <section className="outfits-grid" aria-label="Saved outfits">
          {outfits.map((outfit) => {
            const archived = archivedItems(outfit);
            const unavailable = outfit.needs_attention || archived.length > 0;
            return (
              <article className={`outfit-card${unavailable ? " needs-attention" : ""}`} key={outfit.id}>
                <div className="outfit-thumbnail">
                  {outfit.thumbnailUrl ? (
                    <img src={outfit.thumbnailUrl} alt={outfit.name} />
                  ) : (
                    <span aria-hidden="true">No preview</span>
                  )}
                </div>
                <div className="outfit-card-copy">
                  <h2>{outfit.name}</h2>
                  <p>{outfit.items.length} pieces</p>
                  {archived.map((item) => (
                    <div className="outfit-attention" role="status" key={item.id}>
                      <span>Archived garment: {item.name || "Unnamed garment"}</span>
                      <strong>Missing {item.saved_slot || item.slot}</strong>
                    </div>
                  ))}
                  <div className="outfit-card-actions">
                    <button
                      type="button"
                      onClick={() => onLoad(outfit.items, outfit)}
                      disabled={unavailable}
                      aria-label={`Load ${outfit.name}`}
                    >
                      Load outfit
                    </button>
                    {onWear && (
                      <button
                        type="button"
                        className="outfit-wear-action"
                        onClick={() => onWear(outfit.items, outfit)}
                        disabled={unavailable}
                        aria-label={`Wear ${outfit.name}`}
                      >
                        Wear outfit
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
