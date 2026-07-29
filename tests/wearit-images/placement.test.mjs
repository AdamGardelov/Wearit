import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  optimizeJacketPlacement,
  scoreJacketCandidate,
  transformLayer,
} from "../../scripts/wearit-images/placement.mjs";

const repo = path.resolve(".");
const mannequin = path.join(repo, "public/mannequin-photoreal.png");
const acceptedLayers = [
  "black-white-boucle-blazer.png",
  "black-pinstripe-blazer-v2.png",
].map((name) => path.join(
  repo,
  "data/import-work/jackets-reprocess-20260728/wear-layers",
  name,
));

let profile;
let workspace;
let globalResult;
let globalNeutral;
let repeatedGlobalResult;
let shortSleeveResult;
let acceptedResults;
let globalWearLayer;
let globalOutputDir;

const shiftedBy = { x: 18, y: 18 };

async function createSyntheticJacket(file, { shortRightSleeve = false } = {}) {
  const critical = Object.fromEntries(
    profile.criticalRegions.map((region) => [region.name, region]),
  );
  const rectangles = profile.criticalRegions.flatMap((region) => {
    if (region.name === "rightSleeve" && shortRightSleeve) {
      return [{
        input: {
          create: {
            width: region.width,
            height: Math.floor(region.height * 0.2),
            channels: 4,
            background: "#446688ff",
          },
        },
        left: region.x + shiftedBy.x,
        top: region.y + shiftedBy.y,
      }];
    }
    if (region.name === "rightCuff" && shortRightSleeve) return [];
    if (region.name === "torso" && shortRightSleeve) {
      return [{
        input: {
          create: {
            width: Math.floor(region.width * 0.76),
            height: region.height,
            channels: 4,
            background: "#446688ff",
          },
        },
        left: region.x + shiftedBy.x,
        top: region.y + shiftedBy.y,
      }];
    }
    return [{
      input: {
        create: {
          width: region.width,
          height: region.height,
          channels: 4,
          background: "#446688ff",
        },
      },
      left: region.x + shiftedBy.x,
      top: region.y + shiftedBy.y,
    }];
  });

  // Join the synthetic jacket into one realistic alpha silhouette.
  rectangles.push({
    input: {
      create: {
        width: shortRightSleeve
          ? Math.floor(critical.torso.width * 0.76)
          : critical.torso.width,
        height: 80,
        channels: 4,
        background: "#446688ff",
      },
    },
    left: critical.torso.x + shiftedBy.x,
    top: critical.leftShoulder.y + shiftedBy.y,
  });

  await sharp({
    create: {
      width: profile.canvas.width,
      height: profile.canvas.height,
      channels: 4,
      background: "#00000000",
    },
  }).composite(rectangles).png().toFile(file);
}

function placementTuple(candidate) {
  const { anchorX, anchorY, scale, rotationDegrees } = candidate.placement;
  return [anchorX, anchorY, scale, rotationDegrees, candidate.score];
}

