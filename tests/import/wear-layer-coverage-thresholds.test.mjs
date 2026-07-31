import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectWearLayer } from "../../scripts/wearit-images/image-checks.mjs";
import { loadProfiles, profileForCategory } from "../../scripts/wearit-images/profiles.mjs";
import { CATEGORY_DEFINITIONS } from "../../src/domain/slots.js";

const CANVAS = { width: 887, height: 1774 };

let workspace;

/**
 * Paint opaque blocks on a transparent 887x1774 canvas. Each block is one
 * connected component, so `blocks` models a garment's part count directly:
 * two shoes, one hat crown, one belt strap.
 */
async function layerWithBlocks(name, blocks) {
  const canvas = sharp({
    create: {
      width: CANVAS.width,
      height: CANVAS.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  const composites = await Promise.all(
    blocks.map(async ({ left, top, width, height }) => ({
      left,
      top,
      input: await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 120, g: 120, b: 120, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    })),
  );
  const file = join(workspace, `${name}.png`);
  await canvas.composite(composites).png().toFile(file);
  return file;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "wear-coverage-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("category profiles declare wear-layer coverage thresholds", () => {
  it("gives every registered category an explicit, positive coverage floor", async () => {
    const profiles = await loadProfiles();
    for (const { id } of CATEGORY_DEFINITIONS) {
      const profile = profileForCategory(profiles, id);
      expect(profile.coverage, `${id} declares coverage`).toBeTruthy();
      expect(
        profile.coverage.minVisibleFraction,
        `${id} minVisibleFraction is a positive fraction`,
      ).toBeGreaterThan(0);
      expect(profile.coverage.minVisibleFraction).toBeLessThanOrEqual(1);
      expect(
        profile.coverage.minLargestComponentFraction,
        `${id} minLargestComponentFraction does not exceed minVisibleFraction`,
      ).toBeGreaterThan(0);
      expect(profile.coverage.minLargestComponentFraction).toBeLessThanOrEqual(
        profile.coverage.minVisibleFraction,
      );
    }
  });

  it("keeps the jacket floor at the calibrated 0.05/0.04 so its behaviour is unchanged", async () => {
    const profiles = await loadProfiles();
    expect(profileForCategory(profiles, "jacket").coverage).toEqual({
      minVisibleFraction: 0.05,
      minLargestComponentFraction: 0.04,
    });
  });
});

describe("inspectWearLayer under small-garment categories", () => {
  it("accepts a realistic pair of shoes, which covers ~2% of the body canvas", async () => {
    // Measured from the first real shoes wear layer: 33 863 visible px
    // (2.15% of the canvas) split across two components, largest 17 115 px
    // (1.09%). Two 120x150 blocks reproduce that scale.
    const file = await layerWithBlocks("shoes", [
      { left: 290, top: 1480, width: 120, height: 150 },
      { left: 470, top: 1480, width: 120, height: 150 },
    ]);
    const profiles = await loadProfiles();
    const { coverage } = profileForCategory(profiles, "shoes");

    const result = await inspectWearLayer(file, { ...CANVAS, ...coverage });

    expect(result.content.visibleFraction).toBeLessThan(0.05);
    expect(result.components.garmentComponents).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("accepts a hat crown and a belt strap, the other sub-5% categories", async () => {
    const profiles = await loadProfiles();
    const cases = [
      { category: "hat", blocks: [{ left: 380, top: 60, width: 130, height: 110 }] },
      { category: "belt", blocks: [{ left: 330, top: 690, width: 230, height: 34 }] },
    ];
    for (const { category, blocks } of cases) {
      const file = await layerWithBlocks(category, blocks);
      const { coverage } = profileForCategory(profiles, category);
      const result = await inspectWearLayer(file, { ...CANVAS, ...coverage });
      expect(result.failures, `${category} has no structural failures`).toEqual([]);
      expect(result.pass, `${category} passes`).toBe(true);
    }
  });

  it("still rejects a layer that is effectively empty", async () => {
    const file = await layerWithBlocks("speck", [
      { left: 440, top: 880, width: 6, height: 6 },
    ]);
    const profiles = await loadProfiles();
    const { coverage } = profileForCategory(profiles, "shoes");

    const result = await inspectWearLayer(file, { ...CANVAS, ...coverage });

    expect(result.failures).toContain("content");
    expect(result.pass).toBe(false);
  });
});

describe("the batch engine passes profile coverage into inspection", () => {
  it("does not leave inspectWearLayer on its jacket-shaped defaults", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(resolve("scripts/wearit-images/batch.mjs"), "utf8"),
    );
    const call = source.match(/inspectWearLayer\([^)]*\{([\s\S]*?)\}\s*\)/);
    expect(call, "inspectWearLayer is called with an options object").not.toBeNull();
    expect(call[1]).toMatch(/minVisibleFraction/);
    expect(call[1]).toMatch(/minLargestComponentFraction/);
  });
});
