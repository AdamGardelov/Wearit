import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const CATEGORY_SLOTS = Object.freeze({
  top: "top",
  bottom: "bottom",
  dress: "dress",
  jacket: "outerwear",
  coat: "outerwear",
  shoes: "shoes",
  accessory: "accessory",
});
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DETAIL_FORMATS = new Set(["jpeg", "png", "webp"]);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalExistingFile(value, label) {
  let resolved;
  try {
    resolved = await realpath(path.resolve(value));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new Error(`${label} must be an existing real file`);
    }
    throw error;
  }
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} must be an existing real file`);
  return resolved;
}

async function canonicalExistingDirectory(value, label) {
  let resolved;
  try {
    resolved = await realpath(path.resolve(value));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new Error(`${label} must be an existing real directory`);
    }
    throw error;
  }
  if (!(await stat(resolved)).isDirectory()) throw new Error(`${label} must be an existing real directory`);
  return resolved;
}

async function canonicalPotentialDirectory(value, label) {
  const requested = path.resolve(value);
  let existing = requested;
  const missing = [];

  while (true) {
    try {
      const resolved = await realpath(existing);
      const info = await stat(resolved);
      if (missing.length && !info.isDirectory()) {
        throw new Error(`${label} must be a directory or have a directory ancestor`);
      }
      const canonical = path.resolve(resolved, ...missing);
      if (!missing.length && !info.isDirectory()) throw new Error(`${label} must be a directory`);
      return canonical;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error(`${label} has no existing directory ancestor`);
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

function canonicalRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must stay inside the items directory`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== value) {
    throw new Error(`${label} must stay inside the items directory`);
  }
  return normalized;
}

async function resolveReviewedFile(itemsRoot, reference, label) {
  const relative = canonicalRelativePath(reference, label);
  const candidate = path.resolve(itemsRoot, ...relative.split("/"));
  if (!isInside(itemsRoot, candidate)) throw new Error(`${label} must stay inside the items directory`);

  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} not found: ${reference}`);
    throw error;
  }
  if (!isInside(itemsRoot, resolved)) throw new Error(`${label} must stay inside the items directory`);
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} is not a file: ${reference}`);
  return { relative, absolute: resolved };
}

function stableUuidFromSha256(bytes) {
  const digits = createHash("sha256").update(bytes).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16], 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function normalizeText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} must be at most ${maximum} characters`);
  return normalized;
}

function normalizeColors(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one six-digit hex color`);
  return value.map((color, index) => {
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new Error(`${label}[${index}] must be a six-digit hex color`);
    }
    return color.toLowerCase();
  });
}

function normalizeTags(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) throw new Error(`${label} must contain at most 12 tags`);
  return value.map((tag, index) => normalizeText(tag, `${label}[${index}]`, 40).toLowerCase());
}

function numberInRange(value, label, minimum, maximum, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    const suffix = integer ? " integer" : " number";
    throw new Error(`${label} must be a${suffix} from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizePlacement(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required`);
  return {
    anchorX: numberInRange(value.anchorX, `${label}.anchorX`, 0, 1),
    anchorY: numberInRange(value.anchorY, `${label}.anchorY`, 0, 1),
    scale: numberInRange(value.scale, `${label}.scale`, 0.05, 2),
    rotationDegrees: numberInRange(value.rotationDegrees, `${label}.rotationDegrees`, -180, 180),
    layerOrder: numberInRange(value.layerOrder, `${label}.layerOrder`, 0, 100, true),
  };
}

async function validateCutout(file, label) {
  const bytes = await readFile(file);
  const image = sharp(bytes);
  const metadata = await image.metadata();
  if (metadata.format !== "png") throw new Error(`${label} must be a PNG`);
  if (!metadata.hasAlpha || metadata.channels !== 4) throw new Error(`${label} must be an RGBA PNG with an alpha channel`);
  const alpha = (await image.stats()).channels[3];
  if (!alpha || alpha.min !== 0 || alpha.max === 0) {
    throw new Error(`${label} must contain transparent and visible pixels`);
  }
  return bytes;
}

