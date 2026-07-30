import { describe, expect, it } from "vitest";
import {
  CATEGORY_BY_ID,
  CATEGORY_BY_SOURCE_FOLDER,
  CATEGORY_DEFINITIONS,
  SLOT_LABELS,
  categoryForSourceFolder,
  defaultLayerOrderForCategory,
  slotForCategory,
} from "./slots.js";

const EXPECTED = [
  ["top", "Tops", "top", 20],
  ["bottom", "Bottoms", "bottom", 30],
  ["dress", "Dresses", "dress", 25],
  ["jacket", "Jackets", "outerwear", 40],
  ["coat", "Coats", "outerwear", 40],
  ["shoes", "Shoes", "shoes", 10],
  ["hat", "Hats", "hat", 70],
  ["belt", "Belts", "belt", 35],
  ["bag", "Bags", "bag", 60],
  ["scarf", "Scarves", "scarf", 50],
  ["accessory", "Accessories", "accessory", 80],
];

describe("category registry", () => {
  it("preserves the legacy all-category lookup entry", () => {
    expect(CATEGORY_BY_ID.all).toEqual({ id: "all", label: "Alla" });
  });

  it("defines every category, source folder, slot, and default layer", () => {
    expect(CATEGORY_DEFINITIONS.map(({ id, sourceFolder, slot, layerOrder }) =>
      [id, sourceFolder, slot, layerOrder])).toEqual(EXPECTED);
    for (const [id, folder, slot, layer] of EXPECTED) {
      expect(CATEGORY_BY_ID[id]).toMatchObject({ id, sourceFolder: folder, slot, layerOrder: layer });
      expect(CATEGORY_BY_SOURCE_FOLDER[folder].id).toBe(id);
      expect(categoryForSourceFolder(folder)).toBe(id);
      expect(slotForCategory(id)).toBe(slot);
      expect(defaultLayerOrderForCategory(id)).toBe(layer);
      expect(SLOT_LABELS[slot]).toBeTypeOf("string");
    }
  });
});
