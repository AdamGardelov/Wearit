import { useMemo, useState } from "react";
import { CATEGORY_BY_ID, CATEGORIES } from "../../domain/slots.js";

function garmentName(item) {
  return item.name || CATEGORY_BY_ID[item.category]?.label || "Garderobsplagg";
}

export function GarmentTray({ items, selectedIds, onSelect, filter = null }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const availableCategoryIds = useMemo(
    () => new Set(items.map((item) => item.category)),
    [items],
  );
  // Only show categories that hold garments; "all" is always available.
  const visibleCategories = useMemo(
    () => CATEGORIES.filter((category) => category.id === "all" || availableCategoryIds.has(category.id)),
    [availableCategoryIds],
  );
  const effectiveCategory = activeCategory === "all" || availableCategoryIds.has(activeCategory)
    ? activeCategory
    : "all";
  const visibleItems = useMemo(
    () => effectiveCategory === "all"
      ? items
      : items.filter((item) => item.category === effectiveCategory),
    [effectiveCategory, items],
  );
  const activeLabel = CATEGORY_BY_ID[effectiveCategory]?.label || "Plagg";

  return (
    <section className="garment-tray" aria-label="Plagglåda">
      {filter && <div className="dress-tray-filter">{filter}</div>}
      <div className="dress-category-chips" aria-label="Filtrera plagg efter kategori">
        {visibleCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={effectiveCategory === category.id ? "active" : ""}
            onClick={() => setActiveCategory(category.id)}
            aria-pressed={effectiveCategory === category.id}
          >
            {category.label}
          </button>
        ))}
      </div>

      {visibleItems.length ? (
        <div className="garment-strip" aria-label={activeLabel}>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="garment-option"
              onClick={() => onSelect(item)}
              aria-label={`Välj ${garmentName(item)}`}
              aria-pressed={selectedIds.has(item.id)}
            >
              {item.cutoutUrl ? <img src={item.cutoutUrl} alt="" /> : <span aria-hidden="true">—</span>}
              <span>{garmentName(item)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="garment-empty">Inga {activeLabel.toLowerCase()} i din garderob än.</p>
      )}
    </section>
  );
}
