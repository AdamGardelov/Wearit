export const WEEKDAYS = Object.freeze([
  { value: 1, label: "Måndag", shortLabel: "Mån" },
  { value: 2, label: "Tisdag", shortLabel: "Tis" },
  { value: 3, label: "Onsdag", shortLabel: "Ons" },
  { value: 4, label: "Torsdag", shortLabel: "Tor" },
  { value: 5, label: "Fredag", shortLabel: "Fre" },
]);

export function validWeekday(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function currentWeekday(date = new Date()) {
  const value = date.getDay();
  return validWeekday(value) ? value : null;
}

export function emptyWeek() {
  return WEEKDAYS.map(({ value }) => ({ weekday: value, outfitId: null, outfit: null }));
}
