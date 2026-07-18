import { useEffect, useMemo, useState } from "react";
import "./history.css";

function displayDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export function HistoryView({ repository, active = true, refreshKey = 0, onOpenItem = null }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return undefined;
    let mounted = true;
    setLoading(true);
    setError("");
    repository.listWearHistory()
      .then((loaded) => {
        if (mounted) setEvents(loaded);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || "Kunde inte ladda historiken.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [active, refreshKey, repository]);

  const orderedEvents = useMemo(
    () => [...events].sort((left, right) => (
      new Date(right.worn_at).getTime() - new Date(left.worn_at).getTime()
    )),
    [events],
  );

  return (
    <main className="history-view" aria-busy={loading}>
      <header className="history-header">
        <p>Historik</p>
        <h1>Vad du burit</h1>
        <span>{orderedEvents.length} {orderedEvents.length === 1 ? "gång" : "gånger"}</span>
      </header>
      {error && <p className="history-status error" role="alert">{error}</p>}
      {!error && loading && <p className="history-status">Laddar historik</p>}
      {!error && !loading && !orderedEvents.length && (
        <p className="history-status">Ingen historik än.</p>
      )}
      {!!orderedEvents.length && (
        <section className="history-list" aria-label="Historik">
          {orderedEvents.map((event) => (
            <article className="history-entry" key={event.id}>
              <div className="history-date">
                <time dateTime={event.worn_at}>{displayDate(event.worn_at)}</time>
                {event.outfit?.name && <span>{event.outfit.name}</span>}
              </div>
              <div className="history-copy">
                <h2>{event.items.length} plagg</h2>
                <ul>
                  {event.items.map((item) => {
                    const itemId = item.id || item.wardrobe_item_id;
                    const name = item.name || "Namnlöst plagg";
                    const archived = item.status === "archived";
                    // Archived garments are no longer in the active wardrobe, so they stay
                    // as plain text; everything else links back to its item.
                    return (
                      <li key={itemId}>
                        {onOpenItem && !archived ? (
                          <button
                            type="button"
                            className="history-item-link"
                            onClick={() => onOpenItem(itemId)}
                          >
                            {name}
                          </button>
                        ) : (
                          <span>{name}</span>
                        )}
                        {archived && <small>Arkiverat</small>}
                      </li>
                    );
                  })}
                </ul>
                {event.notes && <p>{event.notes}</p>}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
