const SUPPORTED_SLOTS = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"];

export const CATEGORIES = [
  { id: "all", label: "Alla", builtIn: true },
  { id: "top", label: "Överdelar", slot: "top", builtIn: true },
  { id: "bottom", label: "Underdelar", slot: "bottom", builtIn: true },
  { id: "dress", label: "Klänningar", slot: "dress", builtIn: true },
  { id: "jacket", label: "Jackor", slot: "outerwear", builtIn: true },
  { id: "coat", label: "Rockar", slot: "outerwear", builtIn: true },
  { id: "shoes", label: "Skor", slot: "shoes", builtIn: true },
  { id: "accessory", label: "Accessoarer", slot: "accessory", builtIn: true },
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

export const SLOT_OPTIONS = [
  { id: "top", label: "Överdelar" },
  { id: "bottom", label: "Underdelar" },
  { id: "dress", label: "Klänningar" },
  { id: "outerwear", label: "Ytterplagg" },
  { id: "shoes", label: "Skor" },
  { id: "accessory", label: "Accessoarer" },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category]),
);

export function slotForCategory(category) {
  return CATEGORY_BY_ID[category]?.slot ?? null;
}

export function normalizeCustomCategory(row) {
  if (
    !row
    || typeof row.id !== "string"
    || !row.id.trim()
    || typeof row.name !== "string"
    || !row.name.trim()
    || row.name.trim().length > 80
    || !SUPPORTED_SLOTS.includes(row.slot)
    || row.builtIn === true
  ) {
    throw new Error("Invalid custom wardrobe category.");
  }
  return {
    id: row.id,
    label: row.name.trim(),
    slot: row.slot,
    builtIn: false,
  };
}
