import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  CATEGORY_BY_SOURCE_FOLDER,
  CATEGORY_DEFINITIONS,
  SLOT_LABELS,
  SLOT_OPTIONS,
  categoryForSourceFolder,
  defaultLayerOrderForCategory,
  normalizeCustomCategory,
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
    expect(CATEGORY_BY_ID.all).toEqual({ id: "all", label: "Alla", builtIn: true });
    expect(Object.isFrozen(CATEGORY_BY_ID.all)).toBe(true);
  });

  it("defines every category, source folder, slot, and default layer", () => {
    expect(CATEGORY_DEFINITIONS.map(({ id, sourceFolder, slot, layerOrder }) =>
      [id, sourceFolder, slot, layerOrder])).toEqual(EXPECTED);
    expect(CATEGORY_DEFINITIONS.every((category) => Object.isFrozen(category))).toBe(true);
    expect(CATEGORIES.every((category) => Object.isFrozen(category))).toBe(true);
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

describe("wardrobe categories", () => {
  it("marks every built-in category explicitly", () => {
    expect(CATEGORIES.every((category) => category.builtIn)).toBe(true);
    expect(CATEGORIES.find((category) => category.id === "top")).toEqual({ id: "top", label: "Överdelar", slot: "top", builtIn: true });
  });

  it("exposes supported mannequin slots with Swedish labels", () => {
    expect(SLOT_OPTIONS).toEqual([
      { id: "top", label: "Överdelar" }, { id: "bottom", label: "Underdelar" },
      { id: "dress", label: "Klänningar" }, { id: "outerwear", label: "Ytterplagg" },
      { id: "shoes", label: "Skor" }, { id: "accessory", label: "Accessoarer" },
    ]);
  });

  it("normalizes a valid custom category row", () => {
    expect(normalizeCustomCategory({ id: "category-1", name: " Kavajer ", slot: "outerwear" })).toEqual({
      id: "category-1", label: "Kavajer", slot: "outerwear", builtIn: false,
    });
  });

  // slot "hat" is a pipeline slot, not a custom-category slot: the database check
  // constraint rejects it, so normalizeCustomCategory must reject it too.
  it.each([null, {}, { id: "category-1", name: "Kavajer", slot: "hat" }, { id: "category-1", name: "", slot: "top" }])("rejects unsupported rows: %j", (row) => {
    expect(() => normalizeCustomCategory(row)).toThrow("Invalid custom wardrobe category");
  });

  it("keeps slotForCategory limited to built-ins", () => {
    expect(slotForCategory("top")).toBe("top");
    expect(slotForCategory("category-1")).toBeNull();
  });
});
