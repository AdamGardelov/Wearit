export const CATEGORIES = [
  { id: "all", label: "Alla" },
  { id: "top", label: "Överdelar", slot: "top" },
  { id: "bottom", label: "Underdelar", slot: "bottom" },
  { id: "dress", label: "Klänningar", slot: "dress" },
  { id: "jacket", label: "Jackor", slot: "outerwear" },
  { id: "coat", label: "Rockar", slot: "outerwear" },
  { id: "shoes", label: "Skor", slot: "shoes" },
  { id: "accessory", label: "Accessoarer", slot: "accessory" },
];

// Swedish labels for composition slots (used where an item is missing from an outfit).
export const SLOT_LABELS = {
  top: "överdel",
  bottom: "underdel",
  dress: "klänning",
  outerwear: "ytterplagg",
  shoes: "skor",
  accessory: "accessoar",
};

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category]),
);

export function slotForCategory(category) {
  return CATEGORY_BY_ID[category]?.slot ?? null;
}
