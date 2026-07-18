import { describe, expect, it } from "vitest";
import {
  ITEM_FILTER_GROUPS,
  OUTFIT_FILTER_GROUPS,
  activeAdvancedFilterCount,
  clearAdvancedFilterGroups,
  emptyAdvancedFilter,
  matchesAdvancedFilter,
  sanitizeAdvancedFilter,
} from "./filters.js";

const filter = (overrides = {}) => ({ ...emptyAdvancedFilter(), ...overrides });
const summer = { id: "s-summer", kind: "season" };
const rainy = { id: "t-rainy", kind: "theme" };

describe("matchesAdvancedFilter", () => {
  it("uses OR within colours and AND across colour, season, and theme", () => {
    const active = filter({
      selectedColorIds: ["black", "green"],
      selectedSeasonIds: [summer.id],
      selectedThemeIds: [rainy.id],
    });
    expect(matchesAdvancedFilter(
      { colors: ["#4a8c3f"], labelIds: [summer.id, rainy.id] },
      active,
    )).toBe(true);
    expect(matchesAdvancedFilter(
      { colors: ["#2f5fb0"], labelIds: [summer.id, rainy.id] },
      active,
    )).toBe(false);
    expect(matchesAdvancedFilter(
      { colors: ["#4a8c3f"], labelIds: [summer.id] },
      active,
    )).toBe(false);
  });

  it("ignores colour for outfit groups", () => {
    const active = filter({
      selectedColorIds: ["green"],
      selectedSeasonIds: [summer.id],
    });
    expect(matchesAdvancedFilter(
      { labelIds: [summer.id] },
      active,
      OUTFIT_FILTER_GROUPS,
    )).toBe(true);
  });
});

it("counts and clears only applicable groups", () => {
  const active = filter({
    selectedColorIds: ["black", "green"],
    selectedSeasonIds: [summer.id],
    selectedThemeIds: [rainy.id],
  });
  expect(activeAdvancedFilterCount(active, ITEM_FILTER_GROUPS)).toBe(4);
  expect(activeAdvancedFilterCount(active, OUTFIT_FILTER_GROUPS)).toBe(2);
  expect(clearAdvancedFilterGroups(active, OUTFIT_FILTER_GROUPS)).toEqual({
    selectedColorIds: ["black", "green"],
    selectedSeasonIds: [],
    selectedThemeIds: [],
  });
});

it("sanitizes only collections supplied by the caller", () => {
  const active = filter({
    selectedColorIds: ["green", "missing", "green"],
    selectedSeasonIds: [summer.id, rainy.id],
    selectedThemeIds: [rainy.id, summer.id],
  });
  expect(sanitizeAdvancedFilter(active, {
    colors: [{ id: "green" }],
    labels: [summer, rainy],
  })).toEqual({
    selectedColorIds: ["green"],
    selectedSeasonIds: [summer.id],
    selectedThemeIds: [rainy.id],
  });
  expect(sanitizeAdvancedFilter(active, { labels: [summer, rainy] }).selectedColorIds)
    .toEqual(["green", "missing"]);
});
