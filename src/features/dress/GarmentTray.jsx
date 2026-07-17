import { useMemo, useState } from "react";
import { CATEGORY_BY_ID, CATEGORIES } from "../../domain/slots.js";

function garmentName(item) {
  return item.name || CATEGORY_BY_ID[item.category]?.label || "Wardrobe item";
}

export function GarmentTray({ items, selectedIds, onSelect }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const visibleItems = useMemo(
    () => activeCategory === "all"
      ? items
      : items.filter((item) => item.category === activeCategory),
    [activeCategory, items],
  );
  const activeLabel = CATEGORY_BY_ID[activeCategory]?.label || "Items";

  return (
    <section className="garment-tray" aria-label="Garment tray">
      <div className="dress-category-chips" aria-label="Filter garments by category">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            className={activeCategory === category.id ? "active" : ""}
            onClick={() => setActiveCategory(category.id)}
            aria-pressed={activeCategory === category.id}
          >
            {category.label}
          </button>
        ))}
      </div>

      {visibleItems.length ? (
        <div className="garment-strip" aria-label={`${activeLabel} garments`}>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="garment-option"
              onClick={() => onSelect(item)}
              aria-label={`Select ${garmentName(item)}`}
              aria-pressed={selectedIds.has(item.id)}
            >
              {item.cutoutUrl ? <img src={item.cutoutUrl} alt="" /> : <span aria-hidden="true">—</span>}
              <span>{garmentName(item)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="garment-empty">No {activeLabel.toLowerCase()} in your wardrobe yet.</p>
      )}
    </section>
  );
}
