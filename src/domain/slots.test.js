import { describe, expect, it } from "vitest";
import { CATEGORIES, SLOT_OPTIONS, normalizeCustomCategory, slotForCategory } from "./slots.js";

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

  it.each([null, {}, { id: "category-1", name: "Kavajer", slot: "hat" }, { id: "category-1", name: "", slot: "top" }])("rejects unsupported rows: %j", (row) => {
    expect(() => normalizeCustomCategory(row)).toThrow("Invalid custom wardrobe category");
  });

  it("keeps slotForCategory limited to built-ins", () => {
    expect(slotForCategory("top")).toBe("top");
    expect(slotForCategory("category-1")).toBeNull();
  });
});
