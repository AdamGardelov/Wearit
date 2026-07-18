import { describe, expect, it } from "vitest";
import {
  EMPTY_MANNEQUIN,
  mannequinReducer,
  selectedItems,
} from "./mannequin.js";

const top = { id: "top-1", name: "Old top", slot: "top", layer_order: 20 };
const bottom = { id: "bottom-1", name: "Bottom", slot: "bottom", layer_order: 30 };
const shoes = { id: "shoes-1", name: "Shoes", slot: "shoes", layer_order: 10 };
const accessory = { id: "bag-1", name: "Bag", slot: "accessory", layer_order: 50 };

function select(state, item) {
  return mannequinReducer(state, { type: "select", item });
}

function reconcile(state, items) {
  return mannequinReducer(state, { type: "reconcile", items });
}

function expectValidSnapshot(snapshot) {
  expect(snapshot.dress && (snapshot.top || snapshot.bottom)).toBeFalsy();
  for (const [slot, item] of Object.entries(snapshot)) {
    expect(item.slot).toBe(slot);
  }
}

describe("mannequin reconciliation", () => {
  it("drops removed items from the selection and every undo snapshot", () => {
    let state = select(EMPTY_MANNEQUIN, top);
    state = select(state, bottom);
    state = select(state, shoes);

    const result = reconcile(state, [bottom, shoes]);

    expect(selectedItems(result)).toEqual([shoes, bottom]);
    for (const snapshot of [
      result.selectedBySlot,
      ...result.history.map((entry) => entry.selectedBySlot),
    ]) {
      expect(Object.values(snapshot)).not.toContainEqual(top);
      expectValidSnapshot(snapshot);
    }

    let undone = result;
    while (undone.history.length) {
      undone = mannequinReducer(undone, { type: "undo" });
      expect(selectedItems(undone).map((item) => item.id)).not.toContain(top.id);
      expectValidSnapshot(undone.selectedBySlot);
    }
  });

  it("rekeys edited items, refreshes records, and makes dress win over separates", () => {
    const withSeparates = select(select(EMPTY_MANNEQUIN, top), bottom);
    const editedDress = {
      ...top,
      name: "Current dress",
      slot: "dress",
      cutoutUrl: "/current-dress.png",
      layer_order: 25,
    };

    let result = reconcile(withSeparates, [editedDress, bottom, accessory]);

    expect(result.selectedBySlot).toEqual({ dress: editedDress });
    for (const snapshot of [
      result.selectedBySlot,
      ...result.history.map((entry) => entry.selectedBySlot),
    ]) {
      expect(snapshot).not.toHaveProperty("top");
      expectValidSnapshot(snapshot);
      if (snapshot.dress) expect(snapshot.dress).toBe(editedDress);
    }

    result = select(result, accessory);
    result = mannequinReducer(result, { type: "undo" });
    expect(result.selectedBySlot).toEqual({ dress: editedDress });
  });

  it("prefers a canonical-slot occupant over a migrated duplicate, then stable id", () => {
    const canonicalTop = { id: "z-top", slot: "top" };
    const migratingBottom = { id: "a-bottom", slot: "bottom" };
    const state = {
      selectedBySlot: { top: canonicalTop, bottom: migratingBottom },
      history: [],
    };
    const currentCanonical = { ...canonicalTop, name: "Canonical" };
    const migratedToTop = { ...migratingBottom, slot: "top", name: "Migrated" };

    const canonicalResult = reconcile(state, [currentCanonical, migratedToTop]);

    expect(canonicalResult.selectedBySlot).toEqual({ top: currentCanonical });

    const migratedA = { ...canonicalTop, id: "a", slot: "accessory" };
    const migratedB = { ...migratingBottom, id: "b", slot: "accessory" };
    const stableIdState = {
      selectedBySlot: {
        top: { ...canonicalTop, id: "a" },
        bottom: { ...migratingBottom, id: "b" },
      },
      history: [],
    };
    expect(reconcile(stableIdState, [migratedB, migratedA]).selectedBySlot)
      .toEqual({ accessory: migratedA });
  });

  it("preserves state identity when every selection and snapshot is current", () => {
    const state = select(select(EMPTY_MANNEQUIN, top), bottom);

    expect(reconcile(state, [top, bottom])).toBe(state);
  });
});

describe("mannequin selection no-ops", () => {
  it("does not record history when the exact selected item is tapped again", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    expect(select(state, top)).toBe(state);
  });
});