beforeAll(async () => {
  profile = JSON.parse(
    await readFile(
      path.join(repo, "scripts/wearit-images/jacket-profile.json"),
      "utf8",
    ),
  );
  workspace = await mkdtemp(path.join(os.tmpdir(), "wearit-placement-test-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("approved jacket profile", () => {
  it("retains the approved search bounds, fixed rotation, and seed calibration evidence", () => {
    expect(profile).toMatchObject({
      canvas: { width: 887, height: 1774 },
      search: {
        anchorX: { min: 0.46, max: 0.54, coarseStep: 0.02, fineStep: 0.01 },
        anchorY: { min: 0.46, max: 0.54, coarseStep: 0.02, fineStep: 0.01 },
        scale: { min: 0.9, max: 1.1, coarseStep: 0.05, fineStep: 0.01 },
        rotationDegrees: [0],
      },
    });
    expect(profile.criticalRegions.map((region) => [
      region.name,
      region.x,
      region.y,
      region.width,
      region.height,
      region.minCoverage,
      region.seedMinCoverage,
    ])).toEqual([
      ["leftShoulder", 205, 300, 150, 150, 0.42, 0.72],
      ["rightShoulder", 532, 300, 150, 150, 0.4, 0.72],
      ["leftSleeve", 135, 430, 145, 330, 0.36, 0.68],
      ["rightSleeve", 607, 430, 145, 330, 0.3, 0.68],
      ["leftCuff", 120, 760, 145, 120, 0.41, 0.55],
      ["rightCuff", 622, 760, 145, 120, 0.33, 0.55],
      ["torso", 270, 390, 347, 520, 0.75, 0.78],
    ]);
    expect(profile.forbiddenRegions).toEqual([
      {
        name: "face",
        x: 320,
        y: 50,
        width: 247,
        height: 250,
        maxCoverage: 0.02,
      },
      {
        name: "lowerLegs",
        x: 250,
        y: 1120,
        width: 387,
        height: 570,
        maxCoverage: 0.02,
      },
    ]);
  });
});

describe("bounded jacket placement optimization", () => {
  beforeAll(async () => {
    globalWearLayer = path.join(workspace, "globally-shifted.png");
    globalOutputDir = path.join(workspace, "global-output");
    await createSyntheticJacket(globalWearLayer);
    const neutralLayer = await transformLayer({
      wearLayer: globalWearLayer,
      placement: {
        anchorX: 0.5,
        anchorY: 0.5,
        scale: 1,
        rotationDegrees: 0,
      },
    });
    globalNeutral = scoreJacketCandidate({ ...neutralLayer, profile });
    globalResult = await optimizeJacketPlacement({
      wearLayer: globalWearLayer,
      mannequin,
      profile,
      outputDir: globalOutputDir,
    });
    repeatedGlobalResult = await optimizeJacketPlacement({
      wearLayer: globalWearLayer,
      mannequin,
      profile,
      outputDir: path.join(workspace, "global-repeat-output"),
    });

    const shortSleeveLayer = path.join(workspace, "short-right-sleeve.png");
    await createSyntheticJacket(shortSleeveLayer, { shortRightSleeve: true });
    shortSleeveResult = await optimizeJacketPlacement({
      wearLayer: shortSleeveLayer,
      mannequin,
      profile,
      outputDir: path.join(workspace, "short-sleeve-output"),
    });

    acceptedResults = new Map();
    for (const wearLayer of acceptedLayers) {
      acceptedResults.set(wearLayer, await optimizeJacketPlacement({
        wearLayer,
        mannequin,
        profile,
        outputDir: path.join(
          workspace,
          `accepted-${path.basename(wearLayer, ".png")}`,
        ),
      }));
    }
  }, 60_000);

  it("corrects a small global mismatch and emits more than one deterministic preview", async () => {
    const result = globalResult;

    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.placement.rotationDegrees).toBe(0);
    expect(result.placement.anchorX).toBeGreaterThanOrEqual(0.46);
    expect(result.placement.anchorX).toBeLessThanOrEqual(0.54);
    expect(result.placement.anchorY).toBeGreaterThanOrEqual(0.46);
    expect(result.placement.anchorY).toBeLessThanOrEqual(0.54);
    expect(result.placement.scale).toBeGreaterThanOrEqual(0.9);
    expect(result.placement.scale).toBeLessThanOrEqual(1.1);
    expect(result.placement.anchorX).toBeLessThan(0.5);
    expect(result.placement.anchorY).toBeLessThan(0.5);
    expect(result.score).toBeGreaterThan(globalNeutral.score);
    expect(result.candidates.map(({ previewPath }) => path.basename(previewPath)))
      .toEqual(result.candidates.map((_, index) => `candidate-${index + 1}.png`));
  }, 15_000);

  it("surfaces a locally short right sleeve instead of hiding it in aggregate score", async () => {
    expect(shortSleeveResult.metrics.uncoveredCriticalRegions)
      .toContain("rightSleeve");
  }, 15_000);

  it("never evaluates a candidate outside the approved bounds", async () => {
    const result = globalResult;

    expect(result.evaluatedPlacements.length).toBeGreaterThan(0);
    for (const placement of result.evaluatedPlacements) {
      expect(placement.anchorX).toBeGreaterThanOrEqual(0.46);
      expect(placement.anchorX).toBeLessThanOrEqual(0.54);
      expect(placement.anchorY).toBeGreaterThanOrEqual(0.46);
      expect(placement.anchorY).toBeLessThanOrEqual(0.54);
      expect(placement.scale).toBeGreaterThanOrEqual(0.9);
      expect(placement.scale).toBeLessThanOrEqual(1.1);
      expect(placement.rotationDegrees).toBe(0);
    }
  }, 15_000);

  it("selects the same placement and candidate order for identical input", async () => {
    expect(repeatedGlobalResult.placement).toEqual(globalResult.placement);
    expect(repeatedGlobalResult.candidates.map(placementTuple))
      .toEqual(globalResult.candidates.map(placementTuple));
  }, 15_000);

  it("does not overwrite immutable candidate previews", async () => {
    const first = globalResult;
    const before = await Promise.all(
      first.candidates.map(({ previewPath }) => readFile(previewPath)),
    );

    await expect(optimizeJacketPlacement({
      wearLayer: globalWearLayer,
      mannequin,
      profile,
      outputDir: globalOutputDir,
    })).rejects.toThrow(/already exists: .*candidate-1\.png/i);

    const after = await Promise.all(
      first.candidates.map(({ previewPath }) => readFile(previewPath)),
    );
    expect(after).toEqual(before);
  }, 15_000);

  it.each(acceptedLayers)(
    "keeps accepted real layer %s neutral and clear of critical failures",
    async (wearLayer) => {
      const result = acceptedResults.get(wearLayer);

      expect(Math.abs(result.placement.anchorX - 0.5))
        .toBeLessThanOrEqual(0.010001);
      expect(Math.abs(result.placement.anchorY - 0.5))
        .toBeLessThanOrEqual(0.010001);
      expect(Math.abs(result.placement.scale - 1)).toBeLessThanOrEqual(0.02);
      expect(result.metrics.uncoveredCriticalRegions).toEqual([]);
    },
    15_000,
  );
});
