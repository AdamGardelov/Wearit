import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_ID, CATEGORIES } from "../../domain/slots.js";
import { OptimizedImage } from "../../OptimizedImage.jsx";
import { ItemEditorDialog } from "./ItemEditorDialog.jsx";

function itemLabel(item) {
  return item.name || CATEGORY_BY_ID[item.category]?.label || "Wardrobe item";
}

function GalleryItem({ item, selected, onOpen, buttonRef }) {
  return (
    <button
      ref={buttonRef}
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`View ${itemLabel(item)}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <OptimizedImage
        src={item.cutoutUrl}
        alt=""
        sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
        breakpoints={[120, 180, 240, 320, 480]}
      />
    </button>
  );
}

export function WardrobeView({ repository, active = true }) {
  const galleryButtonRefs = useRef(new Map());
  const categoryButtonRefs = useRef(new Map());
  const returnFocusTargetRef = useRef(null);
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    repository.listItems()
      .then((loadedItems) => {
        if (mounted) setItems(loadedItems);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || "Could not load the wardrobe.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!active) setSelectedId(null);
  }, [active]);

  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const visibleItems = useMemo(
    () => activeCategory === "all"
      ? items
      : items.filter((item) => item.category === activeCategory),
    [activeCategory, items],
  );

  const openItem = (itemId) => {
    returnFocusTargetRef.current = galleryButtonRefs.current.get(itemId) ?? null;
    setSelectedId(itemId);
  };

  const restoreEditorFocus = (previouslyFocused) => {
    const preferredTarget = returnFocusTargetRef.current;
    const categoryFallback = categoryButtonRefs.current.get(activeCategory);
    const target = preferredTarget?.isConnected
      ? preferredTarget
      : categoryFallback?.isConnected
        ? categoryFallback
        : previouslyFocused?.isConnected
          ? previouslyFocused
          : null;

    if (typeof target?.focus === "function") target.focus();
  };

  const chooseCategory = (categoryId) => {
    setActiveCategory(categoryId);
    setSelectedId(null);
  };

  const saveItem = async (item) => {
    const requestRepository = repository;
    const savedItem = await repository.updateItem(item);
    if (repositoryRef.current !== requestRepository) return savedItem;
    setItems((current) => current.map((existing) => existing.id === item.id
      ? {
          ...existing,
          ...savedItem,
          cutoutUrl: savedItem.cutoutUrl ?? existing.cutoutUrl,
        }
      : existing));
    return savedItem;
  };

  const archiveItem = async (itemId) => {
    const requestRepository = repository;
    await repository.archiveItem(itemId);
    if (repositoryRef.current !== requestRepository) return;
    const selectedIndex = visibleItems.findIndex((item) => item.id === itemId);
    const fallbackItem = visibleItems[selectedIndex + 1] ?? visibleItems[selectedIndex - 1];
    returnFocusTargetRef.current = (
      (fallbackItem && galleryButtonRefs.current.get(fallbackItem.id))
      || categoryButtonRefs.current.get(activeCategory)
      || returnFocusTargetRef.current
    );
    setItems((current) => current.filter((item) => item.id !== itemId));
    setSelectedId(null);
  };

  const activeLabel = CATEGORY_BY_ID[activeCategory]?.label || "All";

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main
        className="gallery-pane"
        aria-busy={loading}
        aria-hidden={selectedItem ? "true" : undefined}
        inert={selectedItem ? true : undefined}
      >
        <header className="gallery-header">
          <div className="gallery-meta-row">
            <p className="piece-count">
              {items.length} {items.length === 1 ? "piece" : "pieces"}
            </p>
          </div>
          <nav className="category-nav" aria-label="Filter wardrobe by item type">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                ref={(node) => {
                  if (node) categoryButtonRefs.current.set(category.id, node);
                  else categoryButtonRefs.current.delete(category.id);
                }}
                type="button"
                className={activeCategory === category.id ? "active" : ""}
                onClick={() => chooseCategory(category.id)}
                aria-pressed={activeCategory === category.id}
              >
                {category.label}
              </button>
            ))}
          </nav>
        </header>

        {error && <p className="status error" role="alert">{error}</p>}
        {!error && loading && <p className="status">Loading wardrobe</p>}
        {!error && !loading && !items.length && (
          <p className="status empty">Your wardrobe is empty.</p>
        )}
        {!error && !loading && !!items.length && !visibleItems.length && (
          <p className="status empty">No {activeLabel.toLowerCase()} in your wardrobe.</p>
        )}

        {!!visibleItems.length && (
          <section className="gallery-grid" aria-label={`${activeLabel} wardrobe items`}>
            {visibleItems.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onOpen={openItem}
                buttonRef={(node) => {
                  if (node) galleryButtonRefs.current.set(item.id, node);
                  else galleryButtonRefs.current.delete(item.id);
                }}
              />
            ))}
          </section>
        )}
      </main>

      {selectedItem && (
        <ItemEditorDialog
          item={selectedItem}
          onClose={() => setSelectedId(null)}
          onSave={saveItem}
          onArchive={archiveItem}
          onRestoreFocus={restoreEditorFocus}
        />
      )}
    </div>
  );
}
