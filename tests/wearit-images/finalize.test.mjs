import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptedManifest,
  finalizeBatch,
  preflightSourceMoves,
  processedDestination,
} from "../../scripts/wearit-images/finalize.mjs";

const CLI = path.resolve("scripts/wearit-images/batch.mjs");
const ACCEPTED_ID = "11111111-1111-4111-8111-111111111111";
const QUARANTINED_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const PLACEMENT = {
  anchorX: 0.5,
  anchorY: 0.38,
  scale: 0.66,
  rotationDegrees: 0,
  layerOrder: 40,
};
const BYTES = {
  wearLayers: 101,
  productImages: 202,
  manifest: 303,
  total: 606,
};

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function exists(file) {
  return access(file).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

function fakeBundleBuilder({ failAt } = {}) {
  const calls = [];
  let written = false;
  const prepare = async (options) => {
    calls.push(options);
    if (calls.length === failAt) throw new Error("simulated bundle failure");
    const input = JSON.parse(await readFile(options.manifestFile, "utf8"));
    expect(input).toMatchObject({ version: 2, items: [{ id: ACCEPTED_ID }] });
    if (!options.dryRun) written = true;
    return {
      dryRun: Boolean(options.dryRun),
      changed: !written,
      accepted: input.items.length,
      outputDir: options.outputDir,
      manifest: input,
      bytes: BYTES,
    };
  };
  return { calls, prepare };
}

describe("accepted-only garment finalization", () => {
  let root;
  let repositoryRoot;
  let input;
  let workspace;
  let bundleDir;
  let stateFile;
  let acceptedSource;
  let secondSource;
  let quarantinedSource;
  let product;
  let wear;
  let state;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wearit-finalize-"));
    repositoryRoot = path.join(root, "repo");
    input = path.join(root, "unprocessed", "Jackets");
    workspace = path.join(repositoryRoot, "data", "import-work", "batch");
    bundleDir = path.join(repositoryRoot, "data", "import-bundles", "batch");
    stateFile = path.join(workspace, "run-state.json");
    acceptedSource = path.join(input, "accepted-front.jpg");
    secondSource = path.join(input, "accepted-detail.jpg");
    quarantinedSource = path.join(input, "quarantined-front.jpg");
    product = path.join(workspace, "accepted", "product-images", "accepted.png");
    wear = path.join(workspace, "accepted", "wear-layers", "accepted.png");
    await mkdir(path.dirname(product), { recursive: true });
    await mkdir(path.dirname(wear), { recursive: true });
    await mkdir(input, { recursive: true });
    await writeFile(acceptedSource, "accepted source");
    await writeFile(secondSource, "accepted detail");
    await writeFile(quarantinedSource, "quarantined source");
    await writeFile(product, "product");
    await writeFile(wear, "wear");

    state = {
      version: 3,
      inputPath: input,
      workspacePath: workspace,
      infrastructureErrors: [],
      items: [
        {
          id: ACCEPTED_ID,
          slug: "accepted-jacket",
          name: "Accepted jacket",
          category: "jacket",
          status: "accepted",
          metadata: {
            colors: ["#172033", "#f2efe6"],
            tags: ["jacket", "navy"],
            productImageId: PRODUCT_ID,
          },
          sources: [{
            path: acceptedSource,
            role: "front",
            size: Buffer.byteLength("accepted source"),
            sha256: digest("accepted source"),
          }],
          acceptedAssets: {
            "product-image": { path: product },
            "wear-layer": { path: wear },
          },
          placement: { placement: PLACEMENT },
        },
        {
          id: QUARANTINED_ID,
          slug: "quarantined-jacket",
          name: "Quarantined jacket",
          category: "jacket",
          status: "quarantined",
          sources: [{
            path: quarantinedSource,
            role: "front",
            size: Buffer.byteLength("quarantined source"),
            sha256: digest("quarantined source"),
          }],
          acceptedAssets: {},
          placement: null,
        },
      ],
    };
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a complete version-2 manifest containing only accepted items", () => {
    expect(acceptedManifest(state)).toEqual({
      version: 2,
      items: [{
        id: ACCEPTED_ID,
        name: "Accepted jacket",
        category: "jacket",
        wearLayerFile: "accepted/wear-layers/accepted.png",
        images: [{
          id: PRODUCT_ID,
          file: "accepted/product-images/accepted.png",
          view: "front",
          sortOrder: 0,
          isPrimary: true,
        }],
        colors: ["#172033", "#f2efe6"],
        tags: ["jacket", "navy"],
        placement: PLACEMENT,
        status: "accepted",
      }],
    });
  });

  it.each([
    ["metadata", (item) => { delete item.metadata; }],
    ["colors", (item) => { item.metadata.colors = []; }],
    ["tags", (item) => { delete item.metadata.tags; }],
    ["product UUID", (item) => { item.metadata.productImageId = ""; }],
    ["product asset", (item) => { delete item.acceptedAssets["product-image"]; }],
    ["wear asset", (item) => { delete item.acceptedAssets["wear-layer"]; }],
    ["placement", (item) => { item.placement = null; }],
  ])("rejects incomplete accepted %s instead of guessing", (_label, corrupt) => {
    corrupt(state.items[0]);
    expect(() => acceptedManifest(state)).toThrow();
  });

  it("accepts a direct normalized selected placement", () => {
    state.items[0].placement = PLACEMENT;
    expect(acceptedManifest(state).items[0].placement).toEqual(PLACEMENT);
  });

  it.each([
    ["/pictures/unprocessed/Jackets/front.jpg", "/pictures/processed/Jackets/front.jpg"],
    ["/pictures/unprocessed/Jackets/nested/front.jpg", "/pictures/processed/Jackets/nested/front.jpg"],
  ])("maps the exact unprocessed segment and preserves its remainder", (source, expected) => {
    expect(processedDestination(source)).toBe(expected);
  });

  it.each([
    "/pictures/Jackets/front.jpg",
    "/pictures/unprocessed/unprocessed/Jackets/front.jpg",
    "/pictures/unprocessed/Shirts/front.jpg",
    "/pictures/unprocessed/Jackets",
    "unprocessed/Jackets/front.jpg",
    "/pictures/not-unprocessed/Jackets/front.jpg",
  ])("rejects ambiguous or out-of-tree source paths: %s", (source) => {
    expect(() => processedDestination(source)).toThrow();
  });

  it("preflights all accepted destinations and rejects duplicates", async () => {
    state.items[0].sources.push({ ...state.items[0].sources[0] });
    await expect(preflightSourceMoves(state)).rejects.toThrow(/duplicate/i);
    expect(await exists(acceptedSource)).toBe(true);
  });

  it("runs dry-run, write, dry-run and requires final changed false", async () => {
    const builder = fakeBundleBuilder();
    const result = await finalizeBatch({
      stateFile,
      repositoryRoot,
      bundleDir,
      prepareBundle: builder.prepare,
    });

    expect(builder.calls.map(({ dryRun }) => dryRun)).toEqual([true, false, true]);
    expect(builder.calls.every(({ itemsDir, manifestFile, outputDir }) =>
      itemsDir === workspace
      && manifestFile === path.join(workspace, "reviewed-items.v2.json")
      && outputDir === bundleDir
    )).toBe(true);
    expect(result).toMatchObject({ accepted: 1, outputDir: bundleDir, bytes: BYTES });
    expect(result.changed).toBe(false);
  });

  it("persists a builder infrastructure stop and moves no source", async () => {
    await expect(finalizeBatch({
      stateFile,
      repositoryRoot,
      bundleDir,
      prepareBundle: fakeBundleBuilder({ failAt: 2 }).prepare,
    })).rejects.toThrow(/simulated bundle failure/i);

    expect(await exists(acceptedSource)).toBe(true);
    expect(await exists(quarantinedSource)).toBe(true);
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    expect(persisted.finalization).toMatchObject({
      status: "failed-infrastructure",
      cause: { message: expect.stringMatching(/simulated bundle failure/i) },
    });
  });

  it("detects any destination collision before moving the first source", async () => {
    state.items[0].sources.push({
      path: secondSource,
      role: "detail",
      size: Buffer.byteLength("accepted detail"),
      sha256: digest("accepted detail"),
    });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const collision = processedDestination(secondSource);
    await mkdir(path.dirname(collision), { recursive: true });
    await writeFile(collision, "existing");

    await expect(finalizeBatch({
      stateFile,
      repositoryRoot,
      bundleDir,
      prepareBundle: fakeBundleBuilder().prepare,
    })).rejects.toThrow(/collision/i);

    expect(await readFile(acceptedSource, "utf8")).toBe("accepted source");
    expect(await readFile(secondSource, "utf8")).toBe("accepted detail");
    expect(await readFile(collision, "utf8")).toBe("existing");
  });

  it("moves accepted sources and leaves quarantined sources untouched", async () => {
    await finalizeBatch({
      stateFile,
      repositoryRoot,
      bundleDir,
      prepareBundle: fakeBundleBuilder().prepare,
    });

    const destination = processedDestination(acceptedSource);
    expect(await readFile(destination, "utf8")).toBe("accepted source");
    expect(await exists(acceptedSource)).toBe(false);
    expect(await readFile(quarantinedSource, "utf8")).toBe("quarantined source");
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    expect(persisted.items[0].sources[0]).toMatchObject({
      originalPath: acceptedSource,
      path: destination,
      processedAt: expect.any(String),
    });
    expect(persisted.items[1].sources[0].path).toBe(quarantinedSource);
  });

  it("resumes after a previously persisted partial source move", async () => {
    state.items[0].sources.push({
      path: secondSource,
      role: "detail",
      size: Buffer.byteLength("accepted detail"),
      sha256: digest("accepted detail"),
    });
    const firstDestination = processedDestination(acceptedSource);
    await mkdir(path.dirname(firstDestination), { recursive: true });
    await rename(acceptedSource, firstDestination);
    state.items[0].sources[0] = {
      ...state.items[0].sources[0],
      originalPath: acceptedSource,
      path: firstDestination,
      processedAt: "2026-07-29T12:00:00.000Z",
    };
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);

    await finalizeBatch({
      stateFile,
      repositoryRoot,
      bundleDir,
      prepareBundle: fakeBundleBuilder().prepare,
    });

    expect(await readFile(firstDestination, "utf8")).toBe("accepted source");
    expect(await readFile(processedDestination(secondSource), "utf8"))
      .toBe("accepted detail");
    expect(await exists(secondSource)).toBe(false);
  });

  it("rejects a symlinked accepted destination during preflight", async () => {
    const destination = processedDestination(acceptedSource);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(secondSource, destination);

    await expect(preflightSourceMoves(state)).rejects.toThrow(/symlink|collision/i);
    expect(await exists(acceptedSource)).toBe(true);
  });

  it("prints one finalize JSON result and never uploads", async () => {
    await sharp({
      create: { width: 800, height: 600, channels: 4, background: "#00000000" },
    }).composite([{
      input: { create: { width: 400, height: 400, channels: 4, background: "#172033ff" } },
      left: 200,
      top: 100,
    }]).png().toFile(product);
    await sharp({
      create: { width: 887, height: 1774, channels: 4, background: "#00000000" },
    }).composite([{
      input: { create: { width: 400, height: 700, channels: 4, background: "#172033ff" } },
      left: 243,
      top: 500,
    }]).png().toFile(wear);

    const result = spawnSync(process.execPath, [
      CLI,
      "finalize",
      "--workspace", workspace,
      "--repo", repositoryRoot,
      "--bundle", bundleDir,
    ], { cwd: path.resolve("."), encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      command: "finalize",
      bundle: bundleDir,
      accepted: 1,
      bytes: {
        wearLayers: expect.any(Number),
        productImages: expect.any(Number),
        manifest: expect.any(Number),
        total: expect.any(Number),
      },
      uploaded: false,
    });
  });

  it("rejects a bundle inside the workspace without moving sources", () => {
    const result = spawnSync(process.execPath, [
      CLI,
      "finalize",
      "--workspace", workspace,
      "--repo", repositoryRoot,
      "--bundle", path.join(workspace, "bundle"),
    ], { cwd: path.resolve("."), encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/bundle.*workspace|overlap/i);
  });
});