async function validateDetail(file, label) {
  const bytes = await readFile(file);
  const metadata = await sharp(bytes).metadata();
  if (!DETAIL_FORMATS.has(metadata.format)) throw new Error(`${label} must be a PNG, JPEG, or WebP derivative`);
  if (!metadata.width || !metadata.height) throw new Error(`${label} has invalid dimensions`);
  return bytes;
}

async function prepareAcceptedItem(raw, index, itemsRoot) {
  const label = `items[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`);

  const category = raw.category;
  const slot = CATEGORY_SLOTS[category];
  if (!slot) throw new Error(`${label}: invalid category ${String(category)}`);
  if (raw.slot !== undefined && raw.slot !== slot) {
    throw new Error(`${label}.slot must be ${slot} for category ${category}`);
  }

  const cutout = await resolveReviewedFile(itemsRoot, raw.file, `${label}.file`);
  const cutoutBytes = await validateCutout(cutout.absolute, `${label}.file (${raw.file})`);
  const id = stableUuidFromSha256(cutoutBytes);
  const rawDetails = raw.detailFiles ?? [];
  if (!Array.isArray(rawDetails)) throw new Error(`${label}.detailFiles must be an array`);

  const details = [];
  const detailNames = new Set();
  for (let detailIndex = 0; detailIndex < rawDetails.length; detailIndex += 1) {
    const source = await resolveReviewedFile(itemsRoot, rawDetails[detailIndex], `${label}.detailFiles[${detailIndex}]`);
    const name = path.posix.basename(source.relative);
    if (detailNames.has(name)) throw new Error(`${label}.detailFiles has duplicate output name: ${name}`);
    detailNames.add(name);
    details.push({
      source: source.absolute,
      bytes: await validateDetail(source.absolute, `${label}.detailFiles[${detailIndex}]`),
      output: `assets/${id}/details/${name}`,
    });
  }
  details.sort((left, right) => left.output.localeCompare(right.output));

  return {
    id,
    cutoutBytes,
    details,
    manifest: {
      id,
      file: `assets/${id}/cutout.png`,
      detailFiles: details.map((detail) => detail.output),
      name: normalizeText(raw.name, `${label}.name`, 120),
      category,
      slot,
      colors: normalizeColors(raw.colors, `${label}.colors`),
      tags: normalizeTags(raw.tags, `${label}.tags`),
      placement: normalizePlacement(raw.placement, `${label}.placement`),
      status: "accepted",
    },
  };
}

