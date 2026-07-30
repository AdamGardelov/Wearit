import { describe, expect, it } from "vitest";
import { canonicalStringify, loadProfiles, profileForCategory } from "../../scripts/wearit-images/profiles.mjs";

const CATEGORIES = ["top", "bottom", "dress", "jacket", "coat", "shoes", "hat", "belt", "bag", "scarf", "accessory"];

describe("category profile registry", () => {
  it("loads one valid profile per registered category", async () => {
    const profiles = await loadProfiles();
    expect(Object.keys(profiles)).toEqual(CATEGORIES);
    for (const category of CATEGORIES) {
      const profile = profileForCategory(profiles, category);
      expect(profile).toMatchObject({ schemaVersion: 1, category, placement: { anchorX: 0.5, anchorY: 0.5, scale: 1, rotationDegrees: 0 } });
      expect(profile.reviewRegions).toEqual(expect.arrayContaining(["sourceFidelity", "visibleMannequin", "artifacts"]));
      expect(profile.corrections.sourceFidelity).toEqual({ target: "source-fidelity", preserve: [], consumesGenerationAttempt: true });
      expect(profile.corrections).not.toHaveProperty("visibleMannequin");
      expect(profile.corrections).not.toHaveProperty("artifacts");
      expect(profile.evidence).toEqual({ checkerboards: ["light", "dark"], topologyCrops: "item-contract", expectedCoverage: profile.calibration.status === "calibrated" ? "numeric-and-visual" : "visual-only" });
      expect(profile.relativePath).toBe("scripts/wearit-images/category-profiles.json");
      expect(profile.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.isFrozen(profile.reviewRegions)).toBe(true);
      expect(Object.isFrozen(profile.corrections)).toBe(true);
      expect(Object.isFrozen(profile.placement)).toBe(true);
    }
  });

  it("canonicalizes object keys without changing array order", () => {
    expect(canonicalStringify({ b: 1, a: ["x", "y"] })).toBe('{"a":["x","y"],"b":1}');
  });

  it("rejects inherited prototype keys as categories", () => {
    expect(() => profileForCategory({}, "__proto__")).toThrow("Unknown category profile");
    expect(() => profileForCategory({}, "constructor")).toThrow("Unknown category profile");
  });
});
