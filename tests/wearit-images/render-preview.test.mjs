import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import { renderMannequinPreview } from "../../scripts/wearit-images/render-preview.mjs";

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

async function makeFixture() {
  const work = await mkdtemp(path.join(os.tmpdir(), "wearit-preview-test-"));
  workspaces.push(work);
  const mannequin = path.join(work, "mannequin.png");
  const layer = path.join(work, "layer.png");
  const output = path.join(work, "preview.png");
  await sharp({
    create: { width: 100, height: 200, channels: 4, background: "#ffffff" },
  }).png().toFile(mannequin);
  await sharp({
    create: { width: 100, height: 200, channels: 4, background: "#ff0000" },
  }).png().toFile(layer);
  return { work, mannequin, layer, output };
}

function render({ mannequin, layer, output }, {
  anchorX = "0.5",
  anchorY = "0.5",
  scale = "1",
  rotationDegrees = "0",
} = {}) {
  return spawnSync(process.execPath, [
    script,
    "--repo", repo,
    "--mannequin", mannequin,
    "--wear-layer", layer,
    "--output", output,
    "--anchor-x", anchorX,
    "--anchor-y", anchorY,
    "--scale", scale,
    "--rotation-degrees", rotationDegrees,
  ], { encoding: "utf8" });
}

function renderDirect({ mannequin, layer, output }, {
  anchorX = 0.5,
  anchorY = 0.5,
  scale = 1,
  rotationDegrees = 0,
} = {}) {
  return renderMannequinPreview({
    repo,
    mannequin,
    wearLayer: layer,
    output,
    anchorX,
    anchorY,
    scale,
    rotationDegrees,
  });
}

async function readOutput(file) {
  const image = sharp(file);
  const metadata = await image.metadata()
    .then(({ width, height }) => ({ width, height }));
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [
    ...data.subarray(
      (y * info.width + x) * info.channels,
      (y * info.width + x + 1) * info.channels,
    ),
  ];
  return { metadata, pixel };
}

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

it("clips a full-canvas layer shifted to anchorX 0.51", async () => {
  const fixture = await makeFixture();

  const result = await renderDirect(fixture, { anchorX: 0.51 });

  expect(result).toMatchObject({
    width: 100,
    height: 200,
    garmentWidth: 100,
    garmentHeight: 200,
    left: 1,
    top: 0,
    clipped: true,
    crop: { left: 0, top: 0, width: 99, height: 200 },
    composite: { left: 1, top: 0, width: 99, height: 200 },
  });
  const output = await readOutput(fixture.output);
  expect(output.metadata).toEqual({ width: 100, height: 200 });
  expect(output.pixel(0, 100)).toEqual([255, 255, 255, 255]);
  expect(output.pixel(1, 100)).toEqual([255, 0, 0, 255]);
  expect(output.pixel(99, 100)).toEqual([255, 0, 0, 255]);
});

it("clips a full-canvas layer at scale 1.01", async () => {
  const fixture = await makeFixture();

  const result = await renderDirect(fixture, { scale: 1.01 });

  expect(result).toMatchObject({
    width: 100,
    height: 200,
    garmentWidth: 101,
    garmentHeight: 202,
    left: 0,
    top: -1,
    clipped: true,
    crop: { left: 0, top: 1, width: 100, height: 200 },
    composite: { left: 0, top: 0, width: 100, height: 200 },
  });
  const output = await readOutput(fixture.output);
  expect(output.metadata).toEqual({ width: 100, height: 200 });
  expect(output.pixel(0, 0)).toEqual([255, 0, 0, 255]);
  expect(output.pixel(99, 199)).toEqual([255, 0, 0, 255]);
});

it("clips a rotated full-canvas layer at rotation 5 and scale 0.95", async () => {
  const fixture = await makeFixture();

  const result = await renderDirect(fixture, {
    scale: 0.95,
    rotationDegrees: 5,
  });

  expect(result).toMatchObject({
    width: 100,
    height: 200,
    garmentWidth: 111,
    garmentHeight: 198,
    left: -5,
    top: 1,
    clipped: true,
    crop: { left: 5, top: 0, width: 100, height: 198 },
    composite: { left: 0, top: 1, width: 100, height: 198 },
  });
  const output = await readOutput(fixture.output);
  expect(output.metadata).toEqual({ width: 100, height: 200 });
  expect(output.pixel(50, 0)).toEqual([255, 255, 255, 255]);
  expect(output.pixel(50, 100)).toEqual([255, 0, 0, 255]);
  expect(output.pixel(50, 199)).toEqual([255, 255, 255, 255]);
});

it("rejects same-path and symlink-alias preview outputs", async () => {
  const fixture = await makeFixture();
  const alias = path.join(fixture.work, "layer-alias.png");
  await symlink(fixture.layer, alias);
  const sourceBefore = await readFile(fixture.layer);

  await expect(renderDirect({
    ...fixture,
    output: fixture.layer,
  })).rejects.toThrow(/output.*input|same path|alias/i);
  await expect(renderDirect({
    ...fixture,
    output: alias,
  })).rejects.toThrow(/output.*input|same path|alias/i);

  expect(await readFile(fixture.layer)).toEqual(sourceBefore);
});

it("rejects an existing preview output without overwriting it", async () => {
  const fixture = await makeFixture();
  const sentinel = Buffer.from("existing preview");
  await writeFile(fixture.output, sentinel);

  await expect(renderDirect(fixture)).rejects.toThrow(/output.*exists/i);

  expect(await readFile(fixture.output)).toEqual(sentinel);
});

it("cleans sibling preview temporaries when rendering fails", async () => {
  const fixture = await makeFixture();

  await expect(renderDirect(fixture, {
    anchorX: 2,
    scale: 0.2,
  })).rejects.toThrow(/does not intersect/i);

  expect(await readdir(fixture.work)).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^\.preview\.png\..*\.tmp$/),
    ]),
  );
});
