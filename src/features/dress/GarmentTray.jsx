import { useMemo, useState } from "react";
import { CATEGORIES } from "../../domain/slots.js";

const SELECTED_CATEGORY_ID = "__selected__";
const SELECTED_CATEGORY = { id: SELECTED_CATEGORY_ID, label: "Valda" };

function garmentName(item, categoryById) {
  return item.name || categoryById[item.category]?.label || "Garderobsplagg";
}

export function GarmentTray({
  items,
  active = true,
  categories = CATEGORIES,
  selectedIds,
  onSelect,
  itemFilter = () => true,
  renderFilter = null,
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  const categoryList = categories?.length ? categories : CATEGORIES;
  const categoryById = useMemo(
    () => Object.fromEntries(categoryList.map((category) => [category.id, category])),
    [categoryList],
  );
  // Category availability comes from the complete item list, so the advanced filter can
  // never make a category chip disappear.
  const availableCategoryIds = useMemo(
    () => new Set(items.map((item) => item.category)),
    [items],
  );
  const visibleCategories = useMemo(
    () => {
      const available = categoryList.filter(
        (category) => category.id === "all" || availableCategoryIds.has(category.id),
      );
      if (!selectedIds.size) return available;
      const allIndex = available.findIndex((category) => category.id === "all");
      const insertAt = allIndex >= 0 ? allIndex + 1 : 0;
      return [
        ...available.slice(0, insertAt),
        SELECTED_CATEGORY,
        ...available.slice(insertAt),
      ];
    },
    [availableCategoryIds, categoryList, selectedIds],
  );
  // Fall back to All only when the selected category no longer exists in complete items.
  const effectiveCategory = activeCategory === SELECTED_CATEGORY_ID && selectedIds.size
    ? SELECTED_CATEGORY_ID
    : activeCategory === "all" || availableCategoryIds.has(activeCategory)
    ? activeCategory
    : "all";
  const categoryItems = useMemo(
    () => effectiveCategory === SELECTED_CATEGORY_ID
      ? items.filter((item) => selectedIds.has(item.id))
      : effectiveCategory === "all"
      ? items
      : items.filter((item) => item.category === effectiveCategory),
    [effectiveCategory, items, selectedIds],
  );
  // The advanced predicate narrows only the displayed strip; category state is untouched.
  const visibleItems = useMemo(
    () => categoryItems.filter((item) => itemFilter(item)),
    [categoryItems, itemFilter],
  );
  const activeLabel = effectiveCategory === SELECTED_CATEGORY_ID
    ? SELECTED_CATEGORY.label
    : categoryById[effectiveCategory]?.label || "Plagg";

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
          {visibleItems.map((item) => {
            const name = garmentName(item, categoryById);
            const selected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className="garment-option"
                onClick={() => onSelect(item)}
                aria-label={selected ? `${name}, valt` : `Välj ${name}`}
                aria-pressed={selected}
              >
                {active && item.cutoutUrl
                  ? (
                    <img
                      src={item.cutoutUrl}
                      alt=""
                      width="887"
                      height="1774"
                      loading="lazy"
                      decoding="async"
                    />
                  )
                  : <span aria-hidden="true">—</span>}
                <span className="garment-option-name">{name}</span>
                {selected && <span className="garment-selected-mark" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      ) : categoryItems.length ? (
        <p className="garment-empty">Inga plagg matchar filtret.</p>
      ) : (
        <p className="garment-empty">Inga {activeLabel.toLowerCase()} i din garderob än.</p>
      )}
    </section>
  );
}
