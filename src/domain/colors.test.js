import { describe, expect, it } from "vitest";
import { availableColorFamilies, colorFamily, itemColorFamilies } from "./colors.js";

describe("colorFamily", () => {
  it.each([
    ["#000000", "black"],
    ["#1b2941", "blue"], // dark navy still reads as blue
    ["#8b8b8b", "grey"],
    ["#ffffff", "white"],
    ["#f5f0e6", "white"],
    ["#d4c19f", "beige"],
    ["#6b4a2b", "brown"],
    ["#c0392b", "red"],
    ["#e07b39", "orange"],
    ["#e6c229", "yellow"],
    ["#4a8c3f", "green"],
    ["#8fa34a", "green"], // olive stripe
    ["#2f5fb0", "blue"],
    ["#6b4a9c", "purple"],
    ["#d47ba8", "pink"],
  ])("maps %s to %s", (hex, family) => {
    expect(colorFamily(hex)).toBe(family);
  });

  it("supports shorthand hex and ignores unparseable values", () => {
    expect(colorFamily("#0a0")).toBe("green");
    expect(colorFamily("navy")).toBeNull();
    expect(colorFamily(null)).toBeNull();
  });
});

describe("itemColorFamilies", () => {
  it("collects the distinct families of an item's colours", () => {
    const families = itemColorFamilies({ colors: ["#1b2941", "#c0392b", "#2f5fb0"] });
    expect([...families].sort()).toEqual(["blue", "red"]);
  });

  it("returns an empty set for a colourless item", () => {
    expect(itemColorFamilies({}).size).toBe(0);
  });
});

describe("availableColorFamilies", () => {
  it("lists present families in canonical order without duplicates", () => {
    const items = [
      { colors: ["#2f5fb0"] }, // blue
      { colors: ["#c0392b", "#2f5fb0"] }, // red + blue
      { colors: ["#4a8c3f"] }, // green
    ];
    expect(availableColorFamilies(items).map((family) => family.id)).toEqual([
      "red",
      "green",
      "blue",
    ]);
  });
});