async function readBundleInput(manifestFile) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in manifest: ${manifestFile}`);
    throw error;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Manifest must be an object");
  if (manifest.version !== 1) throw new Error("Manifest must use version 1");
  if (!Array.isArray(manifest.items)) throw new Error("Manifest must contain an items array");
  return manifest;
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort();
}

async function currentBundleMatches(outputDir, manifestText, prepared) {
  try {
    const outputInfo = await lstat(outputDir);
    if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) return false;
    const manifestPath = path.join(outputDir, "manifest.json");
    const manifestInfo = await lstat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) return false;
    if (await readFile(manifestPath, "utf8") !== manifestText) return false;

    const expectedFiles = ["manifest.json"];
    for (const item of prepared) {
      expectedFiles.push(item.manifest.file, ...item.manifest.detailFiles);
      const cutoutPath = path.join(outputDir, item.manifest.file);
      const cutoutInfo = await lstat(cutoutPath);
      if (!cutoutInfo.isFile() || cutoutInfo.isSymbolicLink()) return false;
      if (!Buffer.from(await readFile(cutoutPath)).equals(item.cutoutBytes)) return false;
      for (const detail of item.details) {
        const detailPath = path.join(outputDir, detail.output);
        const detailInfo = await lstat(detailPath);
        if (!detailInfo.isFile() || detailInfo.isSymbolicLink()) return false;
        if (!Buffer.from(await readFile(detailPath)).equals(detail.bytes)) return false;
      }
    }
    return JSON.stringify(await listFiles(outputDir)) === JSON.stringify(expectedFiles.sort());
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function writeOrReuseAsset(staging, currentOutput, relative, bytes) {
  const destination = path.join(staging, relative);
  try {
    const current = path.join(currentOutput, relative);
    const currentInfo = await lstat(current);
    if (
      currentInfo.isFile()
      && !currentInfo.isSymbolicLink()
      && currentInfo.nlink === 1
      && Buffer.from(await readFile(current)).equals(bytes)
    ) {
      await link(current, destination);
      return;
    }
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "EXDEV", "EPERM"].includes(error.code)) throw error;
  }
  await writeFile(destination, bytes);
}

async function stageBundle(parent, outputName, currentOutput, manifestText, prepared) {
  const staging = await mkdtemp(path.join(parent, `.${outputName}.tmp-`));
  try {
    for (const item of prepared) {
      const assetDir = path.join(staging, "assets", item.id);
      await mkdir(path.join(assetDir, "details"), { recursive: true });
      await writeOrReuseAsset(staging, currentOutput, item.manifest.file, item.cutoutBytes);
      for (const detail of item.details) {
        await writeOrReuseAsset(staging, currentOutput, detail.output, detail.bytes);
      }
    }
    await writeFile(path.join(staging, "manifest.json"), manifestText);
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function installStagedBundle(staging, outputDir) {
  let existing = false;
  try {
    const info = await lstat(outputDir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Output path must be a real directory: ${outputDir}`);
    existing = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!existing) {
    await rename(staging, outputDir);
    return;
  }

  const backup = `${outputDir}.backup-${randomUUID()}`;
  await rename(outputDir, backup);
  try {
    await rename(staging, outputDir);
  } catch (error) {
    await rename(backup, outputDir);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

export async function prepareImportBundle({ itemsDir, manifestFile, outputDir, dryRun = false }) {
  if (!itemsDir || !manifestFile || !outputDir) {
    throw new Error("itemsDir, manifestFile, and outputDir are required");
  }

  const itemsPath = await canonicalExistingDirectory(itemsDir, "itemsDir");
  const manifestPath = await canonicalExistingFile(manifestFile, "manifestFile");
  const outputPath = await canonicalPotentialDirectory(outputDir, "outputDir");
  if (isInside(itemsPath, outputPath) || isInside(outputPath, itemsPath)) {
    throw new Error("outputDir and itemsDir must not contain one another");
  }
  if (isInside(outputPath, manifestPath)) {
    throw new Error("manifestFile must not be inside or equal to outputDir");
  }

  const input = await readBundleInput(manifestPath);
  const prepared = [];
  for (let index = 0; index < input.items.length; index += 1) {
    if (input.items[index]?.status !== "accepted") continue;
    prepared.push(await prepareAcceptedItem(input.items[index], index, itemsPath));
  }
  prepared.sort((left, right) => left.id.localeCompare(right.id));

  const seenIds = new Set();
  for (const item of prepared) {
    if (seenIds.has(item.id)) throw new Error(`Duplicate accepted cutout content: ${item.id}`);
    seenIds.add(item.id);
  }

  const manifest = { version: 1, items: prepared.map((item) => item.manifest) };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const changed = !(await currentBundleMatches(outputPath, manifestText, prepared));
  const result = {
    dryRun: Boolean(dryRun),
    changed,
    accepted: prepared.length,
    outputDir: outputPath,
    manifest,
  };
  if (dryRun || !changed) return result;

  const parent = path.dirname(outputPath);
  const outputName = path.basename(outputPath);
  await mkdir(parent, { recursive: true });
  const staging = await stageBundle(parent, outputName, outputPath, manifestText, prepared);
  try {
    await installStagedBundle(staging, outputPath);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return result;
}
