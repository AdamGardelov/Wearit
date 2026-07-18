import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  currentWeekday,
  emptyWeek,
  validWeekday,
} from "./weeklyPlan.js";

describe("weeklyPlan", () => {
  it("exposes exactly Monday through Friday in order", () => {
    expect(WEEKDAYS.map((day) => day.value)).toEqual([1, 2, 3, 4, 5]);
    expect(WEEKDAYS.map((day) => day.label)).toEqual([
      "Måndag",
      "Tisdag",
      "Onsdag",
      "Torsdag",
      "Fredag",
    ]);
  });

  it("validates weekday integers 1..5 and rejects everything else", () => {
    expect([1, 2, 3, 4, 5].every(validWeekday)).toBe(true);
    expect(validWeekday(0)).toBe(false);
    expect(validWeekday(6)).toBe(false);
    expect(validWeekday(7)).toBe(false);
    expect(validWeekday(2.5)).toBe(false);
    expect(validWeekday("3")).toBe(false);
    expect(validWeekday(null)).toBe(false);
  });

  it("maps a weekday date to its ISO weekday value", () => {
    // getDay(): Sunday 0, Monday 1, ... Saturday 6.
    expect(currentWeekday({ getDay: () => 1 })).toBe(1);
    expect(currentWeekday({ getDay: () => 3 })).toBe(3);
    expect(currentWeekday({ getDay: () => 5 })).toBe(5);
  });

  it("maps Saturday and Sunday to null", () => {
    expect(currentWeekday({ getDay: () => 6 })).toBeNull();
    expect(currentWeekday({ getDay: () => 0 })).toBeNull();
  });

  it("builds five empty slots ordered Monday to Friday", () => {
    expect(emptyWeek()).toEqual([
      { weekday: 1, outfitId: null, outfit: null },
      { weekday: 2, outfitId: null, outfit: null },
      { weekday: 3, outfitId: null, outfit: null },
      { weekday: 4, outfitId: null, outfit: null },
      { weekday: 5, outfitId: null, outfit: null },
    ]);
  });
});
