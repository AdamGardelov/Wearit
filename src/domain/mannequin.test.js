import { describe, expect, it } from "vitest";
import {
  EMPTY_MANNEQUIN,
  mannequinReducer,
  selectedItems,
} from "./mannequin.js";

const top = { id: "top-1", slot: "top", layer_order: 20 };
const replacementTop = { id: "top-2", slot: "top", layer_order: 21 };
const bottom = { id: "bottom-1", slot: "bottom", layer_order: 30 };
const dress = { id: "dress-1", slot: "dress", layer_order: 25 };
const outerwear = { id: "coat-1", slot: "outerwear", layer_order: 40 };
const shoes = { id: "shoes-1", slot: "shoes", layer_order: 10 };
const accessory = { id: "bag-1", slot: "accessory", layer_order: 50 };

function select(state, item) {
  return mannequinReducer(state, { type: "select", item });
}

describe("mannequinReducer", () => {
  it("replaces an item in the same slot", () => {
    const withTop = select(EMPTY_MANNEQUIN, top);

    const result = select(withTop, replacementTop);

    expect(result.selectedBySlot).toEqual({ top: replacementTop });
  });

  it("selecting dress clears top and bottom", () => {
    const withSeparates = select(select(EMPTY_MANNEQUIN, top), bottom);

    const result = select(withSeparates, dress);

    expect(result.selectedBySlot).toEqual({ dress });
  });

  it("selecting top clears dress", () => {
    const result = select(select(EMPTY_MANNEQUIN, dress), top);

    expect(result.selectedBySlot).toEqual({ top });
  });

  it("selecting bottom clears dress", () => {
    const result = select(select(EMPTY_MANNEQUIN, dress), bottom);

    expect(result.selectedBySlot).toEqual({ bottom });
  });

  it("keeps outerwear, shoes, and accessory across compatible selections", () => {
    let state = select(EMPTY_MANNEQUIN, outerwear);
    state = select(state, shoes);
    state = select(state, accessory);
    state = select(state, top);
    state = select(state, bottom);

    const result = select(state, dress);

    expect(result.selectedBySlot).toEqual({ outerwear, shoes, accessory, dress });
  });

  it("undo restores the prior complete selection", () => {
    const withSeparates = select(select(EMPTY_MANNEQUIN, top), bottom);
    const withDress = select(withSeparates, dress);

    const result = mannequinReducer(withDress, { type: "undo" });

    expect(result.selectedBySlot).toEqual({ top, bottom });
    expect(result.history).toHaveLength(withDress.history.length - 1);
  });

  it("clear can be undone", () => {
    const selected = select(select(EMPTY_MANNEQUIN, top), shoes);
    const cleared = mannequinReducer(selected, { type: "clear" });

    const result = mannequinReducer(cleared, { type: "undo" });

    expect(cleared.selectedBySlot).toEqual({});
    expect(result.selectedBySlot).toEqual({ top, shoes });
  });

  it("ignores malformed item", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    expect(mannequinReducer(state, { type: "select", item: { id: "missing-slot" } })).toBe(state);
    expect(mannequinReducer(state, { type: "select", item: { slot: "top" } })).toBe(state);
    expect(mannequinReducer(state, { type: "select", item: null })).toBe(state);
  });

  it("loads valid items by slot and records the prior selection", () => {
    const state = select(EMPTY_MANNEQUIN, dress);

    const result = mannequinReducer(state, {
      type: "load",
      items: [top, bottom, outerwear],
    });

    expect(result.selectedBySlot).toEqual({ top, bottom, outerwear });
    expect(result.history.at(-1).selectedBySlot).toEqual({ dress });
  });

  it("ignores a null load without changing the state", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    const result = mannequinReducer(state, { type: "load", items: null });

    expect(result).toBe(state);
  });

  it("ignores a non-array load without changing the state", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    const result = mannequinReducer(state, { type: "load", items: { top } });

    expect(result).toBe(state);
  });

  it("rejects a mixed valid and malformed load atomically", () => {
    const state = select(EMPTY_MANNEQUIN, dress);

    const result = mannequinReducer(state, {
      type: "load",
      items: [top, { id: "missing-slot" }],
    });

    expect(result).toBe(state);
  });

  it("rejects an unrecognized slot atomically", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    const result = mannequinReducer(state, {
      type: "load",
      items: [bottom, { id: "hat-1", slot: "hat" }],
    });

    expect(result).toBe(state);
  });

  it("loads an explicit empty composition and records the prior selection", () => {
    const state = select(EMPTY_MANNEQUIN, top);

    const result = mannequinReducer(state, { type: "load", items: [] });

    expect(result.selectedBySlot).toEqual({});
    expect(result.history.at(-1).selectedBySlot).toEqual({ top });
  });

  it("rejects duplicate loaded slots atomically", () => {
    const state = select(EMPTY_MANNEQUIN, dress);

    const result = mannequinReducer(state, {
      type: "load",
      items: [top, replacementTop],
    });

    expect(result).toBe(state);
  });

  it("returns the same state for no-op actions", () => {
    expect(mannequinReducer(EMPTY_MANNEQUIN, { type: "clear" })).toBe(EMPTY_MANNEQUIN);
    expect(mannequinReducer(EMPTY_MANNEQUIN, { type: "undo" })).toBe(EMPTY_MANNEQUIN);
    expect(mannequinReducer(EMPTY_MANNEQUIN, { type: "unknown" })).toBe(EMPTY_MANNEQUIN);
  });
});

