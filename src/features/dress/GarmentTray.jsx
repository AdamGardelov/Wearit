import { useMemo, useState } from "react";
import { CATEGORY_BY_ID, CATEGORIES } from "../../domain/slots.js";

function garmentName(item) {
  return item.name || CATEGORY_BY_ID[item.category]?.label || "Garderobsplagg";
}

export function GarmentTray({
  items,
  selectedIds,
  onSelect,
  itemFilter = () => true,
  renderFilter = null,
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  // Category availability comes from the complete item list, so the advanced filter can
  // never make a category chip disappear.
  const availableCategoryIds = useMemo(
    () => new Set(items.map((item) => item.category)),
    [items],
  );
  const visibleCategories = useMemo(
    () => CATEGORIES.filter((category) => category.id === "all" || availableCategoryIds.has(category.id)),
    [availableCategoryIds],
  );
  // Fall back to All only when the selected category no longer exists in complete items.
  const effectiveCategory = activeCategory === "all" || availableCategoryIds.has(activeCategory)
    ? activeCategory
    : "all";
  const categoryItems = useMemo(
    () => effectiveCategory === "all"
      ? items
      : items.filter((item) => item.category === effectiveCategory),
    [effectiveCategory, items],
  );
  // The advanced predicate narrows only the displayed strip; category state is untouched.
  const visibleItems = useMemo(
    () => categoryItems.filter((item) => itemFilter(item)),
    [categoryItems, itemFilter],
  );
  const activeLabel = CATEGORY_BY_ID[effectiveCategory]?.label || "Plagg";

  return (
    <section className="garment-tray" aria-label="Plagglåda">
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

      {renderFilter && (
        <div className="dress-tray-filter">
          {renderFilter({ visibleCount: visibleItems.length, totalCount: items.length })}
        </div>
      )}

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
      ) : categoryItems.length ? (
        <p className="garment-empty">Inga plagg matchar filtret.</p>
      ) : (
        <p className="garment-empty">Inga {activeLabel.toLowerCase()} i din garderob än.</p>
      )}
    </section>
  );
}
