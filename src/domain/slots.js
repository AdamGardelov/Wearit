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
]);

export const CATEGORIES = Object.freeze([
  { id: "all", label: "Alla" },
  ...CATEGORY_DEFINITIONS.map(({ id, label, slot }) => ({ id, label, slot })),
]);

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

export const slotForCategory = (category) => CATEGORY_BY_ID[category]?.slot ?? null;
export const categoryForSourceFolder = (folder) => CATEGORY_BY_SOURCE_FOLDER[folder]?.id ?? null;
export const defaultLayerOrderForCategory = (category) => CATEGORY_BY_ID[category]?.layerOrder ?? null;