describe("layer controls", () => {
  it("moves a garment forward past its neighbor without touching defaults", () => {
    let state = select(select(EMPTY_MANNEQUIN, top), bottom); // top=20, bottom=30
    // back-to-front: top(20), bottom(30). Move top forward → in front of bottom.
    state = mannequinReducer(state, { type: "move-layer", itemId: top.id, direction: "forward" });

    const order = selectedItems(state).map((item) => item.id);
    expect(order).toEqual([bottom.id, top.id]);
    // Wardrobe item defaults are never mutated.
    expect(top.layer_order).toBe(20);
    expect(bottom.layer_order).toBe(30);
  });

  it("moves a garment backward and can be undone", () => {
    let state = select(select(EMPTY_MANNEQUIN, shoes), top); // shoes=10, top=20
    state = mannequinReducer(state, { type: "move-layer", itemId: top.id, direction: "backward" });
    expect(selectedItems(state).map((item) => item.id)).toEqual([top.id, shoes.id]);

    const undone = mannequinReducer(state, { type: "undo" });
    expect(selectedItems(undone).map((item) => item.id)).toEqual([shoes.id, top.id]);
  });

  it("ignores a move at the front or back boundary", () => {
    const state = select(select(EMPTY_MANNEQUIN, shoes), top); // shoes(10) back, top(20) front
    expect(mannequinReducer(state, { type: "move-layer", itemId: top.id, direction: "forward" })).toBe(state);
    expect(mannequinReducer(state, { type: "move-layer", itemId: shoes.id, direction: "backward" })).toBe(state);
    expect(mannequinReducer(state, { type: "move-layer", itemId: "missing", direction: "forward" })).toBe(state);
  });

  it("keeps a slot's stack position when its garment is replaced", () => {
    let state = select(select(EMPTY_MANNEQUIN, shoes), top); // shoes=10, top=20
    // Push the top in front of nothing then move shoes forward so ranks diverge.
    state = mannequinReducer(state, { type: "move-layer", itemId: shoes.id, direction: "forward" });
    const before = selectedItems(state).map((item) => item.slot);

    const replacementShoes = { id: "shoes-2", slot: "shoes", layer_order: 90 };
    state = mannequinReducer(state, { type: "select", item: replacementShoes });

    const after = selectedItems(state);
    expect(after.map((item) => item.slot)).toEqual(before);
    expect(after.find((item) => item.slot === "shoes").id).toBe("shoes-2");
  });

  it("reproduces a saved stack from saved_layer_order on load", () => {
    const savedTop = { ...top, saved_layer_order: 80 };
    const savedShoes = { ...shoes, saved_layer_order: 10 };
    const savedBottom = { ...bottom, saved_layer_order: 40 };
    const state = mannequinReducer(EMPTY_MANNEQUIN, {
      type: "load",
      items: [savedTop, savedShoes, savedBottom],
    });

    expect(selectedItems(state).map((item) => item.id)).toEqual([
      savedShoes.id, // 10
      savedBottom.id, // 40
      savedTop.id, // 80
    ]);
  });
});

describe("selectedItems", () => {
  it("returns selected items in ascending layer order", () => {
    const state = {
      selectedBySlot: { outerwear, shoes, top },
      history: [],
    };

    expect(selectedItems(state)).toEqual([shoes, top, outerwear]);
  });

  it("uses canonical slot order for equal layers", () => {
    const equalLayerItems = [
      { ...accessory, layer_order: 10 },
      { ...shoes, layer_order: 10 },
      { ...outerwear, layer_order: 10 },
      { ...bottom, layer_order: 10 },
      { ...top, layer_order: 10 },
      { ...dress, layer_order: 10 },
    ];
    const state = {
      selectedBySlot: Object.fromEntries(equalLayerItems.map((item) => [item.slot, item])),
      history: [],
    };

    expect(selectedItems(state).map((item) => item.slot)).toEqual([
      "dress",
      "top",
      "bottom",
      "outerwear",
      "shoes",
      "accessory",
    ]);
  });

  it("orders finite layers before missing and non-numeric layers deterministically", () => {
    const missingLayer = { id: "coat-missing", slot: "outerwear" };
    const nonNumericLayer = { id: "shoes-text", slot: "shoes", layer_order: "10" };
    const state = {
      selectedBySlot: {
        shoes: nonNumericLayer,
        outerwear: missingLayer,
        bottom,
        top,
      },
      history: [],
    };

    expect(selectedItems(state).map((item) => item.id)).toEqual([
      "top-1",
      "bottom-1",
      "coat-missing",
      "shoes-text",
    ]);
  });

  it("returns the same order regardless of selection insertion order", () => {
    const missingLayer = { id: "coat-missing", slot: "outerwear" };
    const nonNumericLayer = { id: "shoes-text", slot: "shoes", layer_order: "10" };
    const items = [
      missingLayer,
      nonNumericLayer,
      { ...bottom, layer_order: 10 },
      { ...top, layer_order: 10 },
    ];
    const forward = {
      selectedBySlot: Object.fromEntries(items.map((item) => [item.slot, item])),
      history: [],
    };
    const reverse = {
      selectedBySlot: Object.fromEntries(items.toReversed().map((item) => [item.slot, item])),
      history: [],
    };

    expect(selectedItems(forward).map((item) => item.id)).toEqual(
      selectedItems(reverse).map((item) => item.id),
    );
  });

  it("uses item id as the final stable tie-breaker without mutating state", () => {
    const selectedBySlot = {
      second: { id: "top-b", slot: "top", layer_order: 10 },
      first: { id: "top-a", slot: "top", layer_order: 10 },
    };
    const before = { ...selectedBySlot };

    expect(selectedItems({ selectedBySlot, history: [] }).map((item) => item.id)).toEqual([
      "top-a",
      "top-b",
    ]);
    expect(selectedBySlot).toEqual(before);
  });
});
