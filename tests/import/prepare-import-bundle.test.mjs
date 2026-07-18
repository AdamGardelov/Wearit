import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareImportBundle } from "../../scripts/prepare-import-bundle.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

const VALID_PLACEMENT = {
  anchorX: 0.5,
  anchorY: 0.38,
  scale: 0.66,
  rotationDegrees: 0,
  layerOrder: 40,
};

function accepted(overrides = {}) {
  return {
    file: "navy.png",
    name: "Navy cardigan",
    category: "jacket",
    colors: ["#172033", "#f2efe6"],
    tags: ["knit", "fair-isle", "zip"],
    placement: VALID_PLACEMENT,
    status: "accepted",
    ...overrides,
  };
}

async function writeRgbaPng(file, color = { r: 23, g: 32, b: 51 }) {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({
    create: {
      width: 12,
      height: 12,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { ...color, alpha: 1 },
        },
      }).png().toBuffer(),
      left: 2,
      top: 2,
    }])
    .png()
    .toFile(file);
}

async function writeRgbPng(file) {
  await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 20, g: 30, b: 40 },
    },
  }).png().toFile(file);
}

async function writeManifest(file, items, version = 1) {
  await writeFile(file, `${JSON.stringify({ version, items }, null, 2)}\n`);
}

async function allRelativeFiles(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await allRelativeFiles(directory, absolute));
    else files.push(path.relative(directory, absolute).split(path.sep).join("/"));
  }
  return files.sort();
}

