import { describe, expect, it } from "vitest";
import { combinationKey, validateOutfit } from "./outfits.js";

describe("combinationKey", () => {
  it("sorts distinct item IDs into a stable key", () => {
    expect(combinationKey([{ id: "b" }, { id: "a" }, { id: "b" }])).toBe("a|b");
  });
});

describe("validateOutfit", () => {
  it("requires at least two items", () => {
    expect(validateOutfit([{ id: "a", slot: "top" }])).toEqual({
      valid: false,
      message: "Välj minst två plagg.",
    });
  });

  it("accepts two compatible items", () => {
    expect(validateOutfit([
      { id: "a", slot: "top" },
      { id: "b", slot: "bottom" },
    ])).toEqual({ valid: true, message: "" });
  });

  it("rejects duplicate item IDs", () => {
    expect(validateOutfit([
      { id: "same", slot: "top" },
      { id: "same", slot: "bottom" },
    ])).toEqual({
      valid: false,
      message: "Välj varje plagg endast en gång.",
    });
  });

  it("rejects duplicate slots", () => {
    expect(validateOutfit([
      { id: "a", slot: "top" },
      { id: "b", slot: "top" },
    ])).toEqual({
      valid: false,
      message: "Välj bara ett plagg per plats.",
    });
  });

  it("rejects a dress combined with a top or bottom", () => {
    expect(validateOutfit([
      { id: "dress", slot: "dress" },
      { id: "top", slot: "top" },
    ])).toEqual({
      valid: false,
      message: "En klänning kan inte kombineras med en över- eller underdel.",
    });
  });
});
