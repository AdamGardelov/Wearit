export const SEASON_DEFINITIONS = [
  { key: "spring", name: "Spring", displayName: "Vår" },
  { key: "summer", name: "Summer", displayName: "Sommar" },
  { key: "autumn", name: "Autumn", displayName: "Höst" },
  { key: "winter", name: "Winter", displayName: "Vinter" },
];

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

export function sharedLabelIds(items = []) {
  if (items.length === 0) return [];
  const remaining = new Set(items[0].labelIds ?? []);
  for (const item of items.slice(1)) {
    const itemIds = new Set(item.labelIds ?? []);
    for (const id of remaining) if (!itemIds.has(id)) remaining.delete(id);
  }
  return [...remaining];
}
