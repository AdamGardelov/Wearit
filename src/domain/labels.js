export const SEASON_DEFINITIONS = [
  { key: "spring", name: "Spring", displayName: "Vår" },
  { key: "summer", name: "Summer", displayName: "Sommar" },
  { key: "autumn", name: "Autumn", displayName: "Höst" },
  { key: "winter", name: "Winter", displayName: "Vinter" },
];

export function emptyLabelFilter() {
  return { selectedSeasonIds: [], selectedThemeIds: [] };
}

export function labelsByKind(labels = []) {
  return {
    seasons: labels
      .filter((label) => label.kind === "season")
      .sort((left, right) => {
        const order = SEASON_DEFINITIONS.map(({ key }) => key);
        return order.indexOf(left.seasonKey) - order.indexOf(right.seasonKey);
      }),
    themes: labels
      .filter((label) => label.kind === "theme")
      .sort((left, right) => left.name.localeCompare(right.name, "sv")),
  };
}

export function labelDisplayName(label) {
  if (label.kind !== "season") return label.name;
  return SEASON_DEFINITIONS.find(({ key }) => key === label.seasonKey)?.displayName
    ?? label.name;
}

export function isLabelFilterActive(filter) {
  return filter.selectedSeasonIds.length > 0 || filter.selectedThemeIds.length > 0;
}

export function sanitizeLabelFilter(filter, labels) {
  const seasonIds = new Set(labels.filter((label) => label.kind === "season").map((label) => label.id));
  const themeIds = new Set(labels.filter((label) => label.kind === "theme").map((label) => label.id));
  const uniqueValid = (ids = [], validIds) => [...new Set(ids)].filter((id) => validIds.has(id));
  return {
    selectedSeasonIds: uniqueValid(filter?.selectedSeasonIds, seasonIds),
    selectedThemeIds: uniqueValid(filter?.selectedThemeIds, themeIds),
  };
}

export function matchesLabelFilter(entry, filter) {
  const ids = new Set(entry.labelIds ?? []);
  const seasons = filter.selectedSeasonIds ?? [];
  const themes = filter.selectedThemeIds ?? [];
  const seasonMatches = seasons.length === 0 || seasons.some((id) => ids.has(id));
  const themeMatches = themes.length === 0 || themes.some((id) => ids.has(id));
  return seasonMatches && themeMatches;
}

export function sharedLabelIds(items = []) {
  if (items.length === 0) return [];
  const remaining = new Set(items[0].labelIds ?? []);
  for (const item of items.slice(1)) {
    const itemIds = new Set(item.labelIds ?? []);
    for (const id of remaining) if (!itemIds.has(id)) remaining.delete(id);
  }
  return [...remaining];
}
