import { describe, expect, it } from "vitest";
import {
  labelDisplayName,
  labelsByKind,
  sharedLabelIds,
} from "./labels.js";

const spring = { id: "s-spring", kind: "season", seasonKey: "spring", name: "Spring", locked: true };
const summer = { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true };
const autumn = { id: "s-autumn", kind: "season", seasonKey: "autumn", name: "Autumn", locked: true };
const winter = { id: "s-winter", kind: "season", seasonKey: "winter", name: "Winter", locked: true };
const rainy = { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false };
const birthday = { id: "t-bday", kind: "theme", seasonKey: null, name: "Birthday", locked: false };

describe("sharedLabelIds", () => {
  it("returns nothing for no items", () => {
    expect(sharedLabelIds([])).toEqual([]);
  });

  it("returns a single item's own labels", () => {
    expect(sharedLabelIds([{ labelIds: ["a", "b"] }]).sort()).toEqual(["a", "b"]);
  });

  it("returns the intersection across items", () => {
    expect(sharedLabelIds([
      { labelIds: ["a", "b", "c"] },
      { labelIds: ["b", "c"] },
      { labelIds: ["b"] },
    ])).toEqual(["b"]);
  });

  it("returns nothing when one item is unlabeled", () => {
    expect(sharedLabelIds([{ labelIds: ["a"] }, {}])).toEqual([]);
  });
});

describe("labelsByKind", () => {
  it("orders seasons Spring/Summer/Autumn/Winter regardless of input order", () => {
    const { seasons } = labelsByKind([winter, summer, autumn, spring]);
    expect(seasons.map((label) => label.seasonKey)).toEqual([
      "spring",
      "summer",
      "autumn",
      "winter",
    ]);
  });

  it("sorts themes by Swedish name", () => {
    const { themes } = labelsByKind([rainy, birthday]);
    expect(themes.map((label) => label.name)).toEqual(["Birthday", "Rainy day"]);
  });
});

describe("labelDisplayName", () => {
  it("localizes seasons and keeps theme names", () => {
    expect(labelDisplayName(summer)).toBe("Sommar");
    expect(labelDisplayName(spring)).toBe("Vår");
    expect(labelDisplayName(rainy)).toBe("Rainy day");
  });
});
