// Slots a user-created category may be assigned to. Must stay in sync with the
// widened check constraint in 202607300001_expand_wardrobe_categories.sql.
const SUPPORTED_SLOTS = [
  "top", "bottom", "dress", "outerwear", "shoes", "hat", "belt", "bag", "scarf", "accessory",
];

export const CATEGORY_DEFINITIONS = Object.freeze([
  { id: "top", label: "Överdelar", sourceFolder: "Tops", slot: "top", layerOrder: 20 },
  { id: "bottom", label: "Underdelar", sourceFolder: "Bottoms", slot: "bottom", layerOrder: 30 },
  { id: "dress", label: "Klänningar", sourceFolder: "Dresses", slot: "dress", layerOrder: 25 },
  { id: "jacket", label: "Jackor", sourceFolder: "Jackets", slot: "outerwear", layerOrder: 40 },
  { id: "coat", label: "Rockar", sourceFolder: "Coats", slot: "outerwear", layerOrder: 40 },
  { id: "shoes", label: "Skor", sourceFolder: "Shoes", slot: "shoes", layerOrder: 10 },
  { id: "hat", label: "Hattar", sourceFolder: "Hats", slot: "hat", layerOrder: 70 },
  { id: "belt", label: "Bälten", sourceFolder: "Belts", slot: "belt", layerOrder: 35 },
  { id: "bag", label: "Väskor", sourceFolder: "Bags", slot: "bag", layerOrder: 60 },
  { id: "scarf", label: "Halsdukar", sourceFolder: "Scarves", slot: "scarf", layerOrder: 50 },
  { id: "accessory", label: "Accessoarer", sourceFolder: "Accessories", slot: "accessory", layerOrder: 80 },
].map((category) => Object.freeze(category)));

export const CATEGORIES = Object.freeze([
  { id: "all", label: "Alla", builtIn: true },
  ...CATEGORY_DEFINITIONS.map(({ id, label, slot }) => ({ id, label, slot, builtIn: true })),
].map((category) => Object.freeze(category)));

export const CATEGORY_BY_ID = Object.freeze({
  all: CATEGORIES[0],
  ...Object.fromEntries(CATEGORY_DEFINITIONS.map((category) => [category.id, category])),
});

export const CATEGORY_BY_SOURCE_FOLDER = Object.freeze(
  Object.fromEntries(CATEGORY_DEFINITIONS.map((category) => [category.sourceFolder, category])),
);

// Swedish labels for composition slots (used where an item is missing from an outfit).
export const SLOT_LABELS = Object.freeze({
  top: "överdel",
  bottom: "underdel",
  dress: "klänning",
  outerwear: "ytterplagg",
  shoes: "skor",
  hat: "hatt",
  belt: "bälte",
  bag: "väska",
  scarf: "halsduk",
  accessory: "accessoar",
});

export const SLOT_ORDER = Object.freeze([
  "shoes", "dress", "top", "bottom", "belt", "outerwear", "scarf", "bag", "hat", "accessory",
]);

// Slot picker for the custom-category editor. Limited to SUPPORTED_SLOTS.
export const SLOT_OPTIONS = Object.freeze([
  { id: "top", label: "Överdelar" },
  { id: "bottom", label: "Underdelar" },
  { id: "dress", label: "Klänningar" },
  { id: "outerwear", label: "Ytterplagg" },
  { id: "shoes", label: "Skor" },
  { id: "hat", label: "Hattar" },
  { id: "belt", label: "Bälten" },
  { id: "bag", label: "Väskor" },
  { id: "scarf", label: "Halsdukar" },
  { id: "accessory", label: "Accessoarer" },
].map((option) => Object.freeze(option)));

export const slotForCategory = (category) => CATEGORY_BY_ID[category]?.slot ?? null;
export const categoryForSourceFolder = (folder) => CATEGORY_BY_SOURCE_FOLDER[folder]?.id ?? null;
export const defaultLayerOrderForCategory = (category) => CATEGORY_BY_ID[category]?.layerOrder ?? null;

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