describe("prepareImportBundle", () => {
  let workspace;
  let itemsDir;
  let manifestFile;
  let outputDir;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "wearit-bundle-test-"));
    itemsDir = path.join(workspace, "reviewed");
    manifestFile = path.join(workspace, "review.json");
    outputDir = path.join(workspace, "handoff");
    await mkdir(itemsDir);
    await writeRgbaPng(path.join(itemsDir, "navy.png"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("turns one accepted RGBA PNG into the version 1 Admin bundle", async () => {
    await writeManifest(manifestFile, [accepted()]);

    const result = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const [item] = bundle.items;

    expect(result).toMatchObject({ dryRun: false, changed: true, accepted: 1 });
    expect(bundle).toEqual({
      version: 1,
      items: [{
        id: item.id,
        file: `assets/${item.id}/cutout.png`,
        detailFiles: [],
        name: "Navy cardigan",
        category: "jacket",
        slot: "outerwear",
        colors: ["#172033", "#f2efe6"],
        tags: ["knit", "fair-isle", "zip"],
        placement: VALID_PLACEMENT,
        status: "accepted",
      }],
    });
    expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await readFile(path.join(outputDir, item.file))).toEqual(
      await readFile(path.join(itemsDir, "navy.png")),
    );
    expect(await allRelativeFiles(outputDir)).toEqual([
      `assets/${item.id}/cutout.png`,
      "manifest.json",
    ]);
  });

  it("skips every manifest record that is not accepted", async () => {
    await writeRgbaPng(path.join(itemsDir, "held.png"), { r: 100, g: 20, b: 20 });
    await writeManifest(manifestFile, [
      accepted(),
      accepted({ file: "held.png", status: "hold", category: "not-a-category" }),
      accepted({ file: "missing.png", status: "generate" }),
    ]);

    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    expect(bundle.items).toHaveLength(1);
    expect((await allRelativeFiles(outputDir)).some((file) => file.includes("held"))).toBe(false);
  });

  it.each([
    ["an RGB PNG without alpha", async ({ itemsDir }) => {
      await writeRgbPng(path.join(itemsDir, "navy.png"));
      return accepted();
    }, /alpha channel/i],
    ["an invalid category", async () => accepted({ category: "hat" }), /invalid category/i],
    ["an invalid color", async () => accepted({ colors: ["navy"] }), /six-digit hex/i],
    ["an invalid anchor", async () => accepted({ placement: { ...VALID_PLACEMENT, anchorX: 1.1 } }), /anchorX/i],
    ["an invalid scale", async () => accepted({ placement: { ...VALID_PLACEMENT, scale: 0 } }), /scale/i],
    ["an invalid rotation", async () => accepted({ placement: { ...VALID_PLACEMENT, rotationDegrees: 181 } }), /rotationDegrees/i],
    ["an invalid layer", async () => accepted({ placement: { ...VALID_PLACEMENT, layerOrder: 20.5 } }), /layerOrder/i],
    ["cutout path traversal", async ({ workspace }) => {
      await writeRgbaPng(path.join(workspace, "outside.png"));
      return accepted({ file: "../outside.png" });
    }, /inside the items directory/i],
  ])("rejects %s before creating output", async (_label, arrange, expected) => {
    const item = await arrange({ workspace, itemsDir });
    await writeManifest(manifestFile, [item]);

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir })).rejects.toThrow(expected);
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an output directory nested inside the reviewed items directory", async () => {
    await writeManifest(manifestFile, [accepted()]);
    const nestedParent = path.join(itemsDir, "bundles");
    outputDir = path.join(nestedParent, "handoff");

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/outputDir.*itemsDir|itemsDir.*outputDir/i);
    await expect(access(nestedParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires itemsDir itself to be an existing real directory", async () => {
    const missingItems = path.join(workspace, "missing-reviewed");
    await writeManifest(manifestFile, [accepted({ status: "hold" })]);

    await expect(prepareImportBundle({ itemsDir: missingItems, manifestFile, outputDir }))
      .rejects.toThrow(/itemsDir.*existing real directory/i);
    await expect(access(missingItems)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an items directory nested inside the output directory", async () => {
    outputDir = path.join(workspace, "containing-output");
    itemsDir = path.join(outputDir, "reviewed");
    await mkdir(itemsDir, { recursive: true });
    await writeRgbaPng(path.join(itemsDir, "navy.png"));
    await writeManifest(manifestFile, [accepted()]);

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/outputDir.*itemsDir|itemsDir.*outputDir/i);
  });

  it("resolves an existing symlinked output parent before containment checks", async () => {
    await writeManifest(manifestFile, [accepted()]);
    const alias = path.join(workspace, "reviewed-alias");
    await symlink(itemsDir, alias, "dir");
    const nestedParent = path.join(itemsDir, "bundle-via-alias");
    outputDir = path.join(alias, "bundle-via-alias", "handoff");

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/outputDir.*itemsDir|itemsDir.*outputDir/i);
    await expect(access(nestedParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resolves a symlinked manifest and rejects its real location inside output", async () => {
    outputDir = path.join(workspace, "handoff");
    await mkdir(outputDir);
    const realManifest = path.join(outputDir, "review.json");
    await writeManifest(realManifest, [accepted()]);
    const manifestAlias = path.join(workspace, "review-alias.json");
    await symlink(realManifest, manifestAlias);

    await expect(prepareImportBundle({ itemsDir, manifestFile: manifestAlias, outputDir }))
      .rejects.toThrow(/manifestFile.*outputDir|outputDir.*manifestFile/i);
    expect(await readFile(realManifest, "utf8")).toContain("Navy cardigan");
  });

  it("derives a stable ID from cutout bytes and leaves an identical bundle untouched", async () => {
    await writeManifest(manifestFile, [accepted()]);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const first = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const firstMtime = (await stat(path.join(outputDir, "manifest.json"))).mtimeMs;
    const firstAssetInode = (await stat(path.join(outputDir, first.items[0].file))).ino;

    const secondResult = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const second = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const secondMtime = (await stat(path.join(outputDir, "manifest.json"))).mtimeMs;

    expect(second.items[0].id).toBe(first.items[0].id);
    expect(secondResult.changed).toBe(false);
    expect(secondMtime).toBe(firstMtime);

    await writeManifest(manifestFile, [accepted({ name: "Updated navy cardigan" })]);
    const updatedResult = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const updated = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    expect(updated.items[0].id).toBe(first.items[0].id);
    expect(updated.items[0].name).toBe("Updated navy cardigan");
    expect(updatedResult.changed).toBe(true);
    expect((await stat(path.join(outputDir, updated.items[0].file))).ino).toBe(firstAssetInode);
  });

  it("sorts accepted items by their content-derived IDs", async () => {
    await writeRgbaPng(path.join(itemsDir, "cream.png"), { r: 242, g: 239, b: 230 });
    const items = [
      accepted(),
      accepted({ file: "cream.png", name: "Cream cardigan", colors: ["#f2efe6"] }),
    ];
    await writeManifest(manifestFile, items);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const first = await readFile(path.join(outputDir, "manifest.json"), "utf8");

    await writeManifest(manifestFile, items.reverse());
    const result = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const second = await readFile(path.join(outputDir, "manifest.json"), "utf8");

    expect(second).toBe(first);
    expect(result.changed).toBe(false);
  });

  it("copies only explicitly referenced reviewed detail derivatives", async () => {
    await mkdir(path.join(itemsDir, "details"));
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#172033" } })
      .webp()
      .toFile(path.join(itemsDir, "details", "back.webp"));
    await writeFile(path.join(itemsDir, "details", "source-photo.jpg"), "private raw source");
    await writeManifest(manifestFile, [accepted({ detailFiles: ["details/back.webp"] })]);

    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const [item] = bundle.items;
    expect(item.detailFiles).toEqual([`assets/${item.id}/details/back.webp`]);
    expect(await allRelativeFiles(outputDir)).toEqual([
      `assets/${item.id}/cutout.png`,
      `assets/${item.id}/details/back.webp`,
      "manifest.json",
    ]);
  });

  it("rejects detail path traversal", async () => {
    await writeFile(path.join(workspace, "private-source.jpg"), "must stay local");
    await writeManifest(manifestFile, [accepted({ detailFiles: ["../private-source.jpg"] })]);

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/inside the items directory/i);
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates every accepted record before replacing an existing bundle", async () => {
    await writeManifest(manifestFile, [accepted()]);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const beforeManifest = await readFile(path.join(outputDir, "manifest.json"));
    const beforeFiles = await allRelativeFiles(outputDir);

    await writeManifest(manifestFile, [accepted(), accepted({ file: "missing.png" })]);
    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir })).rejects.toThrow(/missing\.png/i);

    expect(await readFile(path.join(outputDir, "manifest.json"))).toEqual(beforeManifest);
    expect(await allRelativeFiles(outputDir)).toEqual(beforeFiles);
  });

  it("replaces a tampered asset symlink instead of carrying it into a new bundle", async () => {
    await writeManifest(manifestFile, [accepted()]);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const asset = path.join(outputDir, bundle.items[0].file);
    await rm(asset);
    await symlink(path.join(itemsDir, "navy.png"), asset);
    await writeManifest(manifestFile, [accepted({ name: "Updated navy cardigan" })]);

    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    expect((await lstat(asset)).isSymbolicLink()).toBe(false);
    expect(await readFile(asset)).toEqual(await readFile(path.join(itemsDir, "navy.png")));
  });

  it("does not reuse an asset inode that has an external hard link", async () => {
    await writeManifest(manifestFile, [accepted()]);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const asset = path.join(outputDir, bundle.items[0].file);
    const externalLink = path.join(workspace, "external-hard-link.png");
    await link(asset, externalLink);
    expect((await stat(asset)).nlink).toBe(2);
    const externalInode = (await stat(externalLink)).ino;
    await writeManifest(manifestFile, [accepted({ name: "Updated navy cardigan" })]);

    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    const updatedAsset = await stat(asset);
    expect(updatedAsset.ino).not.toBe(externalInode);
    expect(updatedAsset.nlink).toBe(1);
    expect((await stat(externalLink)).nlink).toBe(1);
  });

  it("returns the deterministic manifest without writing during a dry run", async () => {
    await writeManifest(manifestFile, [accepted()]);
    const missingParent = path.join(workspace, "missing", "nested");
    outputDir = path.join(missingParent, "handoff");

    const result = await prepareImportBundle({ itemsDir, manifestFile, outputDir, dryRun: true });

    expect(result).toMatchObject({ dryRun: true, changed: true, accepted: 1 });
    expect(result.manifest.items[0].file).toMatch(/^assets\/.+\/cutout\.png$/);
    await expect(access(path.join(workspace, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exposes the same preparer through the bundled thin CLI wrapper", async () => {
    await writeManifest(manifestFile, [accepted()]);

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(REPOSITORY_ROOT, ".agents/skills/import-clothes/scripts/import-to-wardrobe.mjs"),
      "--items", itemsDir,
      "--manifest", manifestFile,
      "--output", outputDir,
      "--dry-run",
    ], { cwd: REPOSITORY_ROOT });
    const result = JSON.parse(stdout);

    expect(result).toMatchObject({ dryRun: true, changed: true, accepted: 1 });
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never carries modeled, identity, source, or API-key fields and files into output", async () => {
    const apiKey = "sk-test-never-copy-this";
    await writeRgbaPng(path.join(itemsDir, "modeled.png"));
    await writeRgbaPng(path.join(itemsDir, "model-reference.png"));
    await writeFile(path.join(itemsDir, "source-photo.jpg"), "private original");
    await writeFile(path.join(itemsDir, ".env"), `OPENAI_API_KEY=${apiKey}\n`);
    await writeManifest(manifestFile, [accepted({
      modeledFile: "modeled.png",
      modelReference: "model-reference.png",
      sourceRefs: ["source-photo.jpg"],
      openaiApiKey: apiKey,
    })]);

    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    const files = await allRelativeFiles(outputDir);
    const manifest = await readFile(path.join(outputDir, "manifest.json"), "utf8");
    expect(files).toHaveLength(2);
    expect(manifest).not.toMatch(/modeled|model-reference|source-photo|OPENAI|sk-test/i);
  });

  it("rejects unsupported manifest versions", async () => {
    await writeManifest(manifestFile, [accepted()], 3);

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/version 1 or 2/i);
  });

  const ITEM_UUID = "96541a13-deb2-51da-bc91-8d0505624551";
  const FRONT_UUID = "11111111-1111-4111-8111-111111111111";
  const BACK_UUID = "22222222-2222-4222-8222-222222222222";

  function acceptedV2(overrides = {}) {
    return {
      id: ITEM_UUID,
      name: "Disco tee",
      category: "top",
      wearLayerFile: "wear-layer.png",
      images: [
        { id: FRONT_UUID, file: "images/front.webp", view: "front", sortOrder: 0, isPrimary: true },
        { id: BACK_UUID, file: "images/back.webp", view: "back", sortOrder: 1, isPrimary: false },
      ],
      colors: ["#202020"],
      tags: ["tshirt"],
      placement: VALID_PLACEMENT,
      status: "accepted",
      ...overrides,
    };
  }

  async function writeV2Sources() {
    await writeRgbaPng(path.join(itemsDir, "wear-layer.png"));
    await mkdir(path.join(itemsDir, "images"), { recursive: true });
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#202020" } })
      .webp().toFile(path.join(itemsDir, "images", "front.webp"));
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#303030" } })
      .webp().toFile(path.join(itemsDir, "images", "back.webp"));
  }

  it("turns an accepted v2 item into a wear-layer plus product-image bundle", async () => {
    await writeV2Sources();
    await writeManifest(manifestFile, [acceptedV2()], 2);

    const result = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));

    expect(result).toMatchObject({ changed: true, accepted: 1 });
    expect(bundle.version).toBe(2);
    expect(bundle.items[0]).toMatchObject({
      id: ITEM_UUID,
      slot: "top",
      wearLayerFile: `assets/${ITEM_UUID}/wear-layer.png`,
      images: [
        { id: FRONT_UUID, file: `assets/${ITEM_UUID}/images/front.webp`, view: "front", sortOrder: 0, isPrimary: true },
        { id: BACK_UUID, file: `assets/${ITEM_UUID}/images/back.webp`, view: "back", sortOrder: 1, isPrimary: false },
      ],
    });
    expect(await allRelativeFiles(outputDir)).toEqual([
      `assets/${ITEM_UUID}/images/back.webp`,
      `assets/${ITEM_UUID}/images/front.webp`,
      `assets/${ITEM_UUID}/wear-layer.png`,
      "manifest.json",
    ]);
  });

  it("preserves the reviewed UUID and leaves an identical v2 bundle untouched", async () => {
    await writeV2Sources();
    await writeManifest(manifestFile, [acceptedV2()], 2);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });

    const second = await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));

    expect(second.changed).toBe(false);
    expect(bundle.items[0].id).toBe(ITEM_UUID);
  });

  it("rejects a v2 item whose primary image is not the front", async () => {
    await writeV2Sources();
    await writeManifest(manifestFile, [acceptedV2({
      images: [
        { id: FRONT_UUID, file: "images/front.webp", view: "front", sortOrder: 0, isPrimary: false },
        { id: BACK_UUID, file: "images/back.webp", view: "back", sortOrder: 1, isPrimary: true },
      ],
    })], 2);

    await expect(prepareImportBundle({ itemsDir, manifestFile, outputDir }))
      .rejects.toThrow(/primary/i);
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the SHA-256 cutout digest as the sole stable-ID input", async () => {
    await writeManifest(manifestFile, [accepted()]);
    await prepareImportBundle({ itemsDir, manifestFile, outputDir });
    const bundle = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));

    const digest = createHash("sha256")
      .update(await readFile(path.join(itemsDir, "navy.png")))
      .digest("hex")
      .slice(0, 32)
      .split("");
    digest[12] = "5";
    digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
    const hex = digest.join("");
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    expect(bundle.items[0].id).toBe(expected);
  });
});
