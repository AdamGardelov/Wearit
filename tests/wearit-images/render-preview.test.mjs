import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";

const repo = path.resolve(".");
const script = path.resolve("scripts/wearit-images/render-preview.mjs");
const workspaces = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("renders the exact wear layer with Wearit's placement semantics", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "wearit-preview-test-"));
  workspaces.push(work);
  const mannequin = path.join(work, "mannequin.png");
  const layer = path.join(work, "layer.png");
  const output = path.join(work, "preview.png");

  await sharp({
    create: { width: 100, height: 200, channels: 4, background: "#ffffff" },
  }).png().toFile(mannequin);
  await sharp({
    create: { width: 20, height: 40, channels: 4, background: "#ff0000" },
  }).png().toFile(layer);

  const result = spawnSync(process.execPath, [
    script,
    "--repo", repo,
    "--mannequin", mannequin,
    "--wear-layer", layer,
    "--output", output,
    "--anchor-x", "0.5",
    "--anchor-y", "0.5",
    "--scale", "0.2",
    "--rotation-degrees", "0",
  ], { encoding: "utf8" });

  expect(result.status, result.stderr).toBe(0);
  const image = sharp(output);
  expect(await image.metadata().then(({ width, height }) => ({ width, height })))
    .toEqual({ width: 100, height: 200 });

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [
    ...data.subarray(
      (y * info.width + x) * info.channels,
      (y * info.width + x + 1) * info.channels,
    ),
  ];
  expect(pixel(39, 79)).toEqual([255, 255, 255, 255]);
  expect(pixel(40, 80)).toEqual([255, 0, 0, 255]);
  expect(pixel(59, 119)).toEqual([255, 0, 0, 255]);
  expect(pixel(60, 120)).toEqual([255, 255, 255, 255]);
});
