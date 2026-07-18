import { itemColorFamilies } from "./colors.js";

export const FILTER_GROUPS = Object.freeze({
  COLOR: "color",
  SEASON: "season",
  THEME: "theme",
});

export const ITEM_FILTER_GROUPS = Object.freeze([
  FILTER_GROUPS.COLOR,
  FILTER_GROUPS.SEASON,
  FILTER_GROUPS.THEME,
]);

export const OUTFIT_FILTER_GROUPS = Object.freeze([
  FILTER_GROUPS.SEASON,
  FILTER_GROUPS.THEME,
]);

const SELECTION_KEY = Object.freeze({
  [FILTER_GROUPS.COLOR]: "selectedColorIds",
  [FILTER_GROUPS.SEASON]: "selectedSeasonIds",
  [FILTER_GROUPS.THEME]: "selectedThemeIds",
});

export function selectionKeyForGroup(group) {
  const key = SELECTION_KEY[group];
  if (!key) throw new Error(`Unknown filter group: ${group}`);
  return key;
}

export function emptyAdvancedFilter() {
  return {
    selectedColorIds: [],
    selectedSeasonIds: [],
    selectedThemeIds: [],
  };
}

function normalizedFilter(filter) {
  return {
    selectedColorIds: [...new Set(filter?.selectedColorIds ?? [])],
    selectedSeasonIds: [...new Set(filter?.selectedSeasonIds ?? [])],
    selectedThemeIds: [...new Set(filter?.selectedThemeIds ?? [])],
  };
}

export function activeAdvancedFilterCount(filter, groups = ITEM_FILTER_GROUPS) {
  const normalized = normalizedFilter(filter);
  return groups.reduce(
    (total, group) => total + normalized[selectionKeyForGroup(group)].length,
    0,
  );
}

export function isAdvancedFilterActive(filter, groups = ITEM_FILTER_GROUPS) {
  return activeAdvancedFilterCount(filter, groups) > 0;
}

export function clearAdvancedFilterGroups(filter, groups = ITEM_FILTER_GROUPS) {
  const next = normalizedFilter(filter);
  for (const group of groups) next[selectionKeyForGroup(group)] = [];
  return next;
}

export function sanitizeAdvancedFilter(filter, available = {}) {
  const next = normalizedFilter(filter);

  if (Object.hasOwn(available, "colors")) {
    const validColorIds = new Set((available.colors ?? []).map((color) => color.id));
    next.selectedColorIds = next.selectedColorIds.filter((id) => validColorIds.has(id));
  }

  if (Object.hasOwn(available, "labels")) {
    const seasons = new Set(
      (available.labels ?? []).filter((label) => label.kind === "season").map((label) => label.id),
    );
    const themes = new Set(
      (available.labels ?? []).filter((label) => label.kind === "theme").map((label) => label.id),
    );
    next.selectedSeasonIds = next.selectedSeasonIds.filter((id) => seasons.has(id));
    next.selectedThemeIds = next.selectedThemeIds.filter((id) => themes.has(id));
  }

  return next;
}

export function matchesAdvancedFilter(
  entry,
  filter,
  groups = ITEM_FILTER_GROUPS,
) {
  const normalized = normalizedFilter(filter);
  const labelIds = new Set(entry?.labelIds ?? []);
  const candidates = {
    [FILTER_GROUPS.COLOR]: itemColorFamilies(entry),
    [FILTER_GROUPS.SEASON]: labelIds,
    [FILTER_GROUPS.THEME]: labelIds,
  };

  return groups.every((group) => {
    const selected = normalized[selectionKeyForGroup(group)];
    return selected.length === 0 || selected.some((id) => candidates[group].has(id));
  });
}
