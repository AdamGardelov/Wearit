export const LAST_WORN_SORT = Object.freeze({
  STANDARD: "standard",
  OLDEST: "oldest",
  NEWEST: "newest",
});

function wornTime(entry) {
  if (!entry?.last_worn_at) return null;
  const value = Date.parse(entry.last_worn_at);
  return Number.isFinite(value) ? value : null;
}

export function sortByLastWorn(entries, order) {
  if (order === LAST_WORN_SORT.STANDARD) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index, time: wornTime(entry) }))
    .sort((left, right) => {
      if (left.time === null && right.time === null) return left.index - right.index;
      if (left.time === null) return order === LAST_WORN_SORT.OLDEST ? -1 : 1;
      if (right.time === null) return order === LAST_WORN_SORT.OLDEST ? 1 : -1;
      const byTime = order === LAST_WORN_SORT.OLDEST
        ? left.time - right.time
        : right.time - left.time;
      return byTime || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function lastWornText(value, locale = "sv-SE") {
  if (!value || !Number.isFinite(Date.parse(value))) return "Aldrig använd";
  return `Senast använd ${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
  }).format(new Date(value))}`;
}
