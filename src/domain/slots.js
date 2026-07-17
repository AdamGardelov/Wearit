export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "top", label: "Tops", slot: "top" },
  { id: "bottom", label: "Bottoms", slot: "bottom" },
  { id: "dress", label: "Dresses", slot: "dress" },
  { id: "jacket", label: "Jackets", slot: "outerwear" },
  { id: "coat", label: "Coats", slot: "outerwear" },
  { id: "shoes", label: "Shoes", slot: "shoes" },
  { id: "accessory", label: "Accessories", slot: "accessory" },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category]),
);

export function slotForCategory(category) {
  return CATEGORY_BY_ID[category]?.slot ?? null;
}
