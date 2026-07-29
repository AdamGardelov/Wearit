import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CRITICAL_REGIONS } from "../../scripts/wearit-images/decision.mjs";

const CLI = path.resolve("scripts/wearit-images/batch.mjs");
const ITEM_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_2 = "22222222-2222-4222-8222-222222222222";

function runCli(arguments_, { env = {}, expectedStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...arguments_], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  expect(result.status, result.stderr).toBe(expectedStatus);

  if (expectedStatus === 0) {
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]);
  }

  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).not.toBe("");
  return result;
}

function passingReview(itemId, overrides = {}) {
  return {
    schemaVersion: 1,
    itemId,
    regions: Object.fromEntries(CRITICAL_REGIONS.map((name) => [
      name,
      {
        status: overrides[name]?.status ?? "pass",
        confidence: overrides[name]?.confidence ?? 0.99,
        reason: overrides[name]?.reason ?? `${name} passes`,
      },
    ])),
  };
}

describe("resumable garment batch CLI", () => {
  let root;
  let input;
  let workspace;
  let intakeFile;
  let profileFile;
  let mannequinFile;
  let optimizerEnv;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wearit-batch-cli-"));
    input = path.join(root, "unprocessed", "Jackets");
    workspace = path.join(root, "batch");
    intakeFile = path.join(root, "intake.json");
    profileFile = path.join(root, "test-profile.json");
    mannequinFile = path.join(root, "mannequin.png");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "first.jpg"), "first source");
    await writeFile(path.join(input, "second.jpg"), "second source");
    await writeFile(intakeFile, JSON.stringify([
      {
        id: ITEM_1,
        slug: "first-jacket",
        name: "First jacket",
        sources: [{ file: "first.jpg", role: "front" }],
      },
      {
        id: ITEM_2,
        slug: "second-jacket",
        name: "Second jacket",
        sources: [{ file: "second.jpg", role: "front" }],
      },
    ]));
    await writeFile(profileFile, JSON.stringify({
      canvas: { width: 32, height: 64 },
      search: {
        anchorX: { min: 0.5, max: 0.5, coarseStep: 0.1, fineStep: 0.1 },
        anchorY: { min: 0.5, max: 0.5, coarseStep: 0.1, fineStep: 0.1 },
        scale: { min: 1, max: 1, coarseStep: 0.1, fineStep: 0.1 },
        rotationDegrees: [0],
        keepBest: 1,
        previewCount: 1,
      },
      criticalRegions: [{
        name: "torso",
        x: 8,
        y: 12,
        width: 16,
        height: 40,
        minCoverage: 0.8,
      }],
      forbiddenRegions: [],
      scoring: {
        requiredCoverageWeight: 1,
        uncoveredCriticalPenalty: 1,
        forbiddenCoveragePenalty: 1,
        asymmetryPenalty: 0,
        clippingPenalty: 1,
        neutralDistancePenalty: 0,
        scaleNeutralDistancePenalty: 0,
      },
    }));
    await sharp({
      create: {
        width: 32,
        height: 64,
        channels: 4,
        background: "#eeeeeeff",
      },
    }).png().toFile(mannequinFile);
    optimizerEnv = {
      WEARIT_BATCH_PROFILE: profileFile,
      WEARIT_BATCH_MANNEQUIN: mannequinFile,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function init() {
    return runCli([
      "init",
      "--input", input,
      "--workspace", workspace,
      "--intake", intakeFile,
    ]);
  }

  async function makeProduct(file, { opaque = false } = {}) {
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: opaque ? "#345678ff" : "#00000000",
      },
    }).composite(opaque ? [] : [{
      input: {
        create: {
          width: 20,
          height: 20,
          channels: 4,
          background: "#345678ff",
        },
      },
      left: 6,
      top: 6,
    }]).png().toFile(file);
  }

  async function makeWear(file) {
    await sharp({
      create: {
        width: 32,
        height: 64,
        channels: 4,
        background: "#00000000",
      },
    }).composite([{
      input: {
        create: {
          width: 16,
          height: 40,
          channels: 4,
          background: "#345678ff",
        },
      },
      left: 8,
      top: 12,
    }]).png().toFile(file);
  }

  async function stageAssets(itemId, suffix = "one", generated = true) {
    const staging = path.join(workspace, "staging");
    await mkdir(staging, { recursive: true });
    const product = path.join(staging, `product-${suffix}.png`);
    const wear = path.join(staging, `wear-${suffix}.png`);
    await makeProduct(product);
    await makeWear(wear);
    runCli([
      "record-asset",
      "--workspace", workspace,
      "--item", itemId,
      "--kind", "product-image",
      "--file", product,
    ]);
    runCli([
      "record-asset",
      "--workspace", workspace,
      "--item", itemId,
      "--kind", "wear-layer",
      "--file", wear,
      ...(generated ? ["--generated"] : []),
    ]);
    return { product, wear };
  }

  async function inspectAndOptimize(itemId) {
    const inspection = runCli([
      "inspect",
      "--workspace", workspace,
      "--item", itemId,
    ], { env: optimizerEnv });
    expect(inspection.structural).toMatchObject({
      itemId,
      pass: true,
      failures: [],
      product: { pass: true },
      wear: { pass: true },
    });

    const optimized = runCli([
      "optimize",
      "--workspace", workspace,
      "--item", itemId,
    ], { env: optimizerEnv });
    expect(optimized.placement).toMatchObject({
      itemId,
      placement: {
        anchorX: 0.5,
        anchorY: 0.5,
        scale: 1,
        rotationDegrees: 0,
      },
      metrics: {
        uncoveredCriticalRegions: [],
        forbiddenRegionViolations: [],
        clippingFraction: 0,
      },
    });
    expect(optimized.placement.candidates).toHaveLength(1);
  }

  it("initializes v3 state, reports one resumable action, and resumes idempotently", async () => {
    const initialized = await init();
    expect(initialized).toMatchObject({
      command: "init",
      version: 3,
      total: 2,
    });
    for (const directory of [
      "accepted/product-images",
      "accepted/wear-layers",
      "accepted/mannequin-previews",
      "attempts",
      "quarantine",
      "audit/contact-sheets",
      "reports",
    ]) {
      await expect(
        import("node:fs/promises").then(({ stat }) =>
          stat(path.join(workspace, directory))),
      ).resolves.toMatchObject({});
    }

    expect(runCli(["next", "--workspace", workspace])).toMatchObject({
      action: "generate",
      item: { id: ITEM_1, slug: "first-jacket" },
      generationAttempt: 1,
    });
    expect((await init()).resumed).toBe(true);
    expect(runCli(["status", "--workspace", workspace])).toMatchObject({
      command: "status",
      counts: { total: 2, ready: 2, terminal: 0 },
      next: { action: "generate", item: { id: ITEM_1 } },
    });
  });

  it("versions immutable assets and refuses a fourth generated asset", async () => {
    await init();
    const staging = path.join(workspace, "staging");
    await mkdir(staging);
    const source = path.join(staging, "wear.png");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await writeFile(source, `generated-${attempt}`);
      const output = runCli([
        "record-asset",
        "--workspace", workspace,
        "--item", ITEM_1,
        "--kind", "wear-layer",
        "--file", source,
        "--generated",
      ]);
      expect(output.asset.version).toBe(attempt);
      expect(output.generationAttempts).toBe(attempt);
      if (attempt === 1) {
        await writeFile(source, "changed later");
        expect(await readFile(output.asset.path, "utf8")).toBe("generated-1");
      }
    }

    await writeFile(source, "generated-4");
    runCli([
      "record-asset",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--kind", "wear-layer",
      "--file", source,
      "--generated",
    ], { expectedStatus: 1 });
    const state = JSON.parse(
      await readFile(path.join(workspace, "run-state.json"), "utf8"),
    );
    expect(state.items[0].generationAttempts).toBe(3);
    expect(state.items[0].attempts).toHaveLength(3);
  });

  it("records real inspection metrics and one real optimized preview", async () => {
    await init();
    await stageAssets(ITEM_1);
    await inspectAndOptimize(ITEM_1);

    expect(runCli(["next", "--workspace", workspace])).toMatchObject({
      action: "review",
      item: { id: ITEM_1 },
    });
    const state = JSON.parse(
      await readFile(path.join(workspace, "run-state.json"), "utf8"),
    );
    expect(state.items[0].structural.wear.dimensions).toMatchObject({
      width: 32,
      height: 64,
      matches: true,
    });
    expect(state.items[0].placement.candidates[0].previewPath)
      .toContain(path.join("attempts", "first-jacket"));
  });

  it("preserves a passing product across a targeted wear retry and accepts", async () => {
    await init();
    await stageAssets(ITEM_1, "initial");
    await inspectAndOptimize(ITEM_1);
    const reviewFile = path.join(root, "retry-review.json");
    const review = passingReview(ITEM_1, {
      leftSleeve: {
        status: "fail",
        confidence: 0.99,
        reason: "Sleeve needs more coverage",
      },
    });
    await writeFile(reviewFile, JSON.stringify(review));

    const retried = runCli([
      "record-review",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--review", reviewFile,
    ]);
    expect(retried).toMatchObject({
      decision: {
        decision: "retry",
        reason: "targeted-generation-correction",
        correction: {
          target: "left-sleeve",
          preserve: ["product-image"],
        },
      },
    });
    const acceptedProduct = retried.acceptedAssets["product-image"];
    expect(acceptedProduct.path).toContain("product-image-v001");
    expect(runCli(["next", "--workspace", workspace])).toMatchObject({
      action: "generate",
      correction: { target: "left-sleeve" },
      preserve: ["product-image"],
    });

    const staging = path.join(workspace, "staging");
    const retryWear = path.join(staging, "wear-retry.png");
    await makeWear(retryWear);
    runCli([
      "record-asset",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--kind", "wear-layer",
      "--file", retryWear,
      "--generated",
    ]);
    await inspectAndOptimize(ITEM_1);
    const passFile = path.join(root, "pass-review.json");
    await writeFile(passFile, JSON.stringify(passingReview(ITEM_1)));
    expect(runCli([
      "record-review",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--review", passFile,
    ])).toMatchObject({
      decision: { decision: "accept" },
      status: "accepted",
      acceptedAssets: {
        "product-image": acceptedProduct,
        "wear-layer": { version: 2 },
      },
    });
  });

  it("persists deterministic attempts, quarantines no-progress, and continues", async () => {
    await init();
    await stageAssets(ITEM_1, "bad", false);
    const stateFile = path.join(workspace, "run-state.json");
    let state = JSON.parse(await readFile(stateFile, "utf8"));
    const firstWear = state.items[0].attempts.find(
      ({ kind }) => kind === "wear-layer",
    );
    // Replace the selected wear candidate with a structurally repairable image.
    await sharp({
      create: {
        width: 32,
        height: 64,
        channels: 4,
        background: "#00000000",
      },
    }).composite([{
      input: {
        create: {
          width: 16,
          height: 40,
          channels: 4,
          background: "#14c912ff",
        },
      },
      left: 8,
      top: 12,
    }]).png().toFile(path.join(workspace, "staging", "chroma.png"));
    runCli([
      "record-asset",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--kind", "wear-layer",
      "--file", path.join(workspace, "staging", "chroma.png"),
    ]);
    expect(firstWear).toBeDefined();

    const reviewFile = path.join(root, "structural-review.json");
    await writeFile(reviewFile, JSON.stringify(passingReview(ITEM_1)));
    runCli([
      "inspect",
      "--workspace", workspace,
      "--item", ITEM_1,
    ], { env: optimizerEnv });
    expect(runCli([
      "record-review",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--review", reviewFile,
    ])).toMatchObject({
      decision: {
        decision: "retry",
        correction: { target: "deterministic-cleanup" },
      },
      deterministicAttempts: { cleanup: 1, placement: 0 },
    });

    runCli([
      "inspect",
      "--workspace", workspace,
      "--item", ITEM_1,
    ], { env: optimizerEnv });
    expect(runCli([
      "record-review",
      "--workspace", workspace,
      "--item", ITEM_1,
      "--review", reviewFile,
    ])).toMatchObject({
      decision: {
        decision: "quarantine",
        reason: "deterministic-no-progress",
      },
      status: "quarantined",
    });
    expect(runCli(["next", "--workspace", workspace])).toMatchObject({
      action: "generate",
      item: { id: ITEM_2 },
    });

    state = JSON.parse(await readFile(stateFile, "utf8"));
    expect(state.items[0].deterministicAttempts).toEqual({
      cleanup: 1,
      placement: 0,
    });
  });

  it("emits completion after all items are terminal", async () => {
    await init();
    const stateFile = path.join(workspace, "run-state.json");
    const { updateItem } = await import(
      "../../scripts/wearit-images/state.mjs"
    );
    await updateItem(stateFile, ITEM_1, (item) => ({
      ...item,
      status: "quarantined",
    }));
    await updateItem(stateFile, ITEM_2, (item) => ({
      ...item,
      status: "accepted",
    }));

    expect(runCli(["next", "--workspace", workspace])).toEqual({
      action: "complete",
      counts: {
        total: 2,
        accepted: 1,
        quarantined: 1,
        "failed-infrastructure": 0,
        terminal: 2,
      },
    });
  });

  it("uses exit code 2 for malformed arguments and exit code 1 for runtime errors", () => {
    runCli(["next"], { expectedStatus: 2 });
    runCli(["not-a-command"], { expectedStatus: 2 });
    runCli(["next", "--workspace", path.join(root, "missing")], {
      expectedStatus: 1,
    });
  });
});
