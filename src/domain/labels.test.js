import { describe, expect, it } from "vitest";
import {
  emptyLabelFilter,
  isLabelFilterActive,
  labelDisplayName,
  labelsByKind,
  matchesLabelFilter,
  sanitizeLabelFilter,
  sharedLabelIds,
} from "./labels.js";

const spring = { id: "s-spring", kind: "season", seasonKey: "spring", name: "Spring", locked: true };
const summer = { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true };
const autumn = { id: "s-autumn", kind: "season", seasonKey: "autumn", name: "Autumn", locked: true };
const winter = { id: "s-winter", kind: "season", seasonKey: "winter", name: "Winter", locked: true };
const rainy = { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false };
const birthday = { id: "t-bday", kind: "theme", seasonKey: null, name: "Birthday", locked: false };

function filter(overrides = {}) {
  return { ...emptyLabelFilter(), ...overrides };
}

describe("matchesLabelFilter", () => {
  it("matches every entry when no labels are selected", () => {
    expect(matchesLabelFilter({ labelIds: ["s-summer"] }, emptyLabelFilter())).toBe(true);
    expect(matchesLabelFilter({ labelIds: [] }, emptyLabelFilter())).toBe(true);
    expect(matchesLabelFilter({}, emptyLabelFilter())).toBe(true);
  });

  it("uses OR within the season group", () => {
    const active = filter({ selectedSeasonIds: ["s-summer", "s-winter"] });
    expect(matchesLabelFilter({ labelIds: ["s-summer"] }, active)).toBe(true);
    expect(matchesLabelFilter({ labelIds: ["s-winter"] }, active)).toBe(true);
    expect(matchesLabelFilter({ labelIds: ["s-spring"] }, active)).toBe(false);
  });

  it("uses OR within the theme group", () => {
    const active = filter({ selectedThemeIds: ["t-rainy", "t-bday"] });
    expect(matchesLabelFilter({ labelIds: ["t-rainy"] }, active)).toBe(true);
    expect(matchesLabelFilter({ labelIds: ["t-bday"] }, active)).toBe(true);
    expect(matchesLabelFilter({ labelIds: ["s-summer"] }, active)).toBe(false);
  });

  it("uses AND across the season and theme groups", () => {
    const active = filter({ selectedSeasonIds: ["s-summer"], selectedThemeIds: ["t-rainy"] });
    expect(matchesLabelFilter({ labelIds: ["s-summer", "t-rainy"] }, active)).toBe(true);
    expect(matchesLabelFilter({ labelIds: ["s-summer"] }, active)).toBe(false);
    expect(matchesLabelFilter({ labelIds: ["t-rainy"] }, active)).toBe(false);
    expect(matchesLabelFilter({ labelIds: ["s-summer", "t-bday"] }, active)).toBe(false);
  });

  it("hides unlabeled entries only when a filter is active", () => {
    expect(matchesLabelFilter({ labelIds: [] }, emptyLabelFilter())).toBe(true);
    expect(matchesLabelFilter({ labelIds: [] }, filter({ selectedSeasonIds: ["s-summer"] }))).toBe(false);
  });
});

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

describe("sanitizeLabelFilter", () => {
  it("removes deleted, unknown, duplicate, and wrong-kind ids", () => {
    const result = sanitizeLabelFilter(
      {
        selectedSeasonIds: ["s-summer", "s-summer", "unknown", "t-rainy"],
        selectedThemeIds: ["t-rainy", "deleted", "s-summer"],
      },
      [summer, rainy],
    );
    expect(result).toEqual({
      selectedSeasonIds: ["s-summer"],
      selectedThemeIds: ["t-rainy"],
    });
  });

  it("tolerates a missing filter", () => {
    expect(sanitizeLabelFilter(undefined, [summer])).toEqual(emptyLabelFilter());
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

describe("isLabelFilterActive", () => {
  it("is false when empty and true with any selection", () => {
    expect(isLabelFilterActive(emptyLabelFilter())).toBe(false);
    expect(isLabelFilterActive(filter({ selectedSeasonIds: ["s-summer"] }))).toBe(true);
    expect(isLabelFilterActive(filter({ selectedThemeIds: ["t-rainy"] }))).toBe(true);
  });
});
