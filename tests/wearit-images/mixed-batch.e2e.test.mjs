import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { updateItem } from "../../scripts/wearit-images/state.mjs";

const CLI = path.resolve("scripts/wearit-images/batch.mjs");
const ITEMS = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "linen-top", category: "top", folder: "Tops" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "running-shoes", category: "shoes", folder: "Shoes" },
  { id: "33333333-3333-4333-8333-333333333333", slug: "wool-hat", category: "hat", folder: "Hats" },
];

function runCli(args, { expectedStatus = 0, env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, ...env },
  });
  expect(result.status, result.stderr).toBe(expectedStatus);
  if (expectedStatus !== 0) return result;
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout.trim());
}

async function image(file, { width, height, alpha = true } = {}) {
  const base = sharp({ create: { width, height, channels: 4, background: alpha ? "#00000000" : "#eeeeeeff" } });
  const output = alpha
    ? base.composite([{ input: { create: { width: Math.max(80, Math.floor(width * 0.35)), height: Math.max(80, Math.floor(height * 0.35)), channels: 4, background: "#345678ff" }, left: Math.floor(width * 0.325), top: Math.floor(height * 0.325) } }])
    : base;
  await output.png().toFile(file);
}

function reviewFor(itemId, regions) {
  return { schemaVersion: 1, itemId, regions: Object.fromEntries(regions.map((name) => [name, { status: "pass", confidence: 0.99, reason: `${name} passes` }])) };
}

describe("mixed category batch lifecycle", () => {
  let root;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("processes Tops/Shoes/Hats end-to-end, isolates quarantine/infrastructure, moves sources, and resumes idempotently", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wearit-mixed-e2e-"));
    const input = path.join(root, "unprocessed");
    const workspace = path.join(root, "workspace");
    const bundle = path.join(root, "bundle");
    const mannequin = path.join(root, "mannequin.png");
    await mkdir(input, { recursive: true });
    for (const item of ITEMS) {
      await mkdir(path.join(input, item.folder), { recursive: true });
      await writeFile(path.join(input, item.folder, `${item.slug}.jpg`), `${item.slug}-source`);
    }
    await image(mannequin, { width: 887, height: 1774, alpha: false });
    const intake = ITEMS.map((item) => ({
      id: item.id, slug: item.slug, name: item.slug, category: item.category,
      metadata: { images: [{ id: `${item.id.slice(0, 8)}-0000-4000-8000-000000000001`, view: "front", sortOrder: 0, isPrimary: true }] },
      sources: [{ file: `${item.folder}/${item.slug}.jpg`, role: "front" }],
    }));
    const intakeFile = path.join(root, "intake.json");
    await writeFile(intakeFile, JSON.stringify(intake));

    expect(runCli(["init", "--input", input, "--workspace", workspace, "--intake", intakeFile])).toMatchObject({ version: 4, total: 3 });
    expect(runCli(["init", "--input", input, "--workspace", workspace, "--intake", intakeFile])).toMatchObject({ resumed: true });
    const state = JSON.parse(await readFile(path.join(workspace, "run-state.json"), "utf8"));
    expect(state.inputMode).toBe("mixed");
    expect(state.items.map(({ category }) => category)).toEqual(["top", "shoes", "hat"]);

    for (const item of ITEMS) {
      const staging = path.join(workspace, "staging");
      await mkdir(staging, { recursive: true });
      const product = path.join(staging, `${item.slug}-product.png`);
      const wear = path.join(staging, `${item.slug}-wear.png`);
      await image(product, { width: 256, height: 256 });
      await image(wear, { width: 887, height: 1774 });
      const imageId = intake.find(({ id }) => id === item.id).metadata.images[0].id;
      runCli(["record-asset", "--workspace", workspace, "--item", item.id, "--kind", "product-image", "--image-id", imageId, "--view", "front", "--file", product]);
      runCli(["record-asset", "--workspace", workspace, "--item", item.id, "--kind", "wear-layer", "--file", wear, "--generated"]);
      expect(runCli(["inspect", "--workspace", workspace, "--item", item.id])).toMatchObject({ structural: { pass: true } });
      expect(runCli(["optimize", "--workspace", workspace, "--item", item.id], { env: { WEARIT_BATCH_MANNEQUIN: mannequin } })).toMatchObject({ placement: { itemId: item.id } });
      const current = JSON.parse(await readFile(path.join(workspace, "run-state.json"), "utf8"));
      const regions = current.items.find(({ id }) => id === item.id).profile ? (await import("../../scripts/wearit-images/profiles.mjs")).profileForCategory(await (await import("../../scripts/wearit-images/profiles.mjs")).loadProfiles(), item.category).reviewRegions : [];
      const reviewFile = path.join(root, `${item.slug}-review.json`);
      await writeFile(reviewFile, JSON.stringify(reviewFor(item.id, regions)));
      expect(runCli(["record-review", "--workspace", workspace, "--item", item.id, "--review", reviewFile])).toMatchObject({ status: "accepted", decision: { decision: "accept" } });
    }

    const finalized = runCli(["finalize", "--workspace", workspace, "--repo", root, "--bundle", bundle]);
    expect(finalized).toMatchObject({ command: "finalize", accepted: 3, uploaded: false });
    for (const item of ITEMS) {
      await expect(stat(path.join(root, "processed", item.folder, `${item.slug}.jpg`))).resolves.toBeDefined();
      await expect(stat(path.join(input, item.folder, `${item.slug}.jpg`))).rejects.toMatchObject({ code: "ENOENT" });
    }
    const resumedFinalize = runCli(["finalize", "--workspace", workspace, "--repo", root, "--bundle", bundle]);
    expect(resumedFinalize).toMatchObject({ accepted: 3, uploaded: false });
  });

  it("keeps quarantined sources isolated and stops on infrastructure failure", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wearit-mixed-stop-"));
    const input = path.join(root, "unprocessed");
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(input, "Tops"), { recursive: true });
    await mkdir(path.join(input, "Shoes"), { recursive: true });
    await writeFile(path.join(input, "Tops", "quarantined.jpg"), "quarantine-source");
    await writeFile(path.join(input, "Shoes", "blocked.jpg"), "blocked-source");
    const intakeFile = path.join(root, "intake.json");
    await writeFile(intakeFile, JSON.stringify([
      { id: ITEMS[0].id, slug: "quarantined-top", name: "Quarantined top", category: "top", sources: [{ file: "Tops/quarantined.jpg", role: "front" }] },
      { id: ITEMS[1].id, slug: "blocked-shoes", name: "Blocked shoes", category: "shoes", sources: [{ file: "Shoes/blocked.jpg", role: "front" }] },
    ]));
    runCli(["init", "--input", input, "--workspace", workspace, "--intake", intakeFile]);
    const stateFile = path.join(workspace, "run-state.json");
    await updateItem(stateFile, ITEMS[0].id, (item) => ({ ...item, status: "quarantined", quarantine: { reason: "test-isolation" } }));
    await updateItem(stateFile, ITEMS[1].id, (item) => ({ ...item, status: "failed-infrastructure" }));
    expect(runCli(["next", "--workspace", workspace])).toMatchObject({ action: "infrastructure-stop", item: { id: ITEMS[1].id } });
    expect(runCli(["status", "--workspace", workspace])).toMatchObject({ counts: { quarantined: 1, "failed-infrastructure": 1, terminal: 2 } });
    await expect(stat(path.join(input, "Tops", "quarantined.jpg"))).resolves.toBeDefined();
    await expect(stat(path.join(input, "Shoes", "blocked.jpg"))).resolves.toBeDefined();
  });
});
