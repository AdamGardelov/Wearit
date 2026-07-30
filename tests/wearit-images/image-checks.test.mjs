import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectProductImage,
  inspectWearLayer,
} from "../../scripts/wearit-images/image-checks.mjs";

const REMOVE_CHROMA_SCRIPT = path.resolve(
  "scripts/wearit-images/remove-dual-chroma.py",
);

describe("deterministic image checks", () => {
  const workspaces = [];

  afterEach(async () => {
    await Promise.all(
      workspaces.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function makeWorkspace() {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "wearit-image-checks-"),
    );
    workspaces.push(directory);
    return directory;
  }

  async function writeLayer(
    file,
    {
      width = 887,
      height = 1774,
      background = { r: 0, g: 0, b: 0, alpha: 0 },
      overlays = [{
        input: {
          create: {
            width: 400,
            height: 900,
            channels: 4,
            background: { r: 80, g: 50, b: 35, alpha: 1 },
          },
        },
        left: 243,
        top: 400,
      }],
    } = {},
  ) {
    await sharp({
      create: { width, height, channels: 4, background },
    }).composite(overlays).png().toFile(file);
  }

  it("accepts a correctly sized transparent wear layer", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "valid.png");
    await writeLayer(file);

    expect(await inspectWearLayer(file)).toMatchObject({
      pass: true,
      failures: [],
      source: {
        format: "png",
        space: "srgb",
        channels: 4,
        hasAlpha: true,
        isPalette: false,
      },
      dimensions: { width: 887, height: 1774 },
      alpha: { hasTransparent: true, hasVisible: true },
      chroma: { suspiciousPixels: 0 },
    });
  });

  it("rejects a wear layer with the wrong dimensions", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "wrong-size.png");
    await writeLayer(file, { width: 886 });

    expect((await inspectWearLayer(file)).failures).toContain("dimensions");
  });

  it("rejects a fully opaque wear layer", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "opaque.png");
    await writeLayer(file, {
      background: { r: 80, g: 50, b: 35, alpha: 1 },
      overlays: [],
    });

    expect((await inspectWearLayer(file)).failures).toContain("alpha");
  });

  it("rejects a wear layer with only one visible pixel", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "one-pixel.png");
    await writeLayer(file, {
      overlays: [{
        input: {
          create: {
            width: 1,
            height: 1,
            channels: 4,
            background: { r: 80, g: 50, b: 35, alpha: 1 },
          },
        },
        left: 443,
        top: 887,
      }],
    });

    const result = await inspectWearLayer(file);

    expect(result.failures).toContain("content");
    expect(result.content).toMatchObject({
      visiblePixels: 1,
      largestComponentPixels: 1,
    });
  });

  it("rejects unsupported, non-alpha, and indexed wear-layer sources", async () => {
    const workspace = await makeWorkspace();
    const jpeg = path.join(workspace, "wear-layer.jpg");
    const rgb = path.join(workspace, "wear-layer-rgb.png");
    const indexed = path.join(workspace, "wear-layer-indexed.png");
    await sharp({
      create: {
        width: 887,
        height: 1774,
        channels: 3,
        background: { r: 80, g: 50, b: 35 },
      },
    }).jpeg().toFile(jpeg);
    await sharp({
      create: {
        width: 887,
        height: 1774,
        channels: 3,
        background: { r: 80, g: 50, b: 35 },
      },
    }).png().toFile(rgb);
    await sharp({
      create: {
        width: 887,
        height: 1774,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 400,
          height: 900,
          channels: 4,
          background: { r: 80, g: 50, b: 35, alpha: 1 },
        },
      },
      left: 243,
      top: 400,
    }]).png({ palette: true, colours: 16 }).toFile(indexed);

    expect((await inspectWearLayer(jpeg)).failures).toContain("format");
    expect((await inspectWearLayer(rgb)).failures).toEqual(
      expect.arrayContaining(["color-mode", "alpha"]),
    );
    expect((await inspectWearLayer(indexed)).failures).toContain("color-mode");
  });

  it("allows connected antialiased garment edges", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "antialiased.png");
    const body = Buffer.alloc(400 * 900 * 4);
    for (let y = 0; y < 900; y += 1) {
      for (let x = 0; x < 400; x += 1) {
        const offset = (y * 400 + x) * 4;
        body.set(
          [80, 50, 35, x === 0 || x === 399 ? 128 : 255],
          offset,
        );
      }
    }
    await writeLayer(file, {
      overlays: [{
        input: body,
        raw: { width: 400, height: 900, channels: 4 },
        left: 243,
        top: 400,
      }],
    });

    expect(await inspectWearLayer(file)).toMatchObject({
      pass: true,
      failures: [],
      alpha: { hasTransparent: true, hasVisible: true },
    });
  });

  it("rejects a detached 20-pixel island without rewriting the source", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "detached.png");
    await writeLayer(file, {
      overlays: [
        {
          input: {
            create: {
              width: 400,
              height: 900,
              channels: 4,
              background: { r: 80, g: 50, b: 35, alpha: 1 },
            },
          },
          left: 243,
          top: 400,
        },
        {
          input: {
            create: {
              width: 5,
              height: 4,
              channels: 4,
              background: { r: 90, g: 90, b: 70, alpha: 1 },
            },
          },
          left: 20,
          top: 20,
        },
      ],
    });
    const before = await readFile(file);

    const result = await inspectWearLayer(file);

    expect(result.failures).toContain("detached-components");
    expect(result.components).toMatchObject({
      detachedPixels: 20,
      largestDetachedPixels: 20,
    });
    expect(await readFile(file)).toEqual(before);
  });

  it("allows multiple disconnected garment-sized pieces", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "pieces.png");
    const garment = (width, height) => ({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 80, g: 50, b: 35, alpha: 1 },
      },
    });
    await writeLayer(file, {
      overlays: [
        { input: garment(260, 900), left: 313, top: 400 },
        { input: garment(70, 500), left: 180, top: 480 },
        { input: garment(70, 500), left: 637, top: 480 },
      ],
    });

    expect(await inspectWearLayer(file)).toMatchObject({
      pass: true,
      failures: [],
      components: { garmentComponents: 3, detachedPixels: 0 },
    });
  });

  it("rejects vivid green and magenta residue", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "residue.png");
    const body = Buffer.alloc(400 * 900 * 4, 0);
    for (let index = 0; index < body.length; index += 4) {
      body[index] = 80;
      body[index + 1] = 50;
      body[index + 2] = 35;
      body[index + 3] = 255;
    }
    body.set([20, 201, 18, 255], 4 * (100 * 400 + 100));
    body.set([255, 0, 255, 255], 4 * (200 * 400 + 200));
    body.set([28, 12, 40, 255], 4 * (300 * 400 + 300));
    await writeLayer(file, {
      overlays: [{
        input: body,
        raw: { width: 400, height: 900, channels: 4 },
        left: 243,
        top: 400,
      }],
    });

    const result = await inspectWearLayer(file);

    expect(result.failures).toContain("chroma-residue");
    expect(result.chroma.suspiciousPixels).toBe(3);
  });

  it("accepts production remover output with legitimate key-hued colors", async () => {
    const workspace = await makeWorkspace();
    const source = path.join(workspace, "dual-chroma.png");
    const output = path.join(workspace, "wear-layer.png");
    const width = 887;
    const height = 1774;
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([20, 201, 18, 255], index);
    }
    for (let y = 400; y < 1300; y += 1) {
      for (let x = 243; x < 643; x += 1) {
        pixels.set([80, 50, 35, 255], (y * width + x) * 4);
      }
    }
    const legitimateColors = [
      [55, 70, 55, 255],
      [70, 55, 70, 255],
      [190, 150, 35, 255],
      [35, 150, 190, 255],
    ];
    legitimateColors.forEach((color, index) => {
      pixels.set(color, ((500 + index) * width + 300) * 4);
    });
    await sharp(pixels, {
      raw: { width, height, channels: 4 },
    }).png().toFile(source);

    const removal = spawnSync("python3", [
      REMOVE_CHROMA_SCRIPT,
      "--input", source,
      "--out", output,
    ], { encoding: "utf8" });

    expect(removal.status, removal.stderr).toBe(0);
    expect(await inspectWearLayer(output)).toMatchObject({
      pass: true,
      failures: [],
      chroma: { suspiciousPixels: 0 },
    });
  }, 40_000);

  it("accepts transparent product images and rejects opaque ones", async () => {
    const workspace = await makeWorkspace();
    const transparent = path.join(workspace, "product-transparent.png");
    const opaque = path.join(workspace, "product-opaque.png");
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 200,
          height: 500,
          channels: 4,
          background: { r: 80, g: 50, b: 35, alpha: 1 },
        },
      },
      left: 100,
      top: 150,
    }]).png().toFile(transparent);
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 4,
        background: { r: 80, g: 50, b: 35, alpha: 1 },
      },
    }).png().toFile(opaque);

    expect(await inspectProductImage(transparent)).toMatchObject({
      pass: true,
      failures: [],
      dimensions: { width: 400, height: 800 },
      alpha: { hasTransparent: true, hasVisible: true },
    });
    expect((await inspectProductImage(opaque)).failures).toContain("alpha");
  });

  it("accepts transparent WebP product images", async () => {
    const workspace = await makeWorkspace();
    const file = path.join(workspace, "product.webp");
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 200,
          height: 500,
          channels: 4,
          background: { r: 80, g: 50, b: 35, alpha: 1 },
        },
      },
      left: 100,
      top: 150,
    }]).webp({ lossless: true }).toFile(file);

    expect(await inspectProductImage(file)).toMatchObject({
      pass: true,
      failures: [],
      source: { format: "webp", space: "srgb", channels: 4, hasAlpha: true },
    });
  });

  it("rejects trivial and unsupported product-image sources", async () => {
    const workspace = await makeWorkspace();
    const tiny = path.join(workspace, "product-tiny.png");
    const jpeg = path.join(workspace, "product.jpg");
    const indexed = path.join(workspace, "product-indexed.png");
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 1,
          height: 1,
          channels: 4,
          background: { r: 80, g: 50, b: 35, alpha: 1 },
        },
      },
      left: 200,
      top: 400,
    }]).png().toFile(tiny);
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 3,
        background: { r: 80, g: 50, b: 35 },
      },
    }).jpeg().toFile(jpeg);
    await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 200,
          height: 500,
          channels: 4,
          background: { r: 80, g: 50, b: 35, alpha: 1 },
        },
      },
      left: 100,
      top: 150,
    }]).png({ palette: true, colours: 16 }).toFile(indexed);

    expect((await inspectProductImage(tiny)).failures).toContain("content");
    expect((await inspectProductImage(jpeg)).failures).toContain("format");
    expect((await inspectProductImage(indexed)).failures).toContain("color-mode");
  });
});
