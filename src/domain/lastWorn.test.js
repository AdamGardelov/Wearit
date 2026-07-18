import { describe, expect, it } from "vitest";
import { LAST_WORN_SORT, lastWornText, sortByLastWorn } from "./lastWorn.js";

const entry = (id, last_worn_at) => ({ id, last_worn_at });

describe("sortByLastWorn", () => {
  it("returns a stable copy in Standard order without reordering", () => {
    const entries = [entry("a", null), entry("b", "2026-07-10T00:00:00Z")];
    const sorted = sortByLastWorn(entries, LAST_WORN_SORT.STANDARD);
    expect(sorted).toEqual(entries);
    expect(sorted).not.toBe(entries);
  });

  it("puts never-used entries first for longest-since-used, then oldest to newest", () => {
    const entries = [
      entry("recent", "2026-07-15T00:00:00Z"),
      entry("never", null),
      entry("old", "2026-01-01T00:00:00Z"),
    ];
    expect(sortByLastWorn(entries, LAST_WORN_SORT.OLDEST).map((item) => item.id))
      .toEqual(["never", "old", "recent"]);
  });

  it("puts never-used entries last for most-recently-used, newest to oldest", () => {
    const entries = [
      entry("old", "2026-01-01T00:00:00Z"),
      entry("never", null),
      entry("recent", "2026-07-15T00:00:00Z"),
    ];
    expect(sortByLastWorn(entries, LAST_WORN_SORT.NEWEST).map((item) => item.id))
      .toEqual(["recent", "old", "never"]);
  });

  it("keeps Standard order for equal dates in both directions", () => {
    const entries = [
      entry("first", "2026-07-10T00:00:00Z"),
      entry("second", "2026-07-10T00:00:00Z"),
      entry("third", "2026-07-10T00:00:00Z"),
    ];
    expect(sortByLastWorn(entries, LAST_WORN_SORT.OLDEST).map((item) => item.id))
      .toEqual(["first", "second", "third"]);
    expect(sortByLastWorn(entries, LAST_WORN_SORT.NEWEST).map((item) => item.id))
      .toEqual(["first", "second", "third"]);
  });

  it("keeps Standard order among never-used entries in both directions", () => {
    const entries = [entry("x", null), entry("y", null), entry("z", null)];
    expect(sortByLastWorn(entries, LAST_WORN_SORT.OLDEST).map((item) => item.id))
      .toEqual(["x", "y", "z"]);
    expect(sortByLastWorn(entries, LAST_WORN_SORT.NEWEST).map((item) => item.id))
      .toEqual(["x", "y", "z"]);
  });

  it("treats an invalid date as never used", () => {
    const entries = [
      entry("valid", "2026-07-10T00:00:00Z"),
      entry("garbage", "not-a-date"),
    ];
    // A garbage timestamp is never-used: first under OLDEST, last under NEWEST.
    expect(sortByLastWorn(entries, LAST_WORN_SORT.OLDEST).map((item) => item.id))
      .toEqual(["garbage", "valid"]);
    expect(sortByLastWorn(entries, LAST_WORN_SORT.NEWEST).map((item) => item.id))
      .toEqual(["valid", "garbage"]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry("a", "2026-07-01T00:00:00Z"), entry("b", null)];
    const snapshot = [...entries];
    sortByLastWorn(entries, LAST_WORN_SORT.NEWEST);
    expect(entries).toEqual(snapshot);
  });
});

describe("lastWornText", () => {
  it("renders never-used entries in Swedish", () => {
    expect(lastWornText(null)).toBe("Aldrig använd");
    expect(lastWornText("")).toBe("Aldrig använd");
    expect(lastWornText("not-a-date")).toBe("Aldrig använd");
  });

  it("renders a dated entry as Swedish day and month", () => {
    // Noon UTC stays on 14 July across every realistic local timezone.
    expect(lastWornText("2026-07-14T12:00:00Z")).toBe("Senast använd 14 juli");
  });
});
