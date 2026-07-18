import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_ID, CATEGORIES } from "../../domain/slots.js";
import { availableColorFamilies } from "../../domain/colors.js";
import {
  ITEM_FILTER_GROUPS,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
} from "../../domain/filters.js";
import { UnifiedFilter } from "../filters/UnifiedFilter.jsx";
import { OptimizedImage } from "../../OptimizedImage.jsx";
import { ItemEditorDialog } from "./ItemEditorDialog.jsx";

function itemLabel(item) {
  return item.name || CATEGORY_BY_ID[item.category]?.label || "Garderobsplagg";
}

function GalleryItem({ item, selected, onOpen, buttonRef }) {
  return (
    <button
      ref={buttonRef}
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`Visa ${itemLabel(item)}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <OptimizedImage
        src={item.primaryImageUrl ?? item.cutoutUrl}
        alt=""
        sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
        breakpoints={[120, 180, 240, 320, 480]}
      />
    </button>
  );
}

export function WardrobeView({
  repository,
  active = true,
  onMarkWorn,
  colors = null,
  labels = [],
  advancedFilter = emptyAdvancedFilter(),
  onAdvancedFilterChange = () => {},
  labelsLoading = false,
  labelsError = "",
  onCreateTheme,
  onRenameTheme,
  onDeleteTheme,
  openItemId = null,
  onOpenItemHandled = () => {},
  context = "",
}) {
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
        if (mounted) setError(loadError.message || "Kunde inte ladda garderoben.");
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

  // Open a specific item's editor on request (e.g. followed from the History view). Wait for
  // the wardrobe to finish loading before giving up: an archived item is never in the active
  // list, so the request is simply cleared once loading settles.
  useEffect(() => {
    if (!openItemId) return;
    if (items.some((item) => item.id === openItemId)) {
      returnFocusTargetRef.current = galleryButtonRefs.current.get(openItemId) ?? null;
      setSelectedId(openItemId);
      onOpenItemHandled();
    } else if (!loading) {
      onOpenItemHandled();
    }
  }, [openItemId, items, loading, onOpenItemHandled]);

  const availableCategoryIds = useMemo(
    () => new Set(items.map((item) => item.category)),
    [items],
  );
  // Total garments per category from the complete list; "all" counts everything. Counts are
  // supplementary and aria-hidden so they never enter the button's accessible name.
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return counts;
  }, [items]);
  const categoryCount = (categoryId) => (categoryId === "all" ? items.length : categoryCounts.get(categoryId) ?? 0);
  // Only offer categories that actually hold garments; "all" is always present.
  const visibleCategories = useMemo(
    () => CATEGORIES.filter((category) => category.id === "all" || availableCategoryIds.has(category.id)),
    [availableCategoryIds],
  );
  // Fall back to local colours only when App does not supply the shared families (e.g. the
  // view rendered standalone in tests). Colours always come from the complete item list.
  const availableColors = useMemo(
    () => colors ?? availableColorFamilies(items),
    [colors, items],
  );

  // Drop a category that no longer has any garments behind it. Category availability stays
  // derived from complete items, so an advanced-filter selection can never hide a category.
  useEffect(() => {
    if (activeCategory !== "all" && !availableCategoryIds.has(activeCategory)) {
      setActiveCategory("all");
    }
  }, [availableCategoryIds, activeCategory]);

  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const visibleItems = useMemo(
    () => items.filter((item) => (
      (activeCategory === "all" || item.category === activeCategory)
      && matchesAdvancedFilter(item, advancedFilter, ITEM_FILTER_GROUPS)
    )),
    [activeCategory, advancedFilter, items],
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
    const remaining = items.filter((item) => item.id !== itemId);
    const activeCategoryStillPresent = activeCategory === "all"
      || remaining.some((item) => item.category === activeCategory);
    const selectedIndex = visibleItems.findIndex((item) => item.id === itemId);
    const fallbackItem = visibleItems[selectedIndex + 1] ?? visibleItems[selectedIndex - 1];
    const focusCategory = activeCategoryStillPresent ? activeCategory : "all";
    returnFocusTargetRef.current = (
      (fallbackItem && galleryButtonRefs.current.get(fallbackItem.id))
      || categoryButtonRefs.current.get(focusCategory)
      || returnFocusTargetRef.current
    );
    if (!activeCategoryStillPresent) setActiveCategory("all");
    setItems(remaining);
    setSelectedId(null);
  };

  const markWorn = (item) => {
    onMarkWorn?.([item]);
  };

  const activeLabel = CATEGORY_BY_ID[activeCategory]?.label || "Alla";

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
              {items.length} plagg
            </p>
          </div>
          <div className="wardrobe-toolbar">
            <nav className="category-nav" aria-label="Filtrera garderob efter typ">
              {visibleCategories.map((category) => (
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
                  <span className="category-count" aria-hidden="true">{categoryCount(category.id)}</span>
                </button>
              ))}
            </nav>
            <UnifiedFilter
              groups={ITEM_FILTER_GROUPS}
              colors={availableColors}
              labels={labels}
              value={advancedFilter}
              onChange={onAdvancedFilterChange}
              loading={labelsLoading}
              error={labelsError}
              visibleCount={visibleItems.length}
              totalCount={items.length}
              resultNoun="plagg"
              context={context}
              align="end"
            />
          </div>
        </header>

        {error && <p className="status error" role="alert">{error}</p>}
        {!error && loading && <p className="status">Laddar garderob</p>}
        {!error && !loading && !items.length && (
          <p className="status empty">Din garderob är tom.</p>
        )}
        {!error && !loading && !!items.length && !visibleItems.length && (
          <p className="status empty">Inga plagg matchar filtret.</p>
        )}

        {!!visibleItems.length && (
          <section className="gallery-grid" aria-label={`${activeLabel} i garderoben`}>
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
          onMarkWorn={markWorn}
          onRestoreFocus={restoreEditorFocus}
          labels={labels}
          labelsLoading={labelsLoading}
          labelsError={labelsError}
          onCreateTheme={onCreateTheme}
          onRenameTheme={onRenameTheme}
          onDeleteTheme={onDeleteTheme}
        />
      )}
    </div>
  );
}
